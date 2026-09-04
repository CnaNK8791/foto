const express = require('express');
const path = require('path');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MIN_SIZE = 200;
const MAX_SIZE = 3840;
const MAX_DELAY_MS = 5000;
const NAV_TIMEOUT_MS = 45000;

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

function buildFilename(pageUrl, format) {
  const host = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/[^a-z0-9.-]/gi, '_');
    } catch {
      return 'screenshot';
    }
  })();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  return `${host}_${stamp}.${ext}`;
}

app.post('/api/screenshot', async (req, res) => {
  const { url, fullPage, format } = req.body || {};
  const width = clamp(req.body?.width, MIN_SIZE, MAX_SIZE, 1280);
  const height = clamp(req.body?.height, MIN_SIZE, MAX_SIZE, 800);
  const delay = clamp(req.body?.delay, 0, MAX_DELAY_MS, 0);
  const shotFormat = format === 'jpeg' ? 'jpeg' : 'png';

  let targetUrl;
  try {
    targetUrl = normalizeUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let browser;
  try {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    });
    const context = await browser.newContext({
      viewport: { width, height },
      userAgent:
        'Mozilla/5.0 (compatible; FotoScreenshotBot/1.0; +https://github.com/)',
    });
    const page = await context.newPage();

    await page.goto(targetUrl, {
      waitUntil: 'load',
      timeout: NAV_TIMEOUT_MS,
    });

    // Даём странице немного "успокоиться" (доп. запросы, рекламa,
    // аналитика), но не проваливаем запрос, если сеть так и не затихла —
    // многие сайты держат соединения открытыми бесконечно.
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    if (delay > 0) {
      await page.waitForTimeout(delay);
    }

    const buffer = await page.screenshot({
      fullPage: Boolean(fullPage),
      type: shotFormat,
    });

    const filename = buildFilename(targetUrl, shotFormat);
    res.setHeader('Content-Type', shotFormat === 'jpeg' ? 'image/jpeg' : 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Ошибка при создании скриншота:', err.message);
    let message = 'Не удалось сделать скриншот страницы.';
    if (err.name === 'TimeoutError' || /Timeout/i.test(err.message)) {
      message = 'Страница не загрузилась вовремя (тайм-аут).';
    } else if (/ERR_NAME_NOT_RESOLVED|net::ERR/i.test(err.message)) {
      message = 'Не удалось открыть указанный адрес. Проверьте URL.';
    }
    res.status(502).json({ error: message });
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
