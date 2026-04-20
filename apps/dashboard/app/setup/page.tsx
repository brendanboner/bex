'use client';

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Settings, Send, Building2, Smartphone, Bot, Cloud, Layers } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

type LLMProvider = 'openai' | 'anthropic' | 'azure-openai';
type NotificationChannel = 'telegram' | 'teams' | 'whatsapp';

type LLMConfig = {
  provider: LLMProvider;
  apiKey: string;
  model: string;
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
};

const PROVIDERS: { value: LLMProvider; label: string; color: string; Icon: React.ElementType }[] = [
  { value: 'openai', label: 'OpenAI', color: 'bg-emerald-500', Icon: Bot },
  { value: 'anthropic', label: 'Anthropic', color: 'bg-cyan-600', Icon: Layers },
  { value: 'azure-openai', label: 'Azure OpenAI', color: 'bg-blue-500', Icon: Cloud },
];

const CHANNELS: { value: NotificationChannel; label: string; color: string; Icon: React.ElementType }[] = [
  { value: 'telegram', label: 'Telegram', color: 'bg-sky-500', Icon: Send },
  { value: 'teams', label: 'Microsoft Teams', color: 'bg-indigo-600', Icon: Building2 },
  { value: 'whatsapp', label: 'WhatsApp', color: 'bg-green-500', Icon: Smartphone },
];

const STEPS = ['LLM Configuration', 'Notification Channel', 'Done'];

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [llm, setLlm] = useState<LLMConfig>({
    provider: 'openai',
    apiKey: '',
    model: DEFAULT_MODELS.openai,
  });

  const [notif, setNotif] = useState<NotificationConfig>({
    channel: 'telegram',
    botToken: '',
    chatId: '',
    webhookUrl: '',
    twilioSid: '',
    twilioAuth: '',
    fromNumber: '',
    toNumber: '',
  });

  const llmMutation = useMutation({
    mutationFn: () => api.post('/setup/llm', { provider: llm.provider, apiKey: llm.apiKey, model: llm.model }),
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
    setLlm((v) => ({ ...v, provider: p, model: DEFAULT_MODELS[p] }));
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="h-7 w-7" /> Setup Wizard
        </h1>
        <p className="text-muted-foreground">Configure your platform in a few steps</p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold border-2',
              i < step ? 'border-green-500 bg-green-500 text-white' :
              i === step ? 'border-primary bg-primary text-primary-foreground' :
              'border-muted-foreground text-muted-foreground',
            )}>
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span className={cn('text-sm font-medium', i === step ? 'text-foreground' : 'text-muted-foreground')}>
              {label}
            </span>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step 1 — LLM */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>LLM Configuration</CardTitle>
            <CardDescription>Choose your AI provider and enter credentials</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Provider</Label>
              <div className="grid grid-cols-3 gap-3">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => handleProviderChange(p.value)}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm font-medium transition-colors',
                      llm.provider === p.value
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

            <div className="space-y-1">
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder="sk-..."
                value={llm.apiKey}
                onChange={(e) => setLlm((v) => ({ ...v, apiKey: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label>Model <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                placeholder={DEFAULT_MODELS[llm.provider]}
                value={llm.model}
                onChange={(e) => setLlm((v) => ({ ...v, model: e.target.value }))}
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={() => llmMutation.mutate()} disabled={!llm.apiKey || llmMutation.isPending}>
                {llmMutation.isPending ? 'Saving…' : 'Next'} <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2 — Notifications */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Notification Channel</CardTitle>
            <CardDescription>Configure how agents will send approval requests and alerts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Channel</Label>
              <div className="grid grid-cols-3 gap-3">
                {CHANNELS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setNotif((v) => ({ ...v, channel: c.value }))}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm font-medium transition-colors',
                      notif.channel === c.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50',
                    )}
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.color}`}>
                      <c.Icon className="h-5 w-5 text-white" />
                    </span>
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
                  <Label>Approval Chat ID</Label>
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
                    <Input
                      type="password"
                      placeholder="ACxxxxxxxxxxxxxxxx"
                      value={notif.twilioSid}
                      onChange={(e) => setNotif((v) => ({ ...v, twilioSid: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Twilio Auth Token</Label>
                    <Input
                      type="password"
                      placeholder="Auth token"
                      value={notif.twilioAuth}
                      onChange={(e) => setNotif((v) => ({ ...v, twilioAuth: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>From Number</Label>
                    <Input
                      placeholder="whatsapp:+14155238886"
                      value={notif.fromNumber}
                      onChange={(e) => setNotif((v) => ({ ...v, fromNumber: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>To Number</Label>
                    <Input
                      placeholder="whatsapp:+1234567890"
                      value={notif.toNumber}
                      onChange={(e) => setNotif((v) => ({ ...v, toNumber: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => notifMutation.mutate()} disabled={notifMutation.isPending}>
                {notifMutation.isPending ? 'Saving…' : 'Next'} <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 — Done */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                <Check className="h-5 w-5 text-green-600" />
              </span>
              Setup Complete!
            </CardTitle>
            <CardDescription>Here's a summary of what was configured</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">LLM Provider</span>
                <Badge variant="secondary">{PROVIDERS.find((p) => p.value === llm.provider)?.label}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Model</span>
                <span className="text-sm text-muted-foreground">{llm.model}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">API Key</span>
                <span className="text-sm text-muted-foreground">{'•'.repeat(12)}</span>
              </div>
            </div>

            <div className="rounded-md border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Notification Channel</span>
                <Badge variant="secondary">{CHANNELS.find((c) => c.value === notif.channel)?.label}</Badge>
              </div>
              {notif.channel === 'telegram' && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Approval Chat ID</span>
                  <span className="text-sm text-muted-foreground">{notif.chatId || '—'}</span>
                </div>
              )}
              {notif.channel === 'teams' && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Webhook URL</span>
                  <span className="text-sm text-muted-foreground truncate max-w-[200px]">{notif.webhookUrl || '—'}</span>
                </div>
              )}
              {notif.channel === 'whatsapp' && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">From Number</span>
                  <span className="text-sm text-muted-foreground">{notif.fromNumber || '—'}</span>
                </div>
              )}
            </div>

            <Button className="w-full" onClick={() => router.push('/')}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
