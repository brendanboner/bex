'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowLeft, LayoutDashboard, Loader2, Sparkles,
  CheckCircle2, AlertCircle, ChevronRight, Edit3, Info,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';

type Agent = { id: string; name: string; description?: string; isDefault: boolean };

type Widget = { id: string; type: string; title?: string; dataKey?: string; colSpan?: number };
type DataKey = { key: string; type: string; count?: number };

type PreviewResult = {
  agentId: string;
  widgets: Widget[];
  dataKeys: DataKey[];
  dataPreview: unknown;
  previewError: string | null;
};

type CreateDashboardBody = {
  name: string;
  slug?: string;
  description?: string;
  agentId?: string;
  prompt: string;
  refreshMode: 'manual' | 'scheduled' | 'realtime';
  cronExpr?: string;
};

const WIDGET_TYPE_COLORS: Record<string, string> = {
  headline: 'bg-cyan-500/15 text-cyan-400',
  stat: 'bg-emerald-500/15 text-emerald-400',
  table: 'bg-violet-500/15 text-violet-400',
  chart: 'bg-orange-500/15 text-orange-400',
  multiline: 'bg-amber-500/15 text-amber-400',
  heatmap: 'bg-red-500/15 text-red-400',
  mermaid: 'bg-sky-500/15 text-sky-400',
  markdown: 'bg-slate-500/15 text-slate-300',
  actions: 'bg-slate-700/50 text-slate-400',
};

function PreviewPanel({
  preview,
  prompt,
  onEditPrompt,
  onConfirm,
  onCancel,
  isBuilding,
}: {
  preview: PreviewResult;
  prompt: string;
  onEditPrompt: (p: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isBuilding: boolean;
}) {
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [localPrompt, setLocalPrompt] = useState(prompt);

  return (
    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-cyan-400 shrink-0" />
        <p className="text-sm font-semibold text-cyan-300">Preview ready — review before building</p>
      </div>

      {preview.previewError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-300">Agent run failed: {preview.previewError}. Widget layout is estimated — skills may still be provisioning.</p>
        </div>
      )}

      {/* Data keys */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
          Data returned ({preview.dataKeys.length} field{preview.dataKeys.length !== 1 ? 's' : ''})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {preview.dataKeys.length === 0 && (
            <span className="text-xs text-slate-500">No structured data — agent may have returned prose</span>
          )}
          {preview.dataKeys.map((dk) => (
            <span
              key={dk.key}
              className="inline-flex items-center gap-1 rounded-md bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300"
            >
              <code className="text-cyan-400">{dk.key}</code>
              <span className="text-slate-500">
                {dk.type === 'array' ? `[${dk.count} rows]` : dk.type}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Proposed widgets */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
          Proposed widget layout ({preview.widgets.length} widget{preview.widgets.length !== 1 ? 's' : ''})
        </p>
        <div className="space-y-1.5">
          {preview.widgets.map((w, i) => (
            <div
              key={w.id ?? i}
              className="flex items-center gap-2 rounded-lg bg-slate-800/60 border border-slate-700/60 px-3 py-2"
            >
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${WIDGET_TYPE_COLORS[w.type] ?? 'bg-slate-700 text-slate-300'}`}>
                {w.type}
              </span>
              <span className="text-xs text-slate-200 flex-1 truncate">{w.title ?? '(untitled)'}</span>
              {w.dataKey && (
                <code className="text-[10px] text-slate-500 shrink-0">{w.dataKey}</code>
              )}
              {w.colSpan && w.colSpan > 1 && (
                <span className="text-[10px] text-slate-600 shrink-0">×{w.colSpan}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Editable prompt */}
      <div>
        <button
          type="button"
          onClick={() => setEditingPrompt((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <Edit3 className="h-3 w-3" />
          {editingPrompt ? 'Hide prompt editor' : 'Edit prompt before building'}
        </button>
        {editingPrompt && (
          <div className="mt-2 space-y-2">
            <Textarea
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              rows={4}
              className="text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { onEditPrompt(localPrompt); setEditingPrompt(false); }}
            >
              Re-preview with this prompt
            </Button>
          </div>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center gap-3 pt-1">
        <Button
          type="button"
          onClick={onConfirm}
          disabled={isBuilding}
          className="gap-2"
        >
          {isBuilding ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
          {isBuilding ? 'Building…' : 'Build Dashboard'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isBuilding}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function NewDashboardPage() {
  const router = useRouter();

  const [name, setName]               = useState('');
  const [slug, setSlug]               = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId]         = useState('');
  const [prompt, setPrompt]           = useState('');
  const [refreshMode, setRefreshMode] = useState<'manual' | 'scheduled' | 'realtime'>('manual');
  const [cronExpr, setCronExpr]       = useState('');
  const [confirmBuild, setConfirmBuild] = useState(false);
  const [preview, setPreview]         = useState<PreviewResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [showEntityHints, setShowEntityHints] = useState(false);

  function handleNameChange(value: string) {
    setName(value);
    const derived = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    setSlug(derived);
  }

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<Agent[]>('/agents'),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateDashboardBody) => api.post('/user-dashboards', body),
    onSuccess: (data: unknown) => {
      const d = data as { slug: string };
      toast({ title: 'Dashboard created', description: `Accessible at /${d.slug}` });
      router.push('/dashboards');
    },
    onError: (e) => toast({ title: 'Creation failed', description: String(e), variant: 'destructive' }),
  });

  async function runPreview(overridePrompt?: string) {
    const activePrompt = overridePrompt ?? prompt;
    if (!name || !activePrompt) return;
    setIsPreviewing(true);
    setPreview(null);
    try {
      const result = await api.post<PreviewResult>('/user-dashboards/preview', {
        name,
        slug: slug || undefined,
        description: description || undefined,
        agentId: agentId || undefined,
        prompt: activePrompt,
        refreshMode,
        cronExpr: (refreshMode === 'scheduled' && cronExpr) ? cronExpr : undefined,
      });
      if (overridePrompt) setPrompt(overridePrompt);
      setPreview(result);
    } catch (e) {
      toast({ title: 'Preview failed', description: String(e), variant: 'destructive' });
    } finally {
      setIsPreviewing(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !prompt) return;

    if (confirmBuild && !preview) {
      runPreview();
      return;
    }

    createMutation.mutate({
      name,
      slug: slug || undefined,
      description: description || undefined,
      agentId: (preview?.agentId) ?? agentId ?? undefined,
      prompt,
      refreshMode,
      cronExpr: (refreshMode === 'scheduled' && cronExpr) ? cronExpr : undefined,
    });
  }

  const isPending = createMutation.isPending;
  const isAnyPending = isPending || isPreviewing;

  const submitLabel = isPreviewing
    ? 'Running preview…'
    : confirmBuild && !preview
    ? 'Preview Dashboard'
    : isPending
    ? 'Creating dashboard…'
    : 'Create Dashboard';

  const submitIcon = isPreviewing || isPending
    ? <Loader2 className="h-4 w-4 animate-spin" />
    : confirmBuild && !preview
    ? <Sparkles className="h-4 w-4" />
    : <LayoutDashboard className="h-4 w-4" />;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboards" className="text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-secondary))] transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[rgb(var(--text-primary))]">New Dashboard</h1>
          <p className="text-sm text-[rgb(var(--text-secondary))]">
            Describe what you want to visualise — the agent will run and the system will auto-generate the widget layout.
          </p>
        </div>
      </div>

      {/* AI note */}
      <div className="flex items-start gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-300">
        <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-cyan-400" />
        <span>
          On creation the selected agent will run immediately, and the LLM will auto-generate a widget layout
          from the response. Enable <strong>Confirm Build</strong> below to preview the layout before saving.
          Complex queries (Sankey diagrams, topology views, large client lists) may take up to 30 seconds —
          the dashboard will show <strong>provisioning</strong> status and update automatically when ready.
        </span>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] p-6 space-y-5">
        {/* Name */}
        <div className="space-y-1.5">
          <Label htmlFor="name">Dashboard Name <span className="text-red-400">*</span></Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. WiFi Clients by AP"
            required
            disabled={isAnyPending}
          />
        </div>

        {/* Slug */}
        <div className="space-y-1.5">
          <Label htmlFor="slug">URL Slug</Label>
          <div className="flex items-center gap-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2">
            <span className="text-sm text-[rgb(var(--text-muted))]">localhost:8801/</span>
            <input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/g, '').slice(0, 80))}
              className="flex-1 bg-transparent text-sm text-[rgb(var(--text-primary))] outline-none"
              placeholder="auto-derived-from-name"
              disabled={isAnyPending}
            />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional brief description"
            disabled={isAnyPending}
          />
        </div>

        {/* Agent */}
        <div className="space-y-1.5">
          <Label htmlFor="agent">Agent</Label>
          <select
            id="agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={isAnyPending}
            className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] outline-none focus:border-cyan-500/40"
          >
            <option value="">— Use default agent —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Prompt */}
        <div className="space-y-1.5 relative">
          <div className="flex items-center gap-2">
            <Label htmlFor="prompt">Agent Prompt <span className="text-red-400">*</span></Label>
            <button
              type="button"
              onClick={() => setShowEntityHints((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-[rgb(var(--border))] px-1.5 py-0.5 text-[11px] text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))]"
              title="Show supported entity types"
            >
              <Info className="h-3 w-3" />
              Entities
            </button>
          </div>
          {showEntityHints && (
            <div className="rounded-lg border border-cyan-500/30 bg-[rgb(var(--bg-elevated))] p-3 text-xs text-[rgb(var(--text-secondary))]">
              <p className="font-semibold text-cyan-300 mb-1">Entity types you can reference</p>
              <p className="leading-relaxed">
                <code>clients</code>, <code>devices</code>, <code>access_points</code>, <code>ssids</code>, <code>vlans</code>,
                <code>alarms</code>, <code>events</code>, <code>fabrics</code>, <code>switches</code>, <code>bgp_sessions</code>,
                <code>interfaces</code>, <code>topology_links</code>, <code>sites</code>, <code>policies</code>, <code>radios</code>.
              </p>
              <p className="mt-1 text-[rgb(var(--text-muted))]">
                Tip: ask for explicit fields and JSON output, e.g. <code>clients[]: client_id, ap_name, ssid, vlan, rssi</code>.
              </p>
            </div>
          )}
          <Textarea
            id="prompt"
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); setPreview(null); }}
            placeholder="e.g. List all wireless clients grouped by AP name and SSID. Return the data as JSON with keys: total_clients, clients_by_ap (array of {ap_name, ssid, client_count}), ssid_breakdown (array of {ssid, count})."
            rows={5}
            required
            disabled={isAnyPending}
          />
          <p className="text-xs text-[rgb(var(--text-muted))]">
            Tip: ask the agent to return JSON — it makes widget generation much more accurate.
          </p>
        </div>

        {/* Refresh mode */}
        <div className="space-y-1.5">
          <Label>Refresh Mode</Label>
          <div className="flex gap-2 flex-wrap">
            {(['manual', 'scheduled', 'realtime'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setRefreshMode(mode)}
                disabled={isAnyPending}
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
            <Input
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              placeholder="Cron expression, e.g. */5 * * * *"
              className="mt-2"
              disabled={isAnyPending}
            />
          )}
          {refreshMode === 'realtime' && (
            <p className="text-xs text-[rgb(var(--text-muted))] mt-1">The viewer will poll the agent every 30 seconds.</p>
          )}
        </div>

        {/* Confirm Build toggle */}
        <div className="border-t border-[rgb(var(--border))] pt-4">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={confirmBuild}
              onChange={(e) => { setConfirmBuild(e.target.checked); setPreview(null); }}
              disabled={isAnyPending}
              className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500/30"
            />
            <div>
              <p className="text-sm font-medium text-[rgb(var(--text-primary))] group-hover:text-cyan-400 transition-colors">
                Confirm Build
              </p>
              <p className="text-xs text-[rgb(var(--text-muted))] mt-0.5">
                Preview the widget layout and data before saving. The agent will run once for the preview, then again when you confirm.
              </p>
            </div>
          </label>
        </div>

        {/* Preview panel (shown after previewing) */}
        {preview && (
          <PreviewPanel
            preview={preview}
            prompt={prompt}
            onEditPrompt={(p) => runPreview(p)}
            onConfirm={() => createMutation.mutate({
              name,
              slug: slug || undefined,
              description: description || undefined,
              agentId: preview.agentId ?? agentId ?? undefined,
              prompt,
              refreshMode,
              cronExpr: (refreshMode === 'scheduled' && cronExpr) ? cronExpr : undefined,
            })}
            onCancel={() => setPreview(null)}
            isBuilding={isPending}
          />
        )}

        {/* Submit — only show when no preview panel is active */}
        {!preview && (
          <div className="pt-2 flex items-center gap-3">
            <Button type="submit" disabled={isAnyPending || !name || !prompt} className="gap-2">
              {submitIcon}
              {submitLabel}
            </Button>
            <Link href="/dashboards">
              <Button type="button" variant="outline" disabled={isAnyPending}>Cancel</Button>
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}

