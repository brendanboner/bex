'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BexLogo } from '@/components/bex-logo';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@bex.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? json.message ?? 'Authentication failed');
        setLoading(false);
        return;
      }
      localStorage.setItem('bex_token', json.data.token);
      // Keep legacy key for backwards compat
      localStorage.setItem('bforge_token', json.data.token);
      router.replace('/');
    } catch {
      setError('Could not reach the API gateway. Is BEX running?');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-[rgb(var(--bg-base))]">
      {/* Left panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2">
            <div className="mb-6">
              <BexLogo size={36} showTagline />
            </div>
            <h1 className="text-2xl font-bold text-[rgb(var(--text-primary))]">Welcome back</h1>
            <p className="text-sm text-[rgb(var(--text-secondary))]">Sign in to your workspace</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[rgb(var(--text-secondary))] uppercase tracking-wider" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3.5 py-2.5 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-colors"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[rgb(var(--text-secondary))] uppercase tracking-wider" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3.5 py-2.5 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-colors"
                required
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 px-4 py-2.5 text-sm font-semibold text-white hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 transition-all shadow-[0_0_20px_rgba(6,182,212,0.25)] hover:shadow-[0_0_30px_rgba(6,182,212,0.4)]"
            >
              {loading ? 'Authenticating…' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-xs text-[rgb(var(--text-muted))]">
            Default: admin@bex.local · BEX2024!
          </p>
        </div>
      </div>

      {/* Right panel — decorative */}
      <div className="hidden lg:flex flex-1 items-center justify-center bg-[rgb(var(--bg-surface))] border-l border-[rgb(var(--border))]">
        <div className="text-center space-y-6 p-12">
          <BexLogo size={64} showTagline />
          <p className="text-sm text-[rgb(var(--text-secondary))] max-w-xs leading-relaxed">
            Enterprise agentic platform. Build, deploy, and operate autonomous domain agents at scale.
          </p>
          <div className="flex gap-2 justify-center flex-wrap pt-2">
            {['XCO', 'XIQ', 'Kubernetes', 'Teams', 'Telegram'].map(t => (
              <span key={t} className="rounded-full border border-[rgb(var(--border))] px-3 py-1 text-xs text-[rgb(var(--text-muted))]">{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

