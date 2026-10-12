/**
 * ActionsWidget — renders action buttons (refresh, custom prompt, etc.)
 */

import { cn } from '@/lib/utils';
import type { Widget } from '@/lib/api';

interface ActionsWidgetProps {
  widget: Widget;
  onRefresh: () => void;
  onPrompt?: (prompt: string) => void;
  isLoading?: boolean;
  colSpan?: number;
}

const styleMap = {
  primary: 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 border-cyan-500/30',
  secondary: 'bg-slate-700/30 hover:bg-slate-700/50 text-slate-300 border-slate-600/40',
  danger: 'bg-red-500/15 hover:bg-red-500/25 text-red-400 border-red-500/30',
};

export function ActionsWidget({ widget, onRefresh, onPrompt, isLoading, colSpan = 1 }: ActionsWidgetProps) {
  const actions = widget.actions ?? [{ label: 'Refresh', action: 'refresh' as const, style: 'primary' as const }];

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 flex flex-col gap-3',
        colSpan === 2 && 'col-span-2',
        colSpan === 3 && 'col-span-3',
        colSpan === 4 && 'col-span-4',
      )}
    >
      {widget.title && (
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{widget.title}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((action, i) => (
          <button
            key={i}
            disabled={isLoading}
            onClick={() => {
              if (action.action === 'refresh') {
                onRefresh();
              } else if (action.action === 'prompt' && action.prompt && onPrompt) {
                onPrompt(action.prompt);
              }
            }}
            className={cn(
              'px-4 py-2 rounded-lg border text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed',
              styleMap[action.style ?? 'primary'],
            )}
          >
            {isLoading && action.action === 'refresh' ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                Refreshing…
              </span>
            ) : (
              action.label
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
