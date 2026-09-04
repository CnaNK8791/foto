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
    setStatus(err.message || 'Произошла ошибка', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Сделать скриншот';
  }
});
