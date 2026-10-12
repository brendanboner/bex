/**
 * HeadlineWidget — displays a single value (number, short string) with a title.
 */

import { cn, resolveDataKey } from '@/lib/utils';

interface HeadlineWidgetProps {
  title?: string;
  dataKey?: string;
  data: Record<string, unknown>;
  colSpan?: number;
}

export function HeadlineWidget({ title, dataKey, data, colSpan = 1 }: HeadlineWidgetProps) {
  const raw = resolveDataKey(data, dataKey);

  // Gracefully handle non-scalar values — show a count rather than [object Object]
  let value: string;
  if (raw == null) value = '—';
  else if (Array.isArray(raw)) value = String(raw.length);
  else if (typeof raw === 'object') value = `${Object.keys(raw as object).length}`;
  else value = String(raw);

  // Try to detect if numeric for large font treatment
  const isNumeric = raw != null && !isNaN(Number(value)) && value !== '—';

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 flex flex-col gap-1',
        colSpan === 2 && 'col-span-2',
        colSpan === 3 && 'col-span-3',
        colSpan === 4 && 'col-span-4',
      )}
    >
      {title && (
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      )}
      <p
        className={cn(
          'font-bold text-slate-100 break-all',
          isNumeric ? 'text-3xl' : 'text-xl',
        )}
      >
        {value}
      </p>
    </div>
  );
}
