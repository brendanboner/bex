/**
 * MermaidWidget — renders a Mermaid diagram from a string field in lastData.
 *
 * Safety contract:
 * - Mermaid only runs client-side (no SSR)
 * - Invalid syntax shows a fallback code block, never crashes the page
 * - Re-renders cleanly by re-mounting on data change (unique key per render)
 */

import { useEffect, useRef, useState } from 'react';
import { cn, resolveDataKey } from '@/lib/utils';

interface MermaidWidgetProps {
  title?: string;
  dataKey?: string;
  data: Record<string, unknown>;
  colSpan?: number;
}

let mermaidInitialised = false;

async function getMermaid() {
  const m = await import('mermaid');
  if (!mermaidInitialised) {
    m.default.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        background: '#0f172a',
        primaryColor: '#06b6d4',
        primaryTextColor: '#e2e8f0',
        primaryBorderColor: '#334155',
        lineColor: '#475569',
        secondaryColor: '#1e293b',
        tertiaryColor: '#1e293b',
        edgeLabelBackground: '#1e293b',
        fontFamily: 'ui-monospace, monospace',
        fontSize: '13px',
      },
    });
    mermaidInitialised = true;
  }
  return m.default;
}

let renderSeq = 0;

export function MermaidWidget({ title, dataKey, data, colSpan = 4 }: MermaidWidgetProps) {
  const raw = resolveDataKey(data, dataKey);
  const diagramText = typeof raw === 'string' ? raw.trim() : '';

  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!diagramText || !containerRef.current) return;

    let cancelled = false;
    setError(null);
    setRendered(false);

    const id = `mermaid-${++renderSeq}`;

    getMermaid()
      .then(async (mermaid) => {
        if (cancelled || !containerRef.current) return;
        try {
          // Validate syntax before rendering — avoids async render errors
          await mermaid.parse(diagramText);
          const { svg } = await mermaid.render(id, diagramText);
          if (cancelled || !containerRef.current) return;
          containerRef.current.innerHTML = svg;
          // Make SVG responsive
          const svgEl = containerRef.current.querySelector('svg');
          if (svgEl) {
            svgEl.style.maxWidth = '100%';
            svgEl.style.height = 'auto';
          }
          setRendered(true);
        } catch (e) {
          if (!cancelled) {
            const msg = e instanceof Error ? e.message : String(e);
            // Trim Mermaid's verbose error — show only the first line
            setError(msg.split('\n')[0]?.slice(0, 200) ?? 'Diagram syntax error');
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load Mermaid');
      });

    return () => { cancelled = true; };
  }, [diagramText]);

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

      {!diagramText && (
        <p className="text-sm text-slate-500 text-center py-8">No diagram data</p>
      )}

      {diagramText && error && (
        <div className="space-y-2">
          <p className="text-xs text-red-400">⚠ Diagram render error: {error}</p>
          <pre className="rounded-lg bg-slate-900/60 p-3 text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap break-words">
            {diagramText}
          </pre>
        </div>
      )}

      {diagramText && !error && (
        <div
          ref={containerRef}
          className={cn(
            'overflow-x-auto flex justify-center',
            !rendered && 'min-h-[120px] flex items-center justify-center',
          )}
        >
          {!rendered && (
            <div className="h-6 w-6 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
          )}
        </div>
      )}
    </div>
  );
}
