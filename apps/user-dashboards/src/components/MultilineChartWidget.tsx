/**
 * MultilineChartWidget — line chart with multiple series (yKeys).
 */

import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { cn, resolveDataKey } from '@/lib/utils';

const COLORS = ['#06b6d4', '#818cf8', '#34d399', '#fb923c', '#f472b6', '#facc15', '#94a3b8'];

interface MultilineChartWidgetProps {
  title?: string;
  dataKey?: string;
  xKey?: string;
  yKeys?: string[];
  data: Record<string, unknown>;
  colSpan?: number;
}

export function MultilineChartWidget({
  title,
  dataKey,
  xKey = 'name',
  yKeys = [],
  data,
  colSpan = 2,
}: MultilineChartWidgetProps) {
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
      {rows.length === 0 || yKeys.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              itemStyle={{ color: '#cbd5e1' }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
            {yKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
