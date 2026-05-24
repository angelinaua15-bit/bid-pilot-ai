import { NextRequest, NextResponse } from 'next/server';
import { getFreelanceAccount, getFreelanceFilter, upsertFreelanceFilter } from '@/lib/db';
import type { ProposalTone } from '@/types';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });

    const [account, filter] = await Promise.all([
      getFreelanceAccount(userId),
      getFreelanceFilter(userId),
    ]);

    return NextResponse.json({ ok: true, account, filter });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userId, minBudgetUah, minBudgetUsd, dailyLimit, aiScoreMin,
      proposalStyle, isEnabled, allowedKeywords, blockedKeywords,
    } = body as {
      userId: string;
      minBudgetUah: number;
      minBudgetUsd: number;
      dailyLimit: number;
      aiScoreMin: number;
      proposalStyle: ProposalTone;
      isEnabled: boolean;
      allowedKeywords: string[];
      blockedKeywords: string[];
    };

    if (!userId) return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });

    const filter = await upsertFreelanceFilter({
      userId,
      minBudgetUah: minBudgetUah ?? 0,
      minBudgetUsd: minBudgetUsd ?? 0,
      dailyLimit: dailyLimit ?? 20,
      aiScoreMin: aiScoreMin ?? 0,
      proposalStyle: proposalStyle ?? 'expert',
      isEnabled: isEnabled ?? false,
      allowedKeywords: allowedKeywords ?? [],
      blockedKeywords: blockedKeywords ?? [],
      allowedCategories: [],
      blockedCategories: [],
    });

    return NextResponse.json({ ok: true, filter });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
