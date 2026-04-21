'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUpFromLine, Brain, CheckCircle, Cloud, CloudDownload, Plus, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
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
  isSyncedToRegistry: boolean;
  registryVersion?: string | null;
};

/** A skill entry from the registry (remote or local-registry-only). */
type RegistrySkill = {
  domain: string;
  name: string;
  version: string;
  description?: string;
  publishedAt: string;
  isInstalledLocally: boolean;
  localVersion?: string | null;
  isInSync: boolean;
  source: 'remote' | 'local-registry';
};

const DOMAIN_COLOURS: Record<string, string> = {
  'extreme_xco':  'from-violet-600 to-purple-500',
  'extreme_xiq':  'from-violet-500 to-indigo-600',
  'kubernetes':   'from-indigo-500 to-blue-600',
  'networking':   'from-blue-500 to-violet-600',
  'security':     'from-red-500 to-rose-600',
  'monitoring':   'from-amber-500 to-orange-600',
  'default':      'from-slate-600 to-slate-700',
};

function domainGradient(domain: string) {
  for (const [key, val] of Object.entries(DOMAIN_COLOURS)) {
    if (domain.toLowerCase().includes(key)) return val;
  }
  return DOMAIN_COLOURS['default'];
}

type SkillCredential = { id: string; name: string; credentialType: string; updatedAt: string } | null;
type ConfirmState =
  | { type: 'delete'; skillId: string; requiresConfirm?: boolean; linkedAgentCount?: number; message?: string }
  | { type: 'replace'; skillId: string; existingVersion: string; existingId: string; linkedAgentCount: number; message: string };

export default function CapabilityMarketplacePage() {
  const qc = useQueryClient();
  const [intent, setIntent] = useState('');
  const [showDiscover, setShowDiscover] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'local' | 'registry'>('local');
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [credSkill, setCredSkill] = useState<Skill | null>(null);
  const [credFields, setCredFields] = useState<Record<string, string>>({});

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: () => api.get<Skill[]>('/skills'),
  });

  const { data: registrySkills = [], isLoading: registryLoading, refetch: refetchRegistry } = useQuery({
    queryKey: ['registry-skills'],
    queryFn: () => api.get<RegistrySkill[]>('/registry/skills'),
    enabled: activeTab === 'registry',
    retry: false,
  });

  const { data: credentialForSkill } = useQuery({
    queryKey: ['skill-credential', credSkill?.id],
    queryFn: () => api.get<SkillCredential>(`/skills/${credSkill!.id}/credential`),
    enabled: !!credSkill,
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
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      api.post<{ published?: boolean; requiresConfirm?: boolean; existingVersion?: string; existingId?: string; linkedAgentCount?: number; message?: string }>(
        `/skills/${id}/publish${force ? '?force=true' : ''}`
      ),
    onSuccess: (data, vars) => {
      if (data.requiresConfirm) {
        setConfirmState({
          type: 'replace',
          skillId: vars.id,
          existingVersion: data.existingVersion!,
          existingId: data.existingId!,
          linkedAgentCount: data.linkedAgentCount!,
          message: data.message!,
        });
      } else {
        void qc.invalidateQueries({ queryKey: ['skills'] });
        toast({ title: 'Skill activated' });
      }
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      api.delete(`/skills/${id}${force ? '?force=true' : ''}`),
    onSuccess: (data: unknown, vars) => {
      const d = data as { requiresConfirm?: boolean; linkedAgentCount?: number; message?: string };
      if (d?.requiresConfirm) {
        setConfirmState({ type: 'delete', skillId: vars.id, requiresConfirm: true, linkedAgentCount: d.linkedAgentCount, message: d.message });
      } else {
        void qc.invalidateQueries({ queryKey: ['skills'] });
        setConfirmState(null);
        toast({ title: 'Skill deleted' });
      }
    },
    onError: (e) => { setConfirmState(null); toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' }); },
  });

  const saveCredMutation = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: Record<string, string> }) =>
      api.put(`/skills/${id}/credential`, fields),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skill-credential', credSkill?.id] });
      setCredSkill(null);
      setCredFields({});
      toast({ title: 'Credential saved ✓', description: 'Agents using this skill will pick up the new credential on the next run.' });
    },
    onError: (e) => toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const pushToRegistryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/skills/${id}/publish-to-registry`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skills'] });
      void qc.invalidateQueries({ queryKey: ['registry-skills'] });
      toast({ title: 'Skill synced to registry' });
    },
    onError: (e) => toast({ title: 'Sync failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const pullMutation = useMutation({
    mutationFn: ({ domain, version }: { domain: string; version: string }) =>
      api.post(`/registry/install/${encodeURIComponent(domain)}/${encodeURIComponent(version)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skills'] });
      void qc.invalidateQueries({ queryKey: ['registry-skills'] });
      toast({ title: 'Skill pulled from registry' });
    },
    onError: (e) => toast({ title: 'Pull failed', description: (e as Error).message, variant: 'destructive' }),
  });

  function openCredential(s: Skill) {
    setCredSkill(s);
    setCredFields({});
  }

  function credFieldsForType(type: string): { key: string; label: string; placeholder: string; secret?: boolean }[] {
    switch (type) {
      case 'USERNAME_PASSWORD': return [
        { key: 'username', label: 'Username', placeholder: 'admin' },
        { key: 'password', label: 'Password', placeholder: '••••••••', secret: true },
      ];
      case 'SSH_KEY': return [
        { key: 'username', label: 'Username', placeholder: 'root' },
        { key: 'privateKey', label: 'Private Key (PEM)', placeholder: '-----BEGIN RSA PRIVATE KEY-----\n...', secret: true },
        { key: 'passphrase', label: 'Passphrase (optional)', placeholder: '', secret: true },
      ];
      case 'OAUTH2_CLIENT': return [
        { key: 'clientId', label: 'Client ID', placeholder: 'my-client-id' },
        { key: 'clientSecret', label: 'Client Secret', placeholder: '••••••••', secret: true },
        { key: 'tokenUrl', label: 'Token URL', placeholder: 'https://auth.example.com/oauth/token' },
      ];
      default: return [
        { key: 'token', label: 'API Token', placeholder: '••••••••', secret: true },
      ];
    }
  }

  const filtered = skills.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.domain.toLowerCase().includes(search.toLowerCase())
  );
  const filteredRegistry = registrySkills.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.domain.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Confirmation dialog — handles both delete and replace-version */}
      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] p-6 max-w-sm w-full mx-4 shadow-2xl">
            {confirmState.type === 'delete' ? (
              <>
                <p className="text-sm font-semibold text-[rgb(var(--text-primary))] mb-2">
                  {confirmState.requiresConfirm ? '⚠️ Skill in use' : 'Delete skill?'}
                </p>
                <p className="text-xs text-[rgb(var(--text-secondary))] mb-5">
                  {confirmState.message ?? 'This cannot be undone. The skill will be removed from the local database.'}
                  {confirmState.linkedAgentCount && !confirmState.message && ` It is currently linked to ${confirmState.linkedAgentCount} agent(s).`}
                </p>
                <div className="flex gap-3 justify-end">
                  <button onClick={() => setConfirmState(null)} className="rounded-lg border border-[rgb(var(--border))] px-3.5 py-2 text-xs font-medium text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--bg-elevated))] transition-colors">Cancel</button>
                  <button
                    onClick={() => deleteMutation.mutate({ id: confirmState.skillId, force: true })}
                    disabled={deleteMutation.isPending}
                    className="rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40 transition-colors"
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Delete anyway'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-[rgb(var(--text-primary))] mb-2">⚠️ Existing version found</p>
                <p className="text-xs text-[rgb(var(--text-secondary))] mb-1">{confirmState.message}</p>
                {confirmState.linkedAgentCount > 0 && (
                  <p className="text-xs text-amber-400 mb-4">{confirmState.linkedAgentCount} agent(s) will be migrated to the new version automatically.</p>
                )}
                <div className="flex gap-3 justify-end mt-4">
                  <button onClick={() => setConfirmState(null)} className="rounded-lg border border-[rgb(var(--border))] px-3.5 py-2 text-xs font-medium text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--bg-elevated))] transition-colors">Cancel</button>
                  <button
                    onClick={() => { publishMutation.mutate({ id: confirmState.skillId, force: true }); setConfirmState(null); }}
                    disabled={publishMutation.isPending}
                    className="rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40 transition-colors"
                  >
                    {publishMutation.isPending ? 'Replacing…' : 'Replace & Activate'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Credential modal */}
      {credSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
                  {credentialForSkill ? 'Update Credential' : 'Set Credential'}
                </p>
                <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">
                  {credSkill.name} · {credSkill.requiredCredentialType?.replace(/_/g, ' ')}
                  {credentialForSkill && <span className="ml-1 text-amber-400">· existing credential will be replaced</span>}
                </p>
              </div>
              <button onClick={() => { setCredSkill(null); setCredFields({}); }} className="text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-secondary))]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 mb-5">
              {credFieldsForType(credSkill.requiredCredentialType ?? 'API_TOKEN').map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-[rgb(var(--text-secondary))] mb-1">{f.label}</label>
                  {f.key === 'privateKey' ? (
                    <textarea
                      rows={4}
                      value={credFields[f.key] ?? ''}
                      onChange={e => setCredFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-xs font-mono text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-violet-500 focus:outline-none resize-y"
                    />
                  ) : (
                    <input
                      type={f.secret ? 'password' : 'text'}
                      value={credFields[f.key] ?? ''}
                      onChange={e => setCredFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-xs text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-violet-500 focus:outline-none"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setCredSkill(null); setCredFields({}); }} className="rounded-lg border border-[rgb(var(--border))] px-3.5 py-2 text-xs font-medium text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--bg-elevated))] transition-colors">Cancel</button>
              <button
                onClick={() => saveCredMutation.mutate({ id: credSkill.id, fields: credFields })}
                disabled={saveCredMutation.isPending || Object.keys(credFields).length === 0}
                className="rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40 transition-colors"
              >
                {saveCredMutation.isPending ? 'Saving…' : 'Save Credential'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hero header */}
      <div className="relative rounded-2xl overflow-hidden border border-[rgb(var(--border))] bg-gradient-to-br from-[#1c1a2e] via-[#1a1828] to-[#1e1f2a] p-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_70%_40%,rgba(137,129,229,0.12),transparent)]" />
        <div className="relative flex items-start justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-500 flex items-center justify-center">
                <Brain className="h-4 w-4 text-white" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-widest text-violet-300">Capability Marketplace</span>
            </div>
            <h1 className="text-2xl font-bold text-[rgb(var(--text-primary))]">Capability Marketplace</h1>
            <p className="text-sm text-[rgb(var(--text-secondary))] max-w-md">
              Build, publish, and pull versioned agent skills. Share capabilities across BEX instances via the central registry.
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
              <p className="text-xs text-[rgb(var(--text-secondary))] mt-0.5">
                Describe the capability needed — the system checks the registry first, then generates via LLM if not found
              </p>
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
          {activeTab === 'local'
            ? `${filtered.length} skill${filtered.length !== 1 ? 's' : ''}`
            : `${filteredRegistry.length} in registry`}
        </span>
        {activeTab === 'registry' && (
          <button
            onClick={() => void refetchRegistry()}
            className="text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-secondary))] transition-colors"
            title="Refresh registry"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
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
              <p className="text-xs mt-1">Use &quot;Discover Skill&quot; to generate one</p>
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
                      {s.status === 'PUBLISHED' ? 'Active' : s.status === 'DRAFT' ? 'Draft' : s.status === 'PENDING_REVIEW' ? 'Pending' : s.status === 'DEPRECATED' ? 'Deprecated' : s.status}
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
                      {/* Credential management button */}
                      {s.requiredCredentialType && (
                        <button
                          onClick={() => openCredential(s)}
                          className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300 font-medium hover:bg-violet-500/20 transition-colors"
                          title={`Manage ${s.requiredCredentialType.replace(/_/g, ' ')} credential`}
                        >
                          🔑 {s.requiredCredentialType.replace(/_/g, ' ')}
                        </button>
                      )}
                      {/* Activate draft/pending skills */}
                      {(s.status === 'DRAFT' || s.status === 'PENDING_REVIEW') && (
                        <button
                          onClick={() => publishMutation.mutate({ id: s.id })}
                          disabled={publishMutation.isPending}
                          className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-[rgba(137,129,229,0.10)] px-2.5 py-1 text-[10px] font-medium text-violet-300 hover:bg-[rgba(137,129,229,0.15)] transition-colors disabled:opacity-40"
                        >
                          <Upload className="h-3 w-3" /> Activate
                        </button>
                      )}
                      {/* Sync / In Sync / Push Update for active skills */}
                      {s.status === 'PUBLISHED' && (
                        s.isSyncedToRegistry ? (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" /> In Sync
                          </span>
                        ) : s.registryVersion && s.registryVersion !== s.version ? (
                          <button
                            onClick={() => pushToRegistryMutation.mutate(s.id)}
                            disabled={pushToRegistryMutation.isPending}
                            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-[rgba(245,158,11,0.08)] px-2.5 py-1 text-[10px] font-medium text-amber-400 hover:bg-[rgba(245,158,11,0.15)] transition-colors disabled:opacity-40"
                            title={`Registry has v${s.registryVersion} — push v${s.version}`}
                          >
                            <ArrowUpFromLine className="h-3 w-3" /> Push Update
                          </button>
                        ) : (
                          <button
                            onClick={() => pushToRegistryMutation.mutate(s.id)}
                            disabled={pushToRegistryMutation.isPending}
                            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-[rgba(16,185,129,0.08)] px-2.5 py-1 text-[10px] font-medium text-emerald-400 hover:bg-[rgba(16,185,129,0.15)] transition-colors disabled:opacity-40"
                            title="Sync to registry"
                          >
                            <Cloud className="h-3 w-3" /> Sync
                          </button>
                        )
                      )}
                      {/* Delete any skill */}
                      <button
                        onClick={() => setConfirmState({ type: 'delete', skillId: s.id })}
                        className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/8 px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/15 transition-colors"
                        title="Delete skill"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
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
          {registryLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1,2,3].map(i => <div key={i} className="h-32 rounded-xl bg-[rgb(var(--bg-surface))] animate-pulse border border-[rgb(var(--border))]" />)}
            </div>
          ) : filteredRegistry.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[rgb(var(--text-muted))]">
              <Cloud className="h-12 w-12 opacity-20 mb-3" />
              <p className="text-sm">No skills in the registry yet</p>
              <p className="text-xs mt-1">
                Activate a local skill then click &quot;Sync&quot; to publish it to the registry
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredRegistry.map(s => (
                <div key={`${s.domain}-${s.version}`} className="group rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] p-4 hover:border-[rgba(137,129,229,0.35)] transition-all shadow-m">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${domainGradient(s.domain)} flex items-center justify-center shrink-0`}>
                      <Brain className="h-5 w-5 text-white opacity-90" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[rgb(var(--text-primary))] truncate">{s.name}</p>
                      <p className="text-xs text-[rgb(var(--text-secondary))] font-mono truncate">{s.domain} · v{s.version}</p>
                    </div>
                    {/* Source badge */}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${
                      s.source === 'remote' ? 'bg-blue-500/15 text-blue-300' : 'bg-violet-500/15 text-violet-300'
                    }`}>
                      {s.source === 'remote' ? 'Remote' : 'Local Registry'}
                    </span>
                  </div>
                  {s.description && (
                    <p className="text-xs text-[rgb(var(--text-secondary))] mb-3 line-clamp-2">{s.description}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[rgb(var(--text-muted))]">{formatDate(s.publishedAt)}</span>
                    <div className="flex items-center gap-2">
                      {/* Show local version if installed but different */}
                      {s.isInstalledLocally && !s.isInSync && s.localVersion && (
                        <span className="text-[10px] text-amber-400" title="Local version differs">
                          local: v{s.localVersion}
                        </span>
                      )}
                      {/* Action button */}
                      {s.isInSync ? (
                        <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" /> In Sync
                        </span>
                      ) : (
                        <button
                          onClick={() => pullMutation.mutate({ domain: s.domain, version: s.version })}
                          disabled={pullMutation.isPending}
                          className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-[rgba(59,130,246,0.08)] px-2.5 py-1 text-[10px] font-medium text-blue-400 hover:bg-[rgba(59,130,246,0.15)] transition-colors disabled:opacity-40"
                          title={s.isInstalledLocally ? `Update local to v${s.version}` : 'Install from registry'}
                        >
                          <CloudDownload className="h-3 w-3" />
                          {s.isInstalledLocally ? 'Update' : 'Pull'}
                        </button>
                      )}
                    </div>
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
