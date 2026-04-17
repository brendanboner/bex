'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { formatDate, STATUS_COLOURS, truncate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Request = {
  id: string;
  status: string;
  channel: string;
  input: string;
  output?: string;
  errorMsg?: string;
  createdAt: string;
  completedAt?: string;
  agent: { id: string; name: string };
  user: { id: string; displayName: string };
};

export default function RequestsPage() {
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['requests-recent'],
    queryFn: () => adminApi.get<Request[]>('/admin/requests/recent'),
    refetchInterval: 5_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Requests</h1>
        <p className="text-muted-foreground">Live audit log of agent requests. Auto-refreshes every 5s.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Input</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.agent.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.user.displayName}</TableCell>
                  <TableCell className="text-sm max-w-xs truncate" title={r.input}>{truncate(r.input, 60)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOURS[r.status] ?? ''}`}>
                      {r.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground capitalize">{r.channel}</TableCell>
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
    </div>
  );
}
