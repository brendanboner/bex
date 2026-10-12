'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Plus,
  Trash2,
  RefreshCw,
  ExternalLink,
  Pencil,
  Play,
  Pause,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';

type UserDashboard = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  agentId?: string;
  refreshMode: string;
  cronExpr?: string;
  status: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
};

const STATUS_COLOURS: Record<string, string> = {
  active:   'bg-emerald-500/15 text-emerald-400',
  paused:   'bg-amber-500/15 text-amber-400',
  archived: 'bg-slate-500/15 text-slate-400',
};

const VIEWER_BASE = process.env.NEXT_PUBLIC_DASHBOARD_VIEWER_URL ?? 'http://localhost:8801';

export default function DashboardsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: dashboards = [], isLoading } = useQuery({
    queryKey: ['user-dashboards'],
    queryFn: () => api.get<UserDashboard[]>('/user-dashboards'),
    refetchInterval: 15_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (slug: string) => api.delete(`/user-dashboards/${slug}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-dashboards'] });
      toast({ title: 'Dashboard deleted' });
    },
    onError: (e) => toast({ title: 'Delete failed', description: String(e), variant: 'destructive' }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ slug, status }: { slug: string; status: string }) =>
      api.put<UserDashboard>(`/user-dashboards/${slug}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-dashboards'] });
      toast({ title: 'Status updated' });
    },
    onError: (e) => toast({ title: 'Update failed', description: String(e), variant: 'destructive' }),
  });

  const refreshMutation = useMutation({
    mutationFn: (slug: string) => api.post(`/user-dashboards/${slug}/refresh`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-dashboards'] });
      toast({ title: 'Dashboard refreshed' });
    },
    onError: (e) => toast({ title: 'Refresh failed', description: String(e), variant: 'destructive' }),
  });

  const filtered = dashboards.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.slug.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[rgb(var(--text-primary))]">Dashboards</h1>
          <p className="text-sm text-[rgb(var(--text-secondary))] mt-0.5">
            Live data views powered by agent skills — accessible at{' '}
            <a href={VIEWER_BASE} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">
              {VIEWER_BASE}
            </a>
          </p>
        </div>
        <Link href="/dashboards/new">
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            New Dashboard
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search dashboards…"
          className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] px-4 py-2 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] outline-none focus:border-cyan-500/40"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-6 w-6 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-[rgb(var(--text-muted))]">
            <LayoutDashboard className="h-10 w-10 opacity-20" />
            <p className="text-sm">
              {search ? 'No dashboards match your search' : 'No dashboards yet — create your first one'}
            </p>
            {!search && (
              <Link href="/dashboards/new">
                <Button size="sm" variant="outline" className="mt-1 gap-2">
                  <Plus className="h-4 w-4" /> Create Dashboard
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))]">
                {['Name', 'Slug', 'Refresh', 'Status', 'Last Run', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="border-b border-[rgb(var(--border))] last:border-0 hover:bg-[rgb(var(--bg-elevated))] transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[rgb(var(--text-primary))]">{d.name}</div>
                    {d.description && (
                      <div className="text-xs text-[rgb(var(--text-muted))] truncate max-w-[200px]">{d.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">/{d.slug}</code>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-[rgb(var(--text-secondary))] capitalize">{d.refreshMode}</span>
                    {d.cronExpr && (
                      <div className="text-[10px] text-[rgb(var(--text-muted))]">{d.cronExpr}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={STATUS_COLOURS[d.status] ?? 'bg-slate-500/15 text-slate-400'}>
                      {d.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-[rgb(var(--text-secondary))]">
                    {d.lastRunAt ? formatDate(d.lastRunAt) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {/* View in viewer */}
                      <a
                        href={`${VIEWER_BASE}/${d.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open viewer"
                        className="rounded p-1.5 text-[rgb(var(--text-muted))] hover:bg-[rgb(var(--bg-elevated))] hover:text-cyan-400 transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>

                      {/* Edit */}
                      <Link
                        href={`/dashboards/${d.slug}`}
                        title="Edit"
                        className="rounded p-1.5 text-[rgb(var(--text-muted))] hover:bg-[rgb(var(--bg-elevated))] hover:text-slate-200 transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Link>

                      {/* Refresh data */}
                      <button
                        title="Refresh data"
                        disabled={refreshMutation.isPending}
                        onClick={() => refreshMutation.mutate(d.slug)}
                        className="rounded p-1.5 text-[rgb(var(--text-muted))] hover:bg-[rgb(var(--bg-elevated))] hover:text-emerald-400 transition-colors disabled:opacity-40"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>

                      {/* Pause/resume */}
                      <button
                        title={d.status === 'paused' ? 'Resume' : 'Pause'}
                        onClick={() =>
                          toggleMutation.mutate({ slug: d.slug, status: d.status === 'paused' ? 'active' : 'paused' })
                        }
                        className="rounded p-1.5 text-[rgb(var(--text-muted))] hover:bg-[rgb(var(--bg-elevated))] hover:text-amber-400 transition-colors"
                      >
                        {d.status === 'paused' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                      </button>

                      {/* Delete */}
                      <button
                        title="Delete"
                        onClick={() => {
                          if (confirm(`Delete dashboard "${d.name}"?`)) deleteMutation.mutate(d.slug);
                        }}
                        className="rounded p-1.5 text-[rgb(var(--text-muted))] hover:bg-red-500/15 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
