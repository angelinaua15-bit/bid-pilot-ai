/**
 * lib/safe-text.ts
 * Safe string coercion for dynamic API values that may be
 * string | string[] | object | null | undefined.
 *
 * Usage: safeText(project.category)  → always returns a lowercase string
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeText(v: any): string {
  if (typeof v === 'string') return v.toLowerCase();
  if (Array.isArray(v)) return v.map(String).join(' ').toLowerCase();
  if (v && typeof v === 'object') return JSON.stringify(v).toLowerCase();
  return '';
}
