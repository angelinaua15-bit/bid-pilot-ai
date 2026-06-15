/**
 * app/freelancehunt/connect/page.tsx  (server component)
 *
 * Wrapper for the "Connect Freelancehunt via browser" flow. Kept as a server
 * component so we can opt out of static prerendering (the client child uses
 * useSearchParams). The actual UI lives in ./connect-client.
 */

import { Suspense } from 'react';
import ConnectClient from './connect-client';

export const dynamic = 'force-dynamic';

export default function FreelancehuntConnectPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0b0b0f',
        color: '#e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <Suspense fallback={<div style={{ color: '#9ca3af' }}>Завантаження…</div>}>
        <ConnectClient />
      </Suspense>
    </div>
  );
}