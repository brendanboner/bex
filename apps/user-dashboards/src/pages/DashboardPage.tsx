/**
 * DashboardPage — renders a single user dashboard at /:slug.
 * Fetches config + lastData from api-gateway, then renders the widget grid.
 * Supports manual refresh, auto-refresh (realtime mode), and schedule display.
 */

import { useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ArrowLeft, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { dashboardApi } from '@/lib/api';
import { relativeTime } from '@/lib/utils';
import { WidgetGrid } from '@/components/WidgetGrid';

const REALTIME_INTERVAL_MS = 30_000;
const PROVISIONING_POLL_MS = 10_000;

export function DashboardPage() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    data: dashboard,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['dashboard', slug],
    queryFn: () => dashboardApi.get(slug!),
    enabled: !!slug,
    staleTime: 10_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => dashboardApi.refresh(slug!),
    onSuccess: (updated) => {
      queryClient.setQueryData(['dashboard', slug], updated);
    },
  });

  const isProvisioning = dashboard?.status === 'provisioning';
  const isError = dashboard?.status === 'error';

  // Auto-poll while provisioning, or auto-refresh for realtime dashboards
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (isProvisioning) {
      // Poll the GET endpoint (not a full refresh) so we detect status transition cheaply
      intervalRef.current = setInterval(() => {
        void queryClient.invalidateQueries({ queryKey: ['dashboard', slug] });
      }, PROVISIONING_POLL_MS);
    } else if (dashboard?.refreshMode === 'realtime') {
      intervalRef.current = setInterval(() => {
        refreshMutation.mutate();
      }, REALTIME_INTERVAL_MS);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard?.refreshMode, isProvisioning, slug]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="h-8 w-8 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
          <p className="text-sm">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <AlertCircle className="h-8 w-8 text-red-400" />
          <p className="text-sm font-medium text-slate-200">Dashboard not found</p>
          <p className="text-xs">{error instanceof Error ? error.message : 'Unknown error'}</p>
          <Link to="/" className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
            ← Back to all dashboards
          </Link>
        </div>
      </div>
    );
  }

  const provisioningMessage = (dashboard.meta as Record<string, unknown> | null)?.provisioningMessage as string | undefined;
  const errorDetail = (dashboard.meta as Record<string, unknown> | null)?.provisioningMessage as string | undefined;

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center gap-4">
          <Link to="/" className="text-slate-500 hover:text-slate-300 transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-slate-100 truncate">{dashboard.name}</h1>
            {dashboard.description && (
              <p className="text-xs text-slate-500 truncate">{dashboard.description}</p>
            )}
          </div>

          {/* Last updated */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="h-3 w-3" />
            <span>Updated {relativeTime(dashboard.lastRunAt)}</span>
          </div>

          {/* Refresh mode badge */}
          {dashboard.refreshMode !== 'manual' && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400 border border-cyan-500/20">
              {dashboard.refreshMode === 'realtime' ? '⏱ Live' : `⏰ ${dashboard.cronExpr ?? 'Scheduled'}`}
            </span>
          )}

          {/* Manual refresh button */}
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending || isProvisioning}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      {/* Provisioning banner */}
      {isProvisioning && (
        <div className="max-w-screen-xl mx-auto px-6 pt-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-start gap-3">
            <Loader2 className="h-4 w-4 text-amber-400 animate-spin mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-300">Preparing your dashboard…</p>
              <p className="text-xs text-amber-400/80 mt-0.5">
                {provisioningMessage ?? 'Required skills are being acquired or generated. This may take up to 60 seconds. This page will update automatically.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error banner */}
      {isError && (
        <div className="max-w-screen-xl mx-auto px-6 pt-4">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-300">Dashboard provisioning failed</p>
              <p className="text-xs text-red-400/80 mt-0.5">
                {errorDetail ?? 'Skill acquisition failed. Click Refresh to try again, or check that your credentials are configured.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Refresh error banner */}
      {refreshMutation.error && (
        <div className="max-w-screen-xl mx-auto px-6 pt-4">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
            Refresh failed: {refreshMutation.error instanceof Error ? refreshMutation.error.message : 'Unknown error'}
          </div>
        </div>
      )}

      {/* Widget grid */}
      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <WidgetGrid
          dashboard={dashboard}
          onRefresh={() => refreshMutation.mutate()}
          isRefreshing={refreshMutation.isPending}
        />
      </main>
    </div>
  );
}
