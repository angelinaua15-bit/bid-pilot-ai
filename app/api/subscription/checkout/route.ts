import { NextRequest, NextResponse } from 'next/server';
import { subscriptionPlans } from '@/lib/mock-data';

export async function POST(req: NextRequest) {
  try {
    const { planId } = await req.json();

    const plan = subscriptionPlans.find((p) => p.id === planId);
    if (!plan) {
      return NextResponse.json({ ok: false, error: 'Plan not found' }, { status: 404 });
    }

    if (plan.price === 0) {
      // TODO: activate free plan in DB
      // await prisma.subscription.upsert({ where: { userId }, update: { plan: 'free', ... }, create: { ... } });
      return NextResponse.json({ ok: true, data: { activated: true } });
    }

    // TODO: Create WayForPay / LiqPay invoice and return checkout URL:
    // const invoice = await wayforpay.createInvoice({
    //   orderReference: `sub_${Date.now()}`,
    //   orderDate: Math.floor(Date.now() / 1000),
    //   amount: plan.price,
    //   currency: 'UAH',
    //   productName: [`BidPilot AI ${plan.name}`],
    //   productPrice: [plan.price],
    //   productCount: [1],
    // });
    // return NextResponse.json({ ok: true, data: { checkoutUrl: invoice.invoiceUrl } });

    // MOCK:
    const mockCheckoutUrl = `https://secure.wayforpay.com/pay?order=mock_${Date.now()}`;
    console.log('[POST /api/subscription/checkout]', { planId, mockCheckoutUrl });
    return NextResponse.json({ ok: true, data: { checkoutUrl: mockCheckoutUrl } });
  } catch (err) {
    console.error('[POST /api/subscription/checkout]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
