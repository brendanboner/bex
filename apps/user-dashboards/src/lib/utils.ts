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

/** Resolve a value from nested data using a dot-path key (e.g. "summary.total"). */
export function resolveDataKey(data: Record<string, unknown> | unknown, key: string | undefined): unknown {
  if (!key || !data) return data;
  if (key === '_root') return data;
  const parts = key.split('.');
  let cur: unknown = data;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
