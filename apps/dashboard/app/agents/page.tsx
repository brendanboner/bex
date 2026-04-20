'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Key, Link2, Unlink } from 'lucide-react';
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
  API_TOKEN:         'bg-cyan-600/20 text-slate-200',
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

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { llmProvider: 'openai', llmModel: 'gpt-4o' },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agents</h1>
          <p className="text-muted-foreground">Manage AI agent definitions and credential assignments</p>
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
                <>
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.name}</div>
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
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOURS[a.status] ?? ''}`}>
                        {a.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(a.createdAt)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(a.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
                </>
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

