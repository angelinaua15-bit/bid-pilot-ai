import { NextRequest, NextResponse } from 'next/server';
import { generateBid } from '@/services/openai.service';
import { checkGenerationLimit } from '@/services/subscription.service';
import { incrementBidCount, saveBid, getCompanyProfile } from '@/lib/db';
import type { Project, GeneratedBid } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      userId?: string;
      projectId?: string;
      /** Full project object passed from the frontend (avoids DB lookup) */
      project?: Project;
      additionalNotes?: string;
      customPrice?: number;
      customDeadline?: number;
    };

    const { userId, projectId, project, additionalNotes, customPrice, customDeadline } = body;

    if (!userId) {
      return NextResponse.json({ ok: false, error: 'userId is required' }, { status: 400 });
    }
    if (!project && !projectId) {
      return NextResponse.json({ ok: false, error: 'project or projectId is required' }, { status: 400 });
    }

    // Check subscription generation limit
    const allowed = await checkGenerationLimit(userId);
    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: 'Generation limit reached for your current plan' },
        { status: 403 },
      );
    }

    // Use the inline project object when available; fall back to a minimal stub
    const projectData: Project = project ?? ({
      id: projectId ?? '',
      title: '',
      description: '',
      budget: { amount: 0, currency: 'UAH' },
      skills: [],
    } as unknown as Project);

    // Load the user's company profile (used to personalise the bid)
    const companyProfile = await getCompanyProfile(userId);
    const profileForBid = companyProfile ?? {
      name: '', tagline: '', description: '', services: [], portfolio: [], bidStyle: 'expert' as const,
      language: 'uk' as const, contacts: {},
    };

    const bid = await generateBid(projectData, profileForBid as never, {
      additionalNotes,
      customPrice,
      customDeadline: customDeadline !== undefined ? String(customDeadline) : undefined,
    });

    // Persist generated bid and increment monthly usage counter
    const effectiveProjectId = project?.id ?? projectId ?? '';
    const generatedBid: GeneratedBid = { ...bid, userId, projectId: effectiveProjectId };
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
