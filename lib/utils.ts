import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { OWNER_TELEGRAM_ID } from '@/types';
import type { SaaSUser } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Returns true if the user is the platform owner.
 * Use this everywhere to bypass limits and unlock admin access.
 * Checks both telegramId (number) and role field in case the DB
 * record has already been upgraded.
 */
export function isOwner(user: SaaSUser | null | undefined): boolean {
  if (!user) return false;
  return user.telegramId === OWNER_TELEGRAM_ID || user.role === 'owner';
}

/**
 * Returns true if the user has admin-level access (owner or admin role).
 */
export function isAdminUser(user: SaaSUser | null | undefined): boolean {
  if (!user) return false;
  return isOwner(user) || user.role === 'admin';
}
