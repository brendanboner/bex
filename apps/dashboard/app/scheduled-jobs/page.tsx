'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Power, Trash2, Play, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { adminApi, api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';

type ScheduledJob = {
  id: string;
  name: string;
  description?: string;
  agentId: string;
  cronExpr: string;
  input: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
};

type Agent = { id: string; name: string };

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  agentId: z.string().min(1),
  cronExpr: z.string().min(1),
  input: z.string().min(1),
});
type FormData = z.infer<typeof schema>;

// Human-readable cron descriptions for common patterns
const CRON_PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at 8am', value: '0 8 * * *' },
  { label: 'Daily midnight', value: '0 0 * * *' },
  { label: 'Weekly Monday 8am', value: '0 8 * * 1' },
];

function describeCron(expr: string): string {
  const match = CRON_PRESETS.find((p) => p.value === expr);
  if (match) return match.label;
  // Basic descriptions
  if (expr === '* * * * *') return 'Every minute';
  const parts = expr.split(' ');
  if (parts.length === 5) {
    const [min, hour, , , day] = parts;
    if (min === '0' && hour !== '*' && day === '*') return `Daily at ${hour}:00`;
    if (min?.startsWith('*/')) return `Every ${min.slice(2)} minutes`;
    if (hour?.startsWith('*/')) return `Every ${hour.slice(2)} hours`;
  }
  return expr;
}

export default function ScheduledJobsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['scheduled-jobs'],
    queryFn: () => adminApi.get<ScheduledJob[]>('/admin/scheduled-jobs'),
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<Agent[]>('/agents'),
  });

  const agentMap = new Map(agents.map((a) => [a.id, a.name]));

  const createMutation = useMutation({
    mutationFn: (data: FormData) => adminApi.post<ScheduledJob>('/admin/scheduled-jobs', data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scheduled-jobs'] });
      setShowForm(false);
      form.reset();
      toast({ title: 'Scheduled job created' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => adminApi.post(`/admin/scheduled-jobs/${id}/toggle`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['scheduled-jobs'] }),
  });

  const runNowMutation = useMutation({
    mutationFn: (id: string) => api.post(`/scheduled-jobs/${id}/run-now`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scheduled-jobs'] });
      toast({ title: 'Job triggered ✓', description: 'Check Requests for the result' });
    },
    onError: (e) => toast({ title: 'Failed to trigger', description: (e as Error).message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.delete(`/admin/scheduled-jobs/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['scheduled-jobs'] }),
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const form = useForm<FormData>({ resolver: zodResolver(schema) });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scheduled Jobs</h1>
          <p className="text-muted-foreground">Cron-based agent task scheduling</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4 mr-2" /> New Job
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>Create Scheduled Job</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input {...form.register('name')} placeholder="Daily network check" />
              </div>
              <div className="space-y-1">
                <Label>Agent</Label>
                <select {...form.register('agentId')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="">Select agent…</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Schedule</Label>
                <div className="flex gap-2">
                  <select
                    onChange={(e) => { if (e.target.value) form.setValue('cronExpr', e.target.value); }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Preset…</option>
                    {CRON_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <Input {...form.register('cronExpr')} placeholder="0 * * * *" className="font-mono" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input {...form.register('description')} placeholder="Checks XCO device health" />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label>Input (sent to agent each run)</Label>
                <Input {...form.register('input')} placeholder="List all fabric devices and flag any that are offline" />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create Job'}
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
                <TableHead>Name / Agent</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Next Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
              {jobs.map((j) => (
                <>
                  <TableRow key={j.id}>
                    <TableCell>
                      <div className="font-medium">{j.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {agentMap.get(j.agentId) ?? j.agentId}
                      </div>
                      {j.description && <div className="text-xs text-muted-foreground mt-0.5">{j.description}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{j.cronExpr}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />{describeCron(j.cronExpr)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{j.lastRunAt ? formatDate(j.lastRunAt) : '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{j.nextRunAt ? formatDate(j.nextRunAt) : '—'}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${j.enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'}`}>
                        {j.enabled ? 'Active' : 'Paused'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => runNowMutation.mutate(j.id)}
                          disabled={runNowMutation.isPending}
                          title="Run now"
                        >
                          <Play className="h-4 w-4 text-indigo-400" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => toggleMutation.mutate(j.id)} title={j.enabled ? 'Pause' : 'Resume'}>
                          <Power className={`h-4 w-4 ${j.enabled ? 'text-emerald-400' : 'text-slate-400'}`} />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          onClick={() => setExpandedJob(expandedJob === j.id ? null : j.id)}
                          title="Show details"
                        >
                          {expandedJob === j.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteMutation.mutate(j.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedJob === j.id && (
                    <TableRow key={`${j.id}-detail`}>
                      <TableCell colSpan={6} className="bg-surface-raised/30">
                        <div className="p-2 space-y-2">
                          <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Prompt sent each run</div>
                          <div className="font-mono text-xs bg-black/30 rounded p-2 whitespace-pre-wrap">{j.input}</div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
              {!isLoading && jobs.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No scheduled jobs yet — create one above or spawn a persona with a schedule
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

