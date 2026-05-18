/**
 * lib/supabase/service.ts
 * Supabase client using the SERVICE ROLE key.
 * Bypasses Row Level Security — only use in server-side API routes.
 * NEVER import this in client components.
 *
 * Uses createServerClient from @supabase/ssr with a no-op cookie store,
 * which is correct for service-role operations that don't need session cookies.
 */

import { createServerClient } from '@supabase/ssr';

export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !url.startsWith('https://') || !key) {
    // Return null when Supabase is not configured.
    // Callers must guard: `const db = getServiceClient(); if (!db) return fallback;`
    return null;
  }

  // No-op cookie handlers — service role doesn't use user sessions
  return createServerClient(url, key, {
    cookies: {
      getAll: () => [],
      setAll: () => {},
    },
  });
}
