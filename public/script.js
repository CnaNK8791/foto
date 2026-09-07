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
  const galleryEl = document.getElementById('gallery');
  const widthInput = document.getElementById('width');
  const heightInput = document.getElementById('height');
  const actionsListEl = document.getElementById('actions-list');
  const actionsEmptyEl = document.getElementById('actions-empty');
  const addScrollAmountInput = document.getElementById('add-scroll-amount');
  const addScrollBtn = document.getElementById('add-scroll-btn');
  const addScreenshotBtn = document.getElementById('add-screenshot-btn');
  const clearActionsBtn = document.getElementById('clear-actions-btn');

  // Сценарий действий — "мини-программа", которая выполняется по шагам на
  // сервере перед снимком(-ами): { type: 'click', x, y } | { type: 'scroll',
  // amount } | { type: 'screenshot' }. Копится между запросами (не
  // сбрасывается сама после снимка) — так можно собирать сценарий
  // постепенно, добавляя шаги по мере того, как видно результат предыдущих.
  let actions = [];

  function setStatus(message, type) {
    statusEl.hidden = !message;
    statusEl.textContent = message || '';
    statusEl.className = `status ${type || ''}`.trim();
  }

  warnIfOpenedAsFile(setStatus);

  function describeAction(action) {
    if (action.type === 'click') return `🖱️ Клик (X=${action.x}, Y=${action.y})`;
    if (action.type === 'scroll') return `⬇️ Прокрутка вниз на ${action.amount} px`;
    return '📸 Снимок здесь';
  }

  function renderActions() {
    actionsListEl.innerHTML = '';
    actionsEmptyEl.hidden = actions.length > 0;

    actions.forEach((action, index) => {
      const li = document.createElement('li');
      li.className = 'action-item';

      const badge = document.createElement('span');
      badge.className = 'action-item__badge';
      badge.textContent = String(index + 1);

      const desc = document.createElement('span');
      desc.className = 'action-item__desc';
      desc.textContent = describeAction(action);

      const buttons = document.createElement('span');
      buttons.className = 'action-item__buttons';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.textContent = '↑';
      upBtn.title = 'Переместить раньше';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => {
        [actions[index - 1], actions[index]] = [actions[index], actions[index - 1]];
        renderActions();
      });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.textContent = '↓';
      downBtn.title = 'Переместить позже';
      downBtn.disabled = index === actions.length - 1;
      downBtn.addEventListener('click', () => {
        [actions[index + 1], actions[index]] = [actions[index], actions[index + 1]];
        renderActions();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Удалить шаг';
      removeBtn.addEventListener('click', () => {
        actions.splice(index, 1);
        renderActions();
      });

      buttons.append(upBtn, downBtn, removeBtn);
      li.append(badge, desc, buttons);
      actionsListEl.appendChild(li);
    });
  }

  renderActions();

  // Вешаем обработчик клика на любую картинку в галерее: добавляет шаг
  // "Клик" в сценарий в этой точке (переводим координату клика мышью — в
  // отображаемых на странице пикселях картинки, которая может быть
  // уменьшена CSS'ом через max-width:100% — в координату исходного снимка
  // через naturalWidth/naturalHeight). Можно кликать несколько раз в
  // разных местах и на разных снимках галереи — каждый клик добавляет
  // отдельный шаг по порядку.
  function attachPicker(imgEl, wrapperEl) {
    imgEl.addEventListener('click', (event) => {
      const rect = imgEl.getBoundingClientRect();
      if (!imgEl.naturalWidth || !imgEl.naturalHeight || rect.width === 0) return;

      const displayX = event.clientX - rect.left;
      const displayY = event.clientY - rect.top;
      const scaleX = imgEl.naturalWidth / rect.width;
      const scaleY = imgEl.naturalHeight / rect.height;

      let naturalX = Math.round(displayX * scaleX);
      let naturalY = Math.round(displayY * scaleY);

      // Сам клик на сервере выполняется по текущему окну браузера
      // (viewport), а превью может показывать снимок ВСЕЙ страницы (она
      // выше окна) — ограничиваем координаты размером окна, иначе клик
      // окажется за пределами того, что реально видно на сервере в момент
      // клика.
      const viewportWidth = Number(widthInput.value) || naturalX;
      const viewportHeight = Number(heightInput.value) || naturalY;
      naturalX = Math.min(naturalX, viewportWidth);
      naturalY = Math.min(naturalY, viewportHeight);

      actions.push({ type: 'click', x: naturalX, y: naturalY });
      renderActions();

      const marker = document.createElement('div');
      marker.className = 'click-marker';
      marker.textContent = String(actions.length);
      marker.style.left = `${displayX}px`;
      marker.style.top = `${displayY}px`;
      wrapperEl.appendChild(marker);

      setStatus(
        `Шаг ${actions.length} «Клик (X=${naturalX}, Y=${naturalY})» добавлен в сценарий. Можно добавить ещё шаги или нажать «Сделать скриншот».`,
        'ok'
      );
    });
  }

  addScrollBtn.addEventListener('click', () => {
    let amount = Number(addScrollAmountInput.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus('Укажите положительное число пикселей для прокрутки.', 'error');
      return;
    }
    amount = Math.min(Math.round(amount), 20000);
    actions.push({ type: 'scroll', amount });
    addScrollAmountInput.value = '';
    renderActions();
    setStatus(`Шаг ${actions.length} «Прокрутка на ${amount} px» добавлен в сценарий.`, 'ok');
  });

  addScreenshotBtn.addEventListener('click', () => {
    actions.push({ type: 'screenshot' });
    renderActions();
    setStatus(
      `Шаг ${actions.length} «📸 Снимок здесь» добавлен в сценарий. Можно добавить ещё шаги или нажать «Сделать скриншот».`,
      'ok'
    );
  });

  clearActionsBtn.addEventListener('click', () => {
    actions = [];
    renderActions();
    setStatus('Сценарий очищен.', 'ok');
  });

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
      actions,
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

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'Не удалось сделать скриншот.');
      }

      const screenshots = Array.isArray(data?.screenshots) ? data.screenshots : [];
      if (screenshots.length === 0) {
        throw new Error('Сервер не вернул ни одного снимка.');
      }

      galleryEl.innerHTML = '';
      screenshots.forEach((shot, index) => {
        const item = document.createElement('div');
        item.className = 'gallery-item';

        const label = document.createElement('span');
        label.className = 'gallery-item__label';
        label.textContent =
          screenshots.length > 1 ? `Скриншот ${index + 1} из ${screenshots.length}` : 'Скриншот';

        const wrapper = document.createElement('div');
        wrapper.className = 'preview-wrapper';

        const img = document.createElement('img');
        img.className = 'preview-img';
        img.alt = 'Скриншот страницы';
        img.src = shot.dataUrl;
        wrapper.appendChild(img);
        attachPicker(img, wrapper);

        const downloadLink = document.createElement('a');
        downloadLink.className = 'download-btn';
        downloadLink.href = shot.dataUrl;
        downloadLink.download = shot.filename || `screenshot_${index + 1}.png`;
        downloadLink.textContent = '⬇ Сохранить фото';

        item.append(label, wrapper, downloadLink);
        galleryEl.appendChild(item);
      });

      resultEl.hidden = false;

      setStatus(
        screenshots.length > 1
          ? `Готово! Получено снимков: ${screenshots.length}. Скачайте каждый по отдельности кнопкой под ним.`
          : 'Готово! Скачайте фото кнопкой под ним.',
        'ok'
      );
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
