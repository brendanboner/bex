'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('bex_token') ?? localStorage.getItem('bforge_token') ?? '';
}

export default function AccountPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);

    if (next !== confirm) {
      setStatus({ ok: false, message: 'New passwords do not match.' });
      return;
    }
    if (next.length < 8) {
      setStatus({ ok: false, message: 'New password must be at least 8 characters.' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const json = await res.json();
      if (json.ok) {
        setStatus({ ok: true, message: 'Password changed successfully.' });
        setCurrent('');
        setNext('');
        setConfirm('');
      } else {
        setStatus({ ok: false, message: json.error?.message ?? 'Failed to change password.' });
      }
    } catch {
      setStatus({ ok: false, message: 'Could not reach the API. Is BEX running?' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="text-muted-foreground">Manage your login credentials.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>
            Your current password is required to confirm the change.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="current">Current password</label>
              <input
                id="current"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="new">New password</label>
              <input
                id="new"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={8}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="confirm">Confirm new password</label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {status && (
              <div className={`rounded-md px-3 py-2 text-sm ${status.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {status.message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
