/**
 * GET  /api/company-profile  — return current company profile
 * POST /api/company-profile  — update company profile
 */

import { NextRequest, NextResponse } from 'next/server';
import { companyProfile as defaultProfile } from '@/lib/mock-data';
import type { CompanyProfile } from '@/types';

let profile: CompanyProfile = { ...defaultProfile };

export async function GET() {
  return NextResponse.json({ ok: true, data: profile });
}

export async function POST(req: NextRequest) {
  try {
    const body: Partial<CompanyProfile> = await req.json();
    profile = { ...profile, ...body };
    return NextResponse.json({ ok: true, data: profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
