import { NextResponse } from 'next/server';

const REQUIRED_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'NEXT_PUBLIC_APP_URL',
  'TELEGRAM_WEBHOOK_SECRET',
] as const;

const OPTIONAL_VARS = [
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'WAYFORPAY_MERCHANT_ACCOUNT',
] as const;

export async function GET() {
  const vars: Record<string, boolean> = {};
  const missing: string[] = [];

  for (const key of REQUIRED_VARS) {
    const present = Boolean(process.env[key]);
    vars[key] = present;
    if (!present) missing.push(key);
  }

  for (const key of OPTIONAL_VARS) {
    vars[key] = Boolean(process.env[key]);
  }

  return NextResponse.json({
    ok: missing.length === 0,
    vars,
    missing,
    timestamp: new Date().toISOString(),
  });
}
