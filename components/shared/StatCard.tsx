import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  accent?: boolean;
  sublabel?: string;
  className?: string;
}

export function StatCard({ label, value, icon, accent, sublabel, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'glass-card p-4 flex flex-col gap-2',
        accent && 'border-primary/40 bg-primary/10',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          {label}
        </span>
        {icon && (
          <span className={cn('text-muted-foreground', accent && 'text-primary')}>{icon}</span>
        )}
      </div>
      <span className={cn('text-2xl font-bold', accent && 'text-primary')}>{value}</span>
      {sublabel && <span className="text-xs text-muted-foreground">{sublabel}</span>}
    </div>
  );
}
