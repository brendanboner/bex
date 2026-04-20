'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, CheckCircle, Cloud, CloudDownload, Plus, Search, Upload, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, STATUS_COLOURS } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

type Skill = {
  id: string;
  name: string;
  domain: string;
  version: string;
  status: string;
  capabilities: string[];
  requiredCredentialType?: string | null;
  createdAt: string;
};

type RemoteSkill = {
  domain: string;
  name: string;
  version: string;
  description?: string;
  registryUrl: string;
  publishedAt: string;
};

const DOMAIN_COLOURS: Record<string, string> = {
  'extreme_xco':        'from-violet-600 to-purple-500',
  'extreme_xiq':        'from-violet-500 to-indigo-600',
  'kubernetes':         'from-indigo-500 to-blue-600',
  'networking':         'from-blue-500 to-violet-600',
  'security':           'from-red-500 to-rose-600',
  'monitoring':         'from-amber-500 to-orange-600',
  'default':            'from-slate-600 to-slate-700',
};

function domainGradient(domain: string) {
  for (const [key, val] of Object.entries(DOMAIN_COLOURS)) {
    if (domain.toLowerCase().includes(key)) return val;
  }
  return DOMAIN_COLOURS['default'];
}

export default function SkillExchangePage() {
  const qc = useQueryClient();
  const [intent, setIntent] = useState('');
  const [showDiscover, setShowDiscover] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'local' | 'registry'>('local');

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: () => api.get<Skill[]>('/skills'),
  });

  const { data: remoteSkills = [], isLoading: remoteLoading } = useQuery({
    queryKey: ['registry-skills'],
    queryFn: () => api.get<RemoteSkill[]>('/registry/skills'),
    enabled: activeTab === 'registry',
    retry: false,
  });

  const discoverMutation = useMutation({
    mutationFn: (intentText: string) =>
      api.post<{ skillId: string; status: string }>('/skills/discover', { intent: intentText }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['skills'] });
      setShowDiscover(false);
      setIntent('');
      toast({ title: 'Skill discovery queued', description: `Draft ID: ${data.skillId}` });
    },
    onError: (e) => toast({ title: 'Discovery failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => api.post(`/skills/${id}/publish`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['skills'] }); toast({ title: 'Skill published to registry' }); },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const pullMutation = useMutation({
    mutationFn: ({ domain, version }: { domain: string; version: string }) =>
      api.post(`/registry/install/${encodeURIComponent(domain)}/${encodeURIComponent(version)}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['skills'] }); toast({ title: 'Skill pulled from registry' }); },
    onError: (e) => toast({ title: 'Pull failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const filtered = skills.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.domain.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Hero header — exchangeview style */}
      <div className="relative rounded-2xl overflow-hidden border border-[rgb(var(--border))] bg-gradient-to-br from-[#1c1a2e] via-[#1a1828] to-[#1e1f2a] p-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_70%_40%,rgba(137,129,229,0.12),transparent)]" />
        <div className="relative flex items-start justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-500 flex items-center justify-center">
                <Brain className="h-4 w-4 text-white" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-widest text-violet-300">Skill Exchange</span>
            </div>
            <h1 className="text-2xl font-bold text-[rgb(var(--text-primary))]">Capability Marketplace</h1>
            <p className="text-sm text-[rgb(var(--text-secondary))] max-w-md">
              Build, publish, and pull versioned agent skills. Share capabilities across BEX Forge instances via the central registry.
            </p>
          </div>
          <button
            onClick={() => setShowDiscover(v => !v)}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-500 px-4 py-2.5 text-sm font-semibold text-white hover:from-violet-500 hover:to-purple-400 transition-all shadow-m shrink-0"
          >
            <Plus className="h-4 w-4" /> Discover Skill
          </button>
        </div>
      </div>

      {/* Discover panel */}
      {showDiscover && (
        <div className="rounded-xl border border-violet-500/30 bg-[rgba(137,129,229,0.06)] p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">Discover New Skill</p>
              <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">Describe the capability needed — the engine generates a draft using LLM + knowledge sources</p>
            </div>
            <button onClick={() => setShowDiscover(false)} className="text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-secondary))]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-3">
            <input
              value={intent}
              onChange={e => setIntent(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && intent.trim()) discoverMutation.mutate(intent); }}
              placeholder="e.g. Monitor fabric drift in an Extreme XCO environment"
              className="flex-1 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3.5 py-2.5 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-violet-500 focus:outline-none transition-colors"
            />
            <button
              onClick={() => discoverMutation.mutate(intent)}
              disabled={!intent.trim() || discoverMutation.isPending}
              className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40 transition-colors"
            >
              {discoverMutation.isPending ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      )}

      {/* Tabs + Search */}
      <div className="flex items-center gap-4">
        <div className="flex rounded-lg border border-[rgb(var(--border))] p-0.5 bg-[rgb(var(--bg-surface))]">
          {(['local', 'registry'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${
                activeTab === tab
                  ? 'bg-[rgba(137,129,229,0.15)] text-violet-300'
                  : 'text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))]'
              }`}
            >
              {tab === 'local' ? <Brain className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}
              {tab === 'local' ? 'Local Skills' : 'Registry'}
            </button>
          ))}
        </div>
        <div className="flex-1 relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[rgb(var(--text-muted))]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search skills…"
            className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] py-2 pl-9 pr-3 text-xs text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-violet-500 focus:outline-none transition-colors"
          />
        </div>
        <span className="text-xs text-[rgb(var(--text-muted))]">
          {activeTab === 'local' ? `${filtered.length} skill${filtered.length !== 1 ? 's' : ''}` : `${remoteSkills.length} available`}
        </span>
      </div>

      {/* Local skills grid */}
      {activeTab === 'local' && (
        <div>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1,2,3].map(i => <div key={i} className="h-40 rounded-xl bg-[rgb(var(--bg-surface))] animate-pulse border border-[rgb(var(--border))]" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[rgb(var(--text-muted))]">
              <Brain className="h-12 w-12 opacity-20 mb-3" />
              <p className="text-sm">No skills yet</p>
              <p className="text-xs mt-1">Use &quot;Discover Skill&quot; to generate one from an intent</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map(s => (
                <div key={s.id} className="group rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] p-4 hover:border-[rgba(137,129,229,0.35)] transition-all shadow-m">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${domainGradient(s.domain)} flex items-center justify-center shrink-0`}>
                      <Brain className="h-5 w-5 text-white opacity-90" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[rgb(var(--text-primary))] truncate">{s.name}</p>
                      <p className="text-xs text-[rgb(var(--text-secondary))] font-mono truncate">{s.domain} · v{s.version}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${STATUS_COLOURS[s.status] ?? 'badge-queued'}`}>
                      {s.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {s.capabilities.slice(0, 4).map(c => (
                      <span key={c} className="rounded-full border border-[rgb(var(--border))] px-2 py-0.5 text-[10px] text-[rgb(var(--text-secondary))]">{c}</span>
                    ))}
                    {s.capabilities.length > 4 && (
                      <span className="text-[10px] text-[rgb(var(--text-muted))]">+{s.capabilities.length - 4}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[rgb(var(--text-muted))]">{formatDate(s.createdAt)}</span>
                    <div className="flex items-center gap-2">
                      {s.requiredCredentialType && (
                        <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300 font-medium" title="Required credential type">
                          🔑 {s.requiredCredentialType.replace('_', ' ')}
                        </span>
                      )}
                      {(s.status === 'DRAFT' || s.status === 'PENDING_REVIEW') && (
                      <button
                        onClick={() => publishMutation.mutate(s.id)}
                        disabled={publishMutation.isPending}
                        className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-[rgba(137,129,229,0.10)] px-2.5 py-1 text-[10px] font-medium text-violet-300 hover:bg-[rgba(137,129,229,0.15)] transition-colors disabled:opacity-40"
                      >
                        <Upload className="h-3 w-3" /> Publish
                      </button>
                    )}
                    {s.status === 'PUBLISHED' && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                          <CheckCircle className="h-3 w-3" /> In registry
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Registry tab */}
      {activeTab === 'registry' && (
        <div>
          {remoteLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1,2,3].map(i => <div key={i} className="h-32 rounded-xl bg-[rgb(var(--bg-surface))] animate-pulse border border-[rgb(var(--border))]" />)}
            </div>
          ) : remoteSkills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[rgb(var(--text-muted))]">
              <Cloud className="h-12 w-12 opacity-20 mb-3" />
              <p className="text-sm">Registry is empty</p>
              <p className="text-xs mt-1">Publish a local skill to share it with other BEX Forge instances</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {remoteSkills.map(s => (
                <div key={`${s.domain}-${s.version}`} className="group rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] p-4 hover:border-[rgba(137,129,229,0.35)] transition-all shadow-m">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${domainGradient(s.domain)} flex items-center justify-center shrink-0`}>
                      <Brain className="h-5 w-5 text-white opacity-90" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[rgb(var(--text-primary))] truncate">{s.name}</p>
                      <p className="text-xs text-[rgb(var(--text-secondary))] font-mono truncate">{s.domain} · v{s.version}</p>
                    </div>
                  </div>
                  {s.description && (
                    <p className="text-xs text-[rgb(var(--text-secondary))] mb-3 line-clamp-2">{s.description}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[rgb(var(--text-muted))]">{formatDate(s.publishedAt)}</span>
                    <button
                      onClick={() => pullMutation.mutate({ domain: s.domain, version: s.version })}
                      disabled={pullMutation.isPending}
                      className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-[rgba(16,185,129,0.08)] px-2.5 py-1 text-[10px] font-medium text-emerald-400 hover:bg-[rgba(16,185,129,0.15)] transition-colors disabled:opacity-40"
                    >
                      <CloudDownload className="h-3 w-3" /> Pull
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
