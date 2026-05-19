# ─── Stage 1: deps + build ────────────────────────────────────────────────────
# Use the official Playwright image — Chromium, its dependencies, and all
# required system libs are pre-installed. Tag matches the playwright package
# version declared in package.json.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy AS builder

WORKDIR /app

# Install pnpm via corepack (ships with Node 16+; the Playwright image uses Node 20).
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy manifests first for better layer caching.
COPY package.json pnpm-lock.yaml ./

# Install all dependencies.
# --no-frozen-lockfile: tolerate minor lockfile drift between environments.
# PLAYWRIGHT_BROWSERS_PATH=0: reuse the browsers that are already baked into the
# base image instead of downloading them again during `playwright install`.
ENV PLAYWRIGHT_BROWSERS_PATH=0
RUN pnpm install --no-frozen-lockfile

# Copy the rest of the source.
COPY . .

# Build the Next.js app (needed if any server routes are imported by the worker).
# Skip if your worker is fully standalone and does not depend on the Next.js build.
RUN pnpm build || true


# ─── Stage 2: production image ────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

# Install pnpm in the final stage too (needed to run tsx via pnpm scripts).
RUN corepack enable && corepack prepare pnpm@latest --activate

# Tell Playwright to use the browsers that are pre-installed in the base image.
ENV PLAYWRIGHT_BROWSERS_PATH=0

# Chromium needs these flags to run in a sandboxless container environment.
# PLAYWRIGHT_CHROMIUM_ARGS is read by our playwright-browser.service.ts launch call.
ENV PLAYWRIGHT_CHROMIUM_ARGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu"

# Copy installed node_modules and built artefacts from the builder stage.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml

# Copy source (needed by tsx at runtime — it transpiles on the fly).
COPY . .

# Railway injects PORT automatically; default to 8080 if not set.
ENV PORT=8080
EXPOSE 8080

# Health-check so Railway knows when the worker is ready.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:${PORT}/status \
      -H "Authorization: Bearer ${AUTOMATION_SECRET}" || exit 1

# Start the worker server.
CMD ["npm", "run", "worker:start"]
