'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, STATUS_COLOURS } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';

type Skill = {
  id: string;
  name: string;
  domain: string;
  version: string;
  status: string;
  capabilities: string[];
  createdAt: string;
};

export default function SkillsPage() {
  const qc = useQueryClient();
  const [intent, setIntent] = useState('');
  const [discovering, setDiscovering] = useState(false);

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: () => api.get<Skill[]>('/skills'),
  });

  const discoverMutation = useMutation({
    mutationFn: (intentText: string) =>
      api.post<{ skillId: string; status: string }>('/skills/discover', { intent: intentText }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['skills'] });
      setDiscovering(false);
      setIntent('');
      toast({ title: `Skill discovery queued`, description: `Draft skill ID: ${data.skillId}` });
    },
    onError: (e) => toast({ title: 'Discovery failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => api.post(`/skills/${id}/publish`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skills'] });
      toast({ title: 'Skill published' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Skills</h1>
          <p className="text-muted-foreground">Manage versioned agent capability definitions</p>
        </div>
        <Button onClick={() => setDiscovering((v) => !v)}>
          <Plus className="h-4 w-4 mr-2" /> Discover Skill
        </Button>
      </div>

      {discovering && (
        <Card>
          <CardHeader>
            <CardTitle>Discover New Skill</CardTitle>
            <CardDescription>
              Describe the capability you need. The skill engine will generate a draft skill using LLM + knowledge sources.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Intent</Label>
              <Input
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="e.g. List all network devices in an Extreme XCO fabric"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => discoverMutation.mutate(intent)}
                disabled={!intent.trim() || discoverMutation.isPending}
              >
                {discoverMutation.isPending ? 'Discovering…' : 'Discover'}
              </Button>
              <Button variant="outline" onClick={() => setDiscovering(false)}>Cancel</Button>
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
                <TableHead>Domain</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {skills.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">{s.domain}</TableCell>
                  <TableCell className="text-sm">{s.version}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {s.capabilities.slice(0, 3).map((c) => (
                        <span key={c} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">{c}</span>
                      ))}
                      {s.capabilities.length > 3 && (
                        <span className="text-xs text-muted-foreground">+{s.capabilities.length - 3}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOURS[s.status] ?? ''}`}>
                      {s.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(s.createdAt)}</TableCell>
                  <TableCell>
                    {s.status === 'DRAFT' || s.status === 'PENDING_REVIEW' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => publishMutation.mutate(s.id)}
                        disabled={publishMutation.isPending}
                      >
                        <CheckCircle className="h-3 w-3 mr-1" /> Publish
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && skills.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">No skills yet — use Discover Skill to create one</p>
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
