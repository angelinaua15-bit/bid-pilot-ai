import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Always create a new client within each function — never store in a global.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !url.startsWith('https://') || !anonKey) {
    // Return null when Supabase env vars are not configured.
    // Callers that need auth must guard: `const client = await createClient(); if (!client) return;`
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore.
          }
        },
      },
    },
  );
}
