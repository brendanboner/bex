'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@forge.local');
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
      localStorage.setItem('bclaw_token', json.data.token);
      router.replace('/');
    } catch {
      setError('Could not reach the API gateway. Is Forge running?');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-[rgb(var(--bg-base))]">
      {/* Left panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-400 flex items-center justify-center">
                <span className="text-sm font-bold text-white">FG</span>
              </div>
              <span className="text-lg font-semibold text-[rgb(var(--text-primary))]">Forge</span>
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
                className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3.5 py-2.5 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-colors"
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
                className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] px-3.5 py-2.5 text-sm text-[rgb(var(--text-primary))] placeholder-[rgb(var(--text-muted))] focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-colors"
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
              className="w-full rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white hover:from-violet-500 hover:to-fuchsia-400 disabled:opacity-50 transition-all shadow-[0_0_20px_rgba(124,58,237,0.3)] hover:shadow-[0_0_30px_rgba(124,58,237,0.5)]"
            >
              {loading ? 'Authenticating…' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-xs text-[rgb(var(--text-muted))]">
            Default: admin@forge.local · Forge2024!
          </p>
        </div>
      </div>

      {/* Right panel — decorative */}
      <div className="hidden lg:flex flex-1 items-center justify-center bg-[rgb(var(--bg-surface))] border-l border-[rgb(var(--border))]">
        <div className="text-center space-y-4 p-12">
          <div className="text-5xl font-black gradient-text">Forge</div>
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

