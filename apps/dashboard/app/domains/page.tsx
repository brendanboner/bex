'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BookOpen, ChevronDown, ChevronRight, Code2,
  ExternalLink, List, RefreshCw, Save, Zap,
} from 'lucide-react';
import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type DocRef = {
  url: string;
  title: string;
  type: 'api_guide' | 'cli' | 'troubleshooting' | 'release_notes' | 'user_guide' | 'other';
  description: string;
  discoveredAt: string;
};

type PlaybookStep = {
  step: number;
  tool?: string;
  params?: Record<string, string>;
  foreach?: boolean;
  purpose?: string;
  extractField?: string;
  compute?: string;
  output?: string;
};

type Playbook = {
  name: string;
  description: string;
  triggerPatterns: string[];
  steps: PlaybookStep[];
};

type DomainKnowledge = {
  domain: string;
  docIndex: DocRef[];
  entityGraph: Record<string, unknown>;
  playbooks: Playbook[];
  updatedAt: string;
};

// Doc type labels — all use the same muted system style, differentiated by text only
const DOC_TYPE_LABEL: Record<string, string> = {
  api_guide:       'api guide',
  cli:             'cli',
  troubleshooting: 'troubleshoot',
  release_notes:   'release notes',
  user_guide:      'user guide',
  other:           'other',
};

// ─── JsonEditor ───────────────────────────────────────────────────────────────

function JsonEditor({ label, value, onChange }: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState('');

  const handleChange = (raw: string) => {
    setText(raw);
    try { onChange(JSON.parse(raw)); setError(''); }
    catch { setError('Invalid JSON'); }
  };

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
        {label}
      </label>
      <textarea
        className={`w-full font-mono text-xs text-foreground bg-background rounded-lg border p-3 h-56 resize-y
          focus:outline-none focus:ring-1 focus:ring-primary/40 transition-colors
          ${error ? 'border-destructive/60' : 'border-border'}`}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── PlaybookCard ─────────────────────────────────────────────────────────────

function PlaybookCard({ pb }: { pb: Playbook }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-elevated overflow-hidden">
      <button
        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-surface/60 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <Zap className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-foreground">{pb.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{pb.description}</p>
          {pb.triggerPatterns?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {pb.triggerPatterns.map((t) => (
                <span key={t} className="badge-queued rounded px-1.5 py-0.5 text-[10px] font-medium">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3 bg-background space-y-2.5">
          {pb.steps?.map((step) => (
            <div key={step.step} className="flex gap-3 text-xs">
              <span className="shrink-0 w-5 h-5 rounded-full bg-surface border border-border
                text-muted-foreground font-bold flex items-center justify-center text-[10px]">
                {step.step}
              </span>
              <div className="min-w-0 space-y-0.5">
                {step.tool && (
                  <p className="text-foreground">
                    <code className="bg-elevated border border-border px-1 py-0.5 rounded
                      font-mono text-[11px] text-muted-foreground">{step.tool}</code>
                    {step.foreach && <span className="ml-1.5 text-muted-foreground italic">× each</span>}
                    {step.purpose && <span className="ml-1.5 text-muted-foreground">— {step.purpose}</span>}
                  </p>
                )}
                {step.params && Object.keys(step.params).length > 0 && (
                  <p className="text-muted-foreground font-mono text-[10px]">
                    {JSON.stringify(step.params)}
                  </p>
                )}
                {step.extractField && (
                  <p className="text-muted-foreground">
                    → extract: <span className="font-mono text-foreground">{step.extractField}</span>
                  </p>
                )}
                {step.compute && <p className="text-muted-foreground italic">{step.compute}</p>}
                {step.output && (
                  <p className="text-foreground font-medium">Output: {step.output}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── EntityGraphView ──────────────────────────────────────────────────────────

function EntityGraphView({ graph }: { graph: Record<string, unknown> }) {
  const entities = (graph.entities as Record<string, {
    idField?: string; notes?: string; links?: Record<string, string>;
  }>) ?? {};
  const computations = (graph.computations as Record<string, string>) ?? {};

  if (Object.keys(entities).length === 0 && Object.keys(computations).length === 0) {
    return <p className="text-xs text-muted-foreground italic">No entity graph defined.</p>;
  }

  return (
    <div className="space-y-2">
      {Object.entries(entities).map(([name, e]) => (
        <div key={name} className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs">
          <p className="font-semibold text-foreground">
            {name}
            {e.idField && (
              <span className="ml-1.5 font-normal text-muted-foreground">
                id: <code className="font-mono">{e.idField}</code>
              </span>
            )}
          </p>
          {e.notes && <p className="text-muted-foreground mt-0.5">{e.notes}</p>}
          {e.links && Object.keys(e.links).length > 0 && (
            <p className="text-muted-foreground mt-1">
              → {Object.entries(e.links).map(([k, v]) => `${k} (via ${v})`).join(' · ')}
            </p>
          )}
        </div>
      ))}
      {Object.keys(computations).length > 0 && (
        <div className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs space-y-1">
          <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">
            Computation Recipes
          </p>
          {Object.entries(computations).map(([k, v]) => (
            <p key={k} className="text-muted-foreground">
              <span className="font-medium text-foreground">{k}:</span> {v}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DomainCard ───────────────────────────────────────────────────────────────

type Tab = 'view' | 'edit';

function DomainCard({ domain: initial }: { domain: DomainKnowledge }) {
  const [domain, setDomain] = useState(initial);
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>('view');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put<DomainKnowledge>(`/domains/${domain.domain}/knowledge`, {
        entityGraph: domain.entityGraph,
        playbooks: domain.playbooks,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface shadow-m overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-elevated/40 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-elevated border border-border flex items-center justify-center">
            <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-sm text-foreground">{domain.domain}</p>
            <p className="text-xs text-muted-foreground">
              {domain.docIndex.length} docs · {domain.playbooks.length} playbooks ·{' '}
              {new Date(domain.updatedAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {domain.playbooks.length > 0 && (
            <span className="badge-queued rounded-full px-2 py-0.5 text-[10px] font-semibold">
              {domain.playbooks.length} playbooks
            </span>
          )}
          {expanded
            ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-border">
          {/* Tab bar */}
          <div className="flex border-b border-border bg-elevated px-5">
            {(['view', 'edit'] as Tab[]).map((t) => (
              <button
                key={t}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors capitalize ${
                  tab === t
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setTab(t)}
              >
                {t === 'view' ? <List className="w-3 h-3" /> : <Code2 className="w-3 h-3" />}
                {t === 'view' ? 'View' : 'Edit JSON'}
              </button>
            ))}
          </div>

          <div className="px-5 py-4 space-y-6">
            {/* Document Index — always visible */}
            <div>
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2.5">
                Document Index
              </h3>
              {domain.docIndex.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No documents yet. Build a skill from a URL to populate this.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {domain.docIndex.map((doc) => (
                    <div key={doc.url} className="flex items-center gap-2 text-xs">
                      <span className="badge-queued shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium">
                        {DOC_TYPE_LABEL[doc.type] ?? doc.type}
                      </span>
                      <a
                        href={doc.url} target="_blank" rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-0.5 truncate transition-colors"
                      >
                        {doc.title}
                        <ExternalLink className="w-2.5 h-2.5 shrink-0 ml-0.5" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {tab === 'view' ? (
              <>
                <div>
                  <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2.5">
                    Entity Graph
                  </h3>
                  <EntityGraphView graph={domain.entityGraph} />
                </div>
                <div>
                  <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2.5">
                    Playbooks
                  </h3>
                  {domain.playbooks.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No playbooks yet. Build a skill to auto-generate them.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {domain.playbooks.map((pb) => (
                        <PlaybookCard key={pb.name} pb={pb} />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <JsonEditor
                  label="Entity Graph"
                  value={domain.entityGraph}
                  onChange={(v) => setDomain((d) => ({ ...d, entityGraph: v as Record<string, unknown> }))}
                />
                <JsonEditor
                  label="Playbooks"
                  value={domain.playbooks}
                  onChange={(v) => setDomain((d) => ({ ...d, playbooks: v as Playbook[] }))}
                />
                <div className="flex justify-end">
                  <button
                    onClick={save}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground
                      text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saved ? 'Saved!' : saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DomainsPage() {
  const [domains, setDomains] = useState<DomainKnowledge[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<DomainKnowledge[]>('/domains');
      setDomains(res ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Domain Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Entity graphs and multi-step playbooks. Type{' '}
            <code className="text-primary text-xs bg-elevated border border-border px-1 py-0.5 rounded">
              @playbook-name
            </code>{' '}
            in any message to invoke one directly.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border
            text-xs text-muted-foreground hover:bg-elevated transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
      ) : domains.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">
          No domain knowledge yet. Build a skill from a URL to populate this.
        </div>
      ) : (
        <div className="space-y-3">
          {domains.map((d) => <DomainCard key={d.domain} domain={d} />)}
        </div>
      )}
    </div>
  );
}
