type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { message?: string } };

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
const ADMIN_URL = process.env['NEXT_PUBLIC_ADMIN_API_URL'] ?? 'http://localhost:4001';

function getToken(): string {
  if (typeof window !== 'undefined') {
    const ls = localStorage.getItem('bex_token');
    if (ls) return ls;
    // Fallback: read from cookie (set after login, available to client JS)
    const cookie = document.cookie.split('; ').find(r => r.startsWith('bex_token='));
    const cookieVal = cookie ? cookie.split('=')[1] : '';
    if (cookieVal) {
      // Sync back to localStorage
      localStorage.setItem('bex_token', cookieVal);
    }
    return cookieVal;
  }
  return '';
}

async function apiFetch<T>(
  base: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const hasBody = options.body !== undefined && options.body !== null;
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  // 204 No Content — treat as success with no data
  if (res.status === 204) return undefined as unknown as T;

  const json = (await res.json()) as ApiResponse<T>;

  if (!json.ok) {
    const msg = json.error.message ?? 'API error';
    // Redirect to login on auth failure
    if (res.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('bex_token');
      document.cookie = 'bex_token=; path=/; max-age=0';
      window.location.href = '/login';
    }
    throw new Error(msg);
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
