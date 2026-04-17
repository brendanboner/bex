'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { formatDate, STATUS_COLOURS } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';

type Agent = {
  id: string;
  name: string;
  description?: string;
  status: string;
  llmProvider: string;
  llmModel: string;
  createdAt: string;
};

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  llmProvider: z.enum(['openai', 'anthropic', 'azure-openai']),
  llmModel: z.string().min(1),
});
type CreateForm = z.infer<typeof createSchema>;

export default function AgentsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<Agent[]>('/agents'),
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
    mutationFn: (id: string) => api.delete(`/agents/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agents'] }),
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
          <p className="text-muted-foreground">Manage AI agent definitions</p>
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
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {agents.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium">{a.name}</div>
                    {a.description && <div className="text-xs text-muted-foreground">{a.description}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{a.llmProvider} / {a.llmModel}</TableCell>
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
              ))}
              {!isLoading && agents.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No agents yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
