/**
 * TableWidget — sortable, searchable table rendering an array from lastData.
 * Supports dot-path columns (e.g. "ssids.clients.hostname") and automatically
 * unwinds nested arrays into flat rows.
 */

import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';
import { cn, resolveDataKey } from '@/lib/utils';

interface TableWidgetProps {
  title?: string;
  dataKey?: string;
  columns?: string[];
  data: Record<string, unknown>;
  colSpan?: number;
}

type SortDir = 'asc' | 'desc';

function cellValue(row: Record<string, unknown>, col: string): string {
  // Direct key first (handles pre-flattened dot-key names), then resolveDataKey
  const v = Object.prototype.hasOwnProperty.call(row, col)
    ? row[col]
    : resolveDataKey(row, col);
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Unwinds nested arrays into flat rows so dot-path columns render correctly.
 * E.g. {ap_name, ssids:[{ssid_name, clients:[{hostname,ip_address}]}]}
 * with cols ["ap_name","ssids.ssid_name","ssids.clients.hostname"]
 * produces one row per (ap, ssid, client) combination.
 */
function flattenRows(
  rows: Record<string, unknown>[],
  cols: string[],
): Record<string, unknown>[] {
  let result = [...rows];
  // Up to 5 passes to handle multi-level nesting
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    const expanded: Record<string, unknown>[] = [];
    for (const row of result) {
      let unwound = false;
      for (const [key, val] of Object.entries(row)) {
        if (Array.isArray(val) && cols.some((c) => c === key || c.startsWith(`${key}.`))) {
          for (const item of val as Record<string, unknown>[]) {
            const newRow = { ...row };
            delete newRow[key];
            for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
              newRow[`${key}.${k}`] = v;
            }
            expanded.push(newRow);
          }
          unwound = true;
          changed = true;
          break;
        }
      }
      if (!unwound) expanded.push(row);
    }
    result = expanded;
    if (!changed) break;
  }
  return result;
}

export function TableWidget({ title, dataKey, columns, data, colSpan = 2 }: TableWidgetProps) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [search, setSearch] = useState('');

  const raw = resolveDataKey(data, dataKey);
  const rawRows: Record<string, unknown>[] = Array.isArray(raw)
    ? (raw as Record<string, unknown>[])
    : raw && typeof raw === 'object'
    ? [raw as Record<string, unknown>]
    : [];

  const explicitCols = columns?.length ? columns : undefined;

  // Flatten nested arrays when explicit columns with dot-paths are provided
  const rows = useMemo(
    () => (explicitCols ? flattenRows(rawRows, explicitCols) : rawRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(rawRows), JSON.stringify(explicitCols)],
  );

  const cols: string[] = explicitCols ?? (rows[0] ? Object.keys(rows[0]).slice(0, 10) : []);

  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((row) =>
      cols.some((c) => cellValue(row, c).toLowerCase().includes(q)),
    );
  }, [rows, cols, search]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      const av = cellValue(a, sortCol);
      const bv = cellValue(b, sortCol);
      const n = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === 'asc' ? n : -n;
    });
  }, [filtered, sortCol, sortDir]);

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  const colClass = (span: number) =>
    cn(
      span === 2 && 'col-span-2',
      span === 3 && 'col-span-3',
      span === 4 && 'col-span-4',
    );

  // When the agent returned prose/markdown (stored as _text string), render it as text
  if (rows.length === 0 && typeof raw === 'string' && raw.length > 0) {
    return (
      <div className={cn('rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 overflow-auto max-h-[600px]', colClass(colSpan))}>
        {title && <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{title}</p>}
        <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words font-sans leading-relaxed">{raw}</pre>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={cn('rounded-xl border border-slate-700/60 bg-slate-800/50 p-4', colClass(colSpan))}>
        {title && <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{title}</p>}
        <p className="text-sm text-slate-500 text-center py-4">No data</p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-slate-700/60 bg-slate-800/50 overflow-hidden', colClass(colSpan))}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60">
        {title && <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>}
        <div className="flex items-center gap-1 ml-auto rounded-lg border border-slate-700 bg-slate-900/50 px-2 py-1">
          <Search className="h-3 w-3 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            className="bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none w-24"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/60 bg-slate-900/30">
              {cols.map((col) => (
                <th
                  key={col}
                  onClick={() => toggleSort(col)}
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 cursor-pointer select-none whitespace-nowrap hover:text-slate-200 transition-colors"
                >
                  <span className="inline-flex items-center gap-1">
                    {col.split('.').pop()}
                    {sortCol === col ? (
                      sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronUp className="h-3 w-3 opacity-0 group-hover:opacity-30" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={i}
                className="border-b border-slate-700/40 last:border-0 hover:bg-slate-700/20 transition-colors"
              >
                {cols.map((col) => (
                  <td key={col} className="px-3 py-2 text-xs text-slate-300 whitespace-nowrap max-w-[280px] truncate">
                    {cellValue(row, col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-slate-700/40 text-right">
        <span className="text-[10px] text-slate-500">{sorted.length} row{sorted.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}
