'use client';

import { useEffect, useState, useCallback } from 'react';
import { BookOpen, ChevronDown, ChevronRight, ExternalLink, RefreshCw, Save } from 'lucide-react';
import { api } from '@/lib/api';

type DocRef = {
  url: string;
  title: string;
  type: 'api_guide' | 'cli' | 'troubleshooting' | 'release_notes' | 'user_guide' | 'other';
  description: string;
  discoveredAt: string;
};

type DomainKnowledge = {
  domain: string;
  docIndex: DocRef[];
  entityGraph: Record<string, unknown>;
  playbooks: Array<Record<string, unknown>>;
  updatedAt: string;
};

const DOC_TYPE_COLORS: Record<string, string> = {
  api_guide:      'bg-blue-100 text-blue-800',
  cli:            'bg-purple-100 text-purple-800',
  troubleshooting:'bg-red-100 text-red-800',
  release_notes:  'bg-yellow-100 text-yellow-800',
  user_guide:     'bg-green-100 text-green-800',
  other:          'bg-gray-100 text-gray-600',
};

function JsonEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
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
    <div className="space-y-1">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</label>
      <textarea
        className={`w-full font-mono text-xs rounded border p-2 h-48 resize-y ${error ? 'border-red-400' : 'border-gray-200'}`}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function DomainCard({ domain: initial }: { domain: DomainKnowledge }) {
  const [domain, setDomain] = useState(initial);
  const [expanded, setExpanded] = useState(false);
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
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-indigo-500" />
          <div className="text-left">
            <p className="font-semibold text-gray-900">{domain.domain}</p>
            <p className="text-xs text-gray-500">
              {domain.docIndex.length} docs · {domain.playbooks.length} playbooks · updated {new Date(domain.updatedAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-6">
          {/* Document Index */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Document Index</h3>
            {domain.docIndex.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No documents discovered yet. Build a skill from a URL to populate this.</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {domain.docIndex.map((doc) => (
                  <div key={doc.url} className="flex items-start gap-2 text-xs">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${DOC_TYPE_COLORS[doc.type] ?? DOC_TYPE_COLORS.other}`}>
                      {doc.type.replace('_', ' ')}
                    </span>
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:underline flex items-center gap-0.5 truncate"
                    >
                      {doc.title}
                      <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Entity Graph editor */}
          <JsonEditor
            label="Entity Graph"
            value={domain.entityGraph}
            onChange={(v) => setDomain((d) => ({ ...d, entityGraph: v as Record<string, unknown> }))}
          />

          {/* Playbooks editor */}
          <JsonEditor
            label="Playbooks"
            value={domain.playbooks}
            onChange={(v) => setDomain((d) => ({ ...d, playbooks: v as Array<Record<string, unknown>> }))}
          />

          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saved ? 'Saved!' : saving ? 'Saving…' : 'Save changes'}
            </button>
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
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Domain Intelligence</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Document references, entity relationships, and analysis playbooks per domain. Auto-populated when you build skills.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm text-gray-600 hover:bg-gray-50">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading domains…</div>
      ) : domains.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
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
