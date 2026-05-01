'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle, Bot, ChevronDown, Plus, Send, Sparkles, Zap,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { BexLogo } from '@/components/bex-logo';

type Agent = { id: string; name: string; description?: string; status: string };
type ChatMode = 'coordinator' | 'direct';
type ChatMessage = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  agentName?: string;
  routed?: boolean;
  error?: boolean;
};
type RequestRecord = { id: string; status: string; output?: string; errorMsg?: string };

const SESSION_STORAGE_KEY = 'nexus_coordinator_session_id';

const SUGGESTIONS = [
  'Give me a health summary of everything',
  'Show any active alarms',
  'How many clients are connected?',
  'What skills are available?',
];

export default function NexusPage() {
  const [mode, setMode] = useState<ChatMode>('coordinator');
  const [pinnedAgent, setPinnedAgent] = useState<Agent | null>(null);
  const [coordinatorSessionId, setCoordinatorSessionId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem(SESSION_STORAGE_KEY);
    return null;
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (coordinatorSessionId) localStorage.setItem(SESSION_STORAGE_KEY, coordinatorSessionId);
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  }, [coordinatorSessionId]);

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<Agent[]>('/agents'),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Close picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerOpen && pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [pickerOpen]);

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
    setCoordinatorSessionId(null);
    setMessages([]);
    setPollingId(null);
    setSending(false);
    setPickerOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function pinAgent(agent: Agent) {
    setMode('direct');
    setPinnedAgent(agent);
    setCoordinatorSessionId(null);
    setMessages([]);
    setPollingId(null);
    setSending(false);
    setPickerOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function handleSend() {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content }]);
    setInput('');
    setSending(true);

    if (mode === 'coordinator') {
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
  const agentLabel = mode === 'coordinator' ? 'Nexus' : (pinnedAgent?.name ?? 'Agent');
  const placeholder = mode === 'coordinator'
    ? 'Ask anything — Nexus routes to the right agent…'
    : `Ask ${agentLabel} directly…`;

  return (
    <div className="flex flex-col h-[calc(100vh-2.25rem)] overflow-hidden">

      {/* ── Messages / Empty state ── */}
      <div className="flex-1 overflow-y-auto">
        {!isActive ? (
          /* ── Empty / welcome state ── */
          <div className="flex flex-col items-center justify-center h-full gap-8 px-6 pb-24">
            <BexLogo size={52} showWordmark showTagline />
            <div className="text-center space-y-2 max-w-md">
              <h1 className="text-xl font-semibold text-[rgb(var(--text-primary))]">
                {mode === 'coordinator' ? 'What do you need?' : `Chatting with ${agentLabel}`}
              </h1>
              <p className="text-sm text-[rgb(var(--text-muted))] leading-relaxed">
                {mode === 'coordinator'
                  ? 'Nexus automatically routes to the best agent. Or pick an agent directly using the selector in the input below.'
                  : 'Your message goes directly to this agent. Tap the agent name in the input to switch.'}
              </p>
            </div>
            {mode === 'coordinator' && (
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); inputRef.current?.focus(); }}
                    className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))]
                      px-4 py-1.5 text-sm text-[rgb(var(--text-secondary))]
                      hover:border-[rgba(137,129,229,0.3)] hover:text-[rgb(var(--text-primary))]
                      transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Message thread ── */
          <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
            {messages.map(msg => (
              <div key={msg.id} className={cn('animate-fade-in', msg.role === 'user' ? 'flex justify-end' : 'flex justify-start')}>
                {msg.role === 'agent' ? (
                  /* Agent message — clean, no card border */
                  <div className="flex gap-3 max-w-[85%]">
                    <div className={cn(
                      'mt-0.5 w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0',
                      msg.error
                        ? 'bg-[rgba(237,95,86,0.1)]'
                        : 'bg-[rgba(137,129,229,0.1)]',
                    )}>
                      {msg.error
                        ? <AlertCircle className="h-3.5 w-3.5 text-[rgb(237,95,86)]" />
                        : msg.routed
                          ? <Zap className="h-3.5 w-3.5 text-[rgb(137,129,229)]" />
                          : <Bot className="h-3.5 w-3.5 text-[rgb(var(--text-secondary))]" />}
                    </div>
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[rgb(var(--text-primary))]">{msg.agentName ?? 'Agent'}</span>
                        <span className={cn(
                          'text-[10px] rounded-md border px-1.5 py-0.5 font-medium',
                          msg.error
                            ? 'border-[rgba(237,95,86,0.2)] bg-[rgba(237,95,86,0.08)] text-[rgb(237,95,86)]'
                            : msg.routed
                              ? 'border-[rgba(137,129,229,0.2)] bg-[rgba(137,129,229,0.07)] text-[rgb(var(--text-secondary))]'
                              : 'border-[rgba(77,79,99,0.4)] bg-[rgba(45,47,62,0.5)] text-[rgb(var(--text-muted))]',
                        )}>
                          {msg.error ? 'Error' : msg.routed ? 'Routed' : 'Direct'}
                        </span>
                      </div>
                      <div className={cn(
                        'text-sm leading-relaxed',
                        msg.error ? 'text-[rgb(237,95,86)] whitespace-pre-wrap' : 'text-[rgb(var(--text-primary))]',
                      )}>
                        {msg.error ? msg.content : (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                              h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-3">{children}</h1>,
                              h2: ({ children }) => <h2 className="text-sm font-bold mb-1.5 mt-2">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2">{children}</h3>,
                              ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
                              li: ({ children }) => <li className="text-sm">{children}</li>,
                              code: ({ inline, children, ...props }: { inline?: boolean; children?: React.ReactNode; [key: string]: unknown }) => inline
                                ? <code className="bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border))] rounded px-1 py-0.5 text-xs font-mono" {...props}>{children}</code>
                                : <code className="block bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border))] rounded-lg p-3 text-xs font-mono overflow-x-auto mb-2 whitespace-pre" {...props}>{children}</code>,
                              pre: ({ children }) => <div className="mb-2">{children}</div>,
                              blockquote: ({ children }) => <blockquote className="border-l-2 border-[rgba(137,129,229,0.4)] pl-3 italic text-[rgb(var(--text-secondary))] mb-2">{children}</blockquote>,
                              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                              a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[rgb(137,129,229)] underline hover:opacity-80 transition-opacity">{children}</a>,
                              table: ({ children }) => <div className="overflow-x-auto mb-2"><table className="text-xs border-collapse w-full">{children}</table></div>,
                              th: ({ children }) => <th className="border border-[rgb(var(--border))] px-2 py-1.5 bg-[rgb(var(--bg-elevated))] font-semibold text-left">{children}</th>,
                              td: ({ children }) => <td className="border border-[rgb(var(--border))] px-2 py-1.5">{children}</td>,
                              hr: () => <hr className="border-[rgb(var(--border))] my-3" />,
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* User message — right-aligned solid bubble, agentone #2a2c3a */
                  <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tr-sm
                    bg-[#2a2c3a]
                    text-sm text-[rgb(var(--text-primary))] whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                  </div>
                )}
              </div>
            ))}

            {/* Typing indicator */}
            {sending && (
              <div className="flex gap-3 animate-fade-in">
                <div className="mt-0.5 w-7 h-7 rounded-xl bg-[rgba(137,129,229,0.1)]
                  flex items-center justify-center flex-shrink-0">
                  {mode === 'coordinator'
                    ? <Zap className="h-3.5 w-3.5 text-[rgb(137,129,229)] animate-pulse" />
                    : <Bot className="h-3.5 w-3.5 text-[rgb(var(--text-secondary))]" />}
                </div>
                <div className="flex items-center gap-1.5 pt-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--text-muted))] animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--text-muted))] animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--text-muted))] animate-bounce" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input area ── */}
      <div className="px-6 pb-6 pt-2 flex-shrink-0">
        <div className="max-w-2xl mx-auto">
          {/* Pill input with glow — agentone searchContainer #3d3f52 */}
          <div className="relative rounded-full bg-[#3d3f52] input-glow
            border border-[rgba(137,129,229,0.15)]
            flex items-center gap-2 px-2 py-2">

            {/* ── Agent picker chip ── */}
            <div ref={pickerRef} className="relative flex-shrink-0">
              <button
                onClick={() => setPickerOpen(o => !o)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
                  'transition-colors whitespace-nowrap',
                  mode === 'coordinator'
                    ? 'bg-[rgba(137,129,229,0.12)] text-[rgb(137,129,229)] hover:bg-[rgba(137,129,229,0.2)]'
                    : 'bg-[rgb(var(--bg-surface))] text-[rgb(var(--text-secondary))] hover:bg-[rgba(255,255,255,0.06)]',
                )}
              >
                {mode === 'coordinator'
                  ? <Zap className="h-3 w-3" />
                  : <Bot className="h-3 w-3" />}
                {agentLabel}
                <ChevronDown className={cn('h-3 w-3 transition-transform', pickerOpen && 'rotate-180')} />
              </button>

              {/* Agent dropdown */}
              {pickerOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-56
                  bg-[rgba(15,15,21,0.97)] border border-[rgba(77,79,99,0.4)]
                  rounded-xl shadow-l overflow-hidden z-50 backdrop-blur-sm">
                  {/* Nexus / smart routing */}
                  <button
                    onClick={startNewCoordinatorChat}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors text-left',
                      mode === 'coordinator'
                        ? 'bg-[rgba(137,129,229,0.1)] text-[rgb(var(--text-primary))]'
                        : 'text-[rgb(var(--text-secondary))] hover:bg-[rgba(255,255,255,0.04)] hover:text-[rgb(var(--text-primary))]',
                    )}
                  >
                    <Zap className="h-3.5 w-3.5 text-[rgb(137,129,229)] flex-shrink-0" />
                    <div>
                      <p className="font-medium">Nexus</p>
                      <p className="text-[10px] text-[rgb(var(--text-muted))]">Smart routing</p>
                    </div>
                    {mode === 'coordinator' && <Sparkles className="ml-auto h-3 w-3 text-[rgb(137,129,229)]" />}
                  </button>

                  {/* Divider */}
                  {agents.length > 0 && (
                    <div className="border-t border-[rgba(77,79,99,0.3)] mx-3" />
                  )}

                  {/* Individual agents */}
                  <div className="max-h-52 overflow-y-auto">
                    {isLoading && (
                      <p className="px-3 py-2 text-xs text-[rgb(var(--text-muted))]">Loading agents…</p>
                    )}
                    {agents.map(agent => (
                      <button
                        key={agent.id}
                        onClick={() => pinAgent(agent)}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors text-left',
                          mode === 'direct' && pinnedAgent?.id === agent.id
                            ? 'bg-[rgba(137,129,229,0.1)] text-[rgb(var(--text-primary))]'
                            : 'text-[rgb(var(--text-secondary))] hover:bg-[rgba(255,255,255,0.04)] hover:text-[rgb(var(--text-primary))]',
                        )}
                      >
                        <Bot className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{agent.name}</p>
                          {agent.description && (
                            <p className="text-[10px] text-[rgb(var(--text-muted))] truncate">{agent.description}</p>
                          )}
                        </div>
                        {mode === 'direct' && pinnedAgent?.id === agent.id && (
                          <Sparkles className="ml-auto h-3 w-3 text-[rgb(137,129,229)] flex-shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* New chat shortcut */}
                  <div className="border-t border-[rgba(77,79,99,0.3)] p-1.5">
                    <button
                      onClick={startNewCoordinatorChat}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs
                        text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-primary))]
                        hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                    >
                      <Plus className="h-3 w-3" /> New chat
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Vertical divider */}
            <div className="w-px h-5 bg-[rgb(var(--border))] flex-shrink-0" />

            {/* Text input */}
            <input
              ref={inputRef}
              placeholder={placeholder}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              className="flex-1 min-w-0 bg-transparent text-sm text-[rgb(var(--text-primary))]
                placeholder-[rgb(var(--text-muted))] focus:outline-none disabled:opacity-50 px-1"
            />

            {/* Send button */}
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || sending}
              className={cn(
                'h-9 w-9 flex items-center justify-center rounded-full flex-shrink-0 transition-all',
                input.trim() && !sending
                  ? 'bg-[rgb(137,129,229)] text-white hover:bg-[rgb(122,120,208)] shadow-sm'
                  : 'bg-[rgba(137,129,229,0.15)] text-[rgb(var(--text-muted))] cursor-not-allowed',
              )}
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="mt-2 text-center text-[10px] text-[rgb(var(--text-muted))]">
            {mode === 'coordinator'
              ? 'Smart routing active — Nexus selects the best agent automatically'
              : `Direct mode — talking to ${agentLabel}`}
          </p>
        </div>
      </div>
    </div>
  );
}
