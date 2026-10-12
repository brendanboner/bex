'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Minus, Network, Pencil, Plus, ShieldCheck, Trash2, WifiOff } from 'lucide-react';
import { adminApi, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';

type Endpoint = {
  id: string;
  name: string;
  description?: string;
  baseUrl?: string;
  tags: string[];
  aliases: string[];
  sshEnabled: boolean;
  hostname?: string;
  sshPort: number;
  credentialId?: string;
  sshVerified: boolean;
};

type Credential = { id: string; name: string };

const EMPTY_FORM = {
  name: '', description: '', baseUrl: '', tags: '', aliases: '', notes: '',
  hostname: '', sshPort: '22', credentialId: '',
};

function buildBody(form: typeof EMPTY_FORM, sshEnabled: boolean) {
  return {
    name: form.name,
    description: form.description || undefined,
    baseUrl: form.baseUrl || undefined,
    tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    aliases: form.aliases.split(',').map((t) => t.trim()).filter(Boolean),
    notes: form.notes || undefined,
    sshEnabled,
    hostname: sshEnabled && form.hostname ? form.hostname : undefined,
    sshPort: parseInt(form.sshPort || '22', 10),
    credentialId: sshEnabled && form.credentialId ? form.credentialId : undefined,
  };
}

export default function EndpointsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sshEnabled, setSshEnabled] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: endpoints = [], isLoading } = useQuery({
    queryKey: ['endpoints'],
    queryFn: () => adminApi.get<Endpoint[]>('/admin/endpoints'),
  });

  const { data: credentials = [] } = useQuery({
    queryKey: ['credentials-list'],
    queryFn: () => api.get<Credential[]>('/credentials'),
  });

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSshEnabled(false);
    setShowForm(true);
  }

  function openEdit(ep: Endpoint) {
    setEditingId(ep.id);
    setForm({
      name: ep.name,
      description: ep.description ?? '',
      baseUrl: ep.baseUrl ?? '',
      tags: ep.tags.join(', '),
      aliases: ep.aliases.join(', '),
      notes: '',
      hostname: ep.hostname ?? '',
      sshPort: String(ep.sshPort),
      credentialId: ep.credentialId ?? '',
    });
    setSshEnabled(ep.sshEnabled);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSshEnabled(false);
  }

  const createMutation = useMutation({
    mutationFn: () => adminApi.post<Endpoint>('/admin/endpoints', buildBody(form, sshEnabled)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['endpoints'] });
      closeForm();
      toast({ title: 'Endpoint registered' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: () => adminApi.patch<Endpoint>(`/admin/endpoints/${editingId}`, buildBody(form, sshEnabled)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['endpoints'] });
      closeForm();
      toast({ title: 'Endpoint updated' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.delete(`/admin/endpoints/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['endpoints'] }),
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const verifySshMutation = useMutation({
    mutationFn: (id: string) => api.post<{ success: boolean; message: string }>(`/endpoints/${id}/verify-ssh`),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['endpoints'] });
      toast({
        title: data.success ? 'SSH verified' : 'SSH failed',
        description: data.message,
        variant: data.success ? 'default' : 'destructive',
      });
    },
    onError: (e) => toast({ title: 'SSH error', description: (e as Error).message, variant: 'destructive' }),
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e8e9f2]">Endpoints</h1>
          <p className="text-[#8f91a1]">API systems and SSH hosts available to agents</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> Register Endpoint
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Edit Endpoint' : 'Register Endpoint'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Name (unique)</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="extreme-xco-primary" />
              </div>
              <div className="space-y-1">
                <Label>Base URL (optional)</Label>
                <Input value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} placeholder="https://xco.example.com" />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Extreme XCO controller" />
              </div>
              <div className="space-y-1">
                <Label>Tags (comma-separated)</Label>
                <Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="networking, extreme-xco" />
              </div>
              <div className="space-y-1">
                <Label>Smart routing aliases</Label>
                <Input value={form.aliases} onChange={e => setForm(f => ({ ...f, aliases: e.target.value }))} placeholder="office network, lab xco" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Notes (markdown)</Label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="## Notes&#10;Auth: Bearer token..."
                />
              </div>

              {/* SSH toggle */}
              <div className="sm:col-span-2 border-t border-border pt-4">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div
                    onClick={() => setSshEnabled(v => !v)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${sshEnabled ? 'bg-violet-600' : 'bg-muted'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${sshEnabled ? 'translate-x-5' : ''}`} />
                  </div>
                  <span className="text-sm font-medium">Enable SSH access</span>
                </label>
              </div>

              {sshEnabled && (
                <>
                  <div className="space-y-1">
                    <Label>Hostname / IP</Label>
                    <Input value={form.hostname} onChange={e => setForm(f => ({ ...f, hostname: e.target.value }))} placeholder="192.168.1.100" />
                  </div>
                  <div className="space-y-1">
                    <Label>SSH Port</Label>
                    <Input type="number" value={form.sshPort} onChange={e => setForm(f => ({ ...f, sshPort: e.target.value }))} placeholder="22" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>SSH Credential</Label>
                    <select
                      value={form.credentialId}
                      onChange={e => setForm(f => ({ ...f, credentialId: e.target.value }))}
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">— select credential —</option>
                      {credentials.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div className="sm:col-span-2 flex gap-2">
                <Button
                  onClick={() => editingId ? updateMutation.mutate() : createMutation.mutate()}
                  disabled={isSaving || !form.name}
                >
                  {isSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Register'}
                </Button>
                <Button type="button" variant="outline" onClick={closeForm}>Cancel</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Base URL</TableHead>
                <TableHead>SSH</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
              {endpoints.map((ep) => (
                <TableRow key={ep.id} className={editingId === ep.id ? 'bg-violet-500/5' : ''}>
                  <TableCell>
                    <div className="font-medium font-mono text-sm flex items-center gap-1.5">
                      <Network className="h-3.5 w-3.5 text-muted-foreground" />
                      {ep.name}
                    </div>
                    {ep.description && <div className="text-xs text-muted-foreground mt-0.5">{ep.description}</div>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{ep.baseUrl ?? <Minus className="h-3 w-3 opacity-30" />}</TableCell>
                  <TableCell>
                    {ep.sshEnabled ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-[rgb(var(--text-secondary))]">{ep.hostname}:{ep.sshPort}</span>
                        {ep.sshVerified
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                          : <WifiOff className="h-3.5 w-3.5 text-amber-400" />}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {ep.tags.map((t) => (
                        <span key={t} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">{t}</span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {ep.sshEnabled && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Verify SSH"
                          disabled={verifySshMutation.isPending}
                          onClick={() => verifySshMutation.mutate(ep.id)}
                        >
                          <ShieldCheck className="h-4 w-4 text-violet-400" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit"
                        onClick={() => openEdit(ep)}
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() => deleteMutation.mutate(ep.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && endpoints.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No endpoints registered</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

