'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, Brain, CheckCircle2, Clock, Key, Network, Users, Zap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { adminApi, api } from '@/lib/api';
import { formatDate, STATUS_COLOURS, truncate } from '@/lib/utils';

type Status = {
  counts: { agents: number; skills: number; credentials: number; requests: number; users: number; endpoints: number; scheduledJobs: number };
  queue: { waiting: number; active: number; completed: number; failed: number };
  requestsByStatus: Record<string, number>;
};

type RecentRequest = {
  id: string;
  status: string;
  channel: string;
  input: string;
  output?: string;
  createdAt: string;
  agent: { id: string; name: string };
  user: { id: string; displayName: string };
};

const statCards = (counts: Status['counts']) => [
  { label: 'Agents', value: counts.agents, icon: Bot, color: 'text-blue-500' },
  { label: 'Skills', value: counts.skills, icon: Brain, color: 'text-purple-500' },
  { label: 'Credentials', value: counts.credentials, icon: Key, color: 'text-yellow-500' },
  { label: 'Requests', value: counts.requests, icon: Clock, color: 'text-gray-500' },
  { label: 'Endpoints', value: counts.endpoints, icon: Network, color: 'text-teal-500' },
  { label: 'Users', value: counts.users, icon: Users, color: 'text-indigo-500' },
  { label: 'Scheduled Jobs', value: counts.scheduledJobs, icon: Zap, color: 'text-orange-500' },
];

export default function OverviewPage() {
  const { data: status } = useQuery({
    queryKey: ['status'],
    queryFn: () => adminApi.get<Status>('/admin/status'),
    refetchInterval: 15_000,
  });

  const { data: recent } = useQuery({
    queryKey: ['recent-requests'],
    queryFn: () => adminApi.get<RecentRequest[]>('/admin/requests/recent'),
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Platform status at a glance</p>
      </div>

      {/* Stats grid */}
      {status && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards(status.counts).map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                <Icon className={`h-5 w-5 ${color}`} />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{value}</p>
              </CardContent>
            </Card>
          ))}

          {/* Queue stats */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" /> Queue
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Active</span><span className="font-semibold">{status.queue.active}</span></div>
              <div className="flex justify-between"><span>Waiting</span><span className="font-semibold">{status.queue.waiting}</span></div>
              <div className="flex justify-between"><span>Failed</span><span className="font-semibold text-red-500">{status.queue.failed}</span></div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent Requests */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Requests</CardTitle>
          <CardDescription>Last 20 agent requests across all channels</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recent?.map((r) => (
              <div key={r.id} className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{r.agent.name}</span>
                    <span className="text-muted-foreground">•</span>
                    <span className="text-muted-foreground">{r.user.displayName}</span>
                    <Badge className={`ml-auto text-xs ${STATUS_COLOURS[r.status] ?? ''}`}>{r.status}</Badge>
                  </div>
                  <p className="text-muted-foreground truncate">{truncate(r.input, 100)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{formatDate(r.createdAt)} · {r.channel}</p>
                </div>
              </div>
            ))}
            {!recent?.length && <p className="text-sm text-muted-foreground">No requests yet</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
