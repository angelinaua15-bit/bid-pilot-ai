/**
 * services/subscription.service.ts
 * Subscription logic and generation limit enforcement.
 *
 * TODO: Connect to DB (Prisma) for real usage tracking.
 */

import type { Subscription, PlanId } from '@/types';
import { mockUser } from '@/lib/mock-data';

/**
 * Get current subscription for a user.
 */
export async function getUserSubscription(userId: string): Promise<Subscription | null> {
  // TODO: Replace with Prisma query:
  // return prisma.subscription.findUnique({ where: { userId } });

  // MOCK:
  await new Promise((r) => setTimeout(r, 200));
  console.log('[SubscriptionService] getSubscription', { userId });
  return mockUser.subscription ?? null;
}

/**
 * Check if user has generations remaining. Returns true if allowed.
 */
export async function checkGenerationLimit(userId: string): Promise<boolean> {
  const sub = await getUserSubscription(userId);
  if (!sub) return false;
  return sub.generationsUsed < sub.generationsLimit;
}

/**
 * Increment the used generation count.
 */
export async function incrementGenerationUsage(userId: string): Promise<void> {
  // TODO: Replace with Prisma update:
  // await prisma.subscription.update({
  //   where: { userId },
  //   data: { generationsUsed: { increment: 1 } }
  // });

  console.log('[SubscriptionService] incrementUsage', { userId });
}

/**
 * Activate a subscription plan for a user.
 */
export async function activateSubscription(userId: string, planId: PlanId): Promise<Subscription> {
  // TODO: Replace with Prisma create/update
  const now = new Date();
  const expires = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

  console.log('[SubscriptionService] activateSubscription', { userId, planId });

  const limits: Record<PlanId, number> = {
    free: 10,
    basic: 100,
    pro: 500,
    agency: 2000,
  };

  return {
    id: `sub_${Date.now()}`,
    userId,
    plan: planId,
    status: 'active',
    generationsLimit: limits[planId],
    generationsUsed: 0,
    startedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
}
