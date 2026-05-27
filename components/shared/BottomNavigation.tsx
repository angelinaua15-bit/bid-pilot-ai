'use client';

import { Home, Briefcase, Send, ScrollText, User2, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/telegram';
import type { NavTab } from '@/types';

interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home',      label: 'Dashboard', icon: Home },
  { id: 'freelance', label: 'Freelance', icon: Briefcase },
  { id: 'campaigns', label: 'Campaigns', icon: Send },
  { id: 'logs',      label: 'Logs',      icon: ScrollText },
  { id: 'account',   label: 'Account',   icon: User2 },
  { id: 'admin',     label: 'Admin',     icon: Shield, adminOnly: true },
];

interface BottomNavigationProps {
  active: NavTab;
  onChange: (tab: NavTab) => void;
  isAdmin?: boolean;
}

export function BottomNavigation({ active, onChange, isAdmin = false }: BottomNavigationProps) {
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 safe-bottom"
      style={{
        background: 'oklch(0.12 0.01 250 / 0.96)',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid var(--border)',
      }}
      aria-label="Навігація"
    >
      <div className="flex items-stretch nav-h max-w-lg mx-auto">
        {visibleItems.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => { haptic.select(); onChange(id); }}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-200 active:scale-90 relative',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 1.75} />
              <span className={cn('text-[10px] font-medium leading-none', isActive && 'font-semibold')}>
                {label}
              </span>
              {isActive && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
