'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Star, Bot, Layers, Cloud, CheckCircle, Server } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type LLMProvider = 'openai' | 'anthropic' | 'azure-openai' | 'ollama';

type LLMConfig = {
  id: string;
  name: string;
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  isDefault: boolean;
  credentialId?: string;
  createdAt: string;
};

const PROVIDERS: { value: LLMProvider; label: string; color: string; Icon: React.ElementType; defaultModel: string; needsApiKey: boolean; needsBaseUrl: boolean }[] = [
  { value: 'openai', label: 'OpenAI', color: 'bg-emerald-500', Icon: Bot, defaultModel: 'gpt-4o', needsApiKey: true, needsBaseUrl: false },
  { value: 'anthropic', label: 'Anthropic', color: 'bg-violet-600', Icon: Layers, defaultModel: 'claude-3-5-sonnet-20241022', needsApiKey: true, needsBaseUrl: false },
  { value: 'azure-openai', label: 'Azure OpenAI', color: 'bg-indigo-600', Icon: Cloud, defaultModel: 'gpt-4o', needsApiKey: true, needsBaseUrl: false },
  { value: 'ollama', label: 'Ollama', color: 'bg-orange-500', Icon: Server, defaultModel: 'llama3', needsApiKey: false, needsBaseUrl: true },
];

const PROVIDER_COLOURS: Record<LLMProvider, string> = {
  openai: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  anthropic: 'bg-violet-500/15 text-violet-200 border border-violet-500/28',
  'azure-openai': 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/28',
  ollama: 'bg-orange-500/20 text-orange-300 border border-orange-500/30',
};

const EMPTY_FORM = {
  name: '',
  provider: 'openai' as LLMProvider,
  model: 'gpt-4o',
  apiKey: '',
  baseUrl: '',
  isDefault: false,
};

export default function LLMConfigsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: configs = [], isLoading } = useQuery<LLMConfig[]>({
    queryKey: ['llm-configs'],
    queryFn: async () => {
      const res = await api.get<{ data?: LLMConfig[] }>('/llm-configs');
      return (res as { data?: LLMConfig[] }).data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => api.post('/llm-configs', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['llm-configs'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
      toast({ title: 'LLM config added' });
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const defaultMutation = useMutation({
    mutationFn: async (id: string) => api.patch(`/llm-configs/${id}`, { isDefault: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['llm-configs'] });
      toast({ title: 'Default LLM updated' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/llm-configs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['llm-configs'] });
      toast({ title: 'LLM config removed' });
    },
  });

  const selectedProvider = PROVIDERS.find((p) => p.value === form.provider);
  const isSaveDisabled =
    !form.name ||
    (selectedProvider?.needsApiKey && !form.apiKey) ||
    (selectedProvider?.needsBaseUrl && !form.baseUrl) ||
    createMutation.isPending;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">LLM Configurations</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Register and manage AI provider configurations. The default is used for all agent requests.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4 mr-2" /> Add Configuration
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>New LLM Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Provider selector */}
            <div className="space-y-2">
              <Label>Provider</Label>
              <div className="grid grid-cols-4 gap-3">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setForm((v) => ({ ...v, provider: p.value, model: p.defaultModel, apiKey: '', baseUrl: '' }))}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm font-medium transition-colors',
                      form.provider === p.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50',
                    )}
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${p.color}`}>
                      <p.Icon className="h-5 w-5 text-white" />
                    </span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  placeholder={`${selectedProvider?.label ?? 'OpenAI'} Production`}
                  value={form.name}
                  onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Model</Label>
                <Input
                  placeholder={selectedProvider?.defaultModel ?? 'gpt-4o'}
                  value={form.model}
                  onChange={(e) => setForm((v) => ({ ...v, model: e.target.value }))}
                />
              </div>
            </div>

            {/* Ollama: show Base URL; other providers: show API Key */}
            {selectedProvider?.needsBaseUrl ? (
              <div className="space-y-1">
                <Label>Ollama Base URL</Label>
                <Input
                  placeholder="http://192.168.1.10:11434"
                  value={form.baseUrl}
                  onChange={(e) => setForm((v) => ({ ...v, baseUrl: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Remote or local Ollama instance. No API key needed — Ollama&apos;s OpenAI-compatible API is used.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>API Key</Label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={form.apiKey}
                  onChange={(e) => setForm((v) => ({ ...v, apiKey: e.target.value }))}
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isDefault"
                checked={form.isDefault}
                onChange={(e) => setForm((v) => ({ ...v, isDefault: e.target.checked }))}
                className="h-4 w-4"
              />
              <Label htmlFor="isDefault" className="cursor-pointer">Set as default</Label>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button
                disabled={isSaveDisabled}
                onClick={() => createMutation.mutate(form)}
              >
                {createMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground text-sm">Loading…</div>
          ) : configs.length === 0 ? (
            <div className="p-6 text-muted-foreground text-sm">
              No LLM configurations yet. Add one above or use <code className="bg-muted px-1 rounded">bex llm add</code>.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Model / Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {configs.map((cfg) => (
                  <TableRow key={cfg.id}>
                    <TableCell className="font-medium">{cfg.name}</TableCell>
                    <TableCell>
                      <span className={cn('rounded px-2 py-0.5 text-xs font-medium', PROVIDER_COLOURS[cfg.provider] ?? 'bg-slate-700 text-slate-200')}>
                        {PROVIDERS.find((p) => p.value === cfg.provider)?.label ?? cfg.provider}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      <span>{cfg.model}</span>
                      {cfg.baseUrl && (
                        <span className="ml-2 text-xs text-slate-500">@ {cfg.baseUrl}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {cfg.isDefault ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle className="h-3 w-3" /> Default
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => defaultMutation.mutate(cfg.id)}
                          disabled={defaultMutation.isPending}
                        >
                          <Star className="h-3 w-3 mr-1" /> Set default
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(cfg.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
