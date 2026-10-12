'use client';

import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot, Building2, CheckCircle2, Cloud, Edit2, Loader2,
  Plus, Send, Server, Smartphone, Star, Trash2, KeyRound,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

type LLMProvider = 'openai' | 'anthropic' | 'azure-openai' | 'ollama';
type NotifChannel = 'telegram' | 'teams' | 'whatsapp';

type LLMConfigRecord = {
  id: string; name: string; provider: LLMProvider; model: string;
  baseUrl?: string; isDefault: boolean; credentialId?: string;
};

type NotifStatus = {
  activeChannel: string | null;
  telegram?: { configured: boolean; botToken: string | null; chatId: string | null; botName?: string };
  teams?: { configured: boolean; webhookUrl: string | null };
  whatsapp?: { configured: boolean; twilioSid: string | null; fromNumber: string | null };
};

const PROVIDERS: { value: LLMProvider; label: string; color: string; Icon: React.ElementType; defaultModel: string; needsApiKey: boolean; needsBaseUrl: boolean; needsEndpoint: boolean }[] = [
  { value: 'openai',       label: 'OpenAI',       color: 'bg-emerald-600', Icon: Bot,    defaultModel: 'gpt-4o',                    needsApiKey: true,  needsBaseUrl: false, needsEndpoint: false },
  { value: 'anthropic',    label: 'Anthropic',    color: 'bg-violet-600',  Icon: Bot,    defaultModel: 'claude-3-5-sonnet-20241022', needsApiKey: true,  needsBaseUrl: false, needsEndpoint: false },
  { value: 'azure-openai', label: 'Azure OpenAI', color: 'bg-indigo-600',  Icon: Cloud,  defaultModel: 'gpt-4o',                    needsApiKey: true,  needsBaseUrl: false, needsEndpoint: true  },
  { value: 'ollama',       label: 'Ollama',       color: 'bg-orange-600',  Icon: Server, defaultModel: 'llama3',                    needsApiKey: false, needsBaseUrl: true,  needsEndpoint: false },
];

const PROVIDER_BADGE: Record<LLMProvider, string> = {
  openai:        'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25',
  anthropic:     'bg-violet-500/15 text-violet-300 border border-violet-500/25',
  'azure-openai':'bg-indigo-500/15 text-indigo-200 border border-indigo-500/25',
  ollama:        'bg-orange-500/15 text-orange-300 border border-orange-500/25',
};

const CHANNELS: { value: NotifChannel; label: string; Icon: React.ElementType }[] = [
  { value: 'telegram', label: 'Telegram',        Icon: Send },
  { value: 'teams',    label: 'Microsoft Teams', Icon: Building2 },
  { value: 'whatsapp', label: 'WhatsApp',        Icon: Smartphone },
];

const EMPTY_LLM = { name: '', provider: 'openai' as LLMProvider, model: 'gpt-4o', apiKey: '', baseUrl: '', endpoint: '', apiVersion: '2024-08-01-preview' };
const EMPTY_NOTIF = { botToken: '', chatId: '', webhookUrl: '', twilioSid: '', twilioAuth: '', fromNumber: '', toNumber: '' };

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

function TestBadge({ state, msg }: { state: TestState; msg?: string }) {
  if (state === 'idle') return null;
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium',
      state === 'testing' ? 'bg-[rgb(var(--bg-muted))] text-[rgb(var(--text-secondary))]' :
      state === 'ok'      ? 'bg-emerald-500/12 text-emerald-300 border border-emerald-500/20' :
                            'bg-red-500/12 text-red-300 border border-red-500/20',
    )}>
      {state === 'testing' && <Loader2 className="h-3 w-3 animate-spin" />}
      {state === 'ok'      && <CheckCircle2 className="h-3 w-3" />}
      {state === 'testing' ? 'Testing…' : state === 'ok' ? (msg ?? 'OK') : (msg ?? 'Failed')}
    </span>
  );
}

export default function ConfigPage() {
  const qc = useQueryClient();
  const [showAddLLM, setShowAddLLM] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_LLM);
  const [editForm, setEditForm] = useState<Partial<typeof EMPTY_LLM & { newApiKey?: string }>>({});
  const [llmTestStates, setLlmTestStates] = useState<Record<string, TestState>>({});
  const [llmTestMsgs, setLlmTestMsgs] = useState<Record<string, string>>({});

  const [notifChannel, setNotifChannel] = useState<NotifChannel>('telegram');
  const [notifFields, setNotifFields] = useState(EMPTY_NOTIF);
  const [notifTestState, setNotifTestState] = useState<TestState>('idle');

  const { data: rawConfigs, isLoading } = useQuery({
    queryKey: ['llm-configs'],
    queryFn: () => api.get<LLMConfigRecord[] | { data?: LLMConfigRecord[] }>('/llm-configs'),
  });
  const configs: LLMConfigRecord[] = Array.isArray(rawConfigs) ? rawConfigs : (rawConfigs as { data?: LLMConfigRecord[] })?.data ?? [];

  const { data: notifStatus } = useQuery<NotifStatus>({
    queryKey: ['notif-status'],
    queryFn: async () => {
      const res = await api.get<{ data?: NotifStatus }>('/setup/notifications');
      return (res as { data?: NotifStatus }).data ?? { activeChannel: null };
    },
  });

  // Set active channel tab based on what's configured
  useEffect(() => {
    if (notifStatus?.activeChannel && CHANNELS.some(c => c.value === notifStatus.activeChannel)) {
      setNotifChannel(notifStatus.activeChannel as NotifChannel);
    }
  }, [notifStatus]);

  const addMutation = useMutation({
    mutationFn: (data: typeof form) => api.post('/llm-configs', { ...data, isDefault: configs.length === 0 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['llm-configs'] }); setShowAddLLM(false); setForm(EMPTY_LLM); toast({ title: 'LLM config added' }); },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<typeof EMPTY_LLM & { newApiKey?: string }> }) =>
      api.patch(`/llm-configs/${id}`, { ...data, ...(data.newApiKey ? { apiKey: data.newApiKey } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['llm-configs'] }); setEditingId(null); toast({ title: 'Config updated' }); },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const defaultMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/llm-configs/${id}`, { isDefault: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['llm-configs'] }); toast({ title: 'Default LLM updated' }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/llm-configs/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['llm-configs'] }); toast({ title: 'Config deleted' }); },
  });

  async function testLLM(id: string) {
    setLlmTestStates(s => ({ ...s, [id]: 'testing' }));
    setLlmTestMsgs(s => ({ ...s, [id]: '' }));
    try {
      await api.post(`/llm-configs/${id}/test`);
      setLlmTestStates(s => ({ ...s, [id]: 'ok' }));
      setLlmTestMsgs(s => ({ ...s, [id]: 'Connected' }));
    } catch (e) {
      setLlmTestStates(s => ({ ...s, [id]: 'fail' }));
      setLlmTestMsgs(s => ({ ...s, [id]: (e as Error).message }));
    }
  }

  async function testNotif() {
    setNotifTestState('testing');
    let payload: Record<string, string> = { channel: notifChannel };
    if (notifChannel === 'telegram') payload = { ...payload, botToken: notifFields.botToken, chatId: notifFields.chatId };
    else if (notifChannel === 'teams') payload = { ...payload, webhookUrl: notifFields.webhookUrl };
    else payload = { ...payload, twilioSid: notifFields.twilioSid, twilioAuth: notifFields.twilioAuth, fromNumber: notifFields.fromNumber, toNumber: notifFields.toNumber };
    try {
      await api.post('/setup/notifications/test', payload);
      setNotifTestState('ok');
    } catch (e) {
      setNotifTestState('fail');
      toast({ title: 'Test failed', description: (e as Error).message, variant: 'destructive' });
    }
  }

  async function saveNotif() {
    let payload: Record<string, string> = { channel: notifChannel };
    if (notifChannel === 'telegram') payload = { ...payload, TELEGRAM_BOT_TOKEN: notifFields.botToken, TELEGRAM_APPROVAL_CHAT_ID: notifFields.chatId };
    else if (notifChannel === 'teams') payload = { ...payload, TEAMS_WEBHOOK_URL: notifFields.webhookUrl };
    else payload = { ...payload, TWILIO_ACCOUNT_SID: notifFields.twilioSid, TWILIO_AUTH_TOKEN: notifFields.twilioAuth, TWILIO_WHATSAPP_FROM: notifFields.fromNumber, WHATSAPP_APPROVAL_TO: notifFields.toNumber };
    try {
      await api.post('/setup/notifications', payload);
      qc.invalidateQueries({ queryKey: ['notif-status'] });
      toast({ title: 'Notification channel saved' });
    } catch (e) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  }

  const selectedProvider = PROVIDERS.find(p => p.value === form.provider)!;
  const isSaveDisabled = !form.name || !form.model ||
    (selectedProvider.needsApiKey && !form.apiKey) ||
    (selectedProvider.needsBaseUrl && !form.baseUrl) ||
    (selectedProvider.needsEndpoint && !form.endpoint) ||
    addMutation.isPending;

  return (
    <div className="max-w-3xl mx-auto space-y-10 py-2">
      <div>
        <h1 className="text-xl font-bold text-[rgb(var(--text-primary))]">Configuration</h1>
        <p className="text-sm text-[rgb(var(--text-secondary))] mt-0.5">Manage LLM providers and notification channels.</p>
      </div>

      {/* ─── LLM Providers ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[rgb(var(--text-primary))]">LLM Providers</h2>
            <p className="text-xs text-[rgb(var(--text-muted))] mt-0.5">The default provider is used for all agent requests.</p>
          </div>
          <button
            onClick={() => { setShowAddLLM(v => !v); setForm(EMPTY_LLM); }}
            className="flex items-center gap-1.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-1.5 text-xs font-medium text-[rgb(var(--text-secondary))] hover:border-[rgba(130,100,200,0.18)] hover:text-[rgb(var(--text-primary))] transition-all"
          >
            <Plus className="h-3.5 w-3.5" /> Add Provider
          </button>
        </div>

        {/* Add form */}
        {showAddLLM && (
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] p-5 space-y-4">
            <p className="text-xs font-semibold text-[rgb(var(--text-secondary))] uppercase tracking-wider">New Provider</p>
            <div className="grid grid-cols-4 gap-2">
              {PROVIDERS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setForm(v => ({ ...v, provider: p.value, model: p.defaultModel, apiKey: '', baseUrl: '', endpoint: '', apiVersion: '2024-08-01-preview' }))}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-all',
                    form.provider === p.value
                      ? 'border-[rgba(130,100,200,0.25)] bg-[rgba(130,100,200,0.06)] text-[rgb(var(--text-primary))]'
                      : 'border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:border-[rgb(var(--border-subtle))] hover:text-[rgb(var(--text-primary))]',
                  )}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${p.color}`}>
                    <p.Icon className="h-4 w-4 text-white" />
                  </span>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">Name</label>
                <input
                  placeholder="e.g. GPT-4o Production"
                  value={form.name}
                  onChange={e => setForm(v => ({ ...v, name: e.target.value }))}
                  className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">Model</label>
                <input
                  value={form.model}
                  onChange={e => setForm(v => ({ ...v, model: e.target.value }))}
                  className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                />
              </div>
            </div>
            {selectedProvider.needsBaseUrl ? (
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">Ollama Base URL</label>
                <input
                  placeholder="http://192.168.1.10:11434"
                  value={form.baseUrl}
                  onChange={e => setForm(v => ({ ...v, baseUrl: e.target.value }))}
                  className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                />
              </div>
            ) : selectedProvider.needsEndpoint ? (
              <div className="space-y-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">Azure Configuration</p>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">Endpoint URL *</label>
                  <input
                    placeholder="https://my-resource.openai.azure.com/"
                    value={form.endpoint}
                    onChange={e => setForm(v => ({ ...v, endpoint: e.target.value }))}
                    className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">API Version</label>
                  <input
                    placeholder="2024-08-01-preview"
                    value={form.apiVersion}
                    onChange={e => setForm(v => ({ ...v, apiVersion: e.target.value }))}
                    className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">API Key *</label>
                  <input
                    type="password"
                    placeholder="Azure OpenAI API key"
                    value={form.apiKey}
                    onChange={e => setForm(v => ({ ...v, apiKey: e.target.value }))}
                    className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">API Key</label>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={form.apiKey}
                  onChange={e => setForm(v => ({ ...v, apiKey: e.target.value }))}
                  className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAddLLM(false)} className="rounded-lg border border-[rgb(var(--border))] px-3.5 py-1.5 text-xs text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] transition-colors">Cancel</button>
              <button
                disabled={isSaveDisabled}
                onClick={() => addMutation.mutate(form)}
                className="rounded-lg bg-[rgba(130,100,200,0.7)] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[rgba(130,100,200,0.85)] disabled:opacity-40 transition-colors"
              >
                {addMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Config list */}
        <div className="rounded-xl border border-[rgb(var(--border))] overflow-hidden">
          {isLoading ? (
            <div className="p-6 text-sm text-[rgb(var(--text-muted))]">Loading…</div>
          ) : configs.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-[rgb(var(--text-muted))]">No LLM providers configured.</p>
              <button onClick={() => setShowAddLLM(true)} className="mt-2 text-xs text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] transition-colors">Add your first provider →</button>
            </div>
          ) : (
            <div className="divide-y divide-[rgb(var(--border))]">
              {configs.map((cfg, i) => (
                <div key={cfg.id}>
                  <div className={cn('flex items-center gap-3 px-4 py-3', i % 2 === 0 ? 'bg-[rgb(var(--bg-surface))]' : 'bg-[rgb(var(--bg-base))]')}>
                    <div className="flex-1 min-w-0 flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[rgb(var(--text-primary))]">{cfg.name}</span>
                          {cfg.isDefault && (
                            <span className="rounded-full bg-[rgba(130,100,200,0.1)] border border-[rgba(130,100,200,0.18)] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--text-secondary))]">Default</span>
                          )}
                          {cfg.credentialId && (
                            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">Key set</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', PROVIDER_BADGE[cfg.provider])}>
                            {PROVIDERS.find(p => p.value === cfg.provider)?.label ?? cfg.provider}
                          </span>
                          <span className="text-xs text-[rgb(var(--text-muted))]">{cfg.model}{cfg.baseUrl ? ` @ ${cfg.baseUrl}` : ''}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <TestBadge state={llmTestStates[cfg.id] ?? 'idle'} msg={llmTestMsgs[cfg.id]} />
                      <button onClick={() => testLLM(cfg.id)} disabled={llmTestStates[cfg.id] === 'testing'} className="rounded-lg border border-[rgb(var(--border))] px-2.5 py-1 text-[10px] font-medium text-[rgb(var(--text-secondary))] hover:border-[rgba(130,100,200,0.18)] hover:text-[rgb(var(--text-primary))] disabled:opacity-40 transition-all">
                        Test
                      </button>
                      {!cfg.isDefault && (
                        <button onClick={() => defaultMutation.mutate(cfg.id)} title="Set as default" className="rounded-lg border border-[rgb(var(--border))] px-2.5 py-1 text-[10px] font-medium text-[rgb(var(--text-secondary))] hover:border-[rgba(130,100,200,0.18)] hover:text-[rgb(var(--text-primary))] transition-all">
                          <Star className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingId(editingId === cfg.id ? null : cfg.id); setEditForm({ name: cfg.name, model: cfg.model, baseUrl: cfg.baseUrl, newApiKey: '' }); }}
                        className="rounded-lg border border-[rgb(var(--border))] px-2.5 py-1 text-[10px] font-medium text-[rgb(var(--text-secondary))] hover:border-[rgba(130,100,200,0.18)] hover:text-[rgb(var(--text-primary))] transition-all"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(cfg.id)}
                        disabled={deleteMutation.isPending}
                        className="rounded-lg border border-[rgb(var(--border))] px-2.5 py-1 text-[10px] font-medium text-red-400/60 hover:border-red-500/30 hover:text-red-400 disabled:opacity-40 transition-all"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {/* Inline edit */}
                  {editingId === cfg.id && (
                    <div className="px-4 py-3 bg-[rgb(var(--bg-muted))] border-t border-[rgb(var(--border))] space-y-3">
                      <div className="flex gap-3 items-end">
                        <div className="space-y-1 flex-1">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">Name</label>
                          <input
                            value={editForm.name ?? ''}
                            onChange={e => setEditForm(v => ({ ...v, name: e.target.value }))}
                            className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-1.5 text-sm text-[rgb(var(--text-primary))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                          />
                        </div>
                        <div className="space-y-1 flex-1">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">Model</label>
                          <input
                            value={editForm.model ?? ''}
                            onChange={e => setEditForm(v => ({ ...v, model: e.target.value }))}
                            className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-1.5 text-sm text-[rgb(var(--text-primary))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                          />
                        </div>
                        {cfg.provider === 'ollama' && (
                          <div className="space-y-1 flex-1">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">Base URL</label>
                            <input
                              value={editForm.baseUrl ?? cfg.baseUrl ?? ''}
                              onChange={e => setEditForm(v => ({ ...v, baseUrl: e.target.value }))}
                              className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-1.5 text-sm text-[rgb(var(--text-primary))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                            />
                          </div>
                        )}
                      </div>
                      {cfg.provider !== 'ollama' && (
                        <div className="space-y-1">
                          <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">
                            <KeyRound className="h-3 w-3" />
                            Rotate API Key <span className="text-[rgb(var(--text-muted))] normal-case font-normal">(leave blank to keep existing)</span>
                          </label>
                          <input
                            type="password"
                            placeholder="sk-… (new key)"
                            value={editForm.newApiKey ?? ''}
                            onChange={e => setEditForm(v => ({ ...v, newApiKey: e.target.value }))}
                            className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-1.5 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                          />
                        </div>
                      )}
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setEditingId(null)} className="rounded-lg border border-[rgb(var(--border))] px-3 py-1.5 text-xs text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] transition-colors">Cancel</button>
                        <button
                          onClick={() => updateMutation.mutate({ id: cfg.id, data: editForm })}
                          disabled={updateMutation.isPending}
                          className="rounded-lg bg-[rgba(130,100,200,0.7)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[rgba(130,100,200,0.85)] disabled:opacity-40 transition-colors"
                        >
                          {updateMutation.isPending ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ─── Notification Channels ─────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-[rgb(var(--text-primary))]">Notification Channels</h2>
          <p className="text-xs text-[rgb(var(--text-muted))] mt-0.5">Used to send approval requests and alerts.</p>
        </div>

        {/* Currently configured channel summary */}
        {notifStatus && (
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map(ch => {
              const chData = notifStatus[ch.value as keyof NotifStatus] as { configured?: boolean; botName?: string; webhookUrl?: string | null; fromNumber?: string | null } | undefined;
              const isActive = notifStatus.activeChannel === ch.value;
              const isConfigured = !!chData?.configured;
              if (!isConfigured) return null;
              return (
                <div key={ch.value} className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs',
                  isActive
                    ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-300'
                    : 'border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--text-secondary))]',
                )}>
                  <ch.Icon className="h-3.5 w-3.5" />
                  <span className="font-medium">{ch.label}</span>
                  {ch.value === 'telegram' && (chData as { botName?: string })?.botName && (
                    <span className="text-[rgb(var(--text-muted))]">{(chData as { botName?: string }).botName}</span>
                  )}
                  {ch.value === 'teams' && (chData as { webhookUrl?: string | null })?.webhookUrl && (
                    <span className="text-[rgb(var(--text-muted))] font-mono text-[10px]">{String((chData as { webhookUrl?: string | null }).webhookUrl).slice(0, 30)}…</span>
                  )}
                  {ch.value === 'whatsapp' && (chData as { fromNumber?: string | null })?.fromNumber && (
                    <span className="text-[rgb(var(--text-muted))]">{String((chData as { fromNumber?: string | null }).fromNumber)}</span>
                  )}
                  {isActive && <CheckCircle2 className="h-3 w-3 ml-1" />}
                </div>
              );
            })}
          </div>
        )}

        <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] p-5 space-y-4">
          {/* Channel selector */}
          <div className="flex gap-2">
            {CHANNELS.map(ch => {
              const isConfigured = !!(notifStatus?.[ch.value as keyof NotifStatus] as { configured?: boolean } | undefined)?.configured;
              return (
                <button
                  key={ch.value}
                  onClick={() => { setNotifChannel(ch.value); setNotifTestState('idle'); setNotifFields(EMPTY_NOTIF); }}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition-all',
                    notifChannel === ch.value
                      ? 'border-[rgba(130,100,200,0.25)] bg-[rgba(130,100,200,0.06)] text-[rgb(var(--text-primary))]'
                      : 'border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] hover:border-[rgb(var(--border-subtle))]',
                  )}
                >
                  <ch.Icon className="h-3.5 w-3.5" />
                  {ch.label}
                  {isConfigured && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                </button>
              );
            })}
          </div>

          {/* Channel fields */}
          {notifChannel === 'telegram' && (
            <div className="space-y-3">
              {notifStatus?.telegram?.botName && (
                <div className="flex items-center gap-2 rounded-lg bg-[rgb(var(--bg-muted))] border border-[rgb(var(--border))] px-3 py-2">
                  <Send className="h-3.5 w-3.5 text-[rgb(var(--text-muted))]" />
                  <span className="text-xs text-[rgb(var(--text-secondary))]">Connected as</span>
                  <span className="text-xs font-semibold text-[rgb(var(--text-primary))]">{notifStatus.telegram.botName}</span>
                  {notifStatus.telegram.chatId && (
                    <span className="ml-auto text-xs text-[rgb(var(--text-muted))]">Chat: {notifStatus.telegram.chatId}</span>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">
                    Bot Token {notifStatus?.telegram?.configured && <span className="text-emerald-400 normal-case font-normal">(set — leave blank to keep)</span>}
                  </label>
                  <input
                    type="password"
                    placeholder={notifStatus?.telegram?.configured ? '••••••' : '123456:ABC-...'}
                    value={notifFields.botToken}
                    onChange={e => setNotifFields(v => ({ ...v, botToken: e.target.value }))}
                    className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">Chat ID</label>
                  <input
                    placeholder={notifStatus?.telegram?.chatId ?? 'e.g. 6878129583'}
                    value={notifFields.chatId}
                    onChange={e => setNotifFields(v => ({ ...v, chatId: e.target.value }))}
                    className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                  />
                </div>
              </div>
            </div>
          )}
          {notifChannel === 'teams' && (
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">
                Incoming Webhook URL {notifStatus?.teams?.configured && <span className="text-emerald-400 normal-case font-normal">(set — paste new URL to replace)</span>}
              </label>
              <input
                placeholder={notifStatus?.teams?.webhookUrl ?? 'https://outlook.office.com/webhook/...'}
                value={notifFields.webhookUrl}
                onChange={e => setNotifFields(v => ({ ...v, webhookUrl: e.target.value }))}
                className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
              />
            </div>
          )}
          {notifChannel === 'whatsapp' && (
            <div className="grid grid-cols-2 gap-3">
              {(['twilioSid', 'twilioAuth', 'fromNumber', 'toNumber'] as const).map((key) => {
                const labels: Record<string, string> = { twilioSid: 'Account SID', twilioAuth: 'Auth Token', fromNumber: 'From Number', toNumber: 'To Number' };
                const isSet = key === 'twilioSid' && notifStatus?.whatsapp?.twilioSid;
                return (
                  <div key={key} className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">
                      {labels[key]}{isSet ? <span className="text-emerald-400 normal-case font-normal ml-1">(set)</span> : ''}
                    </label>
                    <input
                      type={key === 'twilioAuth' || key === 'twilioSid' ? 'password' : 'text'}
                      placeholder={key === 'fromNumber' && notifStatus?.whatsapp?.fromNumber ? String(notifStatus.whatsapp.fromNumber) : undefined}
                      value={notifFields[key]}
                      onChange={e => setNotifFields(v => ({ ...v, [key]: e.target.value }))}
                      className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-[rgba(130,100,200,0.25)] focus:outline-none transition-colors"
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <TestBadge state={notifTestState} />
            <div className="flex gap-2 ml-auto">
              <button onClick={testNotif} disabled={notifTestState === 'testing'} className="rounded-lg border border-[rgb(var(--border))] px-3.5 py-1.5 text-xs font-medium text-[rgb(var(--text-secondary))] hover:border-[rgba(130,100,200,0.18)] hover:text-[rgb(var(--text-primary))] disabled:opacity-40 transition-all">
                {notifTestState === 'testing' ? 'Testing…' : 'Test'}
              </button>
              <button onClick={saveNotif} className="rounded-lg bg-[rgba(130,100,200,0.7)] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[rgba(130,100,200,0.85)] transition-colors">
                Save
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
