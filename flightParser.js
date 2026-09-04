// Парсинг карточек рейсов (структура вида trip.com: <div class="flight-info ...">).
// Специально опирается на устойчивые "семантические" признаки — data-testid и
// aria-label/role — а не на хэшированные CSS-классы вида "foo_8688", которые
// меняются между сборками сайта. Подробнее см. README раздел "Список рейсов".

// Эта функция целиком выполняется в браузере через page.$$eval — внутри неё
// доступны только браузерные API (document, DOM), а не Node.js.
function extractFlightBlocksInBrowser(blocks) {
  function attrText(el, sel) {
    const found = el.querySelector(sel);
    return found ? (found.textContent || '').trim() : '';
  }

  // Аккуратно разбирает "родное" aria-label карточки — trip.com сам
  // формирует его как готовый текст вида:
  //   "Flight departing from X at <дата> and arriving at Y at <дата>."
  //   "This is a nonstop flight with a duration of 2h 25m"
  //   "One-way price: RUB 8,933"
  // Используем его как источник истины для длительности/цены — это надёжнее,
  // чем собирать их из отдельных хэшированных CSS-блоков.
  function parseNarrative(ariaLabel) {
    const lines = (ariaLabel || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    let durationSentence = '';
    let priceSentence = '';
    for (const line of lines) {
      if (/duration of/i.test(line)) durationSentence = line;
      if (/price\s*:/i.test(line)) priceSentence = line;
    }
    const durationMatch = durationSentence.match(/duration of ([^.]+)$/i);
    const priceMatch = priceSentence.match(/price\s*:\s*(.+)$/i);
    return {
      durationSentence,
      priceSentence,
      duration: durationMatch ? durationMatch[1].trim() : '',
      price: priceMatch ? priceMatch[1].trim() : '',
    };
  }

  // Вылет/прилёт: контейнер помечен классом, содержащим "is-departure" или
  // "is-arrival" (сам суффикс класса — хэш, но подстрока стабильна), у него
  // есть aria-label с полным названием аэропорта+терминалом, внутри — span с
  // data-testid="flight-time-<точная дата-время>" и код аэропорта в span'ах
  // с классом, содержащим "flight-info-stop__code".
  function parseEndpoint(container) {
    if (!container) return { name: '', code: '', datetime: '' };
    const name = (container.getAttribute('aria-label') || '').trim();
    const timeEl = container.querySelector('[data-testid^="flight-time-"]');
    const datetime = timeEl
      ? (timeEl.getAttribute('data-testid') || '').replace(/^flight-time-/, '').trim()
      : '';
    const codeSpans = container.querySelectorAll('[class*="flight-info-stop__code"] span');
    const code = codeSpans.length ? codeSpans[0].textContent.trim() : '';
    return { name, code, datetime: datetime || timeEl?.textContent.trim() || '' };
  }

  // Номер рейса нигде не гарантирован структурно — ищем эвристически:
  // сначала в элементах с явным намёком в data-testid/class ("flight-no" и
  // т.п.), затем по всему тексту и атрибутам блока по паттерну "2-3 буквы +
  // 2-4 цифры" (SL100, TG201...), отсеивая слишком короткие/длинные совпадения.
  // Валюты и прочие частые ложные срабатывания ("RUB 12,450" похоже на
  // формат номера рейса "XX123") — отсекаем по известному коду.
  const NOT_A_FLIGHT_CODE = new Set([
    'RUB', 'USD', 'EUR', 'GBP', 'THB', 'SGD', 'CNY', 'JPY', 'AUD', 'CAD',
    'HKD', 'IDR', 'VND', 'MYR', 'PHP', 'KRW', 'INR', 'AED', 'CHF', 'KZT',
  ]);

  function findFlightNumber(block, narrative) {
    const texts = [];
    const hinted = block.querySelector(
      '[data-testid*="flight-no" i], [data-testid*="flightno" i], [data-testid*="flight-number" i], [class*="flight-no" i], [class*="flightno" i], [class*="flight-number" i]'
    );
    if (hinted) {
      texts.push(hinted.textContent || '', hinted.getAttribute('aria-label') || '');
    }

    // Собственный aria-label блока — но без строк про цену/длительность:
    // они уже разобраны отдельно и часто дают ложные совпадения вида
    // "RUB 12,450" -> похоже на код рейса.
    const blockAria = block.getAttribute('aria-label') || '';
    const filteredAria = blockAria
      .split('\n')
      .filter((line) => line !== narrative.durationSentence && line !== narrative.priceSentence)
      .join('\n');
    texts.push(filteredAria);

    const walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = walker.nextNode())) {
      for (const attr of ['aria-label', 'title', 'alt', 'data-testid']) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v) texts.push(v);
      }
      if (el.children.length === 0) {
        const t = (el.textContent || '').trim();
        if (t && t.length <= 12) texts.push(t);
      }
    }

    const flightNoRegex = /\b([A-Z]{2,3})\s?-?\s?(\d{2,4})\b/g;
    for (const text of texts) {
      if (!text) continue;
      const matches = [...text.matchAll(flightNoRegex)]
        .filter((m) => !NOT_A_FLIGHT_CODE.has(m[1]))
        .map((m) => `${m[1]}${m[2]}`)
        .filter((m) => m.length >= 4 && m.length <= 7);
      if (matches.length) return matches[0];
    }
    return '';
  }

  return blocks.map((block) => {
    const airline =
      attrText(block, '[data-testid="flights-name"]') ||
      attrText(block, '[class*="flights-name"]') ||
      attrText(block, '[class*="airline"]');

    const departureContainer = block.querySelector('[class*="is-departure"]');
    const arrivalContainer = block.querySelector('[class*="is-arrival"]');
    const departure = parseEndpoint(departureContainer);
    const arrival = parseEndpoint(arrivalContainer);
    const narrative = parseNarrative(block.getAttribute('aria-label'));
    const flightNumber = findFlightNumber(block, narrative);

    return {
      airline,
      flightNumber,
      departure,
      arrival,
      duration: narrative.duration,
      durationSentence: narrative.durationSentence,
      price: narrative.price,
      priceSentence: narrative.priceSentence,
    };
  });
}

function combineAirport(endpoint) {
  const codePart = endpoint.code ? ` (${endpoint.code})` : '';
  return [`${endpoint.name}${codePart}`.trim(), endpoint.datetime].filter(Boolean).join(' ');
}

function formatDetailed(entry) {
  const lines = [entry.airline || 'Авиакомпания не найдена', `Flight: ${entry.flightNumber || '—'}`];
  lines.push(`Flight departing: ${combineAirport(entry.departure)}`);
  lines.push(`Flight arriving: ${combineAirport(entry.arrival)}`);
  if (entry.durationSentence) lines.push(entry.durationSentence);
  if (entry.priceSentence) lines.push(entry.priceSentence);
  return lines.join('\n');
}

function formatShort(entry) {
  const lines = [entry.airline || 'Авиакомпания не найдена', entry.flightNumber || '—'];
  lines.push([entry.departure.code, entry.departure.datetime].filter(Boolean).join(' '));
  lines.push([entry.arrival.code, entry.arrival.datetime].filter(Boolean).join(' '));
  if (entry.duration) lines.push(entry.duration);
  if (entry.price) lines.push(entry.price);
  return lines.join('\n');
}

function formatEntries(entries, format) {
  const formatter = format === 'short' ? formatShort : formatDetailed;
  return entries.map(formatter).join('\n\n');
}

module.exports = { extractFlightBlocksInBrowser, formatEntries };
