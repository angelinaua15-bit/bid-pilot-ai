import { NextRequest, NextResponse } from 'next/server';
import { getCampaignMessages } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const messages = await getCampaignMessages(id);
    return NextResponse.json({ ok: true, messages, data: messages });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'error' }, { status: 500 });
  }
}
