'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { formatDate, STATUS_COLOURS, truncate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';

type RequestSummary = {
  id: string;
  status: string;
  channel: string;
  input: string;
  output?: string;
  errorMsg?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  agent: { id: string; name: string };
  user: { id: string; displayName: string };
};

type ToolCall = {
  toolCallId: string;
  toolName: string;
  result: unknown;
};

type Turn = {
  role: string;
  content: unknown;
};

type RequestDetail = RequestSummary & {
  turns: Turn[];
  toolCalls: ToolCall[];
};

function durationMs(start?: string, end?: string): string {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const ms = e - s;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOURS[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status === 'RUNNING' && <span className="mr-1 h-1.5 w-1.5 rounded-full bg-current animate-pulse inline-block" />}
      {status}
    </span>
  );
}

function JsonView({ data }: { data: unknown }) {
  const text = JSON.stringify(data, null, 2);
  return (
    <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap break-words">
      {text}
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
        const resultStr = JSON.stringify(tc.result);
        const isError = resultStr.includes('"error"');
        return (
          <div key={tc.toolCallId} className={`border rounded-lg overflow-hidden ${isError ? 'border-red-200' : 'border-border'}`}>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
              onClick={() => setExpanded(isOpen ? null : tc.toolCallId)}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">{i + 1}</span>
              <span className={`font-mono text-xs font-medium ${isError ? 'text-red-600' : ''}`}>{tc.toolName}</span>
              {isError && <span className="text-xs text-red-500 ml-auto">error</span>}
              <span className="ml-auto text-xs text-muted-foreground">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div className="border-t px-3 py-2 bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1 font-semibold">Response:</p>
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

function RequestDetailDialog({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const { data: req, isLoading } = useQuery<RequestDetail>({
    queryKey: ['request-detail', requestId],
    queryFn: () => adminApi.get<RequestDetail>(`/admin/requests/${requestId}`),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'RUNNING' || status === 'QUEUED' ? 2000 : false;
    },
  });

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm" />
        <Dialog.Content className="fixed right-0 top-0 h-full w-full max-w-2xl bg-background shadow-2xl z-50 flex flex-col overflow-hidden">
          {/* Header */}
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
                  {req.startedAt && (
                    <>
                      <span>·</span>
                      <span>⏱ {durationMs(req.startedAt, req.completedAt)}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <Dialog.Close asChild>
              <button className="ml-4 text-muted-foreground hover:text-foreground text-xl leading-none shrink-0">✕</button>
            </Dialog.Close>
          </div>

          {isLoading && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">Loading…</div>
          )}

          {req && (
            <Tabs.Root defaultValue="overview" className="flex flex-col flex-1 overflow-hidden">
              <Tabs.List className="flex border-b px-6 shrink-0 gap-1">
                {['overview', 'tools', 'turns'].map((tab) => (
                  <Tabs.Trigger
                    key={tab}
                    value={tab}
                    className="px-3 py-2 text-sm capitalize text-muted-foreground data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors"
                  >
                    {tab === 'tools' ? `Tool Calls (${req.toolCalls?.length ?? 0})` : tab === 'turns' ? `Turns (${req.turns?.length ?? 0})` : 'Overview'}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>

              {/* Overview */}
              <Tabs.Content value="overview" className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Input</p>
                  <div className="text-sm bg-muted rounded p-3 whitespace-pre-wrap break-words">{req.input}</div>
                </div>

                {req.status === 'RUNNING' || req.status === 'QUEUED' ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                    {req.status === 'QUEUED' ? 'Waiting in queue…' : 'Agent is working…'}
                    {req.toolCalls?.length > 0 && (
                      <span className="ml-2">Last tool: <code className="text-xs bg-muted px-1 py-0.5 rounded">{req.toolCalls[req.toolCalls.length - 1]?.toolName}</code></span>
                    )}
                  </div>
                ) : req.status === 'AWAITING_APPROVAL' ? (
                  <div className="flex items-center gap-2 text-sm text-yellow-700 bg-yellow-50 rounded p-3 border border-yellow-200">
                    ⏳ Waiting for approval
                  </div>
                ) : null}

                {req.output && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Output</p>
                    <div className="text-sm bg-muted rounded p-3 whitespace-pre-wrap break-words">{req.output}</div>
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

              {/* Tool Calls */}
              <Tabs.Content value="tools" className="flex-1 overflow-y-auto px-6 py-4">
                <ToolCallTimeline toolCalls={req.toolCalls ?? []} />
              </Tabs.Content>

              {/* Turns */}
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

export default function RequestsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['requests-recent'],
    queryFn: () => adminApi.get<RequestSummary[]>('/admin/requests/recent'),
    refetchInterval: 5_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Activity Log</h1>
        <p className="text-muted-foreground">Click any row to view full details — tool calls, responses, and conversation turns.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Input</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {requests.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setSelectedId(r.id)}
                >
                  <TableCell className="font-medium">{r.agent.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs">
                    <span className="truncate block" title={r.input}>{truncate(r.input, 70)}</span>
                  </TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground capitalize">{r.channel}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{durationMs(r.startedAt, r.completedAt)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
                </TableRow>
              ))}
              {!isLoading && requests.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No requests yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedId && (
        <RequestDetailDialog requestId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
