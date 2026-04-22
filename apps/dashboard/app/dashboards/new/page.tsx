'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, LayoutDashboard, Loader2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';

type Agent = { id: string; name: string; description?: string; isDefault: boolean };

type CreateDashboardBody = {
  name: string;
  slug?: string;
  description?: string;
  agentId?: string;
  prompt: string;
  refreshMode: 'manual' | 'scheduled' | 'realtime';
  cronExpr?: string;
};

export default function NewDashboardPage() {
  const router = useRouter();

  const [name, setName]               = useState('');
  const [slug, setSlug]               = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId]         = useState('');
  const [prompt, setPrompt]           = useState('');
  const [refreshMode, setRefreshMode] = useState<'manual' | 'scheduled' | 'realtime'>('manual');
  const [cronExpr, setCronExpr]       = useState('');

  // Auto-derive slug from name
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !prompt) return;
    createMutation.mutate({
      name,
      slug: slug || undefined,
      description: description || undefined,
      agentId: agentId || undefined,
      prompt,
      refreshMode,
      cronExpr: (refreshMode === 'scheduled' && cronExpr) ? cronExpr : undefined,
    });
  }

  const isPending = createMutation.isPending;

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
          from the response. You can edit widgets afterwards.
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
            disabled={isPending}
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
              disabled={isPending}
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
            disabled={isPending}
          />
        </div>

        {/* Agent */}
        <div className="space-y-1.5">
          <Label htmlFor="agent">Agent</Label>
          <select
            id="agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={isPending}
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
        <div className="space-y-1.5">
          <Label htmlFor="prompt">Agent Prompt <span className="text-red-400">*</span></Label>
          <Textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. List all wireless clients grouped by AP name and SSID. Return the data as JSON with keys: total_clients, clients_by_ap (array of {ap_name, ssid, client_count}), ssid_breakdown (array of {ssid, count})."
            rows={5}
            required
            disabled={isPending}
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
                disabled={isPending}
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
              disabled={isPending}
            />
          )}
          {refreshMode === 'realtime' && (
            <p className="text-xs text-[rgb(var(--text-muted))] mt-1">The viewer will poll the agent every 30 seconds.</p>
          )}
        </div>

        {/* Submit */}
        <div className="pt-2 flex items-center gap-3">
          <Button type="submit" disabled={isPending || !name || !prompt} className="gap-2">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutDashboard className="h-4 w-4" />}
            {isPending ? 'Creating dashboard…' : 'Create Dashboard'}
          </Button>
          <Link href="/dashboards">
            <Button type="button" variant="outline" disabled={isPending}>Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
