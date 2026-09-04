// --- Переключение вкладок ---------------------------------------------
const tabs = document.querySelectorAll('.tab');
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.panel').forEach((panel) => {
      panel.hidden = panel.id !== tab.dataset.target;
    });
  });
});

// Страница открыта напрямую как файл (двойным кликом), а не через сервер —
// backend недоступен, запросы работать не будут.
function warnIfOpenedAsFile(statusSetter) {
  if (location.protocol === 'file:') {
    statusSetter(
      'Похоже, страница открыта напрямую из файла, а не через сервер. ' +
        'Запустите приложение командой "npm start" и откройте http://localhost:3000 — ' +
        'иначе запросы к серверу будут падать с ошибкой "Failed to fetch".',
      'error'
    );
  }
}

function filenameFromDisposition(header) {
  if (!header) return 'screenshot.png';
  const match = /filename="?([^"]+)"?/i.exec(header);
  return match ? match[1] : 'screenshot.png';
}

function describeNetworkError(err) {
  const isNetworkError = err instanceof TypeError;
  return isNetworkError
    ? 'Не удалось связаться с сервером. Убедитесь, что приложение запущено (npm start) и страница открыта через http://localhost:3000.'
    : err.message || 'Произошла ошибка';
}

// --- Режим "Скриншот" ---------------------------------------------------
(function initScreenshotForm() {
  const form = document.getElementById('shot-form');
  const submitBtn = document.getElementById('submit-btn');
  const statusEl = document.getElementById('shot-status');
  const resultEl = document.getElementById('shot-result');
  const previewEl = document.getElementById('preview');
  const downloadLink = document.getElementById('download-link');

  let lastObjectUrl = null;

  function setStatus(message, type) {
    statusEl.hidden = !message;
    statusEl.textContent = message || '';
    statusEl.className = `status ${type || ''}`.trim();
  }

  warnIfOpenedAsFile(setStatus);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      url: document.getElementById('url').value,
      fullPage: document.getElementById('fullPage').checked,
      format: document.getElementById('format').value,
      width: document.getElementById('width').value,
      height: document.getElementById('height').value,
      delay: document.getElementById('delay').value,
      timeout: document.getElementById('timeout').value,
      waitUntil: document.getElementById('waitUntil').value,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Снимаем скриншот…';
    setStatus('Открываем страницу и делаем снимок, подождите…', 'ok');
    resultEl.hidden = true;

    try {
      const response = await fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let message = 'Не удалось сделать скриншот.';
        try {
          const data = await response.json();
          if (data?.error) message = data.error;
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get('Content-Disposition'));

      if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
      lastObjectUrl = URL.createObjectURL(blob);

      previewEl.src = lastObjectUrl;
      downloadLink.href = lastObjectUrl;
      downloadLink.download = filename;
      resultEl.hidden = false;

      setStatus('Готово! Фото сохраняется на устройство…', 'ok');

      // Автоматически сохраняем файл пользователю
      const autoLink = document.createElement('a');
      autoLink.href = lastObjectUrl;
      autoLink.download = filename;
      document.body.appendChild(autoLink);
      autoLink.click();
      autoLink.remove();
    } catch (err) {
      setStatus(describeNetworkError(err), 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Сделать скриншот';
    }
  });
})();

// --- Режим "HTML элемента" ----------------------------------------------
(function initExtractForm() {
  const form = document.getElementById('extract-form');
  const submitBtn = document.getElementById('extract-submit-btn');
  const statusEl = document.getElementById('extract-status');
  const resultEl = document.getElementById('extract-result');
  const codeEl = document.querySelector('#extract-html code');
  const matchCountEl = document.getElementById('extract-match-count');
  const copyBtn = document.getElementById('copy-html-btn');
  const downloadLink = document.getElementById('extract-download-link');

  let lastObjectUrl = null;
  let lastHtml = '';

  function setStatus(message, type) {
    statusEl.hidden = !message;
    statusEl.textContent = message || '';
    statusEl.className = `status ${type || ''}`.trim();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      url: document.getElementById('extract-url').value,
      selector: document.getElementById('selector').value,
      delay: document.getElementById('extract-delay').value,
      timeout: document.getElementById('extract-timeout').value,
      waitUntil: document.getElementById('extract-waitUntil').value,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Извлекаем…';
    setStatus('Открываем страницу и ищем элемент, подождите…', 'ok');
    resultEl.hidden = true;

    try {
      const response = await fetch('/api/extract-element', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось извлечь элемент.');
      }

      lastHtml = data.html;
      codeEl.textContent = data.html;
      matchCountEl.textContent =
        data.matchCount > 1
          ? `Найдено совпадений: ${data.matchCount} (показан первый элемент)`
          : 'Элемент найден';

      if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
      const blob = new Blob([data.html], { type: 'text/html' });
      lastObjectUrl = URL.createObjectURL(blob);
      downloadLink.href = lastObjectUrl;
      downloadLink.download = data.filename || 'element.html';

      resultEl.hidden = false;
      setStatus('Готово!', 'ok');
    } catch (err) {
      setStatus(describeNetworkError(err), 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Извлечь HTML';
    }
  });

  copyBtn.addEventListener('click', async () => {
    if (!lastHtml) return;
    try {
      await navigator.clipboard.writeText(lastHtml);
      copyBtn.textContent = '✅ Скопировано';
    } catch {
      copyBtn.textContent = '⚠️ Не удалось скопировать';
    }
    setTimeout(() => {
      copyBtn.textContent = '📋 Скопировать';
    }, 1500);
  });
})();

// --- Режим "Список рейсов" ------------------------------------------------
(function initFlightsForm() {
  const form = document.getElementById('flights-form');
  const submitBtn = document.getElementById('flights-submit-btn');
  const statusEl = document.getElementById('flights-status');
  const resultEl = document.getElementById('flights-result');
  const codeEl = document.querySelector('#flights-text code');
  const matchCountEl = document.getElementById('flights-match-count');
  const copyBtn = document.getElementById('copy-flights-btn');
  const downloadLink = document.getElementById('flights-download-link');

  let lastObjectUrl = null;
  let lastText = '';

  function setStatus(message, type) {
    statusEl.hidden = !message;
    statusEl.textContent = message || '';
    statusEl.className = `status ${type || ''}`.trim();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      url: document.getElementById('flights-url').value,
      selector: document.getElementById('flights-selector').value,
      format: document.getElementById('flights-output-format').value,
      delay: document.getElementById('flights-delay').value,
      timeout: document.getElementById('flights-timeout').value,
      waitUntil: document.getElementById('flights-waitUntil').value,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Извлекаем…';
    setStatus('Открываем страницу и ищем карточки рейсов, подождите…', 'ok');
    resultEl.hidden = true;

    try {
      const response = await fetch('/api/extract-flights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось извлечь список рейсов.');
      }

      lastText = data.text;
      codeEl.textContent = data.text;
      matchCountEl.textContent = data.autoDetected
        ? `Автоматически найдено рейсов: ${data.matchCount}`
        : `Найдено блоков по селектору «${data.selector}»: ${data.matchCount}`;

      if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
      const blob = new Blob([data.text], { type: 'text/plain' });
      lastObjectUrl = URL.createObjectURL(blob);
      downloadLink.href = lastObjectUrl;
      downloadLink.download = data.filename || 'flights.txt';

      resultEl.hidden = false;
      setStatus('Готово!', 'ok');
    } catch (err) {
      setStatus(describeNetworkError(err), 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Извлечь список рейсов';
    }
  });

  copyBtn.addEventListener('click', async () => {
    if (!lastText) return;
    try {
      await navigator.clipboard.writeText(lastText);
      copyBtn.textContent = '✅ Скопировано';
    } catch {
      copyBtn.textContent = '⚠️ Не удалось скопировать';
    }
    setTimeout(() => {
      copyBtn.textContent = '📋 Скопировать';
    }, 1500);
  });
})();
