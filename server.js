const express = require('express');
const path = require('path');
const { chromium } = require('playwright');
const { extractFlightBlocksInBrowser, formatEntries } = require('./flightParser');

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
const WAIT_STRATEGIES = new Set(['load', 'domcontentloaded', 'networkidle']);

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
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
  const { url, selector, format } = req.body || {};
  const common = readCommonParams(req.body);
  const outputFormat = format === 'short' ? 'short' : 'detailed';

  let targetUrl;
  try {
    targetUrl = normalizeUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (typeof selector !== 'string' || !selector.trim()) {
    return res.status(400).json({ error: 'Укажите CSS-селектор блока (например, .flight-info)' });
  }

  let browser;
  try {
    const opened = await openPage(targetUrl, common);
    browser = opened.browser;
    const page = opened.page;

    const count = await page.locator(selector).count();
    if (count === 0) {
      return res.status(404).json({
        error: `Блоки по селектору "${selector}" не найдены на странице.`,
      });
    }

    const entries = await page.$$eval(selector, extractFlightBlocksInBrowser);
    const text = formatEntries(entries, outputFormat);

    res.json({
      url: targetUrl,
      selector,
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
