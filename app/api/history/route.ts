/**
 * GET /api/history?limit=50&status=sent
 * Returns generated/submitted bids from the DB (or in-memory fallback).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBids } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit  = Math.min(Number(searchParams.get('limit') ?? '50'), 200);
    const status = searchParams.get('status') ?? undefined;

    const { bids, total } = await getBids({ limit, status });

    return NextResponse.json({ ok: true, data: bids, total });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
