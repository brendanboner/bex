'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, Send, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, STATUS_COLOURS } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

type Agent = { id: string; name: string; description?: string; status: string; charter?: { posture: string } };
type CreateRequestResponse = { id: string; requestId: string; status: string };
type RequestRecord = { id: string; status: string; output?: string; errorMsg?: string };
type ChatMessage = { id: string; role: 'user' | 'agent'; content: string };

export default function NexusPage() {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<Agent[]>('/agents'),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pollingId]);

  useEffect(() => {
    if (!pollingId) return;
    const interval = setInterval(async () => {
      try {
        const record = await api.get<RequestRecord>(`/requests/${pollingId}`);
        if (record.status === 'COMPLETED' || record.status === 'FAILED') {
          clearInterval(interval);
          setPollingId(null);
          setSending(false);
          setMessages(prev => [...prev, {
            id: `${pollingId}-resp`,
            role: 'agent',
            content: record.output ?? record.errorMsg ?? (record.status === 'FAILED' ? '⚠ Request failed.' : '(no output)'),
          }]);
        }
      } catch (e) {
        clearInterval(interval);
        setPollingId(null);
        setSending(false);
        toast({ title: 'Polling error', description: (e as Error).message, variant: 'destructive' });
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [pollingId]);

  async function handleSend() {
    if (!input.trim() || !selectedAgent || sending) return;
    const content = input.trim();
    setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content }]);
    setInput('');
    setSending(true);
    try {
      const record = await api.post<CreateRequestResponse>('/requests', {
        agentId: selectedAgent.id, input: content, channel: 'dashboard',
      });
      setPollingId(record.id ?? record.requestId);
    } catch (e) {
      setSending(false);
      toast({ title: 'Failed to send', description: (e as Error).message, variant: 'destructive' });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] rounded-xl border border-[rgb(var(--border))] overflow-hidden bg-[rgb(var(--bg-surface))]">
      {/* Agent list */}
      <aside className="w-56 shrink-0 border-r border-[rgb(var(--border))] flex flex-col">
        <div className="px-4 py-3 border-b border-[rgb(var(--border))]">
          <p className="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--text-muted))]">Agents</p>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {isLoading && <p className="px-4 py-3 text-xs text-[rgb(var(--text-muted))]">Loading…</p>}
          {agents.map(agent => (
            <button
              key={agent.id}
              onClick={() => { if (selectedAgent?.id !== agent.id) { setSelectedAgent(agent); setMessages([]); setPollingId(null); setSending(false); } }}
              className={cn(
                'w-full text-left px-3 py-2.5 rounded-lg mx-1 my-0.5 transition-all',
                selectedAgent?.id === agent.id
                  ? 'bg-[rgba(6,182,212,0.12)] border border-[rgba(6,182,212,0.25)]'
                  : 'hover:bg-[rgb(var(--bg-elevated))]',
              )}
            >
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-lg bg-[rgba(6,182,212,0.12)] flex items-center justify-center shrink-0">
                  <Bot className="h-3.5 w-3.5 text-cyan-300" />
                </div>
                <span className="text-xs font-medium text-[rgb(var(--text-primary))] truncate">{agent.name}</span>
              </div>
              {agent.charter?.posture && (
                <span className={`mt-1 text-[10px] font-medium ${STATUS_COLOURS[agent.charter.posture] ?? 'badge-queued'} rounded-full px-2 py-0.5`}>
                  {agent.charter.posture}
                </span>
              )}
            </button>
          ))}
          {!isLoading && agents.length === 0 && (
            <p className="px-4 py-3 text-xs text-[rgb(var(--text-muted))]">No agents configured</p>
          )}
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedAgent ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[rgb(var(--text-muted))]">
            <div className="h-16 w-16 rounded-2xl bg-[rgba(6,182,212,0.10)] flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-cyan-300 opacity-50" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-[rgb(var(--text-secondary))]">Select an agent</p>
              <p className="text-xs text-[rgb(var(--text-muted))]">Choose an agent from the left to start a conversation</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-[rgb(var(--border))] px-5 py-3 shrink-0">
              <div className="h-8 w-8 rounded-lg bg-[rgba(6,182,212,0.12)] flex items-center justify-center">
                <Bot className="h-4 w-4 text-cyan-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">{selectedAgent.name}</p>
                {selectedAgent.description && (
                  <p className="text-xs text-[rgb(var(--text-secondary))] truncate">{selectedAgent.description}</p>
                )}
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${STATUS_COLOURS[selectedAgent.status] ?? 'badge-queued'}`}>
                {selectedAgent.status}
              </span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {messages.length === 0 && (
                <p className="text-center text-xs text-[rgb(var(--text-muted))] pt-8">
                  Conversation with <span className="text-cyan-300">{selectedAgent.name}</span> · messages appear here
                </p>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[72%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-cyan-600 to-blue-500 text-white rounded-br-sm shadow-[0_0_20px_rgba(6,182,212,0.25)]'
                      : 'bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border))] text-[rgb(var(--text-primary))] rounded-bl-sm',
                  )}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {pollingId && (
                <div className="flex justify-start">
                  <div className="bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border))] rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-[rgb(var(--border))] p-4 shrink-0">
              <div className="flex items-center gap-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-4 py-2 focus-within:border-cyan-500 transition-colors">
                <input
                  placeholder={`Message ${selectedAgent.name}…`}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={sending}
                  className="flex-1 bg-transparent text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={!input.trim() || sending}
                  className="h-8 w-8 flex items-center justify-center rounded-lg bg-gradient-to-br from-cyan-600 to-blue-500 text-white disabled:opacity-40 hover:from-cyan-500 hover:to-blue-400 transition-all shrink-0"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

