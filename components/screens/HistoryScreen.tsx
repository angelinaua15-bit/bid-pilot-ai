'use client';

import { useEffect, useState } from 'react';
import { Clock, Filter } from 'lucide-react';
import { haptic } from '@/lib/telegram';
import { BidPreview } from '@/components/shared/BidPreview';
import { EmptyState } from '@/components/shared/EmptyState';
import { LoadingState } from '@/components/shared/LoadingState';
import type { GeneratedBid, BidStatus } from '@/types';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { uk } from 'date-fns/locale';

const STATUS_FILTERS: { id: BidStatus | 'all'; label: string }[] = [
  { id: 'all',     label: 'Всі' },
  { id: 'draft',   label: 'Чернетки' },
  { id: 'sent',    label: 'Відправлені' },
  { id: 'replied', label: 'З відповіддю' },
  { id: 'skipped', label: 'Пропущені' },
];

const STATUS_STYLE: Record<BidStatus, { label: string; cls: string }> = {
  draft:            { label: 'Чернетка',     cls: 'bg-secondary text-muted-foreground' },
  sent:             { label: 'Відправлено',  cls: 'bg-blue-500/15 text-blue-400' },
  sent_unconfirmed: { label: 'Надіслано?',   cls: 'bg-blue-500/10 text-blue-400/70' },
  replied:          { label: 'Відповідь',    cls: 'bg-green-500/15 text-green-400' },
  skipped:          { label: 'Пропущено',    cls: 'bg-secondary text-muted-foreground' },
};

export function HistoryScreen() {
  const [bids, setBids] = useState<GeneratedBid[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<BidStatus | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadBids = async (status: BidStatus | 'all') => {
    setLoading(true);
    setError(null);
    try {
      const url = status === 'all'
        ? '/api/history?limit=100'
        : `/api/history?limit=100&status=${status}`;
      const res = await fetch(url).then((r) => r.json());
      if (res.ok) {
        setBids(res.data ?? []);
        setTotal(res.total ?? res.data?.length ?? 0);
      } else {
        setError(res.error ?? 'Failed to load history');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBids(activeStatus); }, [activeStatus]);

  const filtered =
    activeStatus === 'all' ? bids : bids.filter((b) => b.status === activeStatus);

  return (
    <div className="flex flex-col h-dvh">
      {/* Filters */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-baseline justify-between mb-3">
          <h1 className="text-xl font-bold">Історія заявок</h1>
          {total > 0 && <span className="text-xs text-muted-foreground">{total} всього</span>}
        </div>
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-0.5">
          {STATUS_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => { haptic.select(); setActiveStatus(id); }}
              className={cn(
                'flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all',
                activeStatus === id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-nav">
        {loading ? (
          <LoadingState rows={3} />
        ) : error ? (
          <EmptyState
            icon={<Clock size={24} />}
            title="Не вдалося завантажити"
            description={error}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Clock size={24} />}
            title="Немає заявок"
            description={activeStatus === 'all'
              ? 'Ви ще не генерували жодної заявки'
              : 'Немає заявок з цим статусом'
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground py-1">
              {filtered.length} заявок
            </p>
            {filtered.map((bid) => {
              const st = STATUS_STYLE[bid.status];
              const isExpanded = expandedId === bid.id;

              return (
                <div key={bid.id} className="glass-card rounded-2xl overflow-hidden">
                  {/* Summary row */}
                  <button
                    onClick={() => { haptic.light(); setExpandedId(isExpanded ? null : bid.id); }}
                    className="w-full flex items-start gap-3 p-4 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{bid.projectTitle}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', st.cls)}>
                          {st.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(bid.createdAt), { addSuffix: true, locale: uk })}
                        </span>
                        <span className="text-[10px] font-medium">${bid.price}</span>
                        <span className="text-[10px] text-muted-foreground">{bid.deadline}</span>
                      </div>
                    </div>
                    <Filter
                      size={14}
                      className={cn(
                        'flex-shrink-0 mt-1 transition-transform text-muted-foreground',
                        isExpanded && 'rotate-180'
                      )}
                    />
                  </button>

                  {/* Expanded bid preview */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border pt-3 fade-in">
                      <BidPreview bid={bid} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
