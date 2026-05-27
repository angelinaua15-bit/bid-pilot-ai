// Public endpoint — returns only active payment methods (no auth required)
import { NextResponse } from 'next/server';
import { getPaymentSettings } from '@/lib/db';

export async function GET() {
  try {
    const settings = await getPaymentSettings(true); // active only
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
