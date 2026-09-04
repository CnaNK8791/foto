// Парсинг карточек рейсов (структура вида trip.com: <div class="flight-info ...">).
// Специально опирается на устойчивые "семантические" признаки — data-testid и
// aria-label/role — а не на хэшированные CSS-классы вида "foo_8688", которые
// меняются между сборками сайта. Подробнее см. README раздел "Список рейсов".

// Эта функция целиком выполняется в браузере через page.evaluate(runFlightExtraction, selector) —
// внутри неё доступны только браузерные API (document, DOM), а не Node.js,
// поэтому все вспомогательные функции объявлены внутри неё же.
function runFlightExtraction(selector) {
  function findBlocks() {
    if (selector) {
      return Array.from(document.querySelectorAll(selector));
    }
    // Автоопределение карточек рейса: у trip.com (и, вероятно, у похожих
    // сайтов) карточка целиком помечена готовым для скринридеров текстом
    // вида "Flight departing from X at <дата-время> ... arriving ... at
    // <дата-время>" в aria-label. Это гораздо надёжнее любого CSS-класса —
    // такой текст не зависит от хэшей сборки и структуры вёрстки.
    const NARRATIVE_RE =
      /Flight departing from [\s\S]+? at \d{4}-\d{2}-\d{2}[\s\S]*?arriving[\s\S]+? at \d{4}-\d{2}-\d{2}/i;
    const candidates = Array.from(document.querySelectorAll('[aria-label]')).filter((el) =>
      NARRATIVE_RE.test(el.getAttribute('aria-label') || '')
    );
    // Если у подходящего элемента есть потомок, тоже подходящий под тот же
    // шаблон, значит текущий элемент — лишняя внешняя обёртка, а не сама
    // карточка. Оставляем только самые "внутренние" совпадения.
    return candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
  }

  function attrText(el, sel) {
    const found = el.querySelector(sel);
    return found ? (found.textContent || '').trim() : '';
  }

  // Разбирает "родное" aria-label карточки — trip.com сам формирует его как
  // готовый текст из нескольких предложений (разделены переносом строки),
  // например:
  //   "Flight departing from X at <дата> and arriving at Y at <дата>."
  //   "This is a nonstop flight with a duration of 2h 25m"
  //   "One-way price: RUB 8,933"
  // либо для рейсов со стыковкой:
  //   "The flight duration is 18 hours 40 minutes, including a layover of ..."
  // Обе формулировки ("duration of" и "duration is") распознаём как одно и
  // то же предложение и выводим его как есть, не пытаясь домыслить точный
  // смысл — формулировки самого trip.com иногда противоречивы/содержат
  // непереведённые плейсхолдеры (например "${2}"), это их особенность, а
  // не наша ошибка парсинга.
  function parseNarrative(ariaLabel) {
    const lines = (ariaLabel || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    let durationSentence = '';
    let priceSentence = '';
    for (const line of lines) {
      if (/duration\s+(is|of)/i.test(line)) durationSentence = line;
      if (/price\s*:/i.test(line)) priceSentence = line;
    }
    return { durationSentence, priceSentence };
  }

  // Вылет/прилёт: контейнер помечен классом, содержащим "is-departure" или
  // "is-arrival" (сам суффикс класса — хэш, но подстрока стабильна), у него
  // есть aria-label с полным названием аэропорта(+терминалом), внутри — span
  // с data-testid="flight-time-<точная дата-время>" и код аэропорта в
  // span'ах с классом, содержащим "flight-info-stop__code".
  function parseEndpoint(container) {
    if (!container) return { name: '', code: '', datetime: '' };
    const name = (container.getAttribute('aria-label') || '').trim();
    const timeEl = container.querySelector('[data-testid^="flight-time-"]');
    const datetime = timeEl
      ? (timeEl.getAttribute('data-testid') || '').replace(/^flight-time-/, '').trim() ||
        timeEl.textContent.trim()
      : '';
    const codeSpans = container.querySelectorAll('[class*="flight-info-stop__code"] span');
    const code = codeSpans.length ? codeSpans[0].textContent.trim() : '';
    return { name, code, datetime };
  }

  // Валюты и прочие частые ложные срабатывания ("RUB 12,450" похоже на
  // формат номера рейса "XX123") — отсекаем по известному коду.
  const NOT_A_FLIGHT_CODE = new Set([
    'RUB', 'USD', 'EUR', 'GBP', 'THB', 'SGD', 'CNY', 'JPY', 'AUD', 'CAD',
    'HKD', 'IDR', 'VND', 'MYR', 'PHP', 'KRW', 'INR', 'AED', 'CHF', 'KZT',
  ]);

  // Номер рейса нигде не гарантирован структурно (на реальных страницах
  // trip.com в списке результатов его вообще нет — см. buildAirlineCodeMap
  // ниже как запасной вариант). Ищем эвристически: сначала в элементах с
  // явным намёком в data-testid/class ("flight-no" и т.п.), затем по всему
  // тексту и атрибутам блока по паттерну "2-3 буквы + 2-4 цифры" (SL100,
  // TG201...), отсеивая слишком короткие/длинные совпадения и известные
  // коды валют.
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

  // На странице результатов trip.com в боковой панели фильтров есть список
  // авиакомпаний с их IATA-кодом (атрибут data-code) и полным названием
  // (aria-label соседнего элемента). Настоящего номера рейса в разметке
  // списка карточек нет вообще — если findFlightNumber ничего не нашла,
  // используем код авиакомпании как более честный запасной вариант, чем
  // прочерк на пустом месте (помечаем flightNumberIsAirlineCode: true).
  function buildAirlineCodeMap() {
    const map = {};
    document
      .querySelectorAll('[data-testid="filter_airline"] .filter-item[data-code]')
      .forEach((item) => {
        const code = item.getAttribute('data-code');
        const wrapper = item.querySelector('.filter-item-wrapper[aria-label]');
        const label = wrapper ? wrapper.getAttribute('aria-label') : '';
        if (code && label) map[label.trim()] = code;
      });
    return map;
  }

  function resolveAirlineCodes(airlineNames, codeMap) {
    if (!airlineNames) return '';
    return airlineNames
      .split(',')
      .map((name) => name.trim())
      .map((name) => codeMap[name] || '')
      .filter(Boolean)
      .join('/');
  }

  const blocks = findBlocks();
  const airlineCodeMap = buildAirlineCodeMap();

  const entries = blocks.map((block) => {
    const airline =
      attrText(block, '[data-testid="flights-name"]') ||
      attrText(block, '[class*="flights-name"]') ||
      attrText(block, '[class*="airline"]');

    const departureContainer = block.querySelector('[class*="is-departure"]');
    const arrivalContainer = block.querySelector('[class*="is-arrival"]');
    const departure = parseEndpoint(departureContainer);
    const arrival = parseEndpoint(arrivalContainer);
    const narrative = parseNarrative(block.getAttribute('aria-label'));

    // Общая длительность рейса — берём из выделенного UI-элемента, а не из
    // текста aria-label: он даёт короткий стабильный формат ("2h 25m",
    // "21h 45m") одинаково и для прямых, и для стыковочных рейсов.
    const durationEl = block.querySelector('[data-testid="flightInfoDuration"]');
    const duration = durationEl ? durationEl.textContent.trim() : '';

    // "Direct" для прямого рейса или описание пересадки вида
    // "18h 40m in Phu Quoc Island" для рейса со стыковкой.
    const stopsEl = block.querySelector('[data-testid="stopInfoText"]');
    const stopsText = stopsEl ? stopsEl.textContent.trim() : '';
    const hasStop = !!stopsText && stopsText.toLowerCase() !== 'direct';

    const priceMatch = narrative.priceSentence.match(/price\s*:\s*(.+)$/i);
    const price = priceMatch ? priceMatch[1].trim() : '';

    let flightNumber = findFlightNumber(block, narrative);
    let flightNumberIsAirlineCode = false;
    if (!flightNumber) {
      const code = resolveAirlineCodes(airline, airlineCodeMap);
      if (code) {
        flightNumber = code;
        flightNumberIsAirlineCode = true;
      }
    }

    return {
      airline,
      flightNumber,
      flightNumberIsAirlineCode,
      departure,
      arrival,
      duration,
      durationSentence: narrative.durationSentence,
      price,
      priceSentence: narrative.priceSentence,
      stopsText,
      hasStop,
    };
  });

  return {
    entries,
    blockCount: blocks.length,
    autoDetected: !selector,
  };
}

function combineAirport(endpoint) {
  const codePart = endpoint.code ? ` (${endpoint.code})` : '';
  return [`${endpoint.name}${codePart}`.trim(), endpoint.datetime].filter(Boolean).join(' ');
}

function formatDetailed(entry) {
  const lines = [entry.airline || 'Авиакомпания не найдена', `Flight: ${entry.flightNumber || '—'}`];
  lines.push(`Flight departing: ${combineAirport(entry.departure)}`);
  lines.push(`Flight arriving: ${combineAirport(entry.arrival)}`);
  if (entry.hasStop && entry.stopsText) lines.push(`Stop: ${entry.stopsText}`);
  if (entry.durationSentence) lines.push(entry.durationSentence);
  if (entry.priceSentence) lines.push(entry.priceSentence);
  return lines.join('\n');
}

function formatShort(entry) {
  const lines = [entry.airline || 'Авиакомпания не найдена', entry.flightNumber || '—'];
  lines.push([entry.departure.code, entry.departure.datetime].filter(Boolean).join(' '));
  lines.push([entry.arrival.code, entry.arrival.datetime].filter(Boolean).join(' '));
  if (entry.hasStop && entry.stopsText) lines.push(entry.stopsText);
  if (entry.duration) lines.push(entry.duration);
  if (entry.price) lines.push(entry.price);
  return lines.join('\n');
}

function formatEntries(entries, format) {
  const formatter = format === 'short' ? formatShort : formatDetailed;
  return entries.map(formatter).join('\n\n');
}

module.exports = { runFlightExtraction, formatEntries };
