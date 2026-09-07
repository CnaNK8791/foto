const express = require('express');
const path = require('path');
const { chromium } = require('playwright');
const { runFlightExtraction, formatEntries } = require('./flightParser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MIN_SIZE = 200;
const MAX_SIZE = 3840;
const MAX_DELAY_MS = 30000; // доп. пауза перед снимком после загрузки
const MIN_TIMEOUT_S = 5;
const MAX_TIMEOUT_S = 120;
const DEFAULT_TIMEOUT_S = 45;
const MAX_SCROLL_PX = 20000; // прокрутка вниз перед снимком
const SCROLL_STEP_PX = 700;
const SCROLL_STEP_DELAY_MS = 400;
const SCROLL_STEP_NETWORKIDLE_MS = 800;
const SCROLL_FINAL_NETWORKIDLE_MS = 3000;
const WAIT_STRATEGIES = new Set(['load', 'domcontentloaded', 'networkidle']);

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Как clamp(), но для необязательных полей: если значение не передано (или
// не число), возвращает null, а не какое-то дефолтное число — так можно
// отличить "клик не нужен" от "клик по координате 0".
function clampOptional(value, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Укажите адрес страницы');
  }
  let candidate = raw.trim();
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Некорректный URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Поддерживаются только http и https адреса');
  }
  return parsed.toString();
}

function buildFilename(pageUrl, ext) {
  const host = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/[^a-z0-9.-]/gi, '_');
    } catch {
      return 'screenshot';
    }
  })();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${host}_${stamp}.${ext}`;
}

function friendlyNavError(err) {
  if (err.name === 'TimeoutError' || /Timeout/i.test(err.message)) {
    return 'Страница не загрузилась вовремя (тайм-аут).';
  }
  if (/ERR_NAME_NOT_RESOLVED|net::ERR/i.test(err.message)) {
    return 'Не удалось открыть указанный адрес. Проверьте URL.';
  }
  return null;
}

// Открывает страницу в headless-браузере и дожидается её загрузки по
// параметрам, заданным пользователем (стратегия/тайм-аут/доп. задержка).
// Вызывающий код обязан закрыть browser в finally.
async function openPage(targetUrl, { width, height, waitUntil, navTimeoutMs, delay }) {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const context = await browser.newContext({
    viewport: { width, height },
    userAgent: 'Mozilla/5.0 (compatible; FotoScreenshotBot/1.0; +https://github.com/)',
  });
  const page = await context.newPage();

  await page.goto(targetUrl, { waitUntil, timeout: navTimeoutMs });

  // Если пользователь не выбрал строгое ожидание "тишины сети" сам, даём
  // странице немного "успокоиться" по умолчанию (доп. запросы, реклама,
  // аналитика), но не проваливаем запрос, если сеть так и не затихла —
  // многие сайты держат соединения открытыми бесконечно.
  if (waitUntil !== 'networkidle') {
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  if (delay > 0) {
    await page.waitForTimeout(delay);
  }

  return { browser, page };
}

// Прокручивает страницу вниз небольшими шагами (как реальный пользователь),
// с паузой и попыткой дождаться "тишины в сети" после каждого шага. Многие
// сайты (например, списки результатов поиска) подгружают контент отдельными
// порциями через API по мере прокрутки (infinite scroll) — один большой
// "прыжок" вниз и короткая фиксированная пауза этого не дожидаются, и часть
// карточек остаётся в виде "заглушек" (skeleton/shimmer-плейсхолдеры).
// Пошаговая прокрутка даёт каждой такой подгрузке шанс сработать и успеть
// отрисоваться, прежде чем мы пойдём дальше вниз.
async function scrollPageDown(page, targetY) {
  let scrolled = 0;
  while (scrolled < targetY) {
    const step = Math.min(SCROLL_STEP_PX, targetY - scrolled);
    await page.evaluate((y) => window.scrollBy(0, y), step);
    scrolled += step;
    await page.waitForTimeout(SCROLL_STEP_DELAY_MS);
    await page.waitForLoadState('networkidle', { timeout: SCROLL_STEP_NETWORKIDLE_MS }).catch(() => {});
  }
  // Финальная более долгая пауза — на случай, если последняя порция
  // контента ещё дозагружается после того, как мы дошли до цели.
  await page.waitForLoadState('networkidle', { timeout: SCROLL_FINAL_NETWORKIDLE_MS }).catch(() => {});
}

function readCommonParams(body) {
  const width = clamp(body?.width, MIN_SIZE, MAX_SIZE, 1280);
  const height = clamp(body?.height, MIN_SIZE, MAX_SIZE, 800);
  const delay = clamp(body?.delay, 0, MAX_DELAY_MS, 0);
  const timeoutS = clamp(body?.timeout, MIN_TIMEOUT_S, MAX_TIMEOUT_S, DEFAULT_TIMEOUT_S);
  const waitUntil = WAIT_STRATEGIES.has(body?.waitUntil) ? body.waitUntil : 'load';
  return { width, height, delay, navTimeoutMs: timeoutS * 1000, waitUntil };
}

app.post('/api/screenshot', async (req, res) => {
  const { url, fullPage, format } = req.body || {};
  const common = readCommonParams(req.body);
  const shotFormat = format === 'jpeg' ? 'jpeg' : 'png';
  const scrollY = clamp(req.body?.scrollY, 0, MAX_SCROLL_PX, 0);
  // Координаты клика — относительно окна браузера (common.width x
  // common.height), то есть именно то, что видно на итоговом снимке (без
  // "Вся страница целиком") или в текущей прокрученной области (с ней).
  const clickX = clampOptional(req.body?.clickX, 0, common.width);
  const clickY = clampOptional(req.body?.clickY, 0, common.height);
  const hasClick = clickX !== null && clickY !== null;

  let targetUrl;
  try {
    targetUrl = normalizeUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let browser;
  try {
    const opened = await openPage(targetUrl, common);
    browser = opened.browser;
    const page = opened.page;

    if (scrollY > 0) {
      // Прокручиваем страницу вниз на заданное число пикселей — это
      // сдвигает область для обычного снимка (например, чтобы убрать из
      // кадра "прилипшую" шапку/баннер) и заодно помогает подгрузить
      // "ленивый" контент (карточки/изображения, которые появляются только
      // при прокрутке) перед снимком всей страницы. Делаем это шагами, а не
      // одним прыжком — см. scrollPageDown.
      await scrollPageDown(page, scrollY);
    }

    if (hasClick) {
      // Клик "вслепую" по координатам (без поиска элемента под курсором) —
      // работает даже если под точкой лежит что-то нестандартное, и не
      // падает с ошибкой, если там в итоге ничего интерактивного не
      // окажется. Выполняется после прокрутки и прямо перед снимком, чтобы
      // визуальный эффект клика (открывшееся меню/подсказка, закрывшийся
      // баннер) гарантированно попал в кадр.
      await page.mouse.click(clickX, clickY);
      await page.waitForTimeout(300);
      await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    }

    const buffer = await page.screenshot({
      fullPage: Boolean(fullPage),
      type: shotFormat,
    });

    const filename = buildFilename(targetUrl, shotFormat === 'jpeg' ? 'jpg' : 'png');
    res.setHeader('Content-Type', shotFormat === 'jpeg' ? 'image/jpeg' : 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Ошибка при создании скриншота:', err.message);
    const message = friendlyNavError(err) || 'Не удалось сделать скриншот страницы.';
    res.status(502).json({ error: message });
  } finally {
    if (browser) await browser.close();
  }
});

app.post('/api/extract-element', async (req, res) => {
  const { url, selector } = req.body || {};
  const common = readCommonParams(req.body);

  let targetUrl;
  try {
    targetUrl = normalizeUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (typeof selector !== 'string' || !selector.trim()) {
    return res.status(400).json({ error: 'Укажите CSS-селектор элемента' });
  }

  let browser;
  try {
    const opened = await openPage(targetUrl, common);
    browser = opened.browser;
    const page = opened.page;

    const locator = page.locator(selector);
    const count = await locator.count();
    if (count === 0) {
      return res.status(404).json({
        error: `Элемент по селектору "${selector}" не найден на странице.`,
      });
    }

    const target = locator.first();
    const [outerHTML, textContent] = await Promise.all([
      target.evaluate((el) => el.outerHTML),
      target.evaluate((el) => el.textContent?.trim() ?? ''),
    ]);

    res.json({
      url: targetUrl,
      selector,
      matchCount: count,
      html: outerHTML,
      text: textContent,
      filename: buildFilename(targetUrl, 'html'),
    });
  } catch (err) {
    console.error('Ошибка при извлечении элемента:', err.message);
    let message = friendlyNavError(err);
    if (!message && /selector|Unexpected token|is not a valid selector/i.test(err.message)) {
      message = 'Некорректный CSS-селектор.';
    }
    res.status(502).json({ error: message || 'Не удалось извлечь элемент со страницы.' });
  } finally {
    if (browser) await browser.close();
  }
});

app.post('/api/extract-flights', async (req, res) => {
  const { url, format } = req.body || {};
  const common = readCommonParams(req.body);
  const outputFormat = format === 'short' ? 'short' : 'detailed';
  // Селектор теперь необязателен: если не задан, карточки рейсов ищутся
  // автоматически по тексту aria-label прямо в браузере (см. flightParser.js).
  const selectorRaw = req.body?.selector;
  const selector = typeof selectorRaw === 'string' && selectorRaw.trim() ? selectorRaw.trim() : null;

  let targetUrl;
  try {
    targetUrl = normalizeUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let browser;
  try {
    const opened = await openPage(targetUrl, common);
    browser = opened.browser;
    const page = opened.page;

    const { entries, blockCount, autoDetected } = await page.evaluate(runFlightExtraction, selector);

    if (blockCount === 0) {
      const message = selector
        ? `Блоки по селектору "${selector}" не найдены на странице.`
        : 'Не удалось автоматически найти карточки рейсов на странице. Попробуйте указать CSS-селектор вручную или увеличить время ожидания/задержку.';
      return res.status(404).json({ error: message });
    }

    const text = formatEntries(entries, outputFormat);

    res.json({
      url: targetUrl,
      selector,
      autoDetected,
      format: outputFormat,
      matchCount: entries.length,
      entries,
      text,
      filename: buildFilename(targetUrl, 'txt'),
    });
  } catch (err) {
    console.error('Ошибка при извлечении списка рейсов:', err.message);
    let message = friendlyNavError(err);
    if (!message && /selector|Unexpected token|is not a valid selector/i.test(err.message)) {
      message = 'Некорректный CSS-селектор.';
    }
    res.status(502).json({ error: message || 'Не удалось извлечь блоки со страницы.' });
  } finally {
    if (browser) await browser.close();
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
