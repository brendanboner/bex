'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { adminApi } from '@/lib/api';
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
  baseUrl: string;
  tags: string[];
  aliases: string[];
};

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  baseUrl: z.string().url(),
  tags: z.string(),
  aliases: z.string().optional(),
  notes: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export default function EndpointsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: endpoints = [], isLoading } = useQuery({
    queryKey: ['endpoints'],
    queryFn: () => adminApi.get<Endpoint[]>('/admin/endpoints'),
  });

  const createMutation = useMutation({
    mutationFn: ({ tags, aliases, ...rest }: FormData) =>
      adminApi.post<Endpoint>('/admin/endpoints', {
        ...rest,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        aliases: (aliases ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['endpoints'] });
      setShowForm(false);
      toast({ title: 'Endpoint registered' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.delete(`/admin/endpoints/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['endpoints'] }),
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const form = useForm<FormData>({ resolver: zodResolver(schema) });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Endpoints</h1>
          <p className="text-muted-foreground">Register systems and APIs available to agents</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4 mr-2" /> Register Endpoint
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>Register Endpoint</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={form.handleSubmit((d) => createMutation.mutate(d))}
              className="grid gap-4 sm:grid-cols-2"
            >
              <div className="space-y-1">
                <Label>Name (unique slug)</Label>
                <Input {...form.register('name')} placeholder="extreme-xco-primary" />
              </div>
              <div className="space-y-1">
                <Label>Base URL</Label>
                <Input {...form.register('baseUrl')} placeholder="https://xco.example.com" />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input {...form.register('description')} placeholder="Extreme XCO controller" />
              </div>
              <div className="space-y-1">
                <Label>Tags (comma-separated)</Label>
                <Input {...form.register('tags')} placeholder="networking, extreme-xco" />
              </div>
              <div className="space-y-1">
                <Label>Aliases for smart routing (comma-separated)</Label>
                <Input {...form.register('aliases')} placeholder="office network, home xco, lab xco" />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label>Notes (markdown)</Label>
                <textarea
                  {...form.register('notes')}
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="## Notes&#10;Auth: Bearer token..."
                />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Saving…' : 'Register'}
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
                <TableHead>Base URL</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Aliases</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
              {endpoints.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="font-medium font-mono text-sm">{e.name}</div>
                    {e.description && <div className="text-xs text-muted-foreground">{e.description}</div>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.baseUrl}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {e.tags.map((t) => (
                        <span key={t} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">{t}</span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(e.aliases ?? []).map((a) => (
                        <span key={a} className="inline-flex items-center rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20 px-2 py-0.5 text-xs">{a}</span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteMutation.mutate(e.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && endpoints.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No endpoints registered</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
