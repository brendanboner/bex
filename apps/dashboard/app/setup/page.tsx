'use client';

import React, { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Check, ChevronLeft, ChevronRight, Settings, Send, Building2,
  Smartphone, AlertCircle, Loader2, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

type LLMProvider = 'openai' | 'anthropic' | 'azure-openai' | 'ollama';
type NotificationChannel = 'telegram' | 'teams' | 'whatsapp';

type LLMConfig = {
  provider: LLMProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
};

type LLMConfigRecord = {
  id: string;
  name: string;
  provider: LLMProvider;
  model: string;
  baseUrl?: string;
  isDefault: boolean;
};

type NotificationConfig = {
  channel: NotificationChannel;
  botToken: string;
  chatId: string;
  webhookUrl: string;
  twilioSid: string;
  twilioAuth: string;
  fromNumber: string;
  toNumber: string;
};

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  'azure-openai': 'gpt-4o',
  ollama: 'llama3',
};

const PROVIDERS: { value: LLMProvider; label: string; needsApiKey: boolean; needsBaseUrl: boolean; placeholder: string }[] = [
  { value: 'openai',      label: 'OpenAI',       needsApiKey: true,  needsBaseUrl: false, placeholder: 'gpt-4o' },
  { value: 'anthropic',   label: 'Anthropic',    needsApiKey: true,  needsBaseUrl: false, placeholder: 'claude-3-5-sonnet-20241022' },
  { value: 'azure-openai',label: 'Azure OpenAI', needsApiKey: true,  needsBaseUrl: false, placeholder: 'gpt-4o' },
  { value: 'ollama',      label: 'Ollama',       needsApiKey: false, needsBaseUrl: true,  placeholder: 'llama3' },
];

const CHANNELS: { value: NotificationChannel; label: string; Icon: React.ElementType }[] = [
  { value: 'telegram', label: 'Telegram',         Icon: Send },
  { value: 'teams',    label: 'Microsoft Teams',  Icon: Building2 },
  { value: 'whatsapp', label: 'WhatsApp',         Icon: Smartphone },
];

const STEPS = ['LLM Provider', 'Notifications', 'Done'];

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testMsg, setTestMsg] = useState('');
  const [notifTestState, setNotifTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  const [llm, setLlm] = useState<LLMConfig>({
    provider: 'openai', apiKey: '', baseUrl: '', model: DEFAULT_MODELS.openai,
  });

  const [notif, setNotif] = useState<NotificationConfig>({
    channel: 'telegram', botToken: '', chatId: '', webhookUrl: '',
    twilioSid: '', twilioAuth: '', fromNumber: '', toNumber: '',
  });

  // Load existing LLM configs to pre-populate and allow skipping
  const { data: existingConfigs = [] } = useQuery<LLMConfigRecord[]>({
    queryKey: ['llm-configs-setup'],
    queryFn: async () => {
      const res = await api.get<{ data?: LLMConfigRecord[] }>('/llm-configs');
      return (res as { data?: LLMConfigRecord[] }).data ?? [];
    },
  });

  const defaultConfig = existingConfigs.find((c) => c.isDefault) ?? existingConfigs[0];

  // Pre-fill form from existing default config
  useEffect(() => {
    if (defaultConfig) {
      setLlm((v) => ({
        ...v,
        provider: defaultConfig.provider,
        model: defaultConfig.model,
        baseUrl: defaultConfig.baseUrl ?? '',
      }));
    }
  }, [defaultConfig?.id]);

  const llmMutation = useMutation({
    mutationFn: () => api.post('/setup/llm', {
      provider: llm.provider,
      apiKey: llm.apiKey || undefined,
      baseUrl: llm.baseUrl || undefined,
      model: llm.model,
    }),
    onSuccess: () => { toast({ title: 'LLM configured' }); setStep(1); },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  const notifMutation = useMutation({
    mutationFn: () => api.post('/setup/notifications', buildNotifPayload()),
    onSuccess: () => { toast({ title: 'Notification channel configured' }); setStep(2); },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  function buildNotifPayload() {
    const base = { channel: notif.channel };
    if (notif.channel === 'telegram') return { ...base, botToken: notif.botToken, chatId: notif.chatId };
    if (notif.channel === 'teams') return { ...base, webhookUrl: notif.webhookUrl };
    return { ...base, twilioSid: notif.twilioSid, twilioAuth: notif.twilioAuth, fromNumber: notif.fromNumber, toNumber: notif.toNumber };
  }

  function handleProviderChange(p: LLMProvider) {
    setLlm({ provider: p, model: DEFAULT_MODELS[p], apiKey: '', baseUrl: '' });
    setTestState('idle');
  }

  async function testLLM() {
    // If there's an existing config and no new credentials, test the existing one
    if (defaultConfig && !llm.apiKey && !llm.baseUrl) {
      setTestState('testing');
      try {
        await api.post(`/llm-configs/${defaultConfig.id}/test`);
        setTestState('ok');
        setTestMsg('Connection successful');
      } catch (e) {
        setTestState('fail');
        setTestMsg((e as Error).message);
      }
      return;
    }
    // Otherwise save first, then test
    setTestState('testing');
    try {
      await api.post('/setup/llm', {
        provider: llm.provider,
        apiKey: llm.apiKey || undefined,
        baseUrl: llm.baseUrl || undefined,
        model: llm.model,
        name: `${llm.provider} (setup)`,
      });
      // Reload to get the new id
      const res = await api.get<{ data?: LLMConfigRecord[] }>('/llm-configs');
      const configs = (res as { data?: LLMConfigRecord[] }).data ?? [];
      const saved = configs.find((c) => c.isDefault) ?? configs[0];
      if (saved) {
        await api.post(`/llm-configs/${saved.id}/test`);
        setTestState('ok');
        setTestMsg('Connection successful — LLM is responding');
      }
    } catch (e) {
      setTestState('fail');
      setTestMsg((e as Error).message.replace('Connection failed: ', ''));
    }
  }

  async function testNotification() {
    setNotifTestState('testing');
    try {
      await api.post('/setup/notifications/test', buildNotifPayload());
      setNotifTestState('ok');
    } catch (e) {
      setNotifTestState('fail');
      toast({ title: 'Test failed', description: (e as Error).message, variant: 'destructive' });
    }
  }

  const selectedProvider = PROVIDERS.find((p) => p.value === llm.provider)!;
  const alreadyConfigured = !!defaultConfig;

  // Next button logic: if already configured AND no new credentials entered, allow skip
  const canProceedLLM = alreadyConfigured
    ? true
    : selectedProvider.needsApiKey
      ? !!llm.apiKey
      : !!llm.baseUrl;

  const hasNewCredentials = selectedProvider.needsApiKey ? !!llm.apiKey : !!llm.baseUrl;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="h-7 w-7" /> Configuration
        </h1>
        <p className="text-muted-foreground">Set up or reconfigure your platform</p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <button
              onClick={() => i < step && setStep(i)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold border-2 transition-colors',
                i < step
                  ? 'border-green-500 bg-green-500 text-white cursor-pointer'
                  : i === step
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground text-muted-foreground',
              )}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </button>
            <span className={cn('text-sm font-medium', i === step ? 'text-foreground' : 'text-muted-foreground')}>
              {label}
            </span>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step 0 — LLM */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>LLM Provider</CardTitle>
            <CardDescription>
              {alreadyConfigured
                ? `Currently using ${PROVIDERS.find((p) => p.value === defaultConfig.provider)?.label} — ${defaultConfig.model}. Update credentials below or skip to next step.`
                : 'Choose your AI provider and enter credentials'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Already-configured banner */}
            {alreadyConfigured && (
              <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                <div className="flex-1 text-sm">
                  <span className="font-medium text-green-300">{defaultConfig.name}</span>
                  <span className="text-muted-foreground ml-2">{defaultConfig.provider} / {defaultConfig.model}
                    {defaultConfig.baseUrl ? ` @ ${defaultConfig.baseUrl}` : ''}</span>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setStep(1)}>
                  Skip <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {/* Provider selector — text pills only */}
            <div className="space-y-2">
              <Label>Provider</Label>
              <div className="flex flex-wrap gap-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => handleProviderChange(p.value)}
                    className={cn(
                      'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                      llm.provider === p.value
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Credential field */}
            {selectedProvider.needsBaseUrl ? (
              <div className="space-y-1">
                <Label>Ollama Base URL</Label>
                <Input
                  placeholder="http://192.168.1.10:11434"
                  value={llm.baseUrl}
                  onChange={(e) => setLlm((v) => ({ ...v, baseUrl: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Remote or local Ollama instance — no API key required.</p>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>API Key {alreadyConfigured && <span className="text-muted-foreground font-normal">(leave blank to keep existing)</span>}</Label>
                <Input
                  type="password"
                  placeholder={alreadyConfigured ? '••••••••• (unchanged)' : 'sk-...'}
                  value={llm.apiKey}
                  onChange={(e) => setLlm((v) => ({ ...v, apiKey: e.target.value }))}
                />
              </div>
            )}

            <div className="space-y-1">
              <Label>Model</Label>
              <Input
                placeholder={selectedProvider.placeholder}
                value={llm.model}
                onChange={(e) => setLlm((v) => ({ ...v, model: e.target.value }))}
              />
            </div>

            {/* Test result */}
            {testState !== 'idle' && (
              <div className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                testState === 'ok' ? 'bg-green-500/10 text-green-300 border border-green-500/20' :
                testState === 'fail' ? 'bg-red-500/10 text-red-300 border border-red-500/20' :
                'bg-muted text-muted-foreground',
              )}>
                {testState === 'testing' && <Loader2 className="h-4 w-4 animate-spin" />}
                {testState === 'ok' && <CheckCircle2 className="h-4 w-4" />}
                {testState === 'fail' && <AlertCircle className="h-4 w-4" />}
                <span>{testState === 'testing' ? 'Testing connection…' : testMsg}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testLLM}
                  disabled={
                    testState === 'testing' ||
                    (!alreadyConfigured && !hasNewCredentials)
                  }
                  className="gap-1.5"
                >
                  {testState === 'testing'
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing…</>
                    : <><RefreshCw className="h-3.5 w-3.5" /> Test Connection</>}
                </Button>
              </div>
              <Button
                onClick={() => {
                  if (alreadyConfigured && !hasNewCredentials) {
                    setStep(1);
                  } else {
                    llmMutation.mutate();
                  }
                }}
                disabled={!canProceedLLM || llmMutation.isPending}
              >
                {llmMutation.isPending ? 'Saving…' : 'Next'} <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1 — Notifications */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Notification Channel</CardTitle>
            <CardDescription>Configure how agents send alerts and approval requests</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Channel selector — text pills */}
            <div className="space-y-2">
              <Label>Channel</Label>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => { setNotif((v) => ({ ...v, channel: c.value })); setNotifTestState('idle'); }}
                    className={cn(
                      'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                      notif.channel === c.value
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {notif.channel === 'telegram' && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label>Bot Token</Label>
                  <Input
                    type="password"
                    placeholder="123456:ABC-DEF..."
                    value={notif.botToken}
                    onChange={(e) => setNotif((v) => ({ ...v, botToken: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Chat ID</Label>
                  <Input
                    placeholder="-1001234567890"
                    value={notif.chatId}
                    onChange={(e) => setNotif((v) => ({ ...v, chatId: e.target.value }))}
                  />
                </div>
              </div>
            )}

            {notif.channel === 'teams' && (
              <div className="space-y-1">
                <Label>Webhook URL</Label>
                <Input
                  placeholder="https://outlook.office.com/webhook/..."
                  value={notif.webhookUrl}
                  onChange={(e) => setNotif((v) => ({ ...v, webhookUrl: e.target.value }))}
                />
              </div>
            )}

            {notif.channel === 'whatsapp' && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Twilio Account SID</Label>
                    <Input type="password" placeholder="ACxxxxxxxxxxxxxxxx" value={notif.twilioSid}
                      onChange={(e) => setNotif((v) => ({ ...v, twilioSid: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Twilio Auth Token</Label>
                    <Input type="password" placeholder="Auth token" value={notif.twilioAuth}
                      onChange={(e) => setNotif((v) => ({ ...v, twilioAuth: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>From Number</Label>
                    <Input placeholder="whatsapp:+14155238886" value={notif.fromNumber}
                      onChange={(e) => setNotif((v) => ({ ...v, fromNumber: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>To Number</Label>
                    <Input placeholder="whatsapp:+1234567890" value={notif.toNumber}
                      onChange={(e) => setNotif((v) => ({ ...v, toNumber: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}

            {/* Notification test status */}
            {notifTestState !== 'idle' && (
              <div className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                notifTestState === 'ok' ? 'bg-green-500/10 text-green-300 border border-green-500/20' :
                notifTestState === 'fail' ? 'bg-red-500/10 text-red-300 border border-red-500/20' :
                'bg-muted text-muted-foreground',
              )}>
                {notifTestState === 'testing' && <Loader2 className="h-4 w-4 animate-spin" />}
                {notifTestState === 'ok' && <CheckCircle2 className="h-4 w-4" />}
                {notifTestState === 'fail' && <AlertCircle className="h-4 w-4" />}
                <span>
                  {notifTestState === 'testing' ? 'Sending test message…' :
                   notifTestState === 'ok' ? 'Test message sent — check your channel' :
                   'Test failed — check your credentials'}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setStep(0)}>
                  <ChevronLeft className="h-3.5 w-3.5" /> Back
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={notifTestState === 'testing'}
                  onClick={testNotification}
                >
                  {notifTestState === 'testing'
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
                    : <><RefreshCw className="h-3.5 w-3.5" /> Send Test</>}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(2)}>Skip</Button>
                <Button onClick={() => notifMutation.mutate()} disabled={notifMutation.isPending}>
                  {notifMutation.isPending ? 'Saving…' : 'Save & Continue'} <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2 — Done */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10">
                <Check className="h-5 w-5 text-green-400" />
              </span>
              Configuration Complete
            </CardTitle>
            <CardDescription>Your platform is ready</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border p-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">LLM Provider</span>
                <Badge variant="secondary">{PROVIDERS.find((p) => p.value === llm.provider)?.label}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Model</span>
                <span>{llm.model}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Notification Channel</span>
                <Badge variant="secondary">{CHANNELS.find((c) => c.value === notif.channel)?.label}</Badge>
              </div>
            </div>
            <div className="flex gap-3">
              <Button className="flex-1" onClick={() => router.push('/')}>Go to Dashboard</Button>
              <Button variant="outline" onClick={() => setStep(0)}>
                <RefreshCw className="h-4 w-4 mr-2" /> Reconfigure
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
