import { Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConnectionStatusProps {
  connected: boolean;
  username?: string;
  label?: string;
  className?: string;
}

export function ConnectionStatus({ connected, username, label, className }: ConnectionStatusProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 glass-card p-3 rounded-2xl',
        connected ? 'border-green-500/30' : 'border-border',
        className
      )}
    >
      <div
        className={cn(
          'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
          connected ? 'bg-green-500/15 text-green-500' : 'bg-secondary text-muted-foreground'
        )}
      >
        {connected ? <Wifi size={18} /> : <WifiOff size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {label ?? 'Freelancehunt'}
        </p>
        <p className={cn('text-xs truncate', connected ? 'text-green-500' : 'text-muted-foreground')}>
          {connected ? (username ? `@${username}` : 'Підключено') : 'Не підключено'}
        </p>
      </div>
      <div className={cn('w-2 h-2 rounded-full flex-shrink-0', connected ? 'bg-green-500' : 'bg-muted-foreground')} />
    </div>
  );
}
