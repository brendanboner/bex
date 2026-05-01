'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Bot, ChevronLeft, ChevronRight, MessageSquare, Plus, Send, Sparkles, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Agent = { id: string; name: string; description?: string; status: string };
type ChatMode = 'coordinator' | 'direct';
type ChatMessage = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  agentName?: string;
  routed?: boolean; // true = came from coordinator (auto-routed)
  error?: boolean;  // true = this message is an inline error
};
type RequestRecord = { id: string; status: string; output?: string; errorMsg?: string };

const SESSION_STORAGE_KEY = 'nexus_coordinator_session_id';

export default function NexusPage() {
  // mode: 'coordinator' = smart routing (default), 'direct' = pinned agent
  const [mode, setMode] = useState<ChatMode>('coordinator');
  const [pinnedAgent, setPinnedAgent] = useState<Agent | null>(null);
  const [coordinatorSessionId, setCoordinatorSessionId] = useState<string | null>(() => {
    // Restore session across page navigations
    if (typeof window !== 'undefined') {
      return localStorage.getItem(SESSION_STORAGE_KEY);
    }
    return null;
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pollingId, setPollingId] = useState<string | null>(null); // only used in direct mode
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Persist sessionId to localStorage whenever it changes
  useEffect(() => {
    if (coordinatorSessionId) {
      localStorage.setItem(SESSION_STORAGE_KEY, coordinatorSessionId);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [coordinatorSessionId]);

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<Agent[]>('/agents'),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Poll for direct-agent responses
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
            content: record.output ?? record.errorMsg ?? (record.status === 'FAILED' ? 'Request failed.' : '(no output)'),
            agentName: pinnedAgent?.name,
            routed: false,
          }]);
        }
      } catch {
        clearInterval(interval);
        setPollingId(null);
        setSending(false);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [pollingId, pinnedAgent]);

  function startNewCoordinatorChat() {
    setMode('coordinator');
    setPinnedAgent(null);
    setCoordinatorSessionId(null); // useEffect will remove from localStorage
    setMessages([]);
    setPollingId(null);
    setSending(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function pinAgent(agent: Agent) {
    setMode('direct');
    setPinnedAgent(agent);
    setCoordinatorSessionId(null);
    setMessages([]);
    setPollingId(null);
    setSending(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function handleSend() {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content }]);
    setInput('');
    setSending(true);

    if (mode === 'coordinator') {
      // Smart routing — coordinator decides which agent(s) handle this
      try {
        const result = await api.post<{ sessionId: string; output: string }>('/coordinator/chat', {
          message: content,
          sessionId: coordinatorSessionId ?? undefined,
          channel: 'dashboard',
        });
        setCoordinatorSessionId(result.sessionId);
        setSending(false);
        const output = result.output?.trim() || '*(No response — the agent completed its task without producing text output.)*';
        setMessages(prev => [...prev, {
          id: `coord-${Date.now()}`,
          role: 'agent',
          content: output,
          agentName: 'Nexus',
          routed: true,
        }]);
      } catch (e) {
        setSending(false);
        setMessages(prev => [...prev, {
          id: `err-${Date.now()}`,
          role: 'agent',
          content: (e as Error).message ?? 'An unexpected error occurred.',
          agentName: 'Nexus',
          routed: true,
          error: true,
        }]);
      }
    } else {
      // Direct mode — send straight to pinned agent, poll for result
      if (!pinnedAgent) { setSending(false); return; }
      try {
        const record = await api.post<{ id: string; requestId?: string }>('/requests', {
          agentId: pinnedAgent.id, input: content, channel: 'dashboard',
        });
        setPollingId(record.id ?? record.requestId ?? null);
      } catch (e) {
        setSending(false);
        setMessages(prev => [...prev, {
          id: `err-${Date.now()}`,
          role: 'agent',
          content: (e as Error).message ?? 'Failed to send request.',
          agentName: pinnedAgent.name,
          routed: false,
          error: true,
        }]);
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  }

  const isActive = messages.length > 0 || sending;
  const placeholder = mode === 'coordinator'
    ? 'Ask anything — Nexus routes to the right agent…'
    : `Ask ${pinnedAgent?.name ?? 'agent'} directly…`;

  return (
    <div className="flex h-[calc(100vh-6rem)] overflow-hidden">
      {/* Collapsible sidebar */}
      <aside className={cn(
        'flex flex-col shrink-0 border-r border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] transition-all duration-200 overflow-hidden',
        sidebarOpen ? 'w-52' : 'w-0 border-r-0',
      )}>
        {/* New routed chat */}
        <div className="p-3 border-b border-[rgb(var(--border))] shrink-0 space-y-1">
          <button
            onClick={startNewCoordinatorChat}
            className={cn(
              'flex items-center gap-2 w-full rounded-lg px-3 py-2 text-xs font-medium transition-all',
              mode === 'coordinator' && !isActive
                ? 'bg-[rgba(130,100,200,0.08)] border border-[rgba(130,100,200,0.12)] text-[rgb(var(--text-primary))]'
                : 'text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--text-primary))]',
            )}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            New Chat
          </button>
        </div>

        {/* Agent list — for direct pinned chats */}
        <div className="flex-1 overflow-y-auto p-2">
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--text-muted))]">
            Direct agents
          </p>
          {isLoading && <p className="px-3 py-2 text-xs text-[rgb(var(--text-muted))]">Loading…</p>}
          {agents.map(agent => (
            <button
              key={agent.id}
              onClick={() => pinAgent(agent)}
              title="Chat directly with this agent"
              className={cn(
                'w-full text-left px-2.5 py-2 rounded-lg my-0.5 transition-all text-xs',
                mode === 'direct' && pinnedAgent?.id === agent.id
                  ? 'bg-[rgba(130,100,200,0.08)] border border-[rgba(130,100,200,0.12)] text-[rgb(var(--text-primary))]'
                  : 'text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--text-primary))]',
              )}
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
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

          <div className="flex-1 flex items-center justify-center gap-2">
            <h1 className="text-sm font-semibold text-[rgb(var(--text-primary))]">Nexus</h1>
            {mode === 'coordinator' ? (
              <span className="flex items-center gap-1 rounded-full border border-[rgba(130,100,200,0.2)] bg-[rgba(130,100,200,0.07)] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--text-secondary))]">
                <Zap className="h-2.5 w-2.5" /> Smart routing
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--text-secondary))]">
                <Bot className="h-2.5 w-2.5" /> {pinnedAgent?.name}
              </span>
            )}
          </div>

          <div className="w-7" />
        </div>

        {/* Empty / welcome state */}
        {!isActive ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
            <div className="h-16 w-16 rounded-2xl bg-[rgba(130,100,200,0.06)] border border-[rgba(99,102,241,0.15)] flex items-center justify-center">
              <Sparkles className="h-7 w-7 text-[rgb(var(--text-secondary))] opacity-70" />
            </div>
            <div className="text-center space-y-1.5 max-w-sm">
              <p className="text-sm font-semibold text-[rgb(var(--text-primary))]">
                {mode === 'coordinator' ? 'What do you need?' : `Chatting with ${pinnedAgent?.name}`}
              </p>
              <p className="text-xs text-[rgb(var(--text-muted))] leading-relaxed">
                {mode === 'coordinator'
                  ? 'Nexus automatically routes your message to the best agent or combination of agents. Or pin a specific agent from the sidebar.'
                  : 'Your message goes directly to this agent. Switch to smart routing via New Chat.'}
              </p>
            </div>
            {/* Suggestion chips — only in coordinator mode */}
            {mode === 'coordinator' && (
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {[
                  'What agents do I have?',
                  'Show any active alarms',
                  'Check for new devices',
                  'What skills are available?',
                ].map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                    className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))] px-3 py-1.5 text-xs text-[rgb(var(--text-secondary))] hover:border-[rgba(130,100,200,0.2)] hover:text-[rgb(var(--text-primary))] transition-all"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Messages */
          <div className="flex-1 overflow-y-auto py-6 px-4">
            <div className="max-w-2xl mx-auto space-y-5">
              {messages.map(msg => (
                <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {msg.role === 'agent' && (
                    <div className={cn(
                      'mr-3 mt-1 h-7 w-7 rounded-xl flex items-center justify-center shrink-0',
                      msg.error
                        ? 'bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)]'
                        : 'bg-[rgba(130,100,200,0.08)] border border-[rgba(130,100,200,0.12)]',
                    )}>
                      {msg.error
                        ? <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                        : msg.routed
                          ? <Zap className="h-3.5 w-3.5 text-[rgb(var(--text-secondary))]" />
                          : <Bot className="h-3.5 w-3.5 text-[rgb(var(--text-secondary))]" />}
                    </div>
                  )}
                  <div className="max-w-[72%]">
                    {msg.role === 'agent' && (
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-semibold text-[rgb(var(--text-primary))]">{msg.agentName ?? 'Agent'}</span>
                        {!msg.error && (
                          <span className={cn(
                            'text-[10px] rounded-full border px-2 py-0.5 font-medium',
                            msg.routed
                              ? 'border-[rgba(130,100,200,0.2)] bg-[rgba(130,100,200,0.07)] text-[rgb(var(--text-secondary))]'
                              : 'border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--text-muted))]',
                          )}>
                            {msg.routed ? 'Routed' : 'Direct'}
                          </span>
                        )}
                        {msg.error && (
                          <span className="text-[10px] rounded-full border border-red-500/20 bg-red-500/08 px-2 py-0.5 font-medium text-red-400">
                            Error
                          </span>
                        )}
                      </div>
                    )}
                    <div className={cn(
                      'rounded-2xl px-4 py-3 text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border))] text-[rgb(var(--text-primary))] rounded-tr-sm whitespace-pre-wrap'
                        : msg.error
                          ? 'bg-red-500/05 border border-red-500/15 text-red-400 rounded-tl-sm whitespace-pre-wrap'
                          : 'bg-[rgb(var(--bg-surface))] border border-[rgb(var(--border))] text-[rgb(var(--text-primary))] rounded-tl-sm',
                    )}>
                      {msg.role === 'user' || msg.error
                        ? msg.content
                        : (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                              h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-1">{children}</h1>,
                              h2: ({ children }) => <h2 className="text-sm font-bold mb-1.5 mt-1">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-1">{children}</h3>,
                              ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                              li: ({ children }) => <li className="text-sm">{children}</li>,
                              code: ({ inline, children, ...props }: { inline?: boolean; children?: React.ReactNode; [key: string]: unknown }) => inline
                                ? <code className="bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border))] rounded px-1 py-0.5 text-xs font-mono" {...props}>{children}</code>
                                : <code className="block bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border))] rounded-lg p-3 text-xs font-mono overflow-x-auto mb-2 whitespace-pre" {...props}>{children}</code>,
                              pre: ({ children }) => <div className="mb-2">{children}</div>,
                              blockquote: ({ children }) => <blockquote className="border-l-2 border-[rgba(130,100,200,0.3)] pl-3 italic text-[rgb(var(--text-secondary))] mb-2">{children}</blockquote>,
                              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                              a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[rgba(130,100,200,0.9)] underline hover:text-[rgba(130,100,200,1)] transition-colors">{children}</a>,
                              table: ({ children }) => <div className="overflow-x-auto mb-2"><table className="text-xs border-collapse w-full">{children}</table></div>,
                              th: ({ children }) => <th className="border border-[rgb(var(--border))] px-2 py-1 bg-[rgb(var(--bg-elevated))] font-semibold text-left">{children}</th>,
                              td: ({ children }) => <td className="border border-[rgb(var(--border))] px-2 py-1">{children}</td>,
                              hr: () => <hr className="border-[rgb(var(--border))] my-2" />,
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        )
                      }
                    </div>
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="mr-3 mt-1 h-7 w-7 rounded-xl bg-[rgba(130,100,200,0.08)] border border-[rgba(130,100,200,0.12)] flex items-center justify-center shrink-0">
                    {mode === 'coordinator'
                      ? <Zap className="h-3.5 w-3.5 text-[rgb(var(--text-secondary))] animate-pulse" />
                      : <Bot className="h-3.5 w-3.5 text-[rgb(var(--text-secondary))]" />}
                  </div>
                  <div className="bg-[rgb(var(--bg-surface))] border border-[rgb(var(--border))] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[rgb(var(--text-muted))] animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-2 w-2 rounded-full bg-[rgb(var(--text-muted))] animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-2 w-2 rounded-full bg-[rgb(var(--text-muted))] animate-bounce" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Input area — always shown */}
        <div className="px-4 pb-5 pt-2 shrink-0">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-3 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-4 py-3 focus-within:border-[rgba(130,100,200,0.25)] transition-colors shadow-lg">
              <input
                ref={inputRef}
                placeholder={placeholder}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending}
                className="flex-1 bg-transparent text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={() => void handleSend()}
                disabled={!input.trim() || sending}
                className="h-8 w-8 flex items-center justify-center rounded-xl bg-[rgba(130,100,200,0.7)] text-white disabled:opacity-30 hover:bg-[rgba(130,100,200,0.85)] transition-all shrink-0 shadow-sm"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-[rgb(var(--text-muted))]">
              {mode === 'coordinator'
                ? 'Smart routing active — Nexus selects the best agent automatically'
                : `Direct mode — pinned to ${pinnedAgent?.name}. Click New Chat to return to smart routing.`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
