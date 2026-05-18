import { NextRequest, NextResponse } from 'next/server';
import { validateFreelancehuntToken } from '@/services/freelancehunt.service';

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    if (!token?.trim()) {
      return NextResponse.json({ ok: false, error: 'Token required' }, { status: 400 });
    }

    const result = await validateFreelancehuntToken(token);
    if (!result.valid) {
      return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 401 });
    }

    // TODO: Encrypt token and save to DB:
    // const encrypted = encrypt(token);
    // await prisma.freelancehuntAccount.upsert({
    //   where: { userId },
    //   update: { encryptedToken: encrypted, username: result.username, connected: true },
    //   create: { userId, encryptedToken: encrypted, username: result.username, connected: true },
    // });

    return NextResponse.json({ ok: true, data: { username: result.username, connected: true } });
  } catch (err) {
    console.error('[POST /api/freelancehunt/connect]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
