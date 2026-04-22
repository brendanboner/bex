'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { formatDate, STATUS_COLOURS, truncate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';

// ─── Types ────────────────────────────────────────────────────────────────────

type RunSummary = {
  id: string;
  status: string;
  channel: string;
  input: string;
  errorMsg?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  agent: { id: string; name: string };
  user: { id: string; displayName: string };
};

type Group = {
  key: string;
  agentId: string;
  agentName: string;
  inputSummary: string;
  channels: string[];
  totalRuns: number;
  counts: { COMPLETED: number; FAILED: number; RUNNING: number; QUEUED: number; OTHER: number };
  lastRunAt: string;
  lastStatus: string;
  lastErrorMsg?: string | null;
  runs: RunSummary[];
};

type ToolCall = { toolCallId: string; toolName: string; result: unknown };
type Turn = { role: string; content: unknown };
type RequestDetail = RunSummary & { output?: string; turns: Turn[]; toolCalls: ToolCall[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function durationMs(start?: string, end?: string): string {
  if (!start) return '—';
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOURS[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {(status === 'RUNNING' || status === 'QUEUED') && (
        <span className="mr-1 h-1.5 w-1.5 rounded-full bg-current animate-pulse inline-block" />
      )}
      {status}
    </span>
  );
}

function CountPill({ label, count, colour }: { label: string; count: number; colour: string }) {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${colour}`}>
      {count} {label}
    </span>
  );
}

function JsonView({ data }: { data: unknown }) {
  return (
    <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap break-words">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function ToolCallTimeline({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!toolCalls.length) return <p className="text-sm text-muted-foreground italic">No tool calls recorded.</p>;
  return (
    <div className="space-y-2">
      {toolCalls.map((tc, i) => {
        const isOpen = expanded === tc.toolCallId;
        const isError = JSON.stringify(tc.result).includes('"error"');
        return (
          <div key={tc.toolCallId} className={`border rounded-lg overflow-hidden ${isError ? 'border-red-200' : 'border-border'}`}>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
              onClick={() => setExpanded(isOpen ? null : tc.toolCallId)}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">{i + 1}</span>
              <span className={`font-mono text-xs font-medium ${isError ? 'text-red-600' : ''}`}>{tc.toolName}</span>
              {isError && <span className="text-xs text-red-500 ml-2">error</span>}
              <span className="ml-auto text-xs text-muted-foreground">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div className="border-t px-3 py-2 bg-muted/30">
                <JsonView data={tc.result} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TurnsView({ turns }: { turns: Turn[] }) {
  if (!turns.length) return <p className="text-sm text-muted-foreground italic">No conversation turns recorded.</p>;
  return (
    <div className="space-y-2">
      {turns.map((t, i) => {
        const content = typeof t.content === 'string' ? t.content : JSON.stringify(t.content, null, 2);
        const isUser = t.role === 'user';
        return (
          <div key={i} className={`rounded-lg p-3 text-sm ${isUser ? 'bg-primary/5 border border-primary/20' : 'bg-muted'}`}>
            <span className={`text-xs font-semibold uppercase tracking-wide ${isUser ? 'text-primary' : 'text-muted-foreground'}`}>{t.role}</span>
            <pre className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed">{content}</pre>
          </div>
        );
      })}
    </div>
  );
}

// ─── Detail slide-over ────────────────────────────────────────────────────────

function RequestDetailDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const { data: req, isLoading } = useQuery<RequestDetail>({
    queryKey: ['request-detail', requestId],
    queryFn: () => adminApi.get<RequestDetail>(`/admin/requests/${requestId}`),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'RUNNING' || s === 'QUEUED' ? 2000 : false;
    },
  });

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm" />
        <Dialog.Content className="fixed right-0 top-0 h-full w-full max-w-2xl bg-background shadow-2xl z-50 flex flex-col overflow-hidden">
          <div className="flex items-start justify-between px-6 py-4 border-b shrink-0">
            <div className="space-y-1 min-w-0">
              <Dialog.Title className="font-semibold text-lg truncate">
                {isLoading ? 'Loading…' : req?.agent.name ?? 'Request'}
              </Dialog.Title>
              {req && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <StatusBadge status={req.status} />
                  <span className="capitalize">{req.channel}</span>
                  <span>·</span>
                  <span>{formatDate(req.createdAt)}</span>
                  {req.startedAt && <><span>·</span><span>⏱ {durationMs(req.startedAt, req.completedAt)}</span></>}
                </div>
              )}
            </div>
            <Dialog.Close asChild>
              <button className="ml-4 text-muted-foreground hover:text-foreground text-xl leading-none shrink-0">✕</button>
            </Dialog.Close>
          </div>

          {isLoading && <div className="flex-1 flex items-center justify-center text-muted-foreground">Loading…</div>}

          {req && (
            <Tabs.Root defaultValue="overview" className="flex flex-col flex-1 overflow-hidden">
              <Tabs.List className="flex border-b px-6 shrink-0 gap-1">
                {['overview', 'tools', 'turns'].map((tab) => (
                  <Tabs.Trigger key={tab} value={tab}
                    className="px-3 py-2 text-sm capitalize text-muted-foreground data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors">
                    {tab === 'tools' ? `Tool Calls (${req.toolCalls?.length ?? 0})` : tab === 'turns' ? `Turns (${req.turns?.length ?? 0})` : 'Overview'}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>

              <Tabs.Content value="overview" className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Input</p>
                  <div className="text-sm bg-muted rounded p-3 whitespace-pre-wrap break-words">{req.input}</div>
                </div>
                {(req.status === 'RUNNING' || req.status === 'QUEUED') && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                    {req.status === 'QUEUED' ? 'Waiting in queue…' : 'Agent is working…'}
                  </div>
                )}
                {req.output && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Output</p>
                    <div className="text-sm bg-muted rounded p-3 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">{
                      (() => { try { return JSON.stringify(JSON.parse(req.output as string), null, 2); } catch { return req.output as string; } })()
                    }</div>
                  </div>
                )}
                {req.errorMsg && (
                  <div>
                    <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">Error</p>
                    <div className="text-sm bg-red-50 text-red-800 border border-red-200 rounded p-3 whitespace-pre-wrap">{req.errorMsg}</div>
                  </div>
                )}
                <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
                  <p>ID: <code className="bg-muted px-1 rounded">{req.id}</code></p>
                  <p>Agent: {req.agent.name} (<code className="bg-muted px-1 rounded">{req.agent.id}</code>)</p>
                  <p>User: {req.user.displayName}</p>
                  {req.startedAt && <p>Started: {formatDate(req.startedAt)}</p>}
                  {req.completedAt && <p>Completed: {formatDate(req.completedAt)}</p>}
                </div>
              </Tabs.Content>

              <Tabs.Content value="tools" className="flex-1 overflow-y-auto px-6 py-4">
                <ToolCallTimeline toolCalls={req.toolCalls ?? []} />
              </Tabs.Content>

              <Tabs.Content value="turns" className="flex-1 overflow-y-auto px-6 py-4">
                <TurnsView turns={req.turns ?? []} />
              </Tabs.Content>
            </Tabs.Root>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Grouped row ──────────────────────────────────────────────────────────────

function GroupRow({ group, onSelectRun }: { group: Group; onSelectRun: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const hasErrors = group.counts.FAILED > 0;
  const isLive = group.counts.RUNNING > 0 || group.counts.QUEUED > 0;

  return (
    <>
      {/* Summary row */}
      <tr
        className={`border-b transition-colors cursor-pointer hover:bg-muted/40 ${hasErrors ? 'bg-red-50/30' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-4 py-3 w-6 text-muted-foreground text-xs select-none">
          {open ? '▼' : '▶'}
        </td>
        <td className="px-4 py-3">
          <div className="font-medium text-sm">{group.agentName}</div>
          <div className="text-xs text-muted-foreground mt-0.5 flex gap-1 flex-wrap">
            {group.channels.map((c) => (
              <span key={c} className="capitalize bg-muted rounded px-1.5 py-0.5">{c}</span>
            ))}
          </div>
        </td>
        <td className="px-4 py-3 max-w-sm">
          <span className="text-sm text-muted-foreground" title={group.inputSummary}>
            {truncate(group.inputSummary, 90)}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1 items-center">
            {isLive && <StatusBadge status={group.counts.RUNNING > 0 ? 'RUNNING' : 'QUEUED'} />}
            {!isLive && <StatusBadge status={group.lastStatus} />}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            <CountPill label="ok" count={group.counts.COMPLETED} colour="bg-green-100 text-green-700" />
            <CountPill label="err" count={group.counts.FAILED} colour="bg-red-100 text-red-700" />
            <CountPill label="live" count={group.counts.RUNNING + group.counts.QUEUED} colour="bg-yellow-100 text-yellow-700" />
          </div>
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(group.lastRunAt)}
        </td>
      </tr>

      {/* Expanded run list */}
      {open && group.runs.map((r) => (
        <tr
          key={r.id}
          className="border-b bg-muted/20 hover:bg-muted/40 cursor-pointer transition-colors"
          onClick={(e) => { e.stopPropagation(); onSelectRun(r.id); }}
        >
          <td className="px-4 py-2 pl-10 text-xs text-muted-foreground" />
          <td className="px-4 py-2 text-xs text-muted-foreground" colSpan={2}>
            <span className="font-mono">{r.id.slice(-8)}</span>
            {r.errorMsg && (
              <span className="ml-2 text-red-500 truncate">{truncate(r.errorMsg, 60)}</span>
            )}
          </td>
          <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
          <td className="px-4 py-2 text-xs text-muted-foreground">{durationMs(r.startedAt, r.completedAt)}</td>
          <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.createdAt)}</td>
        </tr>
      ))}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RequestsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const queryClient = useQueryClient();

  const { data: groups = [], isLoading } = useQuery<Group[]>({
    queryKey: ['requests-grouped'],
    queryFn: () => adminApi.get<Group[]>('/admin/requests/grouped'),
    refetchInterval: 8_000,
  });

  const clearMutation = useMutation({
    mutationFn: () => adminApi.delete('/admin/requests') as Promise<{ deleted: number }>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requests-grouped'] });
      setConfirmClear(false);
    },
  });

  const totalRuns = groups.reduce((n, g) => n + g.totalRuns, 0);
  const totalFailed = groups.reduce((n, g) => n + g.counts.FAILED, 0);
  const totalLive = groups.reduce((n, g) => n + g.counts.RUNNING + g.counts.QUEUED, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Activity Log</h1>
          <p className="text-muted-foreground">
            {groups.length} unique task{groups.length !== 1 ? 's' : ''} · {totalRuns} total runs
            {totalFailed > 0 && <span className="text-red-500 ml-2">· {totalFailed} failed</span>}
            {totalLive > 0 && <span className="text-yellow-600 ml-2">· {totalLive} live</span>}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {!confirmClear ? (
            <button
              onClick={() => setConfirmClear(true)}
              className="px-3 py-1.5 text-sm rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
            >
              Clear Logs
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Delete all {totalRuns} runs?</span>
              <button
                onClick={() => clearMutation.mutate()}
                disabled={clearMutation.isPending}
                className="px-3 py-1.5 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {clearMutation.isPending ? 'Clearing…' : 'Yes, clear all'}
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="px-3 py-1.5 text-sm rounded-md border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-3 w-6" />
                <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wide text-muted-foreground">Agent</th>
                <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wide text-muted-foreground">Input / Task</th>
                <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wide text-muted-foreground">Last Status</th>
                <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wide text-muted-foreground">Runs</th>
                <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wide text-muted-foreground">Last Run</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {groups.map((g) => (
                <GroupRow key={g.key} group={g} onSelectRun={setSelectedId} />
              ))}
              {!isLoading && groups.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No activity yet</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {selectedId && (
        <RequestDetailDialog requestId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
