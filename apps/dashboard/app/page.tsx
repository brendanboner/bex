'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, Brain, Clock, Key, Network, Users, Zap, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { adminApi } from '@/lib/api';
import { formatDate, STATUS_COLOURS, truncate } from '@/lib/utils';
import { Spirograph } from '@/components/Spirograph';

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
      className="flex items-center gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] px-4 py-3 hover:border-[rgba(6,182,212,0.35)] hover:bg-[rgb(var(--bg-elevated))] transition-all group"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.10)]">
        <Icon className="h-4 w-4 text-[rgb(var(--text-secondary))]" />
      </div>
      <div>
        <p className="text-xl font-bold text-[rgb(var(--text-primary))]">{value}</p>
        <p className="text-xs text-[rgb(var(--text-secondary))]">{label}</p>
      </div>
      <ArrowRight className="ml-auto h-3.5 w-3.5 text-[rgb(var(--text-muted))] opacity-0 group-hover:opacity-100 transition-opacity" />
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
    <div className="flex gap-8 min-h-[calc(100vh-100px)]">
      {/* Left column — stats + activity */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Stat pills */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          <StatPill label="Agents" value={status?.counts.agents ?? 0} icon={Bot} href="/agents" />
          <StatPill label="Skills" value={status?.counts.skills ?? 0} icon={Brain} href="/skills" />
          <StatPill label="Users" value={status?.counts.users ?? 0} icon={Users} href="/users" />
          <StatPill label="Credentials" value={status?.counts.credentials ?? 0} icon={Key} href="/credentials" />
          <StatPill label="Endpoints" value={status?.counts.endpoints ?? 0} icon={Network} href="/endpoints" />
          <StatPill label="Scheduled" value={status?.counts.scheduledJobs ?? 0} icon={Zap} href="/scheduled-jobs" />
        </div>

        {/* Queue health */}
        {status && (
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))] mb-3">Queue Health</p>
            <div className="flex gap-6">
              {[
                { label: 'Active', val: status.queue.active, color: 'text-blue-400' },
                { label: 'Waiting', val: status.queue.waiting, color: 'text-amber-400' },
                { label: 'Completed', val: status.queue.completed, color: 'text-emerald-400' },
                { label: 'Failed', val: status.queue.failed, color: 'text-red-400' },
              ].map(({ label, val, color }) => (
                <div key={label}>
                  <p className={`text-2xl font-bold ${color}`}>{val}</p>
                  <p className="text-xs text-[rgb(var(--text-secondary))]">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent activity */}
        <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[rgb(var(--border))]">
            <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">Recent Activity</p>
            <Link href="/requests" className="text-xs text-[rgb(var(--text-secondary))] hover:text-slate-200 transition-colors">View all</Link>
          </div>
          <div className="divide-y divide-[rgb(var(--border))]">
            {recent?.slice(0, 8).map((r) => (
              <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-[rgb(var(--text-primary))]">{r.agent.name}</span>
                    <span className="text-[10px] text-[rgb(var(--text-muted))]">·</span>
                    <span className="text-[10px] text-[rgb(var(--text-secondary))]">{r.user.displayName}</span>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLOURS[r.status] ?? 'badge-queued'}`}>{r.status}</span>
                  </div>
                  <p className="text-xs text-[rgb(var(--text-secondary))] truncate">{truncate(r.input, 90)}</p>
                  <p className="text-[10px] text-[rgb(var(--text-muted))] mt-0.5">{formatDate(r.createdAt)} · {r.channel}</p>
                </div>
              </div>
            ))}
            {!recent?.length && (
              <p className="px-4 py-6 text-sm text-[rgb(var(--text-muted))] text-center">No requests yet — start by sending a message in Nexus</p>
            )}
          </div>
        </div>
      </div>

      {/* Right column — spirograph hero */}
      <div className="hidden xl:flex w-[480px] shrink-0 flex-col items-center justify-center gap-4">
        <Spirograph size={420} />
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">Autonomous Agent Network</p>
          <p className="text-xs text-[rgb(var(--text-secondary))] max-w-xs">
            Skills are built, shared and composed across agents in real time. Each node is an autonomous capability.
          </p>
        </div>
      </div>
    </div>
  );
}

