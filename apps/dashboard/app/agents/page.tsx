'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Key, Link2, Unlink, Power, PowerOff, Star, Brain } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, adminApi } from '@/lib/api';
import { formatDate, STATUS_COLOURS } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';

type Credential = {
  id: string;
  name: string;
  credentialType: string;
  description?: string;
};

type Agent = {
  id: string;
  name: string;
  description?: string;
  status: string;
  isDefault: boolean;
  llmProvider: string;
  llmModel: string;
  credentialId?: string | null;
  credential?: { id: string; name: string; credentialType: string } | null;
  createdAt: string;
};

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  llmProvider: z.enum(['openai', 'anthropic', 'azure-openai', 'ollama']),
  llmModel: z.string().min(1),
});
type CreateForm = z.infer<typeof createSchema>;

const CRED_TYPE_COLOURS: Record<string, string> = {
  API_TOKEN:         'bg-violet-500/15 text-violet-200',
  USERNAME_PASSWORD: 'bg-blue-500/20 text-blue-300',
  SSH_KEY:           'bg-emerald-500/20 text-emerald-300',
  BASIC_AUTH:        'bg-amber-500/20 text-amber-300',
  OAUTH2_CLIENT:     'bg-pink-500/20 text-pink-300',
  USER_PREFERENCE:   'bg-slate-500/20 text-slate-300',
};

export default function AgentsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [assigningCredFor, setAssigningCredFor] = useState<string | null>(null);
  const [viewingMemoryFor, setViewingMemoryFor] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState<string>('');

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => adminApi.get<Agent[]>('/admin/agents'),
  });

  const { data: credentials = [] } = useQuery({
    queryKey: ['credentials-list'],
    queryFn: () => adminApi.get<Credential[]>('/admin/credentials'),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateForm) => api.post<Agent>('/agents', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      setShowForm(false);
      toast({ title: 'Agent created' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.delete(`/admin/agents/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agents'] }),
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const assignCredMutation = useMutation({
    mutationFn: ({ agentId, credentialId }: { agentId: string; credentialId: string | null }) =>
      adminApi.patch<Agent>(`/admin/agents/${agentId}/credential`, { credentialId }),
    onSuccess: (agent) => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      setAssigningCredFor(null);
      toast({ title: agent.credential ? `Credential "${agent.credential.name}" assigned` : 'Credential removed' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ agentId, status }: { agentId: string; status: string }) =>
      adminApi.patch<{ id: string; name: string; status: string }>(`/admin/agents/${agentId}/status`, { status }),
    onSuccess: (agent) => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      toast({ title: `Agent ${agent.status === 'ACTIVE' ? 'activated' : 'deactivated'}` });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => api.post(`/agents/${id}/set-default`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['agents'] }); toast({ title: 'Default agent updated' }); },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const { data: agentMemory } = useQuery({
    queryKey: ['agent-memory', viewingMemoryFor],
    queryFn: () => api.get<{ content: string; updatedAt: string | Date }>(`/agents/${viewingMemoryFor}/workspace/memory`),
    enabled: !!viewingMemoryFor,
  });

  const saveMemoryMutation = useMutation({
    mutationFn: ({ agentId, content }: { agentId: string; content: string }) =>
      api.put(`/agents/${agentId}/workspace/memory`, { content }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agent-memory', viewingMemoryFor] });
      toast({ title: 'Memory saved' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { llmProvider: 'openai', llmModel: 'gpt-4o' },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e8e9f2]">Agents</h1>
          <p className="text-[#8f91a1]">Manage AI agent definitions and credential assignments</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4 mr-2" /> New Agent
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>Create Agent</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={form.handleSubmit((d) => createMutation.mutate(d))}
              className="grid gap-4 sm:grid-cols-2"
            >
              <div className="space-y-1">
                <Label>Name</Label>
                <Input {...form.register('name')} placeholder="NetOps Agent" />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input {...form.register('description')} placeholder="Manages network infrastructure" />
              </div>
              <div className="space-y-1">
                <Label>LLM Provider</Label>
                <select {...form.register('llmProvider')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="azure-openai">Azure OpenAI</option>
                  <option value="ollama">Ollama</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>LLM Model</Label>
                <Input {...form.register('llmModel')} placeholder="gpt-4o" />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create Agent'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Provider / Model</TableHead>
                <TableHead>Credential</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {agents.map((a) => (
                <React.Fragment key={a.id}>
                  <TableRow>
                    <TableCell>
                      <div className="font-medium flex items-center gap-2">
                        {a.name}
                        {a.isDefault && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                            <Star className="h-2.5 w-2.5" /> Default
                          </span>
                        )}
                      </div>
                      {a.description && <div className="text-xs text-muted-foreground">{a.description}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{a.llmProvider} / {a.llmModel}</TableCell>
                    <TableCell>
                      {a.credential ? (
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${CRED_TYPE_COLOURS[a.credential.credentialType] ?? 'bg-slate-500/20 text-slate-300'}`}>
                            <Key className="h-3 w-3" />
                            {a.credential.name}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            title="Remove credential"
                            onClick={() => assignCredMutation.mutate({ agentId: a.id, credentialId: null })}
                          >
                            <Unlink className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground"
                            title="Change credential"
                            onClick={() => setAssigningCredFor(assigningCredFor === a.id ? null : a.id)}
                          >
                            <Link2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setAssigningCredFor(assigningCredFor === a.id ? null : a.id)}
                        >
                          <Link2 className="h-3 w-3 mr-1" /> Assign
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOURS[a.status] ?? ''}`}>
                          {a.status === 'ACTIVE' ? 'Active' : a.status === 'INACTIVE' ? 'Inactive' : 'Draft'}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-6 w-6 ${a.status === 'ACTIVE' ? 'text-emerald-400 hover:text-amber-400' : 'text-muted-foreground hover:text-emerald-400'}`}
                          title={a.status === 'ACTIVE' ? 'Deactivate agent' : 'Activate agent'}
                          disabled={toggleStatusMutation.isPending}
                          onClick={() => toggleStatusMutation.mutate({
                            agentId: a.id,
                            status: a.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                          })}
                        >
                          {a.status === 'ACTIVE' ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(a.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-6 w-6 ${viewingMemoryFor === a.id ? 'text-purple-400' : 'text-muted-foreground hover:text-purple-400'}`}
                          title="View / edit agent memory"
                          onClick={() => {
                            if (viewingMemoryFor === a.id) {
                              setViewingMemoryFor(null);
                            } else {
                              setViewingMemoryFor(a.id);
                              setMemoryDraft('');
                            }
                          }}
                        >
                          <Brain className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-6 w-6 ${a.isDefault ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'}`}
                          title={a.isDefault ? 'System default agent' : 'Make default agent'}
                          disabled={a.isDefault || setDefaultMutation.isPending}
                          onClick={() => !a.isDefault && setDefaultMutation.mutate(a.id)}
                        >
                          <Star className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          title={a.isDefault ? 'Cannot delete the default agent' : 'Delete agent'}
                          disabled={a.isDefault}
                          onClick={() => deleteMutation.mutate(a.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {assigningCredFor === a.id && (
                    <TableRow key={`${a.id}-assign`} className="bg-muted/30">
                      <TableCell colSpan={6}>
                        <div className="py-2">
                          <p className="text-xs text-muted-foreground mb-2">Select a named credential to assign to <strong>{a.name}</strong>:</p>
                          <div className="flex flex-wrap gap-2">
                            {credentials.length === 0 && (
                              <span className="text-xs text-muted-foreground">No credentials found — add one in the Credentials page first.</span>
                            )}
                            {credentials.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => assignCredMutation.mutate({ agentId: a.id, credentialId: c.id })}
                                disabled={assignCredMutation.isPending}
                                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border cursor-pointer hover:opacity-80 transition-opacity ${CRED_TYPE_COLOURS[c.credentialType] ?? 'bg-slate-500/20 text-slate-300'} ${a.credentialId === c.id ? 'ring-2 ring-white/50' : ''}`}
                              >
                                <Key className="h-3 w-3" />
                                {c.name}
                                {c.description && <span className="text-[10px] opacity-70">— {c.description}</span>}
                                {a.credentialId === c.id && <Badge variant="outline" className="h-4 text-[10px] px-1">current</Badge>}
                              </button>
                            ))}
                          </div>
                          <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs" onClick={() => setAssigningCredFor(null)}>Cancel</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {viewingMemoryFor === a.id && (
                    <TableRow key={`${a.id}-memory`} className="bg-muted/30">
                      <TableCell colSpan={6}>
                        <div className="py-3 space-y-2">
                          <div className="flex items-center gap-2 mb-1">
                            <Brain className="h-4 w-4 text-purple-400" />
                            <span className="text-sm font-medium">Agent Memory — {a.name}</span>
                            {agentMemory?.updatedAt && (
                              <span className="text-xs text-muted-foreground">last updated {formatDate(agentMemory.updatedAt)}</span>
                            )}
                          </div>
                          {!agentMemory?.content && (
                            <p className="text-xs text-muted-foreground italic">No memory stored yet. The agent writes memory during runs when it learns something worth remembering.</p>
                          )}
                          <Textarea
                            className="font-mono text-xs min-h-[160px] bg-background"
                            value={memoryDraft || agentMemory?.content || ''}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMemoryDraft(e.target.value)}
                            placeholder="Memory content will appear here after the agent runs..."
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              disabled={saveMemoryMutation.isPending}
                              onClick={() => saveMemoryMutation.mutate({ agentId: a.id, content: memoryDraft || agentMemory?.content || '' })}
                            >
                              Save Memory
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setViewingMemoryFor(null)}>Close</Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
              {!isLoading && agents.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No agents yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

