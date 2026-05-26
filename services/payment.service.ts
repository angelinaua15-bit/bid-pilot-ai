/**
 * services/payment.service.ts
 * Payment integration structure (WayForPay / LiqPay).
 *
 * TODO: Connect real payment provider when ready.
 * Requires: WAYFORPAY_MERCHANT_ACCOUNT, WAYFORPAY_SECRET_KEY
 */

import type { PlanId } from '@/types';
import { subscriptionPlans } from '@/lib/mock-data';

export interface CheckoutSession {
  url: string;
  orderId: string;
}

/**
 * Create a checkout session for a subscription plan.
 */
export async function createCheckoutSession(
  userId: string,
  planId: PlanId
): Promise<CheckoutSession> {
  const plan = subscriptionPlans.find((p) => p.id === planId);
  if (!plan) throw new Error('Plan not found');

  // TODO: Replace with real WayForPay checkout:
  // const orderId = `order_${userId}_${Date.now()}`;
  // const signature = generateWayForPaySignature({ ... });
  // const checkoutUrl = await wayforpay.createInvoice({ ... });
  // return { url: checkoutUrl, orderId };

  // MOCK: return a fake URL
  await new Promise((r) => setTimeout(r, 800));
  console.log('[PaymentService] createCheckout', { userId, planId, price: plan.price });
  return {
    url: `https://wayforpay.com/pay/mock?plan=${planId}&amount=${plan.price}`,
    orderId: `order_${userId}_${Date.now()}`,
  };
}

/**
 * Handle webhook from payment provider (called in API route).
 */
export async function handlePaymentWebhook(payload: unknown): Promise<void> {
  // TODO: Verify WayForPay signature
  // TODO: Update subscription in DB
  // TODO: Send Telegram notification to user
  console.log('[PaymentService] webhook received', payload);
}

/**
 * Cancel active subscription.
 */
export async function cancelSubscription(userId: string): Promise<void> {
  // TODO: Cancel in payment provider + update DB
  await new Promise((r) => setTimeout(r, 500));
  console.log('[PaymentService] cancelSubscription', { userId });
}
