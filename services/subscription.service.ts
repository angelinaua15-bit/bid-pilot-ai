/**
 * services/subscription.service.ts
 * Subscription logic and generation limit enforcement.
 * Uses SaaSUser.subscriptionPlan + applicationsThisMonth from the DB.
 */

import type { SubscriptionPlanSaaS } from '@/types';
import { getUserById, updateUserPlan } from '@/lib/db';

/** Monthly bid-generation limits per plan */
export const PLAN_LIMITS: Record<SubscriptionPlanSaaS, number> = {
  free:      10,
  basic:     50,
  pro:       200,
  premium:   200,
  agency:    1000,
  unlimited: Infinity,
};

/**
 * Check if user has bid generations remaining this month. Returns true if allowed.
 */
export async function checkGenerationLimit(userId: string): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) return false;
  if (user.subscriptionStatus !== 'active') return false;
  const limit = PLAN_LIMITS[user.subscriptionPlan] ?? 0;
  return user.applicationsThisMonth < limit;
}

/**
 * Activate a subscription plan for a user (updates users table).
 */
export async function activateSubscription(
  userId: string,
  plan: SubscriptionPlanSaaS,
  expiresAt?: string,
): Promise<void> {
  const expires = expiresAt ?? (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString();
  })();
  await updateUserPlan(userId, plan, expires);
}

/**
 * Returns the generation limit for a given plan.
 */
export function getPlanLimit(plan: SubscriptionPlanSaaS): number {
  return PLAN_LIMITS[plan] ?? 0;
}
