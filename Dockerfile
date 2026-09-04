# Готовый образ Microsoft уже содержит Node.js, Chromium и все системные
# зависимости, нужные Playwright — это избавляет от проблем со скачиванием
# браузера на стороне хостинга. Версия образа должна совпадать с версией
# пакета "playwright" в package.json.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

# Браузер уже есть в образе — не скачиваем его повторно при npm install
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

EXPOSE 3000

CMD ["node", "server.js"]
