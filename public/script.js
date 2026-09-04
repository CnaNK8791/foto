const form = document.getElementById('shot-form');
const submitBtn = document.getElementById('submit-btn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const previewEl = document.getElementById('preview');
const downloadLink = document.getElementById('download-link');

let lastObjectUrl = null;

function setStatus(message, type) {
  statusEl.hidden = !message;
  statusEl.textContent = message || '';
  statusEl.className = `status ${type || ''}`.trim();
}

// Страница открыта напрямую как файл (двойным кликом), а не через сервер —
// backend недоступен, скриншоты работать не будут.
if (location.protocol === 'file:') {
  setStatus(
    'Похоже, страница открыта напрямую из файла, а не через сервер. ' +
      'Запустите приложение командой "npm start" и откройте http://localhost:3000 — ' +
      'иначе запросы к серверу будут падать с ошибкой "Failed to fetch".',
    'error'
  );
}

function filenameFromDisposition(header) {
  if (!header) return 'screenshot.png';
  const match = /filename="?([^"]+)"?/i.exec(header);
  return match ? match[1] : 'screenshot.png';
}

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
    const isNetworkError = err instanceof TypeError;
    const message = isNetworkError
      ? 'Не удалось связаться с сервером. Убедитесь, что приложение запущено (npm start) и страница открыта через http://localhost:3000.'
      : err.message || 'Произошла ошибка';
    setStatus(message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Сделать скриншот';
  }
});
