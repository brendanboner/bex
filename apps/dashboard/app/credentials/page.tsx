'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Key, User, Terminal, Lock, Zap, Settings2 } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';

type CredentialType = 'API_TOKEN' | 'USERNAME_PASSWORD' | 'SSH_KEY' | 'BASIC_AUTH' | 'OAUTH2_CLIENT' | 'USER_PREFERENCE';

type Credential = {
  id: string;
  name: string;
  scope: string;
  credentialType: CredentialType;
  description?: string;
};

const CRED_TYPES: { value: CredentialType; label: string; icon: React.ElementType; hint: string }[] = [
  { value: 'API_TOKEN',         label: 'API Token',          icon: Key,      hint: 'Bearer/header token or API key (e.g. OpenAI, GitHub)' },
  { value: 'USERNAME_PASSWORD', label: 'Username / Password', icon: User,     hint: 'REST API or web-UI login (e.g. XCO, ExtremeCloud)' },
  { value: 'SSH_KEY',           label: 'SSH Key',             icon: Terminal, hint: 'Private key + optional passphrase for SSH executor' },
  { value: 'BASIC_AUTH',        label: 'Basic Auth',          icon: Lock,     hint: 'username:password sent as HTTP Basic Auth header' },
  { value: 'OAUTH2_CLIENT',     label: 'OAuth 2 Client',      icon: Zap,      hint: 'Client ID + secret for OAuth2 client-credentials flow' },
  { value: 'USER_PREFERENCE',   label: 'User Preference',     icon: Settings2, hint: 'Arbitrary key/value settings usable by agents' },
];

const TYPE_COLOURS: Record<CredentialType, string> = {
  API_TOKEN:         'bg-violet-500/20 text-violet-300 border border-violet-500/30',
  USERNAME_PASSWORD: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  SSH_KEY:           'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  BASIC_AUTH:        'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  OAUTH2_CLIENT:     'bg-pink-500/20 text-pink-300 border border-pink-500/30',
  USER_PREFERENCE:   'bg-slate-500/20 text-slate-300 border border-slate-500/30',
};

const createSchema = z.object({
  name:         z.string().min(1),
  description:  z.string().optional(),
  scope:        z.enum(['USER', 'SYSTEM']),
  credentialType: z.enum(['API_TOKEN','USERNAME_PASSWORD','SSH_KEY','BASIC_AUTH','OAUTH2_CLIENT','USER_PREFERENCE']),
  // per-type fields (all optional at form level — validated on submit)
  token:        z.string().optional(),
  headerName:   z.string().optional(),
  username:     z.string().optional(),
  password:     z.string().optional(),
  privateKey:   z.string().optional(),
  passphrase:   z.string().optional(),
  clientId:     z.string().optional(),
  clientSecret: z.string().optional(),
  tokenUrl:     z.string().optional(),
  prefKey:      z.string().optional(),
  prefValue:    z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

function buildValue(form: CreateForm): Record<string, string> {
  switch (form.credentialType) {
    case 'API_TOKEN':
      return { token: form.token ?? '', ...(form.headerName ? { headerName: form.headerName } : {}) };
    case 'USERNAME_PASSWORD':
      return { username: form.username ?? '', password: form.password ?? '' };
    case 'SSH_KEY':
      return { privateKey: form.privateKey ?? '', ...(form.passphrase ? { passphrase: form.passphrase } : {}), ...(form.username ? { username: form.username } : {}) };
    case 'BASIC_AUTH':
      return { username: form.username ?? '', password: form.password ?? '' };
    case 'OAUTH2_CLIENT':
      return { clientId: form.clientId ?? '', clientSecret: form.clientSecret ?? '', ...(form.tokenUrl ? { tokenUrl: form.tokenUrl } : {}) };
    case 'USER_PREFERENCE':
      return { [form.prefKey ?? 'value']: form.prefValue ?? '' };
    default:
      return {};
  }
}

function TypeFields({ control, register, credentialType }: { control: any; register: any; credentialType: CredentialType }) {
  switch (credentialType) {
    case 'API_TOKEN':
      return <>
        <div className="space-y-1">
          <Label>Token / API Key <span className="text-red-400">*</span></Label>
          <Input {...register('token')} type="password" placeholder="sk-…" />
        </div>
        <div className="space-y-1">
          <Label>Header name <span className="text-muted-foreground text-xs">(default: Authorization)</span></Label>
          <Input {...register('headerName')} placeholder="X-API-Key" />
        </div>
      </>;
    case 'USERNAME_PASSWORD':
    case 'BASIC_AUTH':
      return <>
        <div className="space-y-1">
          <Label>Username <span className="text-red-400">*</span></Label>
          <Input {...register('username')} placeholder="admin" />
        </div>
        <div className="space-y-1">
          <Label>Password <span className="text-red-400">*</span></Label>
          <Input {...register('password')} type="password" placeholder="••••••••" />
        </div>
      </>;
    case 'SSH_KEY':
      return <>
        <div className="space-y-1 sm:col-span-2">
          <Label>Private Key (PEM) <span className="text-red-400">*</span></Label>
          <textarea {...register('privateKey')} rows={5}
            className="w-full rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] px-3 py-2 text-xs font-mono text-foreground resize-y"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
        </div>
        <div className="space-y-1">
          <Label>SSH Username</Label>
          <Input {...register('username')} placeholder="root" />
        </div>
        <div className="space-y-1">
          <Label>Passphrase <span className="text-muted-foreground text-xs">(if encrypted)</span></Label>
          <Input {...register('passphrase')} type="password" />
        </div>
      </>;
    case 'OAUTH2_CLIENT':
      return <>
        <div className="space-y-1">
          <Label>Client ID <span className="text-red-400">*</span></Label>
          <Input {...register('clientId')} placeholder="client_id" />
        </div>
        <div className="space-y-1">
          <Label>Client Secret <span className="text-red-400">*</span></Label>
          <Input {...register('clientSecret')} type="password" placeholder="client_secret" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Token URL <span className="text-muted-foreground text-xs">(optional override)</span></Label>
          <Input {...register('tokenUrl')} placeholder="https://auth.example.com/oauth/token" />
        </div>
      </>;
    case 'USER_PREFERENCE':
      return <>
        <div className="space-y-1">
          <Label>Key <span className="text-red-400">*</span></Label>
          <Input {...register('prefKey')} placeholder="preferred_language" />
        </div>
        <div className="space-y-1">
          <Label>Value</Label>
          <Input {...register('prefValue')} placeholder="en" />
        </div>
      </>;
    default:
      return null;
  }
}

export default function CredentialsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: creds = [], isLoading } = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<Credential[]>('/credentials'),
  });

  const createMutation = useMutation({
    mutationFn: (form: CreateForm) =>
      api.post<Credential>('/credentials', {
        name: form.name,
        description: form.description,
        scope: form.scope,
        credentialType: form.credentialType,
        value: buildValue(form),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['credentials'] });
      setShowForm(false);
      toast({ title: 'Credential stored securely' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/credentials/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['credentials'] }),
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { scope: 'SYSTEM', credentialType: 'API_TOKEN' },
  });
  const credType = useWatch({ control: form.control, name: 'credentialType' }) as CredentialType;
  const selectedTypeMeta = CRED_TYPES.find((t) => t.value === credType);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Credentials</h1>
          <p className="text-muted-foreground">AES-256-GCM encrypted secrets. Values are never shown after storage.</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4 mr-2" /> Add Credential
        </Button>
      </div>

      {/* Type picker row */}
      {showForm && (
        <div className="flex flex-wrap gap-2">
          {CRED_TYPES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => form.setValue('credentialType', value)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
                credType === value
                  ? 'bg-violet-600 border-violet-500 text-white shadow-lg shadow-violet-500/20'
                  : 'bg-[rgb(var(--bg-surface))] border-[rgb(var(--border))] text-muted-foreground hover:text-foreground hover:border-violet-500/50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {selectedTypeMeta && <selectedTypeMeta.icon className="h-5 w-5 text-violet-400" />}
              {selectedTypeMeta?.label ?? 'Add Credential'}
              <span className="text-sm font-normal text-muted-foreground ml-2">{selectedTypeMeta?.hint}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={form.handleSubmit((d) => createMutation.mutate(d))}
              className="grid gap-4 sm:grid-cols-2"
            >
              <div className="space-y-1">
                <Label>Name <span className="text-red-400">*</span></Label>
                <Input {...form.register('name')} placeholder={credType === 'USERNAME_PASSWORD' ? 'xco-admin' : credType === 'SSH_KEY' ? 'xco-ssh-key' : 'my-api-token'} />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input {...form.register('description')} placeholder="Optional notes" />
              </div>
              <div className="space-y-1">
                <Label>Scope</Label>
                <select {...form.register('scope')} className="flex h-10 w-full rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] px-3 py-2 text-sm text-foreground">
                  <option value="SYSTEM">SYSTEM (shared across agents)</option>
                  <option value="USER">USER (personal only)</option>
                </select>
              </div>

              {/* Per-type fields */}
              <TypeFields control={form.control} register={form.register} credentialType={credType} />

              <div className="sm:col-span-2 flex gap-2 pt-2">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Encrypting…' : 'Store Credential'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* List */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {creds.map((c) => {
                const meta = CRED_TYPES.find((t) => t.value === c.credentialType);
                const Icon = meta?.icon ?? Key;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium font-mono text-sm">{c.name}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TYPE_COLOURS[c.credentialType] ?? 'bg-gray-500/20 text-gray-300'}`}>
                        <Icon className="h-3 w-3" />
                        {meta?.label ?? c.credentialType}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.scope === 'SYSTEM' ? 'bg-blue-500/20 text-blue-300' : 'bg-gray-500/20 text-gray-400'}`}>
                        {c.scope}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.description ?? '—'}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(c.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && creds.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No credentials stored</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
