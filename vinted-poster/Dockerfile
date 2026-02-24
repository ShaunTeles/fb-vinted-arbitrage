FROM mcr.microsoft.com/playwright:v1.44.0-jammy
WORKDIR /app
COPY package.json ./
RUN npm install
RUN npx playwright install chromium
COPY server.js ./
COPY vinted.js ./
RUN mkdir -p /app/sessions
EXPOSE 3001
CMD ["node", "server.js"]
