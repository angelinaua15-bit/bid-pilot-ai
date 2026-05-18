// Supabase Auth middleware removed — we use DATABASE_URL directly.
// This file is kept as a no-op so Next.js does not error on the matcher config.
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
