/**
 * lib/config.ts
 * Central config — reads from environment variables.
 * All service code should import from here rather than reading process.env directly.
 */

export const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    /** Default chat ID to send auto-bid notifications to. */
    chatId: process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : null,
  },

  db: {
    /** True when the Supabase service role key is available. */
    isConfigured: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ),
    backend: 'Supabase',
  },

  freelancehunt: {
    /** Freelancehunt API token — used by both the Next.js app and the worker. */
    token: process.env.FREELANCEHUNT_TOKEN ?? '',
  },

  /**
   * External automation worker (VPS / Railway / local machine).
   *
   * Priority:
   *   1. AUTOMATION_WORKER_URL   — explicit Railway / remote worker URL
   *   2. LOCAL_WORKER_URL        — local worker running on same machine (default http://localhost:8080)
   *
   * When either is set, all Freelancehunt work is delegated to the worker.
   */
  worker: {
    url: (
      process.env.AUTOMATION_WORKER_URL ||
      process.env.LOCAL_WORKER_URL ||
      ''
    ).replace(/\/$/, ''),
    secret: process.env.AUTOMATION_SECRET ?? '',
    /** True when a worker URL is configured (remote or local). */
    enabled: Boolean(
      process.env.AUTOMATION_WORKER_URL || process.env.LOCAL_WORKER_URL
    ),
    /** 'railway' when AUTOMATION_WORKER_URL is set, 'local' when only LOCAL_WORKER_URL, 'none' otherwise */
    mode: process.env.AUTOMATION_WORKER_URL
      ? 'railway'
      : process.env.LOCAL_WORKER_URL
        ? 'local'
        : 'none',
  },

  /** App base URL used for webhooks and callbacks. */
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000',
} as const;

/** Returns a human-readable status for each integration. */
export function getIntegrationStatus() {
  return {
    openai:        Boolean(config.openai.apiKey),
    telegram:      Boolean(config.telegram.botToken) && config.telegram.chatId !== null,
    database:      config.db.isConfigured,
    // Freelancehunt is "configured" when worker URL is set OR a token exists.
    // Real session validity is checked at runtime via /api/freelancehunt/status.
    freelancehunt: config.worker.enabled
      ? Boolean(config.worker.url)
      : Boolean(config.freelancehunt.token),
    worker:        config.worker.enabled,
    workerMode:    config.worker.mode,
  };
}
