'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Zap } from 'lucide-react';
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
};

type SpawnResult = {
  agentId: string;
};

export default function PersonasPage() {
  const qc = useQueryClient();

  // Generate modal state
  const [showGenerate, setShowGenerate] = useState(false);
  const [goal, setGoal] = useState('');
  const [domain, setDomain] = useState('');
  const [generated, setGenerated] = useState<GeneratedPersona | null>(null);

  // Spawn modal state
  const [spawnPersonaId, setSpawnPersonaId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState('');
  const [agentName, setAgentName] = useState('');

  const { data: personas = [], isLoading, error } = useQuery({
    queryKey: ['personas'],
    queryFn: () => api.get<Persona[]>('/personas'),
  });

  const generateMutation = useMutation({
    mutationFn: (data: { goal: string; domain?: string }) =>
      api.post<GeneratedPersona>('/personas/generate', data),
    onSuccess: (data) => setGenerated(data),
    onError: (e) => toast({ title: 'Generation failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const saveMutation = useMutation({
    mutationFn: (persona: GeneratedPersona) =>
      api.post<Persona>('/personas', persona),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['personas'] });
      toast({ title: 'Persona saved' });
      setShowGenerate(false);
      setGenerated(null);
      setGoal('');
      setDomain('');
      setSpawnPersonaId(saved.id);
    },
    onError: (e) => toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const spawnMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { ownerId: string; name?: string } }) =>
      api.post<SpawnResult>(`/personas/${id}/spawn`, data),
    onSuccess: (res) => {
      toast({ title: 'Agent spawned', description: `Agent ID: ${res.agentId}` });
      setSpawnPersonaId(null);
      setOwnerId('');
      setAgentName('');
    },
    onError: (e) => toast({ title: 'Spawn failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/personas/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['personas'] });
      toast({ title: 'Persona deleted' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const payload: { goal: string; domain?: string } = { goal };
    if (domain) payload.domain = domain;
    generateMutation.mutate(payload);
  }

  function handleSaveAndSpawn() {
    if (!generated) return;
    saveMutation.mutate(generated);
  }

  function handleSpawn(e: React.FormEvent) {
    e.preventDefault();
    if (!spawnPersonaId) return;
    const spawnData: { ownerId: string; name?: string } = { ownerId };
    if (agentName) spawnData.name = agentName;
    spawnMutation.mutate({ id: spawnPersonaId, data: spawnData });
  }

  function openSpawn(persona: Persona) {
    setSpawnPersonaId(persona.id);
    setAgentName(persona.name);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Personas</h1>
          <p className="text-muted-foreground">LLM-generated agent templates you can spawn into live agents</p>
        </div>
        <Button onClick={() => { setShowGenerate(true); setGenerated(null); }}>
          <Plus className="h-4 w-4 mr-2" /> Generate Persona
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          Failed to load personas: {(error as Error).message}
        </div>
      )}

      {/* Generate modal */}
      {showGenerate && (
        <Card>
          <CardHeader>
            <CardTitle>Generate Persona</CardTitle>
          </CardHeader>
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
                <div className="space-y-1">
                  <Label htmlFor="domain">Domain <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    id="domain"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="networking.extreme-xco"
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={!goal || generateMutation.isPending}>
                    {generateMutation.isPending ? 'Generating…' : 'Generate'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowGenerate(false)}>Cancel</Button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="rounded-md border border-green-200 bg-green-50 p-4 space-y-2">
                  <h3 className="font-semibold text-green-900">{generated.name}</h3>
                  <p className="text-sm text-green-800">{generated.goal}</p>
                  {generated.domain && (
                    <Badge variant="secondary">{generated.domain}</Badge>
                  )}
                  <div>
                    <p className="text-xs font-medium text-green-700 mb-1">Required Skills</p>
                    <div className="flex flex-wrap gap-1">
                      {generated.requiredSkills.map((s) => (
                        <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-green-700 mb-1">Suggested Permissions</p>
                    <div className="flex flex-wrap gap-1">
                      {generated.suggestedPermissions.map((p) => (
                        <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                      ))}
                    </div>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-green-700">System prompt preview</summary>
                    <pre className="mt-1 text-xs text-green-800 whitespace-pre-wrap font-mono bg-white rounded p-2 border">
                      {generated.systemPrompt}
                    </pre>
                  </details>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveAndSpawn} disabled={saveMutation.isPending}>
                    <Zap className="h-4 w-4 mr-2" />
                    {saveMutation.isPending ? 'Saving…' : 'Save & Spawn Agent'}
                  </Button>
                  <Button variant="outline" onClick={() => setGenerated(null)}>Back</Button>
                  <Button variant="ghost" onClick={() => { setShowGenerate(false); setGenerated(null); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Spawn form */}
      {spawnPersonaId && (
        <Card>
          <CardHeader><CardTitle>Spawn Agent</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSpawn} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ownerId">Owner ID *</Label>
                <Input
                  id="ownerId"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  placeholder="user_abc123"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="agentName">Name override <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="agentName"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="My Network Agent"
                />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={!ownerId || spawnMutation.isPending}>
                  {spawnMutation.isPending ? 'Spawning…' : 'Spawn Agent'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setSpawnPersonaId(null)}>Cancel</Button>
              </div>
            </form>
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
                <TableHead>Domain</TableHead>
                <TableHead>Required Skills</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell>
                </TableRow>
              )}
              {personas.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs">
                    {truncate(p.goal, 80)}
                  </TableCell>
                  <TableCell>
                    {p.domain ? <Badge variant="secondary">{p.domain}</Badge> : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {p.requiredSkills.length > 0
                        ? p.requiredSkills.map((s) => (
                            <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                          ))
                        : <span className="text-muted-foreground text-xs">—</span>
                      }
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">
                    {p.schedule ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(p.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openSpawn(p)}
                        className="text-xs"
                      >
                        <Zap className="h-3 w-3 mr-1" /> Spawn
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(p.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && personas.length === 0 && !error && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
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
