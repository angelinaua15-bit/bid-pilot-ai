'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle2, XCircle, AlertTriangle, Clock,
  RefreshCw, Trash2, Filter,
} from 'lucide-react';
import { haptic } from '@/lib/telegram';
import type { AutoBidLog, LogLevel } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const LEVEL_CONFIG: Record<LogLevel, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  info:    { label: 'Info',    color: 'text-muted-foreground', bg: 'bg-secondary',        icon: Clock },
  success: { label: 'OK',     color: 'text-green-400',        bg: 'bg-green-500/10',     icon: CheckCircle2 },
  warning: { label: 'Warn',   color: 'text-yellow-400',       bg: 'bg-yellow-500/10',    icon: AlertTriangle },
  error:   { label: 'Error',  color: 'text-red-400',          bg: 'bg-red-500/10',       icon: XCircle },
};

const LEVELS: Array<LogLevel | 'all'> = ['all', 'success', 'info', 'warning', 'error'];

export function LogsScreen() {
  const [logs, setLogs] = useState<AutoBidLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = filter === 'all' ? '/api/logs?limit=100' : `/api/logs?limit=100&level=${filter}`;
      const httpRes = await fetch(url);

      let res: Record<string, unknown> = { ok: false };
      try {
        const text = await httpRes.text();
        res = text ? JSON.parse(text) : { ok: false };
      } catch {
        setError('Сервер повернув некоректну відповідь');
        setLogs([]);
        setLoading(false);
        return;
      }

      // Normalise: accept both res.data and res.logs for compatibility
      const rawData = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.logs)
          ? res.logs
          : [];
      setLogs(rawData as AutoBidLog[]);

      if (res.workerError) {
        setError(`Worker: ${res.workerError}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Невідома помилка';
      setError(msg);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const handleClear = async () => {
    haptic.error();
    if (!confirm('Очистити всі логи?')) return;
    await fetch('/api/logs', { method: 'DELETE' });
    setLogs([]);
  };

  const displayed = filter === 'all' ? logs : logs.filter((l) => l.level === filter);

  return (
    <div className="flex flex-col pb-nav h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h1 className="text-xl font-bold">Логи</h1>
          <p className="text-xs text-muted-foreground">{logs.length} записів</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { haptic.light(); loadLogs(); }}
            className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-muted-foreground"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleClear}
            className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-red-400"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Level filter */}
      <div className="flex items-center gap-2 px-4 pb-3 overflow-x-auto scrollbar-none">
        <Filter size={12} className="text-muted-foreground flex-shrink-0" />
        {LEVELS.map((lvl) => (
          <button
            key={lvl}
            onClick={() => { haptic.light(); setFilter(lvl); }}
            className={cn(
              'px-3 py-1 rounded-xl text-xs font-medium transition-all flex-shrink-0',
              filter === lvl ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
            )}
          >
            {lvl === 'all' ? 'Всі' : LEVEL_CONFIG[lvl].label}
          </button>
        ))}
      </div>

      {/* Error banner — shown when worker is unreachable but page still renders */}
      {error && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-2">
          <AlertTriangle size={13} className="text-yellow-400 flex-shrink-0" />
          <p className="text-[11px] text-yellow-300 leading-snug">{error}</p>
        </div>
      )}

      {/* Log list */}
      <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-1.5">
        {loading && (
          <div className="flex items-center justify-center pt-10">
            <RefreshCw size={20} className="animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && displayed.length === 0 && (
          <div className="flex flex-col items-center justify-center pt-16 text-muted-foreground gap-2">
            <Clock size={32} strokeWidth={1} />
            <p className="text-sm">{error ? 'Не вдалося завантажити логи' : 'Логів ще немає'}</p>
            {error && (
              <button
                onClick={() => { haptic.light(); loadLogs(); }}
                className="mt-2 px-4 py-2 rounded-xl bg-secondary text-xs font-medium"
              >
                Спробувати знову
              </button>
            )}
          </div>
        )}
        {!loading && displayed.map((log) => {
          const cfg = LEVEL_CONFIG[log.level];
          const Icon = cfg.icon;
          const isExpanded = expanded === log.id;
          const hasMeta = log.meta && Object.keys(log.meta).length > 0;
          const isPlaywrightStep = log.message.startsWith('[Playwright]') || log.message.startsWith('[API]') || log.message.startsWith('[Parser]') || log.message.startsWith('[Pre-flight]');
          const projectUrl = (log.meta as Record<string, unknown> | undefined)?.projectUrl as string | undefined;

          return (
            <button
              key={log.id}
              onClick={() => setExpanded(isExpanded ? null : log.id)}
              className={cn(
                'text-left glass-card px-3 py-2.5 rounded-xl flex items-start gap-2.5 transition-all',
                isExpanded && 'ring-1 ring-border',
                isPlaywrightStep && 'border-l-2 border-l-primary/30'
              )}
            >
              <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', cfg.bg)}>
                <Icon size={12} className={cfg.color} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-xs leading-snug', isPlaywrightStep && 'font-mono text-[11px]')}>
                  {log.message}
                </p>
                {log.projectTitle && (
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">{log.projectTitle}</p>
                )}
                {projectUrl && (
                  <a
                    href={projectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[11px] text-primary underline-offset-2 hover:underline truncate block mt-0.5"
                  >
                    {projectUrl}
                  </a>
                )}
                {isExpanded && hasMeta && (
                  <div className="mt-2 p-2 rounded-lg bg-secondary/50 text-[11px] text-muted-foreground font-mono whitespace-pre-wrap break-all">
                    {JSON.stringify(log.meta, null, 2)}
                  </div>
                )}
                {isExpanded && log.bidId && (
                  <p className="text-[11px] text-muted-foreground mt-1">Bid ID: {log.bidId}</p>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground flex-shrink-0">
                {log.timestamp
                  ? (() => { try { return formatDistanceToNow(new Date(log.timestamp), { addSuffix: true, locale: uk }); } catch { return '—'; } })()
                  : '—'}
              </span>
            </button>
          );
        })}
        <div className="h-4" />
      </div>
    </div>
  );
}
