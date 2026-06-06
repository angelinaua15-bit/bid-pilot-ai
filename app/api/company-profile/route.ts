/**
 * GET  /api/company-profile?userId=...  — return stored company profile
 * POST /api/company-profile             — upsert company profile
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCompanyProfile, upsertCompanyProfile } from '@/lib/db';
import { companyProfile as defaultProfile } from '@/lib/mock-data';
import type { CompanyProfile } from '@/types';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });
  }

  try {
    const profile = await getCompanyProfile(userId);
    // Fall back to default profile shape (not saved yet) rather than 404
    return NextResponse.json({ ok: true, data: profile ?? defaultProfile });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { userId?: string } & Partial<CompanyProfile>;
    const { userId, ...profileFields } = body;

    if (!userId) {
      return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });
    }

    const saved = await upsertCompanyProfile(userId, profileFields);
    return NextResponse.json({ ok: true, data: saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
