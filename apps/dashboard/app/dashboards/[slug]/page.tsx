'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, RefreshCw, Trash2, Save, Sparkles, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';

type UserDashboard = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  agentId?: string;
  prompt: string;
  widgets: unknown[];
  refreshMode: string;
  cronExpr?: string;
  lastData?: unknown;
  lastRunAt?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type Agent = { id: string; name: string; isDefault: boolean };

const VIEWER_BASE = process.env.NEXT_PUBLIC_DASHBOARD_VIEWER_URL ?? 'http://localhost:8801';

export default function EditDashboardPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['user-dashboard', slug],
    queryFn: () => api.get<UserDashboard>(`/user-dashboards/${slug}`),
    enabled: !!slug,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<Agent[]>('/agents'),
  });

  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId]         = useState('');
  const [prompt, setPrompt]           = useState('');
  const [refreshMode, setRefreshMode] = useState('manual');
  const [cronExpr, setCronExpr]       = useState('');
  const [widgetsJson, setWidgetsJson] = useState('');
  const [initialised, setInitialised] = useState(false);

  // Populate form once data loads
  if (dashboard && !initialised) {
    setName(dashboard.name);
    setDescription(dashboard.description ?? '');
    setAgentId(dashboard.agentId ?? '');
    setPrompt(dashboard.prompt);
    setRefreshMode(dashboard.refreshMode);
    setCronExpr(dashboard.cronExpr ?? '');
    setWidgetsJson(JSON.stringify(dashboard.widgets, null, 2));
    setInitialised(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      let parsedWidgets;
      try { parsedWidgets = JSON.parse(widgetsJson); } catch { throw new Error('Invalid widgets JSON'); }
      return api.put<UserDashboard>(`/user-dashboards/${slug}`, {
        name,
        description: description || undefined,
        agentId: agentId || undefined,
        prompt,
        refreshMode,
        cronExpr: (refreshMode === 'scheduled' && cronExpr) ? cronExpr : undefined,
        widgets: parsedWidgets,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-dashboards'] });
      void queryClient.invalidateQueries({ queryKey: ['user-dashboard', slug] });
      toast({ title: 'Dashboard saved' });
    },
    onError: (e) => toast({ title: 'Save failed', description: String(e), variant: 'destructive' }),
  });

  const refreshMutation = useMutation({
    mutationFn: () => api.post<UserDashboard>(`/user-dashboards/${slug}/refresh`),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['user-dashboard', slug] });
      toast({ title: 'Data refreshed', description: `Last run: ${formatDate(updated.lastRunAt ?? '')}` });
    },
    onError: (e) => toast({ title: 'Refresh failed', description: String(e), variant: 'destructive' }),
  });

  const regenMutation = useMutation({
    mutationFn: () => api.post<UserDashboard>(`/user-dashboards/${slug}/regenerate-widgets`),
    onSuccess: (updated) => {
      setWidgetsJson(JSON.stringify(updated.widgets, null, 2));
      setInitialised(false); // force re-population
      void queryClient.invalidateQueries({ queryKey: ['user-dashboard', slug] });
      toast({ title: 'Widgets regenerated' });
    },
    onError: (e) => toast({ title: 'Regenerate failed', description: String(e), variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/user-dashboards/${slug}`),
    onSuccess: () => {
      toast({ title: 'Dashboard deleted' });
      router.push('/dashboards');
    },
    onError: (e) => toast({ title: 'Delete failed', description: String(e), variant: 'destructive' }),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.put<UserDashboard>(`/user-dashboards/${slug}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-dashboard', slug] });
      toast({ title: 'Status updated' });
    },
  });

  if (isLoading || !dashboard) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-6 w-6 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboards" className="text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-secondary))] transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-[rgb(var(--text-primary))] truncate">{dashboard.name}</h1>
          <p className="text-xs text-[rgb(var(--text-muted))]">
            /{dashboard.slug} · Last run: {dashboard.lastRunAt ? formatDate(dashboard.lastRunAt) : 'Never'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${VIEWER_BASE}/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-1.5 text-xs text-[rgb(var(--text-secondary))] hover:text-cyan-400 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Viewer
          </a>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
          Refresh Data
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={() => regenMutation.mutate()}
          disabled={regenMutation.isPending}
        >
          <Sparkles className={`h-3.5 w-3.5 ${regenMutation.isPending ? 'animate-spin' : ''}`} />
          Regenerate Widgets
        </Button>

        {dashboard.status !== 'paused' ? (
          <Button size="sm" variant="outline" className="gap-2 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
            onClick={() => statusMutation.mutate('paused')}>
            Pause
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="gap-2 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
            onClick={() => statusMutation.mutate('active')}>
            Resume
          </Button>
        )}

        <Button
          size="sm"
          variant="outline"
          className="gap-2 text-red-400 border-red-500/30 hover:bg-red-500/10 ml-auto"
          onClick={() => { if (confirm('Delete this dashboard?')) deleteMutation.mutate(); }}
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      {/* Form */}
      <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] p-6 space-y-5">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={saveMutation.isPending} />
        </div>

        <div className="space-y-1.5">
          <Label>Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={saveMutation.isPending} />
        </div>

        <div className="space-y-1.5">
          <Label>Agent</Label>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] outline-none"
          >
            <option value="">— Use default agent —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>Prompt</Label>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} disabled={saveMutation.isPending} />
        </div>

        <div className="space-y-1.5">
          <Label>Refresh Mode</Label>
          <div className="flex gap-2 flex-wrap">
            {(['manual', 'scheduled', 'realtime'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setRefreshMode(mode)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-all ${
                  refreshMode === mode
                    ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-400'
                    : 'border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:border-slate-500'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          {refreshMode === 'scheduled' && (
            <Input value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} placeholder="Cron expression" className="mt-2" />
          )}
        </div>

        {/* Widget JSON editor */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Widget Configuration (JSON)</Label>
            <span className="text-[10px] text-[rgb(var(--text-muted))]">Edit directly or use Regenerate Widgets</span>
          </div>
          <textarea
            value={widgetsJson}
            onChange={(e) => setWidgetsJson(e.target.value)}
            rows={12}
            spellCheck={false}
            className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 font-mono text-xs text-[rgb(var(--text-primary))] outline-none focus:border-cyan-500/40 resize-y"
          />
        </div>

        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="gap-2"
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Changes
        </Button>
      </div>
    </div>
  );
}
