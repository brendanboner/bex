'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, STATUS_COLOURS } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';

type Agent = {
  id: string;
  name: string;
  description?: string;
  status: string;
};

type RequestRecord = {
  id: string;
  status: string;
  output?: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'agent';
  content: string;
};

export default function ChatPage() {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: agents = [], isLoading: agentsLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<Agent[]>('/agents'),
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pollingId]);

  // Poll for request completion
  useEffect(() => {
    if (!pollingId) return;

    const interval = setInterval(async () => {
      try {
        const record = await api.get<RequestRecord>(`/requests/${pollingId}`);
        if (record.status === 'COMPLETED' || record.status === 'FAILED') {
          clearInterval(interval);
          setPollingId(null);
          setSending(false);
          setMessages((prev) => [
            ...prev,
            {
              id: `${pollingId}-response`,
              role: 'agent',
              content: record.output ?? (record.status === 'FAILED' ? 'Request failed.' : '(no output)'),
            },
          ]);
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

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const payload = { agentId: selectedAgent.id, input: input.trim(), channel: 'dashboard' };
    setInput('');
    setSending(true);

    try {
      const record = await api.post<RequestRecord>('/requests', payload);
      setPollingId(record.id);
    } catch (e) {
      setSending(false);
      toast({ title: 'Failed to send', description: (e as Error).message, variant: 'destructive' });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function selectAgent(agent: Agent) {
    if (selectedAgent?.id === agent.id) return;
    setSelectedAgent(agent);
    setMessages([]);
    setPollingId(null);
    setSending(false);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0 rounded-lg border overflow-hidden">
      {/* Agent sidebar */}
      <aside className="w-64 shrink-0 border-r flex flex-col bg-card">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Agents
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {agentsLoading && (
            <p className="px-4 py-2 text-xs text-muted-foreground">Loading…</p>
          )}
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => selectAgent(agent)}
              className={cn(
                'w-full text-left px-4 py-3 hover:bg-accent transition-colors',
                selectedAgent?.id === agent.id && 'bg-accent',
              )}
            >
              <div className="text-sm font-medium truncate">{agent.name}</div>
              <div className={cn(
                'mt-0.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-semibold',
                STATUS_COLOURS[agent.status] ?? '',
              )}>
                {agent.status}
              </div>
            </button>
          ))}
          {!agentsLoading && agents.length === 0 && (
            <p className="px-4 py-2 text-xs text-muted-foreground">No agents configured</p>
          )}
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedAgent ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <MessageSquare className="h-12 w-12 opacity-30" />
            <p className="text-sm">Select an agent to start chatting</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 border-b px-6 py-3 bg-card shrink-0">
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-sm">{selectedAgent.name}</span>
                {selectedAgent.description && (
                  <span className="text-xs text-muted-foreground ml-2">{selectedAgent.description}</span>
                )}
              </div>
              <Badge className={cn('text-xs', STATUS_COLOURS[selectedAgent.status] ?? '')}>
                {selectedAgent.status}
              </Badge>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.length === 0 && (
                <p className="text-center text-sm text-muted-foreground">
                  Start a conversation with <strong>{selectedAgent.name}</strong>
                </p>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'bg-muted rounded-bl-sm',
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {pollingId && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t p-4 shrink-0 bg-card">
              <div className="flex gap-2">
                <Input
                  placeholder={`Message ${selectedAgent.name}…`}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={sending}
                  className="flex-1"
                />
                <Button onClick={() => void handleSend()} disabled={!input.trim() || sending} size="icon">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
