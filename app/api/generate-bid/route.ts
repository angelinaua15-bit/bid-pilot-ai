import { NextRequest, NextResponse } from 'next/server';
import { generateBid } from '@/services/openai.service';
import { checkGenerationLimit } from '@/services/subscription.service';
import { incrementBidCount, saveBid } from '@/lib/db';
import { mockProjects } from '@/lib/mock-data';

export async function POST(req: NextRequest) {
  try {
    const { userId, projectId, additionalNotes, customPrice, customDeadline } =
      await req.json() as {
        userId?: string;
        projectId?: string;
        additionalNotes?: string;
        customPrice?: number;
        customDeadline?: number;
      };

    if (!userId || !projectId) {
      return NextResponse.json({ ok: false, error: 'userId and projectId are required' }, { status: 400 });
    }

    // Check subscription generation limit
    const allowed = await checkGenerationLimit(userId);
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Generation limit reached for your current plan' }, { status: 403 });
    }

    const project = mockProjects.find((p) => p.id === projectId);
    if (!project) {
      return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });
    }

    // Use a minimal profile shape — real profile comes from the DB via /api/profile
    const profilePlaceholder = { name: '', title: '', bio: '', skills: [], experience: '', portfolio: [] };
    const bid = await generateBid(project, profilePlaceholder as never, {
      additionalNotes,
      customPrice,
      customDeadline: customDeadline !== undefined ? String(customDeadline) : undefined,
    });

    // Persist generated bid and increment monthly usage counter
    const generatedBid = { ...bid, userId, projectId } satisfies import('@/types').GeneratedBid;
    await Promise.allSettled([
      saveBid(generatedBid),
      incrementBidCount(userId),
    ]);

    return NextResponse.json({ ok: true, data: bid });
  } catch (err) {
    console.error('[POST /api/generate-bid]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
