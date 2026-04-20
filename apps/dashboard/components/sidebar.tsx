'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Bot,
  Brain,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Key,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Monitor,
  Network,
  Package,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BexLogo } from './bex-logo';

const navSections = [
  {
    items: [
      { href: '/',         label: 'Overview',      icon: LayoutDashboard },
      { href: '/chat',     label: 'Nexus',         icon: MessageSquare },
      { href: '/agents',   label: 'Agents',        icon: Bot },
      { href: '/requests', label: 'Activity',      icon: Clock },
    ],
  },
  {
    items: [
      { href: '/skills',         label: 'Skill Exchange',  icon: Brain },
      { href: '/marketplace',    label: 'Marketplace',     icon: Package },
      { href: '/personas',       label: 'Personas',        icon: UserPlus },
    ],
  },
  {
    items: [
      { href: '/scheduled-jobs', label: 'Scheduled',       icon: Calendar },
      { href: '/targets',        label: 'Targets',         icon: Monitor },
      { href: '/endpoints',      label: 'Endpoints',       icon: Network },
      { href: '/credentials',    label: 'Vault',           icon: Key },
      { href: '/llm-configs',    label: 'LLM Providers',   icon: Cpu },
      { href: '/users',          label: 'Users',           icon: Users },
      { href: '/setup',          label: 'Configuration',   icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [userInitials, setUserInitials] = useState('BX');
  const [userName, setUserName] = useState('BEX Admin');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('bex_token') ?? localStorage.getItem('bforge_token');
      if (!token) router.replace('/login');
      // Parse display name from JWT if available
      try {
        const payload = JSON.parse(atob(token!.split('.')[1]));
        const name = payload.displayName || payload.name || 'BEX Admin';
        setUserName(name);
        setUserInitials(name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase());
      } catch {}
    }
  }, [router]);

  function logout() {
    localStorage.removeItem('bex_token');
    localStorage.removeItem('bforge_token');
    document.cookie = 'bex_token=; path=/; max-age=0';
    router.replace('/login');
  }

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r transition-all duration-200 relative',
        'border-[rgb(var(--border))] bg-[rgb(var(--bg-surface))]',
        collapsed ? 'w-14' : 'w-52',
      )}
    >
      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] transition-colors"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
      </button>

      {/* Logo mark */}
      <div className={cn(
        'flex h-14 items-center border-b border-[rgb(var(--border))]',
        collapsed ? 'justify-center px-0' : 'px-4',
      )}>
        <BexLogo size={28} showWordmark={!collapsed} showTagline={!collapsed} />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-4">
        {navSections.map((section, si) => (
          <div key={si}>
            {si > 0 && (
              <div className="mx-3 mb-3 border-t border-[rgb(var(--border-subtle))]" />
            )}
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== '/' && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  title={collapsed ? label : undefined}
                  className={cn(
                    'flex items-center gap-3 mx-2 px-2.5 py-2 rounded-lg text-sm transition-all',
                    active
                      ? 'bg-[rgba(6,182,212,0.12)] text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.12)]'
                      : 'text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--text-primary))]',
                    collapsed ? 'justify-center' : '',
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-cyan-300' : '')} />
                  {!collapsed && <span className="font-medium truncate">{label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User profile */}
      <div className={cn(
        'flex items-center border-t border-[rgb(var(--border))] p-3',
        collapsed ? 'justify-center' : 'gap-2.5',
      )}>
        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-white">{userInitials}</span>
        </div>
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[rgb(var(--text-primary))] truncate">{userName}</p>
              <p className="text-[10px] text-[rgb(var(--text-muted))]">v0.1.0</p>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text-secondary))] transition-colors shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

