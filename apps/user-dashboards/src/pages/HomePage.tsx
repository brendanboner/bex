/**
 * HomePage — lists all active dashboards as cards.
 */

import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, ArrowRight, Clock, AlertCircle, HelpCircle } from 'lucide-react';
import { dashboardApi } from '@/lib/api';
import { relativeTime, statusColor } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { HelpModal } from '@/components/HelpModal';

export function HomePage() {
  const [showHelp, setShowHelp] = useState(false);
  const { data: dashboards, isLoading, error } = useQuery({
    queryKey: ['dashboards'],
    queryFn: () => dashboardApi.list(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  return (
    <div className="min-h-screen bg-slate-950">
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <header className="border-b border-slate-800">
        <div className="max-w-screen-xl mx-auto px-6 py-4 flex items-center gap-3">
          <LayoutDashboard className="h-5 w-5 text-cyan-400" />
          <div>
            <h1 className="text-lg font-bold text-slate-100">BEX Dashboards</h1>
            <p className="text-xs text-slate-500">Live data views powered by autonomous agents</p>
          </div>
          <button
            onClick={() => setShowHelp(true)}
            className="ml-auto rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-700 transition-all"
            title="Help & widget guide"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <a
            href="http://localhost:3000/dashboards/new"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-400 hover:bg-cyan-500/20 transition-all"
          >
            + New Dashboard
          </a>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-8">
        {isLoading && (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 py-16 text-slate-400">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-sm">Could not load dashboards — is the API gateway running?</p>
            <p className="text-xs">{error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        )}

        {dashboards && dashboards.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-24 text-slate-400">
            <LayoutDashboard className="h-12 w-12 opacity-20" />
            <p className="text-base font-medium text-slate-300">No dashboards yet</p>
            <p className="text-sm text-slate-500 text-center max-w-sm">
              Create your first dashboard from the BEX admin panel or by running{' '}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-cyan-400">bex dashboard create</code>
            </p>
            <a
              href="http://localhost:3000/dashboards/new"
              target="_blank"
              rel="noreferrer"
              className="mt-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-400 hover:bg-cyan-500/20 transition-all"
            >
              Create Dashboard
            </a>
          </div>
        )}

        {dashboards && dashboards.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {dashboards.map((d) => (
              <Link
                key={d.id}
                to={`/${d.slug}`}
                className="group rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 hover:border-cyan-500/40 hover:bg-slate-800 transition-all flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
                    <LayoutDashboard className="h-4 w-4 text-cyan-400" />
                  </div>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', statusColor(d.status))}>
                    {d.status}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-100 truncate group-hover:text-cyan-400 transition-colors">
                    {d.name}
                  </p>
                  {d.description && (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{d.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 text-[10px] text-slate-500">
                  <Clock className="h-3 w-3" />
                  <span>Updated {relativeTime(d.lastRunAt)}</span>
                  <span className="ml-auto text-slate-600">/{d.slug}</span>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px]">
                    {d.refreshMode}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 text-cyan-400 transition-opacity" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
