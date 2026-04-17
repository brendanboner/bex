'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bot,
  Brain,
  Calendar,
  Clock,
  Key,
  LayoutDashboard,
  Network,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/skills', label: 'Skills', icon: Brain },
  { href: '/credentials', label: 'Credentials', icon: Key },
  { href: '/requests', label: 'Requests', icon: Clock },
  { href: '/endpoints', label: 'Endpoints', icon: Network },
  { href: '/scheduled-jobs', label: 'Scheduled Jobs', icon: Calendar },
  { href: '/users', label: 'Users', icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-card">
      <div className="flex h-16 items-center border-b px-6">
        <span className="text-xl font-bold tracking-tight text-primary">🦀 bclaw</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-6 py-2.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
              pathname === href
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="border-t p-4 text-xs text-muted-foreground">bclaw v0.1.0</div>
    </aside>
  );
}
