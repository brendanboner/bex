'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, Brain, Key, Network, Users, Zap, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { adminApi } from '@/lib/api';
import { formatDate, STATUS_COLOURS, truncate } from '@/lib/utils';
import { AgentOrbit } from '@/components/AgentOrbit';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return formatDate(dateStr);
}

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

function StatPill({ label, value, icon: Icon, href }: { label: string; value: number; icon: React.ElementType; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-[rgba(77,79,99,0.35)] bg-[rgba(45,47,61,0.7)] px-4 py-3 hover:border-[rgba(137,129,229,0.35)] hover:bg-[rgba(45,47,61,0.9)] transition-all group"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(137,129,229,0.12)]">
        <Icon className="h-4 w-4 text-[#8981e5]" />
      </div>
      <div>
        <p className="text-xl font-bold text-[#e8e9f2]">{value}</p>
        <p className="text-xs text-[#8f91a1]">{label}</p>
      </div>
      <ArrowRight className="ml-auto h-3.5 w-3.5 text-[#8f91a1] opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}

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
    <div className="mx-auto max-w-3xl space-y-6">

      {/* Agent overview — stat pills */}
      <section>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#8f91a1]">Agent Overview</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatPill label="Agents"      value={status?.counts.agents      ?? 0} icon={Bot}     href="/agents" />
          <StatPill label="Skills"      value={status?.counts.skills      ?? 0} icon={Brain}   href="/skills" />
          <StatPill label="Users"       value={status?.counts.users       ?? 0} icon={Users}   href="/users" />
          <StatPill label="Credentials" value={status?.counts.credentials ?? 0} icon={Key}     href="/credentials" />
          <StatPill label="Endpoints"   value={status?.counts.endpoints   ?? 0} icon={Network} href="/endpoints" />
          <StatPill label="Scheduled"   value={status?.counts.scheduledJobs ?? 0} icon={Zap}  href="/scheduled-jobs" />
        </div>
      </section>

      {/* Queue health */}
      <section>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#8f91a1]">Queue Health</p>
        <div className="flex gap-8 rounded-xl border border-[rgba(77,79,99,0.35)] bg-[rgba(45,47,61,0.7)] px-6 py-4">
          {[
            { label: 'Active',    val: status?.queue.active    ?? 0, color: 'text-violet-400' },
            { label: 'Waiting',   val: status?.queue.waiting   ?? 0, color: 'text-amber-400'  },
            { label: 'Completed', val: status?.queue.completed ?? 0, color: 'text-emerald-400' },
            { label: 'Failed',    val: status?.queue.failed    ?? 0, color: 'text-red-400'    },
          ].map(({ label, val, color }) => (
            <div key={label}>
              <p className={`text-2xl font-bold ${color}`}>{val}</p>
              <p className="text-xs text-[#8f91a1]">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Orbit graphic — centered */}
      <section className="flex flex-col items-center gap-3 py-4">
        <AgentOrbit size={380} />
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-[#e8e9f2]">Autonomous Agent Network</p>
          <p className="text-xs text-[#8f91a1]">Each node is an active agent. It pulses when running a live query.</p>
        </div>
      </section>

      {/* Recent activity */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8f91a1]">Recent Activity</p>
          <Link href="/requests" className="text-xs text-[#8f91a1] hover:text-[#e8e9f2] transition-colors">View all</Link>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Request</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent?.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium text-[#e8e9f2] whitespace-nowrap">{r.agent.name}</TableCell>
                <TableCell className="max-w-[220px]">
                  <p className="truncate text-[#8f91a1]">{truncate(r.input, 60)}</p>
                </TableCell>
                <TableCell className="text-[#8f91a1] whitespace-nowrap">{r.user.displayName}</TableCell>
                <TableCell>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLOURS[r.status] ?? 'bg-slate-500/20 text-slate-300'}`}>
                    {r.status}
                  </span>
                </TableCell>
                <TableCell className="text-[#8f91a1] whitespace-nowrap">{relativeTime(r.createdAt)}</TableCell>
              </TableRow>
            ))}
            {!recent?.length && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-[#8f91a1] py-8">No requests in the last hour</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

    </div>
  );
}

