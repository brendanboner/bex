'use client';
import { useQuery } from '@tanstack/react-query';
import { Circle } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useState, useEffect } from 'react';

export function StatusBar() {
  const [lastUpdated, setLastUpdated] = useState(0);
  const { data } = useQuery({
    queryKey: ['status-bar'],
    queryFn: () => adminApi.get<{ counts: { agents: number } }>('/admin/status'),
    refetchInterval: 30_000,
    retry: false,
  });

  useEffect(() => {
    if (data) setLastUpdated(Date.now());
  }, [data]);

  const agentCount = data?.counts?.agents ?? 0;
  const secondsAgo = lastUpdated ? Math.round((Date.now() - lastUpdated) / 1000) : null;

  return (
    <div className="flex h-9 items-center justify-center gap-2.5 border-b border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] px-4">
      <Circle className="h-2 w-2 fill-emerald-400 text-emerald-400" />
      <span className="text-xs text-[rgb(var(--text-secondary))]">
        {agentCount > 0
          ? `Monitoring ${agentCount} agent${agentCount !== 1 ? 's' : ''}`
          : 'Forge Platform'
        }
        {secondsAgo !== null && (
          <span className="text-[rgb(var(--text-muted))]"> · Updated {secondsAgo}s ago</span>
        )}
      </span>
    </div>
  );
}
