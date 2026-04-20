'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, ChevronDown, ChevronLeft, ChevronRight, MessageSquare, Plus, Send, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, STATUS_COLOURS } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

type Agent = { id: string; name: string; description?: string; status: string; charter?: { posture: string } };
type CreateRequestResponse = { id: string; requestId: string; status: string };
type RequestRecord = { id: string; status: string; output?: string; errorMsg?: string };
type ChatMessage = { id: string; role: 'user' | 'agent'; content: string; agentName?: string };

export default function NexusPage() {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const agentPickerRef = useRef<HTMLDivElement>(null);

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
            agentName: selectedAgent?.name,
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
  }, [pollingId, selectedAgent]);

  // Close agent picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setAgentPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

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

  function selectAgent(agent: Agent) {
    if (selectedAgent?.id !== agent.id) {
      setSelectedAgent(agent);
      setMessages([]);
      setPollingId(null);
      setSending(false);
    }
    setAgentPickerOpen(false);
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] overflow-hidden">
      {/* Collapsible recent-chats sidebar */}
      <aside className={cn(
        'flex flex-col shrink-0 border-r border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] transition-all duration-200 overflow-hidden',
        sidebarOpen ? 'w-52' : 'w-0 border-r-0',
      )}>
        <div className="p-3 border-b border-[rgb(var(--border))] shrink-0">
          <button
            onClick={() => { setSelectedAgent(null); setMessages([]); }}
            className="flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--text-primary))] transition-all"
          >
            <Plus className="h-4 w-4" /> New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--text-muted))]">Agents</p>
          {isLoading && <p className="px-3 py-2 text-xs text-[rgb(var(--text-muted))]">Loading…</p>}
          {agents.map(agent => (
            <button
              key={agent.id}
              onClick={() => selectAgent(agent)}
              className={cn(
                'w-full text-left px-2.5 py-2 rounded-lg my-0.5 transition-all text-xs',
                selectedAgent?.id === agent.id
                  ? 'bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.2)] text-[rgb(var(--text-primary))]'
                  : 'text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--text-primary))]',
              )}
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate font-medium">{agent.name}</span>
              </div>
            </button>
          ))}
          {!isLoading && agents.length === 0 && (
            <p className="px-3 py-2 text-xs text-[rgb(var(--text-muted))]">No agents yet</p>
          )}
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[rgb(var(--border))] shrink-0">
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-[rgb(var(--text-muted))] hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--text-secondary))] transition-all shrink-0"
          >
            {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <h1 className="flex-1 text-center text-sm font-semibold text-[rgb(var(--text-primary))]">
            {selectedAgent ? selectedAgent.name : 'Nexus'}
          </h1>
          <div className="w-7" /> {/* spacer to keep title centered */}
        </div>

        {!selectedAgent ? (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
            <div className="h-16 w-16 rounded-2xl bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.15)] flex items-center justify-center">
              <Sparkles className="h-7 w-7 text-indigo-400 opacity-70" />
            </div>
            <div className="text-center space-y-1.5 max-w-xs">
              <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">Start a conversation</p>
              <p className="text-xs text-[rgb(var(--text-muted))] leading-relaxed">
                Select an agent from the sidebar or use the agent selector below to begin.
              </p>
            </div>
            {/* Agent quick-select grid */}
            {agents.length > 0 && (
              <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                {agents.slice(0, 4).map(agent => (
                  <button
                    key={agent.id}
                    onClick={() => selectAgent(agent)}
                    className="flex items-center gap-2.5 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] px-3.5 py-2.5 text-left hover:border-[rgba(99,102,241,0.3)] hover:bg-[rgb(var(--bg-elevated))] transition-all"
                  >
                    <div className="h-7 w-7 rounded-lg bg-[rgba(99,102,241,0.1)] flex items-center justify-center shrink-0">
                      <Bot className="h-3.5 w-3.5 text-indigo-400" />
                    </div>
                    <span className="text-xs font-medium text-[rgb(var(--text-primary))] truncate">{agent.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto py-6 px-4">
              <div className="max-w-2xl mx-auto space-y-5">
                {messages.length === 0 && (
                  <div className="text-center py-12 space-y-1">
                    <p className="text-sm text-[rgb(var(--text-secondary))]">
                      Conversation with <span className="text-indigo-400">{selectedAgent.name}</span>
                    </p>
                    <p className="text-xs text-[rgb(var(--text-muted))]">Messages appear here</p>
                  </div>
                )}
                {messages.map(msg => (
                  <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                    {msg.role === 'agent' && (
                      <div className="mr-3 mt-1 h-7 w-7 rounded-xl bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.2)] flex items-center justify-center shrink-0">
                        <Bot className="h-3.5 w-3.5 text-indigo-400" />
                      </div>
                    )}
                    <div className={cn(
                      'max-w-[72%]',
                    )}>
                      {msg.role === 'agent' && (
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-[rgb(var(--text-primary))]">{msg.agentName ?? selectedAgent.name}</span>
                          <span className="text-[10px] rounded-full border border-[rgba(99,102,241,0.25)] bg-[rgba(99,102,241,0.1)] px-2 py-0.5 text-indigo-400 font-medium">Agent</span>
                        </div>
                      )}
                      <div className={cn(
                        'rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
                        msg.role === 'user'
                          ? 'bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border))] text-[rgb(var(--text-primary))] rounded-tr-sm'
                          : 'bg-[rgb(var(--bg-surface))] border border-[rgb(var(--border))] text-[rgb(var(--text-primary))] rounded-tl-sm',
                      )}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                ))}
                {pollingId && (
                  <div className="flex justify-start">
                    <div className="mr-3 mt-1 h-7 w-7 rounded-xl bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.2)] flex items-center justify-center shrink-0">
                      <Bot className="h-3.5 w-3.5 text-indigo-400" />
                    </div>
                    <div className="bg-[rgb(var(--bg-surface))] border border-[rgb(var(--border))] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce [animation-delay:-0.3s]" />
                      <span className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce [animation-delay:-0.15s]" />
                      <span className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce" />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Floating input area */}
            <div className="px-4 pb-5 pt-2 shrink-0">
              <div className="max-w-2xl mx-auto space-y-2">
                {/* Agent selector chip */}
                <div className="flex justify-start pl-1" ref={agentPickerRef}>
                  <div className="relative">
                    <button
                      onClick={() => setAgentPickerOpen(o => !o)}
                      className="flex items-center gap-1.5 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3 py-1 text-xs text-[rgb(var(--text-secondary))] hover:border-[rgba(99,102,241,0.3)] hover:text-[rgb(var(--text-primary))] transition-all"
                    >
                      <Bot className="h-3 w-3 text-indigo-400" />
                      <span className="font-medium">{selectedAgent.name}</span>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {agentPickerOpen && (
                      <div className="absolute bottom-full left-0 mb-2 w-52 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] shadow-xl overflow-hidden z-10">
                        {agents.map(agent => (
                          <button
                            key={agent.id}
                            onClick={() => selectAgent(agent)}
                            className={cn(
                              'w-full text-left px-3 py-2 text-xs hover:bg-[rgb(var(--bg-muted))] transition-colors',
                              selectedAgent.id === agent.id ? 'text-indigo-400' : 'text-[rgb(var(--text-primary))]',
                            )}
                          >
                            {agent.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {/* Input card */}
                <div className="flex items-center gap-3 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-4 py-3 focus-within:border-[rgba(99,102,241,0.4)] transition-colors shadow-lg">
                  <input
                    placeholder={`Ask ${selectedAgent.name} anything…`}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sending}
                    className="flex-1 bg-transparent text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:outline-none disabled:opacity-50"
                  />
                  <button
                    onClick={() => void handleSend()}
                    disabled={!input.trim() || sending}
                    className="h-8 w-8 flex items-center justify-center rounded-xl bg-indigo-600 text-white disabled:opacity-30 hover:bg-indigo-500 transition-all shrink-0 shadow-sm"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
