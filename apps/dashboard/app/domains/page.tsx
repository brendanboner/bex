'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BookOpen, ChevronDown, ChevronRight, Code2, ExternalLink,
  List, RefreshCw, Save, Zap,
} from 'lucide-react';
import { api } from '@/lib/api';

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

const DOC_TYPE_COLORS: Record<string, string> = {
  api_guide:      'bg-blue-100 text-blue-700 border border-blue-200',
  cli:            'bg-purple-100 text-purple-700 border border-purple-200',
  troubleshooting:'bg-red-100 text-red-700 border border-red-200',
  release_notes:  'bg-amber-100 text-amber-700 border border-amber-200',
  user_guide:     'bg-emerald-100 text-emerald-700 border border-emerald-200',
  other:          'bg-gray-100 text-gray-600 border border-gray-200',
};

function JsonEditor({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState('');

  const handleChange = (raw: string) => {
    setText(raw);
    try {
      onChange(JSON.parse(raw));
      setError('');
    } catch {
      setError('Invalid JSON');
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest">{label}</label>
      <textarea
        className={`w-full font-mono text-xs text-gray-900 bg-gray-950 rounded-md border p-3 h-56 resize-y focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
          error ? 'border-red-500' : 'border-gray-700'
        }`}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function PlaybookCard({ pb }: { pb: Playbook }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <button
        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <Zap className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-gray-900">{pb.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{pb.description}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {pb.triggerPatterns?.map((t) => (
              <span key={t} className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-medium border border-indigo-100">
                {t}
              </span>
            ))}
          </div>
        </div>
        {open
          ? <ChevronDown className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
          : <ChevronRight className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-2">
          {pb.steps?.map((step) => (
            <div key={step.step} className="flex gap-3 text-xs">
              <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-[10px]">
                {step.step}
              </span>
              <div className="min-w-0">
                {step.tool && (
                  <p className="text-gray-900">
                    <code className="bg-gray-200 text-gray-800 px-1 py-0.5 rounded font-mono text-[11px]">{step.tool}</code>
                    {step.foreach && <span className="ml-1 text-gray-500 italic">× each</span>}
                    {step.purpose && <span className="ml-1.5 text-gray-600">— {step.purpose}</span>}
                  </p>
                )}
                {step.params && Object.keys(step.params).length > 0 && (
                  <p className="text-gray-500 mt-0.5 font-mono text-[10px]">
                    params: {JSON.stringify(step.params)}
                  </p>
                )}
                {step.extractField && (
                  <p className="text-emerald-700 mt-0.5">→ extract: <span className="font-mono">{step.extractField}</span></p>
                )}
                {step.compute && (
                  <p className="text-amber-700 mt-0.5 italic">{step.compute}</p>
                )}
                {step.output && (
                  <p className="text-indigo-700 mt-0.5 font-medium">Output: {step.output}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EntityGraphView({ graph }: { graph: Record<string, unknown> }) {
  const entities = (graph.entities as Record<string, { idField?: string; notes?: string; links?: Record<string, string> }>) ?? {};
  const computations = (graph.computations as Record<string, string>) ?? {};

  if (Object.keys(entities).length === 0 && Object.keys(computations).length === 0) {
    return <p className="text-xs text-gray-400 italic">No entity graph defined.</p>;
  }

  return (
    <div className="space-y-3">
      {Object.entries(entities).map(([name, e]) => (
        <div key={name} className="rounded border border-gray-200 bg-white px-3 py-2 text-xs">
          <p className="font-semibold text-gray-900">{name}
            {e.idField && <span className="ml-1.5 font-normal text-gray-400">id: <code className="font-mono text-gray-600">{e.idField}</code></span>}
          </p>
          {e.notes && <p className="text-gray-500 mt-0.5">{e.notes}</p>}
          {e.links && Object.keys(e.links).length > 0 && (
            <p className="text-indigo-600 mt-1">
              → {Object.entries(e.links).map(([k, v]) => `${k} (via ${v})`).join(' · ')}
            </p>
          )}
        </div>
      ))}
      {Object.keys(computations).length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs space-y-1">
          <p className="font-semibold text-amber-800 uppercase tracking-wide text-[10px]">Computation Recipes</p>
          {Object.entries(computations).map(([k, v]) => (
            <p key={k}><span className="font-medium text-amber-900">{k}:</span> <span className="text-amber-800">{v}</span></p>
          ))}
        </div>
      )}
    </div>
  );
}

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
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
            <BookOpen className="w-4.5 h-4.5 text-indigo-600" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-gray-900">{domain.domain}</p>
            <p className="text-xs text-gray-500">
              {domain.docIndex.length} doc{domain.docIndex.length !== 1 ? 's' : ''} ·{' '}
              {domain.playbooks.length} playbook{domain.playbooks.length !== 1 ? 's' : ''} ·{' '}
              updated {new Date(domain.updatedAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {domain.playbooks.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold border border-amber-200">
              {domain.playbooks.length} playbooks
            </span>
          )}
          {expanded
            ? <ChevronDown className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          {/* Tab bar */}
          <div className="flex border-b border-gray-100 bg-gray-50 px-5">
            <button
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                tab === 'view' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setTab('view')}
            >
              <List className="w-3.5 h-3.5" /> View
            </button>
            <button
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                tab === 'edit' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setTab('edit')}
            >
              <Code2 className="w-3.5 h-3.5" /> Edit JSON
            </button>
          </div>

          <div className="px-5 py-4 space-y-6">
            {/* Document Index (always shown) */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Document Index</h3>
              {domain.docIndex.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No documents discovered yet. Build a skill from a URL to populate this.</p>
              ) : (
                <div className="space-y-1.5">
                  {domain.docIndex.map((doc) => (
                    <div key={doc.url} className="flex items-center gap-2 text-xs">
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${DOC_TYPE_COLORS[doc.type] ?? DOC_TYPE_COLORS.other}`}>
                        {doc.type.replace(/_/g, ' ')}
                      </span>
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:underline flex items-center gap-0.5 truncate"
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
                {/* Entity graph structured view */}
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Entity Graph</h3>
                  <EntityGraphView graph={domain.entityGraph} />
                </div>

                {/* Playbooks structured view */}
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Playbooks</h3>
                  {domain.playbooks.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">No playbooks yet. Build a skill to auto-generate them.</p>
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
                {/* JSON edit mode */}
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
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
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
          <h1 className="text-2xl font-bold text-gray-900">Domain Intelligence</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Document index, entity graphs, and multi-step analysis playbooks — auto-built when you create skills from URLs.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">Loading domains…</div>
      ) : domains.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          No domain knowledge yet. Build a skill from a URL to start populating this.
        </div>
      ) : (
        <div className="space-y-3">
          {domains.map((d) => <DomainCard key={d.domain} domain={d} />)}
        </div>
      )}
    </div>
  );
}

