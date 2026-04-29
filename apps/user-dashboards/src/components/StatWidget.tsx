/**
 * StatWidget — metric card with value, unit, delta trend, and health colouring.
 */

import { cn, resolveDataKey } from '@/lib/utils';
import type { Widget } from '@/lib/api';

interface StatWidgetProps {
  widget: Widget;
  data: Record<string, unknown>;
  colSpan?: number;
}

type StatusKey = 'good' | 'fair' | 'poor' | 'critical' | 'neutral';

const borderBg: Record<StatusKey, string> = {
  good:     'border-l-emerald-500 bg-emerald-500/5',
  fair:     'border-l-amber-500 bg-amber-500/5',
  poor:     'border-l-red-500 bg-red-500/5',
  critical: 'border-l-red-600 bg-red-600/5',
  neutral:  'border-l-slate-600 bg-slate-800/50',
};

const valueColor: Record<StatusKey, string> = {
  good:     'text-emerald-400',
  fair:     'text-amber-400',
  poor:     'text-red-400',
  critical: 'text-red-500',
  neutral:  'text-slate-100',
};

function resolveStatus(
  rawValue: unknown,
  statusKey: string | undefined,
  thresholds: { warn: number; crit: number } | undefined,
  data: Record<string, unknown>,
): StatusKey {
  if (statusKey) {
    const s = String(resolveDataKey(data, statusKey) ?? '').toLowerCase();
    if (s === 'good') return 'good';
    if (s === 'fair') return 'fair';
    if (s === 'poor' || s === 'critical') return s as StatusKey;
    return 'neutral';
  }
  if (thresholds) {
    const num = Number(rawValue);
    if (isNaN(num)) return 'neutral';
    if (num >= thresholds.warn) return 'good';
    if (num >= thresholds.crit) return 'fair';
    return 'poor';
  }
  return 'neutral';
}

export function StatWidget({ widget, data, colSpan = 1 }: StatWidgetProps) {
  const { title, dataKey, deltaKey, statusKey, thresholds, unit } = widget;

  const rawValue = resolveDataKey(data, dataKey);
  const rawDelta = deltaKey ? resolveDataKey(data, deltaKey) : undefined;

  const status = resolveStatus(rawValue, statusKey, thresholds, data);

  const displayValue = rawValue != null ? String(rawValue) : '—';
  const delta = rawDelta != null ? Number(rawDelta) : undefined;

  const colClass = cn(
    'rounded-xl border border-slate-700/60 border-l-4 p-4 flex flex-col gap-2',
    borderBg[status],
    colSpan === 2 && 'col-span-2',
    colSpan === 3 && 'col-span-3',
    colSpan === 4 && 'col-span-4',
  );

  return (
    <div className={colClass}>
      {title && (
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      )}
      <div className="flex items-end gap-1.5">
        <span className={cn('text-3xl font-bold tabular-nums leading-none', valueColor[status])}>
          {displayValue}
        </span>
        {unit && (
          <span className="text-sm text-slate-400 mb-0.5">{unit}</span>
        )}
      </div>
      {delta !== undefined && !isNaN(delta) && (
        <div className={cn('flex items-center gap-1 text-xs font-medium', delta >= 0 ? 'text-emerald-400' : 'text-red-400')}>
          <span>{delta >= 0 ? '↑' : '↓'}</span>
          <span>{Math.abs(delta)}{unit ? ` ${unit}` : ''}</span>
        </div>
      )}
    </div>
  );
}
