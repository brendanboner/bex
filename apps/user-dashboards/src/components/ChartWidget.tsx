/**
 * ChartWidget — bar, line, or pie chart backed by Recharts.
 */

import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { cn, resolveDataKey } from '@/lib/utils';

const COLORS = ['#06b6d4', '#818cf8', '#34d399', '#fb923c', '#f472b6', '#facc15', '#94a3b8'];

interface ChartWidgetProps {
  title?: string;
  dataKey?: string;
  chartType?: 'bar' | 'line' | 'pie';
  xKey?: string;
  yKey?: string;
  data: Record<string, unknown>;
  colSpan?: number;
}

function normaliseRow(row: unknown, xKey: string, yKey: string): { name: string; value: number } {
  if (row && typeof row === 'object') {
    const r = row as Record<string, unknown>;
    const name = String(r[xKey] ?? 'N/A');
    const value = Number(r[yKey] ?? 0);
    return { name, value };
  }
  return { name: '?', value: 0 };
}

export function ChartWidget({ title, dataKey, chartType = 'bar', xKey = 'name', yKey = 'value', data, colSpan = 2 }: ChartWidgetProps) {
  const raw = resolveDataKey(data, dataKey);
  const rows = Array.isArray(raw) ? raw : [];
  const chartData = rows.map((r) => normaliseRow(r, xKey, yKey));

  const colClass = cn(
    'rounded-xl border border-slate-700/60 bg-slate-800/50 p-4',
    colSpan === 2 && 'col-span-2',
    colSpan === 3 && 'col-span-3',
    colSpan === 4 && 'col-span-4',
  );

  const noData = chartData.length === 0;

  return (
    <div className={colClass}>
      {title && (
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{title}</p>
      )}
      {noData ? (
        <p className="text-sm text-slate-500 text-center py-8">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          {chartType === 'pie' ? (
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                itemStyle={{ color: '#cbd5e1' }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
            </PieChart>
          ) : chartType === 'line' ? (
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                itemStyle={{ color: '#cbd5e1' }}
              />
              <Line type="monotone" dataKey="value" stroke="#06b6d4" strokeWidth={2} dot={{ fill: '#06b6d4' }} />
            </LineChart>
          ) : (
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                itemStyle={{ color: '#cbd5e1' }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  );
}
