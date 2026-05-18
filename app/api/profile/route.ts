import { NextRequest, NextResponse } from 'next/server';
import { mockUser } from '@/lib/mock-data';

export async function GET() {
  // TODO: Get userId from session/JWT, then:
  // const profile = await prisma.freelancerProfile.findUnique({ where: { userId } });
  return NextResponse.json({ ok: true, data: mockUser.profile });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    // TODO: Validate body with Zod, then:
    // const updated = await prisma.freelancerProfile.update({ where: { userId }, data: body });
    console.log('[PUT /api/profile]', body);
    return NextResponse.json({ ok: true, data: { ...mockUser.profile, ...body } });
  } catch (err) {
    console.error('[PUT /api/profile]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
