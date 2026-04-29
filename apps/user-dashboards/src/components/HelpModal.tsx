/**
 * HelpModal — full-screen overlay with Widget Types and Example Prompts tabs.
 */

import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HelpModalProps {
  onClose: () => void;
}

const WIDGET_TYPES = [
  {
    type: 'headline',
    name: 'Headline',
    description: 'Single value prominently displayed. Good for totals and counts.',
    props: ['dataKey', 'title', 'colSpan'],
    example: `{ "id": "w1", "type": "headline", "title": "Total Clients", "dataKey": "summary.total_clients", "colSpan": 1 }`,
  },
  {
    type: 'stat',
    name: 'Metric Card',
    description: 'Value with trend arrow and health colour (green/amber/red). Good for signal quality, uptime.',
    props: ['dataKey', 'unit', 'deltaKey', 'statusKey', 'thresholds'],
    example: `{ "id": "w2", "type": "stat", "title": "Avg SNR", "dataKey": "summary.avg_snr", "unit": "dB", "thresholds": { "warn": 25, "crit": 15 } }`,
  },
  {
    type: 'table',
    name: 'Data Table',
    description: 'Sortable/searchable table. Good for client or device lists.',
    props: ['dataKey', 'columns', 'colSpan'],
    example: `{ "id": "w3", "type": "table", "title": "Clients", "dataKey": "clients", "columns": ["hostname","ip","ssid","signal"], "colSpan": 4 }`,
  },
  {
    type: 'chart',
    name: 'Chart',
    description: 'Bar, line, or pie chart. Good for comparisons and distributions.',
    props: ['dataKey', 'chartType', 'xKey', 'yKey', 'colSpan'],
    example: `{ "id": "w4", "type": "chart", "title": "Clients by AP", "dataKey": "by_ap", "chartType": "bar", "xKey": "ap", "yKey": "count", "colSpan": 2 }`,
  },
  {
    type: 'multiline',
    name: 'Multi-Series Chart',
    description: 'Multiple lines on one chart. Good for comparing radio bands or trends.',
    props: ['dataKey', 'xKey', 'yKeys[]', 'colSpan'],
    example: `{ "id": "w5", "type": "multiline", "title": "SNR by Band", "dataKey": "snr_trend", "xKey": "time", "yKeys": ["band_24", "band_5"], "colSpan": 3 }`,
  },
  {
    type: 'heatmap',
    name: 'Heatmap Grid',
    description: 'Grid of cells coloured by value. Good for AP RF quality or client density.',
    props: ['dataKey', 'labelKey', 'valueKey', 'thresholds', 'unit'],
    example: `{ "id": "w6", "type": "heatmap", "title": "AP RF Quality", "dataKey": "access_points", "labelKey": "hostname", "valueKey": "snr", "unit": "dB", "thresholds": { "warn": 25, "crit": 15 }, "colSpan": 4 }`,
  },
  {
    type: 'markdown',
    name: 'Text Summary',
    description: 'Prose/formatted text. Good for agent summaries and analysis.',
    props: ['dataKey', 'colSpan'],
    example: `{ "id": "w7", "type": "markdown", "title": "Analysis", "dataKey": "summary_markdown", "colSpan": 4 }`,
  },
  {
    type: 'actions',
    name: 'Actions',
    description: 'Refresh and quick-action buttons. Always include one per dashboard.',
    props: ['actions[].label', 'actions[].action', 'actions[].style'],
    example: `{ "id": "w8", "type": "actions", "actions": [{ "label": "Refresh", "action": "refresh", "style": "primary" }], "colSpan": 1 }`,
  },
];

const EXAMPLE_PROMPTS = [
  'List all Apple clients on all access points with Hostname, IP Address, VLAN and SSID',
  'Show all devices in a line chart by Radio Parameter Quality',
  'Show Apple clients + radio quality for all APs',
  'Show all active wireless clients grouped by vendor (Apple, Android, Windows)',
  'Create a client health dashboard — signal quality, AP, SSID, VLAN for each client',
  'Show an XCO fabric health dashboard with alarm summary and BGP status',
  'Show all XCO active alarms grouped by severity with trend',
  'Show radio SNR for all APs — 2.4GHz and 5GHz on the same chart',
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-700 transition-all"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

type Tab = 'widgets' | 'prompts';

export function HelpModal({ onClose }: HelpModalProps) {
  const [tab, setTab] = useState<Tab>('widgets');

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/90 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-4xl mx-4 my-8 rounded-2xl border border-slate-700/60 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <div>
            <h2 className="text-lg font-bold text-slate-100">Dashboard Help</h2>
            <p className="text-xs text-slate-500 mt-0.5">Widget types and example prompts</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-all"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4">
          {(['widgets', 'prompts'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-lg px-4 py-1.5 text-sm font-medium transition-all',
                tab === t
                  ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800',
              )}
            >
              {t === 'widgets' ? 'Widget Types' : 'Example Prompts'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          {tab === 'widgets' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {WIDGET_TYPES.map((w) => (
                <div key={w.type} className="rounded-xl border border-slate-700/40 bg-slate-800/50 p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-cyan-500/15 px-2 py-0.5 text-[10px] font-mono font-bold text-cyan-400 border border-cyan-500/20">
                      {w.type}
                    </span>
                    <span className="text-sm font-semibold text-slate-100">{w.name}</span>
                  </div>
                  <p className="text-xs text-slate-400">{w.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {w.props.map((p) => (
                      <span key={p} className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-400 font-mono">
                        {p}
                      </span>
                    ))}
                  </div>
                  <div className="relative">
                    <pre className="rounded-lg bg-slate-950/60 border border-slate-700/40 px-3 py-2 text-[10px] text-slate-400 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                      {w.example}
                    </pre>
                    <div className="absolute top-1 right-1">
                      <CopyButton text={w.example} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'prompts' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {EXAMPLE_PROMPTS.map((prompt, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-slate-700/40 bg-slate-800/50 p-4 flex items-start justify-between gap-3"
                >
                  <p className="text-sm text-slate-300 leading-relaxed flex-1">
                    "{prompt}"
                  </p>
                  <CopyButton text={prompt} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
