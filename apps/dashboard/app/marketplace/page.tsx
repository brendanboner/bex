'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, PackageOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';

type RemoteSkill = {
  domain: string;
  version: string;
  description?: string;
  author?: string;
  tags?: string[];
};

type LocalSkill = {
  id: string;
  domain: string;
  version: string;
  status: string;
};

type RegistryResponse = {
  skills: RemoteSkill[];
} | RemoteSkill[];

export default function MarketplacePage() {
  const qc = useQueryClient();

  const {
    data: remoteSkills,
    isLoading: remoteLoading,
    error: remoteError,
  } = useQuery({
    queryKey: ['registry-skills'],
    queryFn: () => api.get<RegistryResponse>('/registry/skills'),
    retry: false,
  });

  const { data: localSkills = [] } = useQuery({
    queryKey: ['skills'],
    queryFn: () => api.get<LocalSkill[]>('/skills'),
  });

  const installMutation = useMutation({
    mutationFn: ({ domain, version }: { domain: string; version: string }) =>
      api.post(`/registry/install/${encodeURIComponent(domain)}/${encodeURIComponent(version)}`),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['skills'] });
      void qc.invalidateQueries({ queryKey: ['registry-skills'] });
      toast({ title: `Installed ${vars.domain}@${vars.version}` });
    },
    onError: (e) => toast({ title: 'Install failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const publishMutation = useMutation({
    mutationFn: (skill: LocalSkill) =>
      api.post(`/registry/publish/${encodeURIComponent(skill.domain)}/${encodeURIComponent(skill.version)}`),
    onSuccess: (_data, skill) => {
      toast({ title: `Published ${skill.domain}@${skill.version}` });
    },
    onError: (e) => toast({ title: 'Publish failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const skills: RemoteSkill[] = Array.isArray(remoteSkills)
    ? remoteSkills
    : (remoteSkills as { skills: RemoteSkill[] } | undefined)?.skills ?? [];

  function isInstalled(domain: string, version: string) {
    return localSkills.some((s) => s.domain === domain && s.version === version);
  }

  const publishableSkills = localSkills.filter((s) => s.status === 'PUBLISHED');

  const noRegistry =
    remoteError &&
    ((remoteError as Error).message?.toLowerCase().includes('registry') ||
      (remoteError as Error).message?.toLowerCase().includes('not configured') ||
      (remoteError as Error).message?.toLowerCase().includes('econnrefused') ||
      (remoteError as Error).message?.toLowerCase().includes('fetch'));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <PackageOpen className="h-7 w-7" /> Skill Marketplace
        </h1>
        <p className="text-muted-foreground">Browse and install skills from the remote registry</p>
      </div>

      {noRegistry && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
          <strong>No registry configured.</strong> Set <code className="font-mono bg-yellow-100 px-1 rounded">SKILL_REGISTRY_URL</code> to browse remote skills.
        </div>
      )}

      {remoteError && !noRegistry && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          Failed to load registry: {(remoteError as Error).message}
        </div>
      )}

      {/* Publishable local skills */}
      {publishableSkills.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Publish to Registry</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {publishableSkills.map((skill) => (
              <Card key={skill.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base font-semibold truncate">{skill.domain}</CardTitle>
                    <Badge variant="secondary">{skill.version}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => publishMutation.mutate(skill)}
                    disabled={publishMutation.isPending}
                  >
                    Publish
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Remote skills */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Remote Skills</h2>

        {remoteLoading && (
          <p className="text-sm text-muted-foreground">Loading registry…</p>
        )}

        {!remoteLoading && !remoteError && skills.length === 0 && (
          <p className="text-sm text-muted-foreground">No skills found in the registry.</p>
        )}

        {skills.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {skills.map((skill) => {
              const installed = isInstalled(skill.domain, skill.version);
              return (
                <Card key={`${skill.domain}@${skill.version}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold truncate">{skill.domain}</CardTitle>
                        {skill.author && (
                          <CardDescription className="text-xs">{skill.author}</CardDescription>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant="secondary">{skill.version}</Badge>
                        {installed && <Badge variant="success" className="text-xs">Installed</Badge>}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {skill.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{skill.description}</p>
                    )}
                    {skill.tags && skill.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {skill.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    )}
                    <Button
                      size="sm"
                      className="w-full"
                      variant={installed ? 'secondary' : 'default'}
                      disabled={installed || installMutation.isPending}
                      onClick={() => installMutation.mutate({ domain: skill.domain, version: skill.version })}
                    >
                      <Download className="h-3.5 w-3.5 mr-1" />
                      {installed ? 'Installed' : installMutation.isPending ? 'Installing…' : 'Install'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
