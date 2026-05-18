import { NextResponse } from 'next/server';
import { mockUser } from '@/lib/mock-data';

/**
 * GET /api/freelancehunt/status
 *
 * Returns the current user's Freelancehunt connection status.
 *
 * Production: resolve userId from session, query DB for FreelancehuntAccount.
 * Demo: returns mock data.
 */
export async function GET() {
  try {
    // TODO: Get userId from session:
    // const session = await getServerSession();
    // if (!session) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    //
    // const account = await prisma.freelancehuntAccount.findUnique({
    //   where: { userId: session.userId },
    //   select: { connected: true, username: true, connectedAt: true },
    // });

    // DEMO: use mock data
    const account = mockUser.freelancehunt;

    if (!account?.connected) {
      return NextResponse.json({
        ok: true,
        data: { connected: false },
      });
    }

    return NextResponse.json({
      ok: true,
      data: {
        connected: true,
        username: account.username,
        connectedAt: account.connectedAt,
      },
    });
  } catch (err) {
    console.error('[GET /api/freelancehunt/status]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/freelancehunt/status
 *
 * Disconnects the user's Freelancehunt account (removes token from DB).
 */
export async function DELETE() {
  try {
    // TODO: Get userId from session, delete account record:
    // const session = await getServerSession();
    // await prisma.freelancehuntAccount.delete({ where: { userId: session.userId } });

    return NextResponse.json({ ok: true, data: { connected: false } });
  } catch (err) {
    console.error('[DELETE /api/freelancehunt/status]', err);
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}
