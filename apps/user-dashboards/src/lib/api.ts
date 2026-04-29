/// <reference types="vite/client" />

const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) || '/api';

export type Widget = {
  id: string;
  type: 'headline' | 'table' | 'chart' | 'actions';
  title?: string;
  dataKey?: string;
  columns?: string[];
  chartType?: 'bar' | 'line' | 'pie';
  xKey?: string;
  yKey?: string;
  colSpan?: number;
  actions?: Array<{
    label: string;
    action: 'refresh' | 'prompt';
    prompt?: string;
    style?: 'primary' | 'secondary' | 'danger';
  }>;
};

export type UserDashboard = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  agentId?: string;
  prompt: string;
  widgets: Widget[];
  refreshMode: 'manual' | 'scheduled' | 'realtime';
  cronExpr?: string;
  lastData?: Record<string, unknown>;
  lastRunAt?: string;
  status: 'active' | 'paused' | 'archived' | 'provisioning' | 'error';
  meta?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { message?: string } };

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const hasBody = options.body !== undefined && options.body !== null;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (res.status === 204) return undefined as unknown as T;

  // Parse JSON — guard against non-JSON responses (e.g. HTML error pages)
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Server returned non-JSON response (HTTP ${res.status})`);
  }

  const envelope = json as ApiResponse<T>;
  if (!envelope.ok) {
    // Our {ok:false, error:{code,message}} format
    const apiMsg = typeof envelope.error === 'object' && envelope.error !== null
      ? (envelope.error as { message?: string }).message
      : undefined;
    // Fastify native error format: {statusCode, error, message}
    const fastifyMsg = (json as { message?: string }).message;
    throw new Error(apiMsg ?? fastifyMsg ?? `HTTP ${res.status}`);
  }
  return envelope.data;
}

export const dashboardApi = {
  list: () => apiFetch<UserDashboard[]>('/user-dashboards'),
  get: (slug: string) => apiFetch<UserDashboard>(`/user-dashboards/${slug}`),
  refresh: (slug: string) =>
    apiFetch<UserDashboard>(`/user-dashboards/${slug}/refresh`, { method: 'POST' }),
};
