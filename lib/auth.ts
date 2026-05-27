/**
 * lib/auth.ts
 * Shared server-side authentication helpers.
 *
 * Works both when Supabase is configured (uses real DB records)
 * AND when it is not (uses the local_<telegramId> fallback id
 * that auth/me assigns in preview/dev mode).
 */

import { getUserById } from '@/lib/db';
import { OWNER_TELEGRAM_ID } from '@/types';
import type { SaaSUser } from '@/types';

/**
 * Extract the telegram ID from a requesterId that may be either:
 *   - a real UUID from Supabase (e.g. "d3e4f5...")
 *   - a local fallback id (e.g. "local_6237272293")
 */
function telegramIdFromRequesterId(requesterId: string): number | null {
  if (requesterId.startsWith('local_')) {
    const n = Number(requesterId.slice(6));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Assert that the requester is an admin or owner.
 * Returns the SaaSUser on success, null on failure.
 *
 * - If requesterId is a local fallback id AND maps to OWNER_TELEGRAM_ID,
 *   returns a synthetic owner user object without hitting Supabase.
 * - Otherwise, looks up the user in Supabase and checks their role.
 */
export async function assertAdmin(requesterId: string | null | undefined): Promise<SaaSUser | null> {
  if (!requesterId) return null;

  // Fast-path: local fallback id for the owner (Supabase not configured)
  const tgId = telegramIdFromRequesterId(requesterId);
  if (tgId !== null) {
    if (tgId === OWNER_TELEGRAM_ID) {
      // Return a minimal synthetic owner object — enough for all admin checks
      return {
        id: requesterId,
        telegramId: OWNER_TELEGRAM_ID,
        name: 'Owner',
        username: undefined,
        role: 'owner',
        subscriptionPlan: 'unlimited',
        subscriptionStatus: 'active',
        applicationsThisMonth: 0,
        isDisabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as SaaSUser;
    }
    // Other local_ ids are not admins
    return null;
  }

  // Real UUID path: look up in Supabase
  const user = await getUserById(requesterId);
  if (!user) return null;
  if (user.role === 'owner' || user.role === 'admin') return user;
  return null;
}
