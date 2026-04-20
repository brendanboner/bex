'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Zap, Clock, BookOpen, ChevronRight, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, truncate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';

type Persona = {
  id: string;
  name: string;
  goal: string;
  domain?: string;
  requiredSkills: string[];
  suggestedPermissions: string[];
  systemPrompt: string;
  schedule?: string;
  createdAt: string;
};

type GeneratedPersona = {
  id: string;
  name: string;
  goal: string;
  domain?: string;
  systemPrompt: string;
  requiredSkills: string[];
  suggestedPermissions: string[];
  schedule?: string;
};

type SpawnResult = {
  agent: { id: string; name: string };
  scheduledJob: { id: string; name: string; cronExpr: string } | null;
};

type WorkspaceDoc = { domain: string; topic: string; content: string; updatedAt: string };

const CRON_PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at 8am', value: '0 8 * * *' },
  { label: 'Weekly Monday 8am', value: '0 8 * * 1' },
];

const WORKSPACE_TOPICS = [
  { key: 'instructions', label: 'Instructions', hint: 'Operational rules and how the agent should behave' },
  { key: 'context', label: 'Context', hint: 'Environment facts, system topology, relevant details' },
  { key: 'memory', label: 'Memory', hint: 'Running notes — updated by the agent after each run' },
];

export default function PersonasPage() {
  const qc = useQueryClient();

  const [showGenerate, setShowGenerate] = useState(false);
  const [goal, setGoal] = useState('');
  const [domain, setDomain] = useState('');
  const [scheduleInput, setScheduleInput] = useState('');
  const [generated, setGenerated] = useState<GeneratedPersona | null>(null);
  const [spawnResult, setSpawnResult] = useState<SpawnResult | null>(null);

  const [spawnPersonaId, setSpawnPersonaId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState('');

  // Workspace doc editing
  const [workspacePersonaId, setWorkspacePersonaId] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<string>('instructions');
  const [docContent, setDocContent] = useState('');
  const [docDirty, setDocDirty] = useState(false);

  const { data: personas = [], isLoading, error } = useQuery({
    queryKey: ['personas'],
    queryFn: () => api.get<Persona[]>('/personas'),
  });

  const generateMutation = useMutation({
    mutationFn: (data: { goal: string; domain?: string; schedule?: string }) =>
      api.post<GeneratedPersona>('/personas/generate', data),
    onSuccess: (data) => { setGenerated(data); setSpawnResult(null); },
    onError: (e) => toast({ title: 'Generation failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const saveMutation = useMutation({
    mutationFn: (persona: GeneratedPersona) =>
      api.post<Persona>('/personas', persona),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['personas'] });
      spawnMutation.mutate({ id: saved.id, data: {} });
    },
    onError: (e) => toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const spawnMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string } }) =>
      api.post<SpawnResult>(`/personas/${id}/spawn`, data),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      setSpawnResult(res);
      setSpawnPersonaId(null);
      setAgentName('');
      const jobMsg = res.scheduledJob ? ` + scheduled job "${res.scheduledJob.name}"` : '';
      toast({ title: 'Agent spawned ✓', description: `"${res.agent.name}"${jobMsg} created` });
    },
    onError: (e) => toast({ title: 'Spawn failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/personas/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['personas'] }); toast({ title: 'Persona deleted' }); },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  // Workspace doc mutations
  const { data: workspaceDoc, isLoading: docLoading } = useQuery({
    queryKey: ['workspace-doc', workspacePersonaId, activeTopic],
    queryFn: () => api.get<WorkspaceDoc>(`/agents/${workspacePersonaId}/workspace/${activeTopic}`),
    enabled: !!workspacePersonaId,
    staleTime: 0,
  });

  const saveDocMutation = useMutation({
    mutationFn: ({ agentId, topic, content }: { agentId: string; topic: string; content: string }) =>
      api.put(`/agents/${agentId}/workspace/${topic}`, { content }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workspace-doc', workspacePersonaId, activeTopic] });
      setDocDirty(false);
      toast({ title: 'Saved ✓' });
    },
    onError: (e) => toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' }),
  });

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const payload: { goal: string; domain?: string; schedule?: string } = { goal };
    if (domain) payload.domain = domain;
    if (scheduleInput) payload.schedule = scheduleInput;
    generateMutation.mutate(payload);
  }

  function handleSaveAndSpawn() {
    if (!generated) return;
    saveMutation.mutate(generated);
  }

  function handleSpawn(e: React.FormEvent) {
    e.preventDefault();
    if (!spawnPersonaId) return;
    spawnMutation.mutate({ id: spawnPersonaId, data: agentName ? { name: agentName } : {} });
  }

  function openSpawn(p: Persona) {
    setSpawnPersonaId(p.id);
    setAgentName(p.name);
  }

  function openWorkspace(agentId: string) {
    setWorkspacePersonaId(agentId);
    setActiveTopic('instructions');
    setDocContent('');
    setDocDirty(false);
  }

  // Sync editor content when doc loads
  const currentDocContent = workspaceDoc?.content ?? '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Personas</h1>
          <p className="text-muted-foreground">LLM-generated agent templates — each becomes a live agent with skills, memory, and optionally a schedule</p>
        </div>
        <Button onClick={() => { setShowGenerate(true); setGenerated(null); setSpawnResult(null); }}>
          <Plus className="h-4 w-4 mr-2" /> Generate Persona
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.08)] p-4 text-sm text-[rgb(var(--text-secondary))]">
          Failed to load personas: {(error as Error).message}
        </div>
      )}

      {/* Generate panel */}
      {showGenerate && (
        <Card>
          <CardHeader><CardTitle>Generate Persona</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!generated ? (
              <form onSubmit={handleGenerate} className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="goal">Goal *</Label>
                  <textarea
                    id="goal"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="Monitor Extreme XCO fabric health, detect config drift, and auto-remediate minor alarms."
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                    required
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="domain">Domain <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input id="domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="networking.extreme-xco" />
                  </div>
                  <div className="space-y-1">
                    <Label>Schedule <span className="text-muted-foreground font-normal">(optional — LLM infers if not set)</span></Label>
                    <div className="flex gap-2">
                      <select
                        onChange={(e) => { if (e.target.value) setScheduleInput(e.target.value); }}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Preset…</option>
                        {CRON_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                      <Input
                        value={scheduleInput}
                        onChange={(e) => setScheduleInput(e.target.value)}
                        placeholder="0 * * * *"
                        className="font-mono w-36"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={!goal || generateMutation.isPending}>
                    {generateMutation.isPending ? 'Generating…' : 'Generate'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowGenerate(false)}>Cancel</Button>
                </div>
              </form>
            ) : spawnResult ? (
              /* Spawn confirmation */
              <div className="space-y-4">
                <div className="rounded-xl border border-[rgba(34,197,94,0.25)] bg-[rgba(34,197,94,0.05)] p-5 space-y-3">
                  <h3 className="font-semibold text-[rgb(var(--text-primary))]">✅ Agent spawned successfully</h3>
                  <div className="flex items-center gap-2 text-sm text-[rgb(var(--text-secondary))]">
                    <span className="font-medium">Agent:</span>
                    <span className="font-mono text-xs bg-black/20 rounded px-2 py-0.5">{spawnResult.agent.name}</span>
                    <ChevronRight className="h-3 w-3" />
                    <a href="/agents" className="text-indigo-400 hover:underline text-xs">View in Agents</a>
                  </div>
                  {spawnResult.scheduledJob && (
                    <div className="flex items-center gap-2 text-sm text-[rgb(var(--text-secondary))]">
                      <Clock className="h-4 w-4 text-amber-400" />
                      <span className="font-medium">Scheduled job:</span>
                      <span className="font-mono text-xs bg-black/20 rounded px-2 py-0.5">{spawnResult.scheduledJob.cronExpr}</span>
                      <ChevronRight className="h-3 w-3" />
                      <a href="/scheduled-jobs" className="text-indigo-400 hover:underline text-xs">View in Scheduled Jobs</a>
                    </div>
                  )}
                  <div className="pt-1">
                    <Button size="sm" variant="outline" onClick={() => openWorkspace(spawnResult.agent.id)}>
                      <BookOpen className="h-3 w-3 mr-1.5" /> Edit Workspace Docs
                    </Button>
                  </div>
                </div>
                <Button variant="ghost" onClick={() => { setShowGenerate(false); setGenerated(null); setSpawnResult(null); }}>
                  Close
                </Button>
              </div>
            ) : (
              /* Generated persona preview */
              <div className="space-y-4">
                <div className="rounded-xl border border-[rgba(130,100,200,0.2)] bg-[rgb(var(--bg-elevated))] p-5 space-y-4">
                  <div>
                    <h3 className="font-semibold text-[rgb(var(--text-primary))] text-base">{generated.name}</h3>
                    <p className="text-sm text-[rgb(var(--text-secondary))] mt-1 leading-relaxed">{generated.goal}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {generated.domain && (
                        <span className="text-xs rounded-full border border-[rgba(130,100,200,0.2)] bg-[rgba(130,100,200,0.08)] px-2.5 py-0.5 text-[rgb(var(--text-secondary))]">
                          {generated.domain}
                        </span>
                      )}
                      {generated.schedule && (
                        <span className="text-xs rounded-full border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.07)] px-2.5 py-0.5 text-[rgb(var(--text-secondary))] flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {generated.schedule}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-[rgb(var(--border))] pt-4 space-y-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-[rgb(var(--text-muted))] mb-2">Required Skills</p>
                      <div className="flex flex-wrap gap-1.5">
                        {generated.requiredSkills.length > 0
                          ? generated.requiredSkills.map((s) => (
                              <span key={s} className="text-xs rounded-full border border-[rgba(99,102,241,0.25)] bg-[rgba(99,102,241,0.08)] px-2.5 py-0.5 text-[rgb(var(--text-secondary))]">{s}</span>
                            ))
                          : <span className="text-xs text-[rgb(var(--text-muted))]">None specified</span>
                        }
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-[rgb(var(--text-muted))] mb-2">Suggested Permissions</p>
                      <div className="flex flex-wrap gap-1.5">
                        {generated.suggestedPermissions.length > 0
                          ? generated.suggestedPermissions.map((p) => (
                              <span key={p} className="text-xs rounded-full border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.07)] px-2.5 py-0.5 text-[rgb(var(--text-secondary))]">{p}</span>
                            ))
                          : <span className="text-xs text-[rgb(var(--text-muted))]">None specified</span>
                        }
                      </div>
                    </div>
                  </div>
                  <details className="border-t border-[rgb(var(--border))] pt-3">
                    <summary className="cursor-pointer text-xs font-medium text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-secondary))]">
                      System prompt preview
                    </summary>
                    <pre className="mt-2 text-xs text-[rgb(var(--text-secondary))] whitespace-pre-wrap font-mono bg-[rgb(var(--bg-base))] rounded-lg p-3 border border-[rgb(var(--border))] leading-relaxed overflow-auto max-h-48">
                      {generated.systemPrompt}
                    </pre>
                  </details>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveAndSpawn} disabled={saveMutation.isPending || spawnMutation.isPending}>
                    <Zap className="h-4 w-4 mr-2" />
                    {saveMutation.isPending || spawnMutation.isPending ? 'Spawning…' : 'Save & Spawn Agent'}
                  </Button>
                  <Button variant="outline" onClick={() => setGenerated(null)}>Back</Button>
                  <Button variant="ghost" onClick={() => { setShowGenerate(false); setGenerated(null); }}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Per-row Spawn form */}
      {spawnPersonaId && (
        <Card>
          <CardHeader><CardTitle>Spawn Agent</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSpawn} className="flex items-end gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="agentName">Agent name <span className="text-muted-foreground font-normal">(optional override)</span></Label>
                <Input id="agentName" value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="My Network Agent" />
              </div>
              <Button type="submit" disabled={spawnMutation.isPending}>
                <Zap className="h-4 w-4 mr-2" />
                {spawnMutation.isPending ? 'Spawning…' : 'Spawn'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setSpawnPersonaId(null)}>Cancel</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Workspace doc editor */}
      {workspacePersonaId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                Workspace Docs — {personas.find((p) => p.id === workspacePersonaId)?.name ?? 'Agent'}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setWorkspacePersonaId(null)}>Close</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-1 border-b border-[rgb(var(--border))] pb-3">
              {WORKSPACE_TOPICS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setActiveTopic(t.key);
                    setDocContent(t.key === activeTopic ? docContent : '');
                    setDocDirty(false);
                  }}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    activeTopic === t.key
                      ? 'bg-[rgba(130,100,200,0.15)] text-[rgb(var(--text-primary))]'
                      : 'text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-secondary))]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-[rgb(var(--text-muted))]">
              {WORKSPACE_TOPICS.find((t) => t.key === activeTopic)?.hint}
            </p>
            {docLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (
              <textarea
                value={docDirty ? docContent : currentDocContent}
                onChange={(e) => { setDocContent(e.target.value); setDocDirty(true); }}
                rows={12}
                placeholder={`Enter ${activeTopic} as markdown…\n\nThis will be injected into the agent's system prompt on every run.`}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
              />
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!docDirty || saveDocMutation.isPending}
                onClick={() => {
                  if (!workspacePersonaId) return;
                  saveDocMutation.mutate({ agentId: workspacePersonaId, topic: activeTopic, content: docDirty ? docContent : currentDocContent });
                }}
              >
                <Save className="h-3 w-3 mr-1.5" />
                {saveDocMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
              {workspaceDoc?.updatedAt && (
                <span className="text-xs text-muted-foreground self-center">Last saved {formatDate(workspaceDoc.updatedAt)}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Personas table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Goal</TableHead>
                <TableHead>Skills</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-40">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
              {personas.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    {p.domain && <div className="text-xs text-muted-foreground">{p.domain}</div>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs">{truncate(p.goal, 80)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {p.requiredSkills.length > 0
                        ? p.requiredSkills.map((s) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)
                        : <span className="text-muted-foreground text-xs">—</span>
                      }
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground">{p.schedule ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => openSpawn(p)} className="text-xs">
                        <Zap className="h-3 w-3 mr-1" /> Spawn
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openWorkspace(p.id)} title="Workspace docs">
                        <BookOpen className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteMutation.mutate(p.id)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && personas.length === 0 && !error && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No personas yet — generate one to get started
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

