'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Brain,
  Calendar,
  ChevronRight,
  Clock,
  Globe,
  Key,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Network,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BexLogo } from './bex-logo';

const RAIL_W = 72;
const PANEL_W = 240;

const navSections = [
  {
    items: [
      { href: '/',           label: 'Overview',       icon: LayoutDashboard },
      { href: '/chat',       label: 'Nexus',          icon: MessageSquare },
      { href: '/agents',     label: 'Agents',         icon: Bot },
      { href: '/requests',   label: 'Activity',       icon: Clock },
      { href: '/dashboards', label: 'Dashboards',     icon: LayoutGrid },
    ],
  },
  {
    items: [
      { href: '/skills',   label: 'Skill Exchange', icon: Brain },
      { href: '/personas', label: 'Personas',       icon: UserPlus },
      { href: '/domains',  label: 'Domain Intel',   icon: Globe },
    ],
  },
  {
    items: [
      { href: '/scheduled-jobs', label: 'Scheduled',     icon: Calendar },
      { href: '/endpoints',      label: 'Endpoints',     icon: Network },
      { href: '/credentials',    label: 'Vault',         icon: Key },
      { href: '/users',          label: 'Users',         icon: Users },
      { href: '/setup',          label: 'Configuration', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [userInitials, setUserInitials] = useState('BX');
  const [userName, setUserName] = useState('BEX Admin');
  const [userEmail, setUserEmail] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('bex_token') ?? localStorage.getItem('bforge_token');
      if (!token) router.replace('/login');
      try {
        const payload = JSON.parse(atob(token!.split('.')[1]));
        const name = payload.displayName || payload.name || 'BEX Admin';
        setUserName(name);
        setUserInitials(name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase());
        if (payload.email) setUserEmail(payload.email);
      } catch {}
    }
  }, [router]);

  // Close when clicking outside the expanded panel
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (expanded && panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [expanded]);

  function logout() {
    localStorage.removeItem('bex_token');
    localStorage.removeItem('bforge_token');
    document.cookie = 'bex_token=; path=/; max-age=0';
    router.replace('/login');
  }

  return (
    <aside
      ref={panelRef}
      style={{ width: expanded ? PANEL_W : RAIL_W }}
      className="fixed top-0 left-0 h-screen z-[100] flex flex-col overflow-hidden
        transition-[width] duration-[350ms] ease-[cubic-bezier(0.16,1,0.3,1)]
        bg-[rgba(30,31,42,0.82)] backdrop-blur-xl
        border-r border-[rgb(var(--border-subtle,55,57,75))]"
    >
      {/* ── Top: logo / toggle ── */}
      <div className="flex items-center h-[72px] px-5 gap-3 flex-shrink-0">
        <button
          onClick={() => setExpanded(e => !e)}
          title={expanded ? 'Collapse' : 'Expand'}
          className="group relative w-8 h-8 flex items-center justify-center rounded-lg
            transition-colors hover:bg-[rgba(255,255,255,0.05)] flex-shrink-0"
        >
          <span className="transition-opacity duration-150 group-hover:opacity-0">
            <BexLogo size={22} showWordmark={false} showTagline={false} />
          </span>
          <span className="absolute inset-0 flex items-center justify-center opacity-0
            group-hover:opacity-100 transition-opacity duration-150
            text-[rgb(var(--text-secondary))]">
            <ChevronRight className={cn('h-4 w-4 transition-transform duration-300', expanded && 'rotate-180')} />
          </span>
        </button>

        <span className={cn(
          'text-sm font-semibold text-[rgb(var(--text-primary))] whitespace-nowrap overflow-hidden',
          'transition-opacity duration-200',
          expanded ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}>
          Bex Forge
        </span>
        <span className={cn(
          'ml-auto text-[10px] font-semibold rounded-md px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap',
          'bg-[rgba(137,129,229,0.15)] text-[rgb(137,129,229)]',
          'transition-opacity duration-200',
          expanded ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}>
          BETA
        </span>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto py-3 px-5 space-y-5
        [&::-webkit-scrollbar]:w-[3px]
        [&::-webkit-scrollbar-thumb]:rounded-full
        [&::-webkit-scrollbar-thumb]:bg-[rgb(var(--border))]">
        {navSections.map((section, si) => (
          <div key={si}>
            {si > 0 && <div className="mb-5 border-t border-[rgba(55,57,75,0.6)]" />}
            <div className="flex flex-col gap-0.5">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || (href !== '/' && pathname.startsWith(href));
                return (
                  <div key={href} className="relative group/item">
                    <Link
                      href={href}
                      onClick={() => setExpanded(false)}
                      className={cn(
                        'flex items-center gap-3 h-8 rounded-lg transition-all duration-150',
                        expanded ? 'w-full' : 'w-8',
                        active
                          ? 'bg-[rgba(137,129,229,0.12)] text-[rgb(var(--text-primary))]'
                          : 'text-[rgb(var(--text-secondary))] hover:bg-[rgba(255,255,255,0.04)] hover:text-[rgb(var(--text-primary))]',
                      )}
                    >
                      <span className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className={cn(
                        'text-sm font-medium truncate whitespace-nowrap',
                        'transition-opacity duration-200',
                        expanded ? 'opacity-100' : 'opacity-0 pointer-events-none',
                      )}>
                        {label}
                      </span>
                    </Link>
                    {/* Tooltip — only when collapsed */}
                    {!expanded && (
                      <span className="
                        absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2
                        bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border))]
                        text-[rgb(var(--text-primary))] text-xs rounded-md px-2 py-1
                        whitespace-nowrap shadow-m
                        opacity-0 group-hover/item:opacity-100
                        transition-opacity duration-150 pointer-events-none z-[200]
                      ">
                        {label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── User account ── */}
      <div className="flex items-center gap-3 px-5 pb-5 pt-4 flex-shrink-0
        border-t border-[rgba(55,57,75,0.6)]">
        <Link href="/account" title={!expanded ? userName : undefined} onClick={() => setExpanded(false)}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-purple-700
            flex items-center justify-center flex-shrink-0 hover:opacity-80 transition-opacity">
            <span className="text-[10px] font-bold text-white">{userInitials}</span>
          </div>
        </Link>
        <div className={cn(
          'flex-1 min-w-0 transition-opacity duration-200',
          expanded ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}>
          <p className="text-xs font-medium text-[rgb(var(--text-primary))] truncate">{userName}</p>
          <p className="text-[10px] text-[rgb(var(--text-muted))] truncate">{userEmail || 'v0.1.0'}</p>
        </div>
        <div className={cn(
          'flex items-center gap-1.5 flex-shrink-0 transition-opacity duration-200',
          expanded ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}>
          <Link href="/account" title="Account" onClick={() => setExpanded(false)}
            className="text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-secondary))] transition-colors">
            <KeyRound className="h-3.5 w-3.5" />
          </Link>
          <button onClick={logout} title="Sign out"
            className="text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-secondary))] transition-colors">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}

