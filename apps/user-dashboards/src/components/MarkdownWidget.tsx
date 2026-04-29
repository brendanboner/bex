/**
 * MarkdownWidget — safe JSX renderer for a markdown string field.
 * No dangerouslySetInnerHTML. Handles headings, bold, lists, paragraphs.
 */

import { cn, resolveDataKey } from '@/lib/utils';

interface MarkdownWidgetProps {
  title?: string;
  dataKey?: string;
  data: Record<string, unknown>;
  colSpan?: number;
}

/** Render inline bold (**text**) as <strong> nodes */
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-slate-100">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function renderMarkdown(source: string): React.ReactNode[] {
  const lines = source.split('\n');
  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let keyCounter = 0;

  function flushList() {
    if (listBuffer.length === 0) return;
    nodes.push(
      <ul key={`ul-${keyCounter++}`} className="list-disc list-inside space-y-0.5 text-sm text-slate-300 my-1">
        {listBuffer.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flushList();
      nodes.push(
        <h2 key={`h2-${keyCounter++}`} className="text-base font-bold text-slate-100 mt-3 mb-1">
          {renderInline(line.slice(3))}
        </h2>
      );
    } else if (line.startsWith('### ')) {
      flushList();
      nodes.push(
        <h3 key={`h3-${keyCounter++}`} className="text-sm font-semibold text-slate-200 mt-2 mb-0.5">
          {renderInline(line.slice(4))}
        </h3>
      );
    } else if (line.match(/^[-*] /)) {
      listBuffer.push(line.slice(2));
    } else if (line.trim() === '') {
      flushList();
      nodes.push(<div key={`br-${keyCounter++}`} className="h-2" />);
    } else {
      flushList();
      nodes.push(
        <p key={`p-${keyCounter++}`} className="text-sm text-slate-300 leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }
  }
  flushList();
  return nodes;
}

export function MarkdownWidget({ title, dataKey, data, colSpan = 2 }: MarkdownWidgetProps) {
  const raw = resolveDataKey(data, dataKey);

  const colClass = cn(
    'rounded-xl border border-slate-700/60 bg-slate-800/50 p-4',
    colSpan === 2 && 'col-span-2',
    colSpan === 3 && 'col-span-3',
    colSpan === 4 && 'col-span-4',
  );

  if (!dataKey || typeof raw !== 'string') {
    return (
      <div className={colClass}>
        {title && <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{title}</p>}
        <pre className="text-xs text-slate-500 whitespace-pre-wrap">
          {raw != null ? String(raw) : 'No data'}
        </pre>
      </div>
    );
  }

  return (
    <div className={colClass}>
      {title && <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{title}</p>}
      <div className="space-y-0.5">{renderMarkdown(raw)}</div>
    </div>
  );
}
