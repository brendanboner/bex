type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { message?: string } };

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
const ADMIN_URL = process.env['NEXT_PUBLIC_ADMIN_API_URL'] ?? 'http://localhost:4001';

function getToken(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('bclaw_token') ?? '';
  }
  return '';
}

async function apiFetch<T>(
  base: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const json = (await res.json()) as ApiResponse<T>;

  if (!json.ok) {
    throw new Error(json.error.message ?? 'API error');
  }

  return json.data;
}

// ─── Main API (api-gateway :4000) ────────────────────────────────────────────

export const api = {
  get: <T>(path: string) => apiFetch<T>(API_URL, path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(API_URL, path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(API_URL, path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(API_URL, path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => apiFetch<unknown>(API_URL, path, { method: 'DELETE' }),
};

// ─── Admin API (dashboard-api :4001) ─────────────────────────────────────────

export const adminApi = {
  get: <T>(path: string) => apiFetch<T>(ADMIN_URL, path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(ADMIN_URL, path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(ADMIN_URL, path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => apiFetch<unknown>(ADMIN_URL, path, { method: 'DELETE' }),
};
