'use client';

import { useState, useEffect, KeyboardEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';

type Agent = {
  id: string;
  name: string;
  description?: string;
  status: string;
};

type AgentCharter = {
  id?: string;
  mandate: string;
  posture: 'AUTONOMOUS' | 'SUPERVISED' | 'INTERACTIVE' | 'DELIBERATE';
  bearing: 'ANALYTICAL' | 'CONCISE' | 'NARRATIVE' | 'FORMAL';
  verbosity: 'TERSE' | 'STANDARD' | 'DETAILED';
  conductBoundaries: string[];
  escalationTriggers: string[];
};

const POSTURE_OPTIONS: { value: AgentCharter['posture']; label: string; description: string }[] = [
  { value: 'AUTONOMOUS',  label: 'Autonomous',  description: 'Acts and notifies — no confirmation required' },
  { value: 'SUPERVISED',  label: 'Supervised',  description: 'Approval gates for writes and destructive operations' },
  { value: 'INTERACTIVE', label: 'Interactive', description: 'Confirms before each significant action' },
  { value: 'DELIBERATE',  label: 'Deliberate',  description: 'Analysis only — awaits explicit instruction before executing' },
];

const BEARING_OPTIONS: AgentCharter['bearing'][] = ['ANALYTICAL', 'CONCISE', 'NARRATIVE', 'FORMAL'];
const VERBOSITY_OPTIONS: AgentCharter['verbosity'][] = ['TERSE', 'STANDARD', 'DETAILED'];

const DEFAULTS: AgentCharter = {
  mandate: '',
  posture: 'SUPERVISED',
  bearing: 'CONCISE',
  verbosity: 'STANDARD',
  conductBoundaries: [],
  escalationTriggers: [],
};

function TagInput({
  label,
  tags,
  placeholder,
  onChange,
}: {
  label: string;
  tags: string[];
  placeholder: string;
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState('');

  function addTag() {
    const val = input.trim();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
    }
    setInput('');
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1 rounded-md border border-input bg-background p-2 min-h-[42px]">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          onBlur={addTag}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[160px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <p className="text-xs text-muted-foreground">Press Enter to add a pattern</p>
    </div>
  );
}

export default function CharterPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [form, setForm] = useState<AgentCharter>(DEFAULTS);

  const { data: agent, isLoading: agentLoading } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api.get<Agent>(`/agents/${id}`),
    enabled: !!id,
  });

  const { data: charter, isLoading: charterLoading } = useQuery({
    queryKey: ['agent-charter', id],
    queryFn: () => api.get<AgentCharter | null>(`/agents/${id}/charter`),
    enabled: !!id,
  });

  useEffect(() => {
    if (charter) {
      setForm({
        mandate: charter.mandate ?? '',
        posture: charter.posture ?? 'SUPERVISED',
        bearing: charter.bearing ?? 'CONCISE',
        verbosity: charter.verbosity ?? 'STANDARD',
        conductBoundaries: charter.conductBoundaries ?? [],
        escalationTriggers: charter.escalationTriggers ?? [],
      });
    }
  }, [charter]);

  const saveMutation = useMutation({
    mutationFn: (data: AgentCharter) => api.put<AgentCharter>(`/agents/${id}/charter`, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agent-charter', id] });
      toast({ title: 'Charter saved' });
    },
    onError: (e) => toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    saveMutation.mutate(form);
  }

  const isLoading = agentLoading || charterLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/agents">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {isLoading ? 'Loading…' : `${agent?.name ?? ''} — Charter`}
          </h1>
          <p className="text-muted-foreground">
            Define operating mandate, posture, and authority boundaries
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading charter…</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Mandate */}
          <Card>
            <CardHeader><CardTitle>Mandate</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1">
                <Label htmlFor="mandate">
                  What this agent exists to do — injected into every system prompt
                </Label>
                <textarea
                  id="mandate"
                  value={form.mandate}
                  onChange={(e) => setForm((v) => ({ ...v, mandate: e.target.value }))}
                  placeholder="Monitor and remediate network infrastructure across all sites. Escalate incidents with severity CRITICAL or higher immediately."
                  rows={4}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                  required
                />
              </div>
            </CardContent>
          </Card>

          {/* Posture + Bearing + Verbosity */}
          <Card>
            <CardHeader><CardTitle>Behaviour</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              {/* Posture */}
              <div className="space-y-1">
                <Label htmlFor="posture">Posture</Label>
                <select
                  id="posture"
                  value={form.posture}
                  onChange={(e) => setForm((v) => ({ ...v, posture: e.target.value as AgentCharter['posture'] }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {POSTURE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {POSTURE_OPTIONS.find((o) => o.value === form.posture)?.description}
                </p>
              </div>

              {/* Bearing */}
              <div className="space-y-1">
                <Label htmlFor="bearing">Bearing</Label>
                <select
                  id="bearing"
                  value={form.bearing}
                  onChange={(e) => setForm((v) => ({ ...v, bearing: e.target.value as AgentCharter['bearing'] }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {BEARING_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o.charAt(0) + o.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </div>

              {/* Verbosity */}
              <div className="space-y-1">
                <Label htmlFor="verbosity">Verbosity</Label>
                <select
                  id="verbosity"
                  value={form.verbosity}
                  onChange={(e) => setForm((v) => ({ ...v, verbosity: e.target.value as AgentCharter['verbosity'] }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {VERBOSITY_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o.charAt(0) + o.slice(1).toLowerCase()}</option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Conduct Boundaries + Escalation Triggers */}
          <Card>
            <CardHeader><CardTitle>Authority Boundaries</CardTitle></CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <TagInput
                label="Conduct Boundaries"
                tags={form.conductBoundaries}
                placeholder="delete.*, write:fabric-config"
                onChange={(tags) => setForm((v) => ({ ...v, conductBoundaries: tags }))}
              />
              <TagInput
                label="Escalation Triggers"
                tags={form.escalationTriggers}
                placeholder="severity:CRITICAL, alarm_count > 10"
                onChange={(tags) => setForm((v) => ({ ...v, escalationTriggers: tags }))}
              />
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button type="submit" disabled={!form.mandate || saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save Charter'}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/agents')}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
