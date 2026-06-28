/**
 * services/payment.service.ts
 * Manual payment helpers (crypto / card via admin approval).
 * The platform uses admin-approved manual payments rather than an automated gateway.
 */

import type { SubscriptionPlanSaaS } from '@/types';
import { updateUserPlan } from '@/lib/db';
import { sendTelegramMessage } from '@/services/telegram.service';

/**
 * Activate a subscription plan for a user after admin approval.
 * Called by the admin when they confirm a manual payment.
 */
export async function activatePlanAfterPayment(
  userId: string,
  plan: SubscriptionPlanSaaS,
  months = 1,
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + months);
  await updateUserPlan(userId, plan, expiresAt.toISOString());
}

/**
 * Notify a user via Telegram bot that their payment was approved.
 */
export async function notifyPaymentApproved(
  telegramId: number,
  plan: SubscriptionPlanSaaS,
): Promise<void> {
  const planLabel: Record<SubscriptionPlanSaaS, string> = {
    free: 'Безкоштовний', basic: 'Базовий', pro: 'Преміум', premium: 'Преміум', agency: 'Агентський', unlimited: 'Необмежений',
  };
  await sendTelegramMessage(
    telegramId,
    `Ваш платіж підтверджено! Тарифний план <b>${planLabel[plan]}</b> активовано.`,
    { parseMode: 'HTML' },
  );
}

/**
 * Notify a user via Telegram bot that their payment was rejected.
 */
export async function notifyPaymentRejected(
  telegramId: number,
  reason?: string,
): Promise<void> {
  const msg = reason
    ? `На жаль, ваш платіж відхилено.\nПричина: ${reason}`
    : 'На жаль, ваш платіж відхилено. Зверніться до підтримки.';
  await sendTelegramMessage(telegramId, msg);
}

/**
 * Cancel active subscription (downgrade to free).
 */
export async function cancelSubscription(userId: string): Promise<void> {
  await updateUserPlan(userId, 'free');
}
