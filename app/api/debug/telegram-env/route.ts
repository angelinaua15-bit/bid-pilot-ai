/**
 * GET /api/debug/telegram-env
 *
 * Returns Telegram credential diagnostics WITHOUT exposing secret values.
 * Safe to call from the browser or curl during debugging.
 */

import { NextResponse } from 'next/server';

export async function GET() {
  const rawApiId  = process.env.TELEGRAM_API_ID;
  const apiHash   = process.env.TELEGRAM_API_HASH;
  const apiId     = Number(rawApiId ?? '0');

  return NextResponse.json({
    apiIdSet:      Boolean(rawApiId),
    apiHashSet:    Boolean(apiHash),
    apiIdIsNumber: Boolean(rawApiId) && Number.isFinite(apiId) && apiId > 0,
    apiIdLength:   rawApiId?.length ?? 0,
    apiHashLength: apiHash?.length ?? 0,
    handlerMode:   'vercel',
    envSource:     '.env / Vercel project environment variables',
    nodeEnv:       process.env.NODE_ENV ?? 'unknown',
  });
}
