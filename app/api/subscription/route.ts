import { NextResponse } from 'next/server';
import { mockUser } from '@/lib/mock-data';

export async function GET() {
  // TODO: const sub = await prisma.subscription.findUnique({ where: { userId } });
  return NextResponse.json({ ok: true, data: mockUser.subscription });
}
