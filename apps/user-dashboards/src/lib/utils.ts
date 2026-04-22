import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function relativeTime(date: string | Date | undefined | null): string {
  if (!date) return 'never';
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case 'active':  return 'bg-emerald-500/15 text-emerald-400';
    case 'paused':  return 'bg-amber-500/15 text-amber-400';
    case 'archived': return 'bg-slate-500/15 text-slate-400';
    default:        return 'bg-slate-500/15 text-slate-400';
  }
}

/** Resolve a value from nested data using a dot-path + bracket-index key.
 *  Supports: "summary.total", "access_points[0].clients", "rows[2].name"
 */
export function resolveDataKey(data: Record<string, unknown> | unknown, key: string | undefined): unknown {
  if (!key || !data) return data;
  if (key === '_root') return data;

  // Tokenise the key into named segments and optional array indices.
  // e.g. "access_points[0].clients" → ["access_points", 0, "clients"]
  const tokens: (string | number)[] = [];
  // Split on dots first, then parse bracket indices within each segment
  for (const segment of key.split('.')) {
    const bracketMatch = segment.match(/^([^\[]+)(?:\[(\d+)\])?$/);
    if (bracketMatch) {
      tokens.push(bracketMatch[1]!);
      if (bracketMatch[2] !== undefined) tokens.push(Number(bracketMatch[2]));
    } else {
      tokens.push(segment);
    }
  }

  let cur: unknown = data;
  for (const token of tokens) {
    if (cur == null) return undefined;
    if (typeof token === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = (cur as unknown[])[token];
    } else {
      if (typeof cur !== 'object' || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[token];
    }
  }
  return cur;
}
