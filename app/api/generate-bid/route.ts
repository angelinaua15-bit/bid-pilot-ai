import { NextRequest, NextResponse } from 'next/server';
import { generateBid } from '@/services/openai.service';
import { mockProjects, mockUser } from '@/lib/mock-data';

export async function POST(req: NextRequest) {
  try {
    const { projectId, additionalNotes, customPrice, customDeadline } = await req.json();

    // TODO: Check subscription limit:
    // const allowed = await checkGenerationLimit(userId);
    // if (!allowed) return NextResponse.json({ ok: false, error: 'Generation limit reached' }, { status: 403 });

    const project = mockProjects.find((p) => p.id === projectId);
    if (!project) {
      return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });
    }

    const profile = mockUser.profile!;
    const bid = await generateBid(project, profile, { additionalNotes, customPrice, customDeadline });

    // TODO: Increment usage:
    // await incrementGenerationUsage(userId);

    // TODO: Save to DB:
    // await prisma.generatedBid.create({ data: { ...bid, userId } });

    return NextResponse.json({ ok: true, data: bid });
  } catch (err) {
    console.error('[POST /api/generate-bid]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
