'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';

type Target = {
  id: string;
  name: string;
  description?: string;
  hostname: string;
  sshPort: number;
  tags: string[];
  apiBaseUrl?: string;
  credentialId?: string;
  sshVerified: boolean;
  apiVerified: boolean;
  createdAt: string;
};

type CreateTargetForm = {
  name: string;
  description: string;
  hostname: string;
  sshPort: string;
  tags: string;
  apiBaseUrl: string;
  credentialId: string;
};

const EMPTY_FORM: CreateTargetForm = {
  name: '',
  description: '',
  hostname: '',
  sshPort: '22',
  tags: '',
  apiBaseUrl: '',
  credentialId: '',
};

function VerifiedIcon({ verified }: { verified: boolean }) {
  return verified ? (
    <CheckCircle2 className="h-4 w-4 text-green-500" />
  ) : (
    <Minus className="h-4 w-4 text-yellow-500" />
  );
}

export default function TargetsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateTargetForm>(EMPTY_FORM);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());

  const { data: targets = [], isLoading, error } = useQuery({
    queryKey: ['targets'],
    queryFn: () => api.get<Target[]>('/targets'),
  });

  const createMutation = useMutation({
    mutationFn: (data: Omit<Target, 'id' | 'sshVerified' | 'apiVerified' | 'createdAt'>) =>
      api.post<Target>('/targets', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['targets'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
      toast({ title: 'Target added' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Target> }) =>
      api.patch<Target>(`/targets/${id}`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['targets'] });
      setEditingId(null);
      setForm(EMPTY_FORM);
      toast({ title: 'Target updated' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/targets/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['targets'] });
      toast({ title: 'Target deleted' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  async function testSSH(target: Target) {
    setTestingIds((s) => new Set(s).add(target.id));
    try {
      await api.post(`/targets/${target.id}/verify-ssh`);
      void qc.invalidateQueries({ queryKey: ['targets'] });
      toast({ title: `SSH verified for ${target.name}` });
    } catch (e) {
      toast({ title: 'SSH test failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setTestingIds((s) => { const n = new Set(s); n.delete(target.id); return n; });
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const base = {
      name: form.name,
      hostname: form.hostname,
      sshPort: parseInt(form.sshPort, 10) || 22,
      tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    };
    // Build optional fields separately to satisfy exactOptionalPropertyTypes
    const optional: Partial<Pick<Target, 'description' | 'apiBaseUrl' | 'credentialId'>> = {};
    if (form.description) optional.description = form.description;
    if (form.apiBaseUrl) optional.apiBaseUrl = form.apiBaseUrl;
    if (form.credentialId) optional.credentialId = form.credentialId;
    const payload = { ...base, ...optional };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function startEdit(target: Target) {
    setEditingId(target.id);
    setForm({
      name: target.name,
      description: target.description ?? '',
      hostname: target.hostname,
      sshPort: String(target.sshPort),
      tags: target.tags.join(', '),
      apiBaseUrl: target.apiBaseUrl ?? '',
      credentialId: target.credentialId ?? '',
    });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Targets</h1>
          <p className="text-muted-foreground">Manage remote hosts and infrastructure targets</p>
        </div>
        <Button onClick={() => { cancelForm(); setShowForm((v) => !v); }}>
          <Plus className="h-4 w-4 mr-2" /> Add Target
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          Failed to load targets: {(error as Error).message}
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Edit Target' : 'Add Target'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Name *</Label>
                <Input
                  placeholder="prod-router-01"
                  value={form.name}
                  onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input
                  placeholder="Production router"
                  value={form.description}
                  onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Hostname *</Label>
                <Input
                  placeholder="192.168.1.1 or router.example.com"
                  value={form.hostname}
                  onChange={(e) => setForm((v) => ({ ...v, hostname: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>SSH Port</Label>
                <Input
                  type="number"
                  placeholder="22"
                  value={form.sshPort}
                  onChange={(e) => setForm((v) => ({ ...v, sshPort: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Tags <span className="text-muted-foreground font-normal">(comma-separated)</span></Label>
                <Input
                  placeholder="network, cisco, production"
                  value={form.tags}
                  onChange={(e) => setForm((v) => ({ ...v, tags: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>API Base URL</Label>
                <Input
                  placeholder="https://router.example.com/api"
                  value={form.apiBaseUrl}
                  onChange={(e) => setForm((v) => ({ ...v, apiBaseUrl: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Credential ID</Label>
                <Input
                  placeholder="cred_abc123"
                  value={form.credentialId}
                  onChange={(e) => setForm((v) => ({ ...v, credentialId: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={!form.name || !form.hostname || isPending}>
                  {isPending ? 'Saving…' : editingId ? 'Update Target' : 'Add Target'}
                </Button>
                <Button type="button" variant="outline" onClick={cancelForm}>Cancel</Button>
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
                <TableHead>Hostname</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="text-center">SSH</TableHead>
                <TableHead className="text-center">API</TableHead>
                <TableHead>Credential</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell>
                </TableRow>
              )}
              {targets.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="font-medium">{t.name}</div>
                    {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                  </TableCell>
                  <TableCell className="text-sm font-mono">{t.hostname}:{t.sshPort}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {t.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center">
                      <VerifiedIcon verified={t.sshVerified} />
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center">
                      <VerifiedIcon verified={t.apiVerified} />
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t.credentialId ?? '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => startEdit(t)}
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(t.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => testSSH(t)}
                        disabled={testingIds.has(t.id)}
                        className="text-xs"
                      >
                        {testingIds.has(t.id) ? 'Testing…' : 'Test SSH'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && targets.length === 0 && !error && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">No targets yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
