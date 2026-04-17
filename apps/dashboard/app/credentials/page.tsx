'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';

type Credential = { id: string; name: string; scope: string; description?: string };

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scope: z.enum(['USER', 'SYSTEM']),
  token: z.string().min(1),
});
type CreateForm = z.infer<typeof createSchema>;

export default function CredentialsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: creds = [], isLoading } = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<Credential[]>('/credentials'),
  });

  const createMutation = useMutation({
    mutationFn: ({ token, ...rest }: CreateForm) =>
      api.post<Credential>('/credentials', { ...rest, value: { token } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['credentials'] });
      setShowForm(false);
      toast({ title: 'Credential stored securely' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/credentials/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['credentials'] }),
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { scope: 'SYSTEM' },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Credentials</h1>
          <p className="text-muted-foreground">AES-256-GCM encrypted secrets. Values are never shown after storage.</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4 mr-2" /> Add Credential
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>Add Credential</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={form.handleSubmit((d) => createMutation.mutate(d))}
              className="grid gap-4 sm:grid-cols-2"
            >
              <div className="space-y-1">
                <Label>Name</Label>
                <Input {...form.register('name')} placeholder="xco-api-token" />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input {...form.register('description')} placeholder="Extreme XCO API bearer token" />
              </div>
              <div className="space-y-1">
                <Label>Scope</Label>
                <select {...form.register('scope')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="SYSTEM">SYSTEM (shared)</option>
                  <option value="USER">USER (personal)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Token / Secret Value</Label>
                <Input {...form.register('token')} type="password" placeholder="Paste secret here" />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Encrypting…' : 'Store Credential'}
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
                <TableHead>Description</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
              {creds.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium font-mono text-sm">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{c.description ?? '—'}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.scope === 'SYSTEM' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>
                      {c.scope}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(c.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && creds.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No credentials stored</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
