import { cn } from '@/lib/utils';

interface LoadingStateProps {
  rows?: number;
  className?: string;
}

function SkeletonRow({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-xl', className)} />;
}

export function LoadingState({ rows = 3, className }: LoadingStateProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="glass-card p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <SkeletonRow className="w-10 h-10 rounded-xl flex-shrink-0" />
            <div className="flex-1 flex flex-col gap-2">
              <SkeletonRow className="h-4 w-3/4" />
              <SkeletonRow className="h-3 w-1/2" />
            </div>
          </div>
          <SkeletonRow className="h-3 w-full" />
          <SkeletonRow className="h-3 w-5/6" />
          <div className="flex gap-2 pt-1">
            <SkeletonRow className="h-8 flex-1 rounded-lg" />
            <SkeletonRow className="h-8 w-20 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LoadingSpinner({ size = 24 }: { size?: number }) {
  return (
    <div
      className="border-2 border-primary/20 border-t-primary rounded-full animate-spin"
      style={{ width: size, height: size }}
      aria-label="Завантаження..."
    />
  );
}
