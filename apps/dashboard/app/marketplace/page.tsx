'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, AlertCircle, Settings, RefreshCw, Loader2, Wifi, Network } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

type PlatformStatus = 'active' | 'not_configured' | 'partial';

type Platform = {
  id: string;
  label: string;
  configured: boolean;
  credentialId: string | null;
  skillCount: number;
  playbooksCount: number;
  agentId: string | null;
  agentName: string | null;
  status: PlatformStatus;
};

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  xiq: <Wifi className="h-5 w-5" />,
  xco: <Network className="h-5 w-5" />,
};

const PLATFORM_DESCRIPTIONS: Record<string, string> = {
  xiq: 'Manage and monitor wireless networks — clients, APs, SSIDs, VLANs, policies, radio quality, and troubleshooting.',
  xco: 'Monitor and operate IP fabric — alarms, BGP sessions, VTEP health, interface utilization, and audit trails.',
};

const STATUS_BADGE: Record<PlatformStatus, { label: string; classes: string }> = {
  active:         { label: 'Active',          classes: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  not_configured: { label: 'Not Configured',  classes: 'bg-slate-500/10 text-slate-400 border-slate-500/30' },
  partial:        { label: 'Partially Set Up', classes: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
};

export default function MarketplacePage() {
  const queryClient = useQueryClient();
  const [provisioning, setProvisioning] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<{ platforms: Platform[] }>({
    queryKey: ['platforms'],
    queryFn: () => api.get('/platforms'),
    staleTime: 15_000,
  });

  const provisionMutation = useMutation({
    mutationFn: (platformId: string) => api.post(`/platforms/${platformId}/provision`, {}),
    onMutate: (platformId) => setProvisioning(platformId),
    onSuccess: (_, platformId) => {
      toast({ title: 'Provisioning started', description: `Platform ${platformId} is being set up in the background.` });
      setTimeout(() => {
        setProvisioning(null);
        void queryClient.invalidateQueries({ queryKey: ['platforms'] });
      }, 5000);
    },
    onError: (e, platformId) => {
      setProvisioning(null);
      toast({ title: 'Provision failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading platform status…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-center gap-3 text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="text-sm">Failed to load platform status: {error instanceof Error ? error.message : 'Unknown error'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100">Platform Bundles</h1>
        <p className="mt-1 text-sm text-slate-400">
          Configure network management platforms to unlock domain-specific skills, knowledge, and composite tools.
        </p>
      </div>

      <div className="grid gap-4">
        {data.platforms.map((platform) => {
          const badge = STATUS_BADGE[platform.status];
          const icon = PLATFORM_ICONS[platform.id];
          const desc = PLATFORM_DESCRIPTIONS[platform.id] ?? '';
          const isProvisioningThis = provisioning === platform.id;

          return (
            <div
              key={platform.id}
              className="rounded-xl border border-slate-800 bg-slate-900 p-5"
            >
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className="mt-0.5 rounded-lg border border-slate-700 bg-slate-800 p-2 text-cyan-400">
                  {icon}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-semibold text-slate-100">{platform.label}</h2>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.classes}`}>
                      {platform.status === 'active' && <CheckCircle className="h-2.5 w-2.5" />}
                      {platform.status === 'not_configured' && <AlertCircle className="h-2.5 w-2.5" />}
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{desc}</p>

                  {/* Stats */}
                  <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                    <span className={platform.skillCount > 0 ? 'text-slate-300' : ''}>
                      <span className="font-medium">{platform.skillCount}</span> skills
                    </span>
                    <span className={platform.playbooksCount > 0 ? 'text-slate-300' : ''}>
                      <span className="font-medium">{platform.playbooksCount}</span> playbooks
                    </span>
                    {platform.agentName && (
                      <span className="text-slate-300">
                        Agent: <span className="font-medium">{platform.agentName}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {!platform.configured && (
                    <a
                      href="/credentials"
                      className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-all"
                    >
                      <Settings className="h-3.5 w-3.5" />
                      Configure
                    </a>
                  )}
                  {platform.configured && (
                    <button
                      onClick={() => provisionMutation.mutate(platform.id)}
                      disabled={isProvisioningThis}
                      className="flex items-center gap-1.5 rounded-lg border border-cyan-600/50 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300 transition-all disabled:opacity-50"
                    >
                      {isProvisioningThis
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RefreshCw className="h-3.5 w-3.5" />}
                      {isProvisioningThis ? 'Provisioning…' : 'Provision Now'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
