'use client';

/**
 * hooks/use-freelancehunt-status.ts
 * Reads GET /api/freelancehunt/status?userId= and exposes Connected/Reconnect.
 */

import { useCallback, useEffect, useState } from 'react';

export type FreelancehuntUiStatus = 'loading' | 'connected' | 'reconnect' | 'error';

export interface UseFreelancehuntStatus {
  status: FreelancehuntUiStatus;
  username?: string;
  cookieCount?: number;
  updatedAt?: string;
  error?: string;
  refresh: () => Promise<void>;
}

export function useFreelancehuntStatus(
  userId?: string,
  opts?: { pollMs?: number }
): UseFreelancehuntStatus {
  const [status, setStatus] = useState<FreelancehuntUiStatus>('loading');
  const [username, setUsername] = useState<string>();
  const [cookieCount, setCookieCount] = useState<number>();
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!userId) {
      setStatus('reconnect');
      return;
    }
    try {
      const res = await fetch(
        `/api/freelancehunt/status?userId=${encodeURIComponent(userId)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      setStatus(data.connected ? 'connected' : 'reconnect');
      setUsername(data.username ?? undefined);
      setCookieCount(typeof data.cookieCount === 'number' ? data.cookieCount : undefined);
      setUpdatedAt(data.updatedAt ?? undefined);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [userId]);

  useEffect(() => {
    refresh();
    if (opts?.pollMs && opts.pollMs > 0) {
      const t = setInterval(refresh, opts.pollMs);
      return () => clearInterval(t);
    }
  }, [refresh, opts?.pollMs]);

  return { status, username, cookieCount, updatedAt, error, refresh };
}