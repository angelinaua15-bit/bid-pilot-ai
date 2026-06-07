# Use the official Playwright image — includes Chromium + all system dependencies
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Copy root package.json/lockfile first for layer caching
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./

# Install all dependencies
RUN npm install --legacy-peer-deps

# Install Playwright Chromium browser + OS dependencies
RUN npx playwright install --with-deps chromium

# Copy the full project (worker needs services/, lib/, types/)
COPY . .

# Default port
ENV WORKER_PORT=4000
ENV NODE_ENV=production

EXPOSE 4000

# Start the worker
CMD ["npx", "tsx", "worker/index.ts"]
