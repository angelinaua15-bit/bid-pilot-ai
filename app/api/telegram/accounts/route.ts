import { NextRequest, NextResponse } from 'next/server';
import {
  getTelegramAccounts,
  getAllTelegramAccounts,
  upsertTelegramAccount,
  deleteTelegramAccount,
} from '@/lib/db';
import { assertAdmin } from '@/lib/auth';

// GET /api/telegram/accounts?userId=...&requesterId=...  (omit userId for admin — returns all)
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId');
    const requesterId = req.nextUrl.searchParams.get('requesterId');

    const admin = await assertAdmin(requesterId);
    if (!admin) {
      return NextResponse.json({ ok: false, error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const accounts = userId
      ? await getTelegramAccounts(userId)
      : await getAllTelegramAccounts();
    return NextResponse.json({ ok: true, accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// POST /api/telegram/accounts  — create a new account record (status: pending)
// Body: { userId, phoneNumber, requesterId }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, phoneNumber, requesterId } = body as {
      userId?: string;
      phoneNumber?: string;
      requesterId?: string;
    };

    const admin = await assertAdmin(requesterId ?? null);
    if (!admin) {
      return NextResponse.json({ ok: false, error: 'Forbidden: admin access required' }, { status: 403 });
    }

    if (!userId || !phoneNumber) {
      return NextResponse.json({ ok: false, error: 'userId and phoneNumber are required' }, { status: 400 });
    }
    const normalised = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const account = await upsertTelegramAccount({ userId, phoneNumber: normalised, status: 'pending' });
    if (!account) {
      return NextResponse.json({ ok: false, error: 'Failed to create account' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, account }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// DELETE /api/telegram/accounts?id=...&requesterId=...
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    const requesterId = req.nextUrl.searchParams.get('requesterId');

    const admin = await assertAdmin(requesterId);
    if (!admin) {
      return NextResponse.json({ ok: false, error: 'Forbidden: admin access required' }, { status: 403 });
    }

    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    }
    await deleteTelegramAccount(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
