# Use the official Playwright image — ships Chromium + all libglib/libnss/libatk
# system-level dependencies pre-installed. No apt-get needed.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Copy package manifests first for layer cache
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./

# Install Node dependencies
RUN npm install --legacy-peer-deps

# Copy full project source (worker needs services/, lib/, types/, worker/)
COPY . .

# Re-run playwright install AFTER source copy so the version in node_modules
# matches the browsers path. --with-deps installs any missing OS libs too.
RUN npx playwright install --with-deps chromium

# Do NOT set PLAYWRIGHT_BROWSERS_PATH — let Playwright use its default cache
# (~/.cache/ms-playwright) which is what `playwright install` populates.

ENV WORKER_PORT=4000
ENV NODE_ENV=production

EXPOSE 4000

CMD ["npx", "tsx", "worker/index.ts"]
