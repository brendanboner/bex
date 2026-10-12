/**
 * HeatmapWidget — CSS grid of cells coloured by numeric value.
 * value >= warn → green, value >= crit → amber, below crit → red
 */

import { cn, resolveDataKey } from '@/lib/utils';

interface HeatmapWidgetProps {
  title?: string;
  dataKey?: string;
  labelKey?: string;
  valueKey?: string;
  thresholds?: { warn: number; crit: number };
  unit?: string;
  data: Record<string, unknown>;
  colSpan?: number;
}

function cellColor(value: number, warn: number, crit: number): string {
  if (value >= warn) return 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
  if (value >= crit) return 'bg-amber-500/20 border-amber-500/40 text-amber-300';
  return 'bg-red-500/20 border-red-500/40 text-red-300';
}

export function HeatmapWidget({
  title,
  dataKey,
  labelKey = 'label',
  valueKey = 'value',
  thresholds = { warn: 25, crit: 15 },
  unit,
  data,
  colSpan = 2,
}: HeatmapWidgetProps) {
  const raw = resolveDataKey(data, dataKey);
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];

  const colClass = cn(
    'rounded-xl border border-slate-700/60 bg-slate-800/50 p-4',
    colSpan === 2 && 'col-span-2',
    colSpan === 3 && 'col-span-3',
    colSpan === 4 && 'col-span-4',
  );

  return (
    <div className={colClass}>
      {title && (
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{title}</p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">No data</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {rows.map((row, i) => {
            const label = String(row[labelKey] ?? `Item ${i + 1}`);
            const value = Number(row[valueKey] ?? 0);
            const colorClass = cellColor(value, thresholds.warn, thresholds.crit);
            return (
              <div
                key={i}
                className={cn('rounded-lg border px-3 py-2 flex flex-col gap-0.5', colorClass)}
                title={`${label}: ${value}${unit ? ` ${unit}` : ''}`}
              >
                <span className="text-[10px] font-medium truncate opacity-80">{label}</span>
                <span className="text-base font-bold tabular-nums leading-none">
                  {value}
                  {unit && <span className="text-[10px] font-normal ml-0.5 opacity-70">{unit}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-emerald-500/60" />≥{thresholds.warn}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-amber-500/60" />≥{thresholds.crit}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-red-500/60" />&lt;{thresholds.crit}</span>
      </div>
    </div>
  );
}
