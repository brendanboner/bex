import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import type { CoreMessage, CoreTool, LanguageModel } from 'ai';
import { generateText } from 'ai';
import { z } from 'zod';
import jwt from 'jsonwebtoken';

import type { LlmProvider, SkillTool, ToolCallResult } from '@bclaw/shared';
import type { CredentialVaultService } from '@bclaw/credential-vault';

export function buildLlmModel(provider: LlmProvider, model: string, apiKey?: string, baseUrl?: string, apiVersion?: string): LanguageModel {
  const openaiKey = apiKey ?? process.env['OPENAI_API_KEY'];
  const anthropicKey = apiKey ?? process.env['ANTHROPIC_API_KEY'];
  const azureKey = apiKey ?? process.env['AZURE_OPENAI_API_KEY'];
  const azureEndpoint = baseUrl ?? process.env['AZURE_OPENAI_ENDPOINT'];
  const azureApiVersion = apiVersion ?? process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-08-01-preview';

  switch (provider) {
    case 'openai':
      if (!openaiKey) throw new Error('OPENAI_API_KEY not set');
      return createOpenAI({ apiKey: openaiKey })(model);
    case 'anthropic':
      if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');
      return createAnthropic({ apiKey: anthropicKey })(model);
    case 'azure-openai': {
      if (!azureKey) throw new Error('AZURE_OPENAI_API_KEY not set');
      if (!azureEndpoint) throw new Error('Azure endpoint not configured — set AZURE_OPENAI_ENDPOINT or configure an LLM config with an endpoint');
      const azureBaseURL = `${azureEndpoint.replace(/\/$/, '')}/openai/deployments`;
      // Inject api-version query param since older SDK versions hardcode theirs
      const azureFetch: typeof fetch = (url, init) => {
        const u = new URL(url.toString());
        u.searchParams.set('api-version', azureApiVersion);
        return fetch(u.toString(), init);
      };
      return createAzure({ apiKey: azureKey, baseURL: azureBaseURL, fetch: azureFetch })(model);
    }
    case 'ollama': {
      const ollamaBase = baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
      return createOpenAI({ baseURL: `${ollamaBase.replace(/\/$/, '')}/v1`, apiKey: 'ollama' })(model);
    }
    default:
      throw new Error(`Unknown LLM provider: ${String(provider)}`);
  }
}

type ExtendedSkillTool = SkillTool & {
  handlerType?: string;
  config?: Record<string, unknown>;
};

/** In-process token cache for xiq_http_call — avoids re-logging in on every tool call. */
const xciqTokenCache = new Map<string, { token: string; expiresAt: number }>();

/** In-process token cache for xco_http_call — per XCO endpoint. */
const xcoTokenCache = new Map<string, { token: string; expiresAt: number }>();

function getCachedToken(credentialId: string): string | null {
  const entry = xciqTokenCache.get(credentialId);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) { xciqTokenCache.delete(credentialId); return null; }
  return entry.token;
}

function setCachedToken(credentialId: string, token: string, expiresInSeconds = 82800): void {
  // Use 82800s (23h) as TTL — slightly shorter than the 24h API max to be safe
  xciqTokenCache.set(credentialId, { token, expiresAt: Date.now() + expiresInSeconds * 1000 });
}

function getXcoToken(cacheKey: string): string | null {
  const entry = xcoTokenCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) { xcoTokenCache.delete(cacheKey); return null; }
  return entry.token;
}

function setXcoToken(cacheKey: string, token: string, expiresInSeconds = 3600): void {
  xcoTokenCache.set(cacheKey, { token, expiresAt: Date.now() + expiresInSeconds * 1000 });
}

/**
 * Endpoint reachability cache.
 * Caches whether a base URL is reachable so we don't block every tool call
 * when the endpoint is on a private network or VPN (XCO, etc.).
 * OK results cached 60s; failures cached 15s (retry sooner after network change).
 */
const reachabilityCache = new Map<string, { reachable: boolean; checkedAt: number; error?: string }>();

/**
 * Returns the current cached reachability status for a base URL.
 * Used by tool-router.ts to skip entire skill domains that are unreachable.
 *  - `true`      — endpoint confirmed reachable (within TTL)
 *  - `false`     — endpoint confirmed unreachable (within TTL)
 *  - `undefined` — not yet checked (allow through — will be checked at first call)
 */
export function getCachedReachability(baseUrl: string): boolean | undefined {
  try {
    const origin = new URL(baseUrl).origin;
    const cached = reachabilityCache.get(origin);
    if (!cached) return undefined;
    const ttl = cached.reachable ? 60_000 : 15_000;
    if (Date.now() - cached.checkedAt > ttl) return undefined;  // stale
    return cached.reachable;
  } catch {
    return undefined;
  }
}

async function checkReachable(baseUrl: string, timeoutMs = 4000): Promise<{ reachable: boolean; error?: string }> {
  try {
    const origin = new URL(baseUrl).origin;
    const cached = reachabilityCache.get(origin);
    const now = Date.now();
    if (cached) {
      const ttl = cached.reachable ? 60_000 : 15_000;
      if (now - cached.checkedAt < ttl) return cached.error !== undefined
        ? { reachable: cached.reachable, error: cached.error }
        : { reachable: cached.reachable };
    }

    const { fetch: undiFetch, Agent: UndiAgent } = await import('undici');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Use a TLS-permissive agent so HTTPS endpoints with self-signed certs don't
    // falsely report as unreachable (e.g. XCO EFA uses a self-signed certificate).
    const dispatcher = origin.startsWith('https:') ? new UndiAgent({ connect: { rejectUnauthorized: false } }) : undefined;
    try {
      await undiFetch(origin, { method: 'HEAD', signal: controller.signal, ...(dispatcher ? { dispatcher } : {}) });
      reachabilityCache.set(origin, { reachable: true, checkedAt: now });
      return { reachable: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isTimeout = msg.includes('abort') || msg.includes('timeout');
      const hint = isTimeout
        ? `Connection to ${origin} timed out — endpoint may require VPN or private network access`
        : `Cannot reach ${origin} — ${msg}`;
      reachabilityCache.set(origin, { reachable: false, checkedAt: now, error: hint });
      return { reachable: false, error: hint };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Invalid URL — let the actual call fail naturally
    return { reachable: true };
  }
}

/**
 * Converts a skill's tool definitions into Vercel AI SDK tool objects.
 * Supports legacy endpoint-based tools as well as the newer handlerType/config format.
 */
export function buildTools(
  skillTools: SkillTool[],
  vault: CredentialVaultService,
  agentPermissions: string[],
  credentialId: string | undefined,
): Record<string, CoreTool> {
  const tools: Record<string, CoreTool> = {};

  for (const rawTool of skillTools) {
    const skillTool = rawTool as ExtendedSkillTool;

    const paramDef = skillTool.parameters as {
      properties?: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
    const required = new Set(paramDef.required ?? []);

    const paramSchema = z.object(
      Object.fromEntries(
        Object.entries(paramDef.properties ?? {}).map(([key, val]) => {
          const base =
            val.type === 'string'
              ? z.string().describe(val.description ?? key)
              : val.type === 'number'
              ? z.number().describe(val.description ?? key)
              : val.type === 'integer'
              ? z.number().int().describe(val.description ?? key)
              : val.type === 'boolean'
              ? z.boolean().describe(val.description ?? key)
              : z.unknown();
          return [key, required.has(key) ? base : base.optional()];
        }),
      ),
    );

    tools[skillTool.name] = {
      description: skillTool.description,
      parameters: paramSchema,
      execute: async (args: Record<string, unknown>): Promise<unknown> => {
        const handlerType = skillTool.handlerType;
        const config = skillTool.config ?? {};

        // ── xiq_http_call: ExtremeCloud IQ login-then-call pattern ───────────
        // Logs in via POST /login with username/password credential, then calls
        // the actual API endpoint using the returned Bearer token.
        // Accepts both 'xiq_http_call' and legacy 'xciq_http_call' handler names.
        if (handlerType === 'xiq_http_call' || handlerType === 'xciq_http_call') {
          if (!credentialId) {
            return { error: 'xiq_http_call requires a credentialId' };
          }
          const loginUrl = (config['loginUrl'] as string | undefined) ?? 'https://api.extremecloudiq.com/login';
          const urlTemplate = (config['urlTemplate'] as string | undefined) ?? '';
          const method = ((config['method'] as string | undefined) ?? 'GET').toUpperCase();
          if (!urlTemplate) return { error: 'No urlTemplate configured for xiq_http_call tool' };

          // Quick reachability check — fail fast if endpoint is unreachable (VPN, private net, etc.)
          const reach = await checkReachable(loginUrl);
          if (!reach.reachable) {
            return { error: reach.error ?? `Cannot reach ${loginUrl}`, hint: 'Check VPN or network connectivity' };
          }

          const { fetch } = await import('undici');

          // Step 1: Get access_token — use cache to avoid re-logging in on every call
          let accessToken = getCachedToken(credentialId);
          if (!accessToken) {
            // Resolve username/password from vault and login
            const creds = await vault.resolve(credentialId, agentPermissions);
            // Support both bex-init key names (xiq_username/xiq_password) and canonical (username/password)
            const username = String(creds['username'] ?? creds['xiq_username'] ?? '');
            const password = String(creds['password'] ?? creds['xiq_password'] ?? '');

            const loginResp = await fetch(loginUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ username, password }),
            });
            if (!loginResp.ok) {
              return { error: `ExtremeCloud IQ login failed: ${loginResp.status}` };
            }
            const loginData = await loginResp.json() as { access_token?: string; expires_in?: number };
            accessToken = loginData.access_token ?? null;
            if (!accessToken) return { error: 'No access_token in ExtremeCloud IQ login response' };
            setCachedToken(credentialId, accessToken, loginData.expires_in ?? 82800);
            console.info(`[xiq_http_call] Logged in, token cached for credential ${credentialId}`);
          }

          // Step 2: Build URL — replace {param} placeholders, drop empty optional params
          // Arrays are expanded to repeated query params: views=A&views=B
          const expandValue = (k: string, v: unknown): string => {
            if (Array.isArray(v)) {
              return v.map((item) => `${k}=${encodeURIComponent(String(item))}`).join('&');
            }
            return `${k}=${encodeURIComponent(String(v))}`;
          };

          let rawUrl = urlTemplate
            // Query string params: [?&]key={param}
            .replace(/([?&])([^=]+)=\{(\w+)\}/g, (full, sep, k, argKey) => {
              const v = args[argKey];
              if (v == null || v === '') return '';
              return `${sep}${expandValue(k, v)}`;
            })
            // Path params: {param}
            .replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(args[k] ?? '')));

          // Normalize: if ? was stripped but & params remain, promote the first & to ?
          // e.g. "https://api.example.com/devices&limit=100" → "...devices?limit=100"
          if (!rawUrl.includes('?') && rawUrl.includes('&')) {
            rawUrl = rawUrl.replace('&', '?');
          }
          // Clean up any double ? or dangling & at end
          const url = rawUrl.replace(/[?&]+$/, '').replace(/\?&/g, '?').replace(/&&+/g, '&');

          // Step 3: Call API with Bearer token
          const fetchOpts: Parameters<typeof fetch>[1] = {
            method,
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
          };
          if (method !== 'GET' && method !== 'HEAD') {
            fetchOpts.body = JSON.stringify(args);
          }
          let apiResp = await fetch(url, fetchOpts);
          // On 401, clear token cache and retry once with a fresh login
          if (apiResp.status === 401) {
            xciqTokenCache.delete(credentialId);
            console.info(`[xiq_http_call] 401 — clearing token cache, re-logging in`);
            const creds2 = await vault.resolve(credentialId, agentPermissions);
            const freshLogin = await fetch(loginUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ username: String(creds2['username'] ?? creds2['xiq_username'] ?? ''), password: String(creds2['password'] ?? creds2['xiq_password'] ?? '') }),
            });
            if (freshLogin.ok) {
              const freshData = await freshLogin.json() as { access_token?: string; expires_in?: number };
              if (freshData.access_token) {
                setCachedToken(credentialId, freshData.access_token, freshData.expires_in ?? 82800);
                fetchOpts.headers = { ...fetchOpts.headers as object, Authorization: `Bearer ${freshData.access_token}` };
                apiResp = await fetch(url, fetchOpts);
              }
            }
          }
          const apiText = await apiResp.text();
          console.info(`[xiq_http_call] ${method} ${url} → ${apiResp.status}`);
          if (!apiResp.ok) {
            return { error: `ExtremeCloud IQ API error ${apiResp.status}`, url, detail: apiText.slice(0, 500) };
          }
          try {
            return JSON.parse(apiText);
          } catch {
            return { result: apiText.slice(0, 2000) };
          }
        }

        // ── xco_http_call: ExtremeCloud Orchestrator auth-then-call pattern ─
        // XCO EFA REST API: POST /v1/auth/token/access-token → { "access-token": "..." }
        // All endpoints use HTTPS with a self-signed cert (rejectUnauthorized: false).
        // The LLM never sees credentials — only the resolved Bearer token is used.
        if (handlerType === 'xco_http_call') {
          console.info(`[xco_http_call] execute() called for tool: ${skillTool.name}`);
          const effectiveCredId = (config['resolvedCredentialId'] as string | undefined) ?? credentialId;
          if (!effectiveCredId) return { error: 'xco_http_call requires a credential. Configure an xco-admin credential in the dashboard.' };

          const urlTemplate = (config['urlTemplate'] as string | undefined) ?? skillTool.endpoint ?? '';
          if (!urlTemplate) return { error: 'No URL template configured for xco_http_call tool' };
          const method = ((config['method'] as string | undefined) ?? 'GET').toUpperCase();

          // Replace {param} placeholders — support both word-chars and hyphenated names (e.g. {fabric-name})
          const url = urlTemplate.replace(/\{([^}]+)\}/g, (full, k: string) => {
            const val = args[k] ?? args[k.replace(/-/g, '_')] ?? args[k.replace(/_/g, '-')];
            return val !== undefined ? encodeURIComponent(String(val)) : full;
          });

          // Derive XCO EFA auth URL: strip path and append the correct token endpoint
          const defaultAuthUrl = (() => {
            try { const u = new URL(url); return `${u.protocol}//${u.host}/v1/auth/token/access-token`; } catch { return ''; }
          })();
          const authUrl = (config['authUrl'] as string | undefined) ?? defaultAuthUrl;
          console.info(`[xco_http_call] Auth URL: ${authUrl}, API URL: ${url}`);

          // Use undici with TLS verification disabled (XCO uses self-signed cert)
          const { fetch: nodeFetch, Agent: UndiciAgent } = await import('undici');
          const tlsAgent = new UndiciAgent({ connect: { rejectUnauthorized: false } });
          const xcoFetch: typeof nodeFetch = (u, opts) => nodeFetch(u, { ...opts, dispatcher: tlsAgent });

          // Quick reachability check
          const xcoReach = await checkReachable(authUrl || url);
          if (!xcoReach.reachable) {
            return { error: xcoReach.error ?? `Cannot reach XCO endpoint`, hint: 'XCO is on a private network — ensure VPN is connected or the host is reachable' };
          }

          const cacheKey = `${effectiveCredId}:${authUrl}`;

          const doAuth = async (): Promise<string | null> => {
            const creds = await vault.resolve(effectiveCredId, agentPermissions);
            const authResp = await xcoFetch(authUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ username: String(creds['username'] ?? ''), password: String(creds['password'] ?? '') }),
            });
            if (!authResp.ok) {
              const errText = await authResp.text();
              console.error(`[xco_http_call] Auth failed (${authResp.status}): ${errText.slice(0, 200)}`);
              return null;
            }
            // XCO EFA returns { "access-token": "...", "token-type": "Bearer", ... }
            const authData = await authResp.json() as Record<string, unknown>;
            const token = String(authData['access-token'] ?? authData['token'] ?? authData['access_token'] ?? '');
            if (!token) return null;
            const expiresIn = Number(authData['expires_in'] ?? 3600);
            setXcoToken(cacheKey, token, expiresIn);
            console.info(`[xco_http_call] Authenticated to XCO (${authUrl}), token cached`);
            return token;
          };

          // Get or refresh token
          let accessToken = getXcoToken(cacheKey) ?? await doAuth();
          if (!accessToken) return { error: 'XCO authentication failed — check xco-admin credentials in the vault' };

          // Make the actual API call
          const fetchOpts: Parameters<typeof xcoFetch>[1] = {
            method,
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
          };
          if (method !== 'GET' && method !== 'HEAD') {
            fetchOpts.body = JSON.stringify(args);
          }
          let apiResp = await xcoFetch(url, fetchOpts);

          // Retry once on 401 (token expired)
          if (apiResp.status === 401) {
            xcoTokenCache.delete(cacheKey);
            const freshToken = await doAuth();
            if (freshToken) {
              fetchOpts.headers = { ...fetchOpts.headers as object, Authorization: `Bearer ${freshToken}` };
              apiResp = await xcoFetch(url, fetchOpts);
            }
          }

          const apiText = await apiResp.text();
          console.info(`[xco_http_call] ${method} ${url} → ${apiResp.status}`);
          if (!apiResp.ok) {
            return { error: `XCO API error ${apiResp.status}`, url, detail: apiText.slice(0, 500) };
          }
          try { return JSON.parse(apiText); } catch { return { result: apiText.slice(0, 2000) }; }
        }

        // ── public_http_call: direct fetch, no credentials ────────────────
        if (handlerType === 'public_http_call') {
          const urlTemplate = (config['urlTemplate'] as string | undefined) ?? skillTool.endpoint ?? '';
          if (!urlTemplate) return { error: 'No URL template configured for this tool' };
          const method = ((config['method'] as string | undefined) ?? 'GET').toUpperCase();
          // Replace {param} placeholders in URL template
          let publicRawUrl = urlTemplate.replace(/([?&][^=]+=)\{(\w+)\}/g, (full, prefix, k) => {
            const v = args[k];
            return v != null && v !== '' ? `${prefix}${encodeURIComponent(String(v))}` : '';
          }).replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(args[k] ?? '')));
          if (!publicRawUrl.includes('?') && publicRawUrl.includes('&')) publicRawUrl = publicRawUrl.replace('&', '?');
          const url = publicRawUrl.replace(/[?&]+$/, '').replace(/\?&/g, '?').replace(/&&+/g, '&');

          // Quick reachability check
          const pubReach = await checkReachable(url);
          if (!pubReach.reachable) {
            return { error: pubReach.error ?? `Cannot reach endpoint`, hint: 'Endpoint may be down or require VPN' };
          }

          const { fetch } = await import('undici');
          const fetchOpts: Parameters<typeof fetch>[1] = {
            method,
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          };
          if (method !== 'GET' && method !== 'HEAD') {
            fetchOpts.body = JSON.stringify(args);
          }
          const resp = await fetch(url, fetchOpts);
          const text = await resp.text();
          if (!resp.ok) {
            return { error: `HTTP ${resp.status}`, detail: text.slice(0, 500) };
          }
          try {
            return JSON.parse(text);
          } catch {
            return { result: text.slice(0, 2000) };
          }
        }

        // ── http_call: vault-proxied call with credentials ─────────────────
        if (handlerType === 'http_call' || skillTool.endpoint) {
          const urlTemplate = (config['urlTemplate'] as string | undefined) ?? skillTool.endpoint ?? '';
          // Use per-tool credential (injected by orchestrator for domain-specific skills) or agent default
          const effectiveCredentialId = (config['resolvedCredentialId'] as string | undefined) ?? credentialId;

          // If no credential is available, fall back to a public (unauthenticated) call.
          // This handles skills whose tools have a plain endpoint but no required credentials.
          if (!effectiveCredentialId && urlTemplate) {
            const method = ((skillTool as Record<string, unknown>)['method'] as string ?? config['method'] as string ?? 'GET').toUpperCase();
            let publicUrl = urlTemplate;
            // Append all args as query params for GET requests
            if (method === 'GET') {
              const params = new URLSearchParams();
              for (const [k, v] of Object.entries(args)) {
                if (v != null && v !== '') params.set(k, String(v));
              }
              const qs = params.toString();
              publicUrl = qs ? `${urlTemplate}?${qs}` : urlTemplate;
            }
            const pubReach = await checkReachable(publicUrl);
            if (!pubReach.reachable) {
              return { error: pubReach.error ?? 'Cannot reach endpoint', hint: 'Endpoint may be down or require VPN' };
            }
            const { fetch } = await import('undici');
            const opts: Parameters<typeof fetch>[1] = { method, headers: { 'Accept': 'application/json' } };
            if (method !== 'GET' && method !== 'HEAD') opts.body = JSON.stringify(args);
            const resp = await fetch(publicUrl, opts);
            const text = await resp.text();
            if (!resp.ok) return { error: `HTTP ${resp.status}`, detail: text.slice(0, 500) };
            try { return JSON.parse(text); } catch { return { result: text.slice(0, 2000) }; }
          }

          if (!urlTemplate || !effectiveCredentialId) {
            return { result: 'schema-only', args, note: 'Tool has no endpoint or credential configured. Assign an endpoint and credential in the dashboard.' };
          }
          const method = ((config['method'] as string | undefined) ?? 'POST').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
          // Replace {param} arg placeholders (word chars only — host placeholders resolved earlier by orchestrator)
          const url = urlTemplate.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(args[k] ?? '')));

          // Quick reachability check
          const httpReach = await checkReachable(url);
          if (!httpReach.reachable) {
            return { error: httpReach.error ?? `Cannot reach endpoint`, hint: 'Endpoint may require VPN or private network access' };
          }

          const injection = (config['injection'] ?? { type: 'bearer' }) as
            | { type: 'bearer' }
            | { type: 'header'; key: string }
            | { type: 'query'; key: string }
            | { type: 'basic' };
          const result = await vault.proxyRequest(
            { credentialId: effectiveCredentialId, method, url, body: args, injection },
            agentPermissions,
          );
          return result.body;
        }

        // ── bex_api_call: call the BEX api-gateway with a system-signed JWT ─
        if (handlerType === 'bex_api_call') {
          const apiBase = (process.env['BEX_API_URL'] ?? 'http://localhost:4000').replace(/\/$/, '');
          const jwtSecret = process.env['JWT_SECRET'] ?? 'dev-secret';
          const urlPath = (config['urlPath'] as string | undefined) ?? '/scheduled-jobs';
          const method = ((config['method'] as string | undefined) ?? 'GET').toUpperCase();

          // Replace {param} arg placeholders in path (e.g. /scheduled-jobs/{id})
          const resolvedPath = urlPath.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(args[k] ?? '')));
          const url = `${apiBase}${resolvedPath}`;

          // Short-lived system token — signed with the shared JWT_SECRET
          const token = jwt.sign({ sub: 'system', isSystemUser: true }, jwtSecret, { expiresIn: 60 });
          const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          };

          const body = method === 'GET' ? undefined : JSON.stringify(args);
          try {
            const fetchOpts: RequestInit = { method, headers };
            if (body !== undefined) fetchOpts.body = body;
            const res = await fetch(url, fetchOpts);
            const data = await res.json() as unknown;
            return (data as { data?: unknown }).data ?? data;
          } catch (e) {
            return { error: `BEX API call failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        // ── xiq_topology_report: composite XIQ correlation — one call does full SSID→VLAN→client mapping ─
        // Internally runs: login → list_vlan_profiles → list_network_polices → list_ssids_by_network_policy
        // (for each policy) → list_user_profiles → list_active_clients, then correlates and returns JSON.
        if (handlerType === 'xiq_topology_report') {
          if (!credentialId) return { error: 'xiq_topology_report requires a credentialId' };

          const loginUrl = (config['loginUrl'] as string | undefined) ?? 'https://api.extremecloudiq.com/login';
          const apiBase = 'https://api.extremecloudiq.com';

          // Quick reachability check
          const reach = await checkReachable(loginUrl);
          if (!reach.reachable) {
            return { error: reach.error ?? `Cannot reach ${loginUrl}`, hint: 'Check VPN or network connectivity' };
          }

          const { fetch } = await import('undici');

          // Shared helper: get/refresh Bearer token
          const getToken = async (): Promise<string | null> => {
            let token = getCachedToken(credentialId!);
            if (!token) {
              const creds = await vault.resolve(credentialId!, agentPermissions);
              const username = String(creds['username'] ?? creds['xiq_username'] ?? '');
              const password = String(creds['password'] ?? creds['xiq_password'] ?? '');
              const resp = await fetch(loginUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ username, password }),
              });
              if (!resp.ok) return null;
              const data = await resp.json() as { access_token?: string; expires_in?: number };
              token = data.access_token ?? null;
              if (token) setCachedToken(credentialId!, token, data.expires_in ?? 82800);
            }
            return token;
          };

          // Shared helper: GET paginated data from XIQ
          const xiqGet = async (token: string, path: string, params: Record<string, string | number> = {}): Promise<unknown[]> => {
            const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
            const url = `${apiBase}${path}${qs ? '?' + qs : ''}`;
            const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
            console.info(`[xiq_topology_report] GET ${url} → ${resp.status}`);
            if (!resp.ok) {
              const errText = await resp.text().catch(() => '');
              console.warn(`[xiq_topology_report] ${path} failed: ${resp.status} ${errText.slice(0,200)}`);
              return [];
            }
            const body = await resp.json() as { data?: unknown[] } | unknown[];
            // XIQ endpoints return either {data: [...]} or a bare array
            if (Array.isArray(body)) return body;
            return (body as { data?: unknown[] }).data ?? [];
          };

          try {
            const token = await getToken();
            if (!token) return { error: 'XIQ login failed' };

            // Step 1: VLAN profiles — build map of profileId → {vlan_id, vlan_name}
            const vlanProfiles = await xiqGet(token, '/vlan-profiles', { page: 1, limit: 100 });
            const vlanProfileMap = new Map<number, { vlan_id: number; vlan_name: string; description: string }>();
            for (const vp of vlanProfiles as Array<Record<string, unknown>>) {
              const pid = vp['id'] as number;
              vlanProfileMap.set(pid, {
                vlan_id: (vp['default_vlan_id'] as number) ?? 0,
                vlan_name: String(vp['name'] ?? ''),
                description: String(vp['description'] ?? ''),
              });
            }

            // Step 2: Network policies
            const policies = await xiqGet(token, '/network-policies', { page: 1, limit: 50 });

            // Step 3: SSIDs per policy — collect all with their user profile IDs
            const ssidMap = new Map<string, { profileId: number }>(); // ssid name → profileId
            for (const policy of policies as Array<Record<string, unknown>>) {
              const policyId = policy['id'] as number;
              const ssids = await xiqGet(token, `/network-policies/${policyId}/ssids`, { page: 1, limit: 100 });
              for (const s of ssids as Array<Record<string, unknown>>) {
                const ssidName = String(s['name'] ?? s['ssid'] ?? '');
                const profileId = (s['default_user_profile'] as number) ?? 0;
                if (ssidName && !ssidMap.has(ssidName)) {
                  ssidMap.set(ssidName, { profileId });
                }
              }
            }

            // Step 4: User profiles — map profileId → VLAN profile ID
            const userProfiles = await xiqGet(token, '/user-profiles', { page: 1, limit: 100 });
            const profileVlanMap = new Map<number, { vlan_id: number; vlan_name: string }>();
            for (const up of userProfiles as Array<Record<string, unknown>>) {
              const upId = up['id'] as number;
              const vp = up['vlan_profile'] as Record<string, unknown> | undefined;
              if (vp) {
                const vpId = vp['id'] as number;
                const resolved = vlanProfileMap.get(vpId);
                if (resolved) {
                  profileVlanMap.set(upId, { vlan_id: resolved.vlan_id, vlan_name: resolved.vlan_name });
                } else {
                  profileVlanMap.set(upId, {
                    vlan_id: (vp['default_vlan_id'] as number) ?? 0,
                    vlan_name: String(vp['name'] ?? ''),
                  });
                }
              }
            }

            // Step 5: Active clients — group by SSID, also collect IPs for subnet detection
            const clients = await xiqGet(token, '/clients/active', { page: 1, limit: 100 });
            const clientsBySSID = new Map<string, number>();
            const ipsBySSID = new Map<string, string[]>();
            for (const c of clients as Array<Record<string, unknown>>) {
              const ssid = String(c['ssid'] ?? '');
              clientsBySSID.set(ssid, (clientsBySSID.get(ssid) ?? 0) + 1);
              const ip = String(c['ip_address'] ?? '');
              if (ip && ip !== '0.0.0.0' && ip !== '') {
                if (!ipsBySSID.has(ssid)) ipsBySSID.set(ssid, []);
                ipsBySSID.get(ssid)!.push(ip);
              }
            }
            const totalClients = clients.length;

            // Infer subnet from a list of IPs — returns CIDR or min–max range string
            const detectSubnet = (ips: string[]): string | null => {
              if (ips.length === 0) return null;
              const parsed = ips
                .map((ip) => ip.split('.').map(Number))
                .filter((p) => p.length === 4 && p.every((o) => o >= 0 && o <= 255));
              if (parsed.length === 0) return null;
              const f = parsed[0]!;
              if (parsed.every((p) => p[0] === f[0] && p[1] === f[1] && p[2] === f[2]))
                return `${f[0]}.${f[1]}.${f[2]}.0/24`;
              if (parsed.every((p) => p[0] === f[0] && p[1] === f[1]))
                return `${f[0]}.${f[1]}.0.0/16`;
              const sorted = [...parsed].sort((a, b) => a.join('.') < b.join('.') ? -1 : 1);
              const first = sorted[0]!;
              const last = sorted[sorted.length - 1]!;
              return `${first.join('.')} – ${last.join('.')}`;
            };

            // Step 6: Correlate
            const topology: Array<{ ssid: string; vlan_id: number | null; vlan_name: string | null; subnet: string | null; client_count: number }> = [];
            const vlanClientCount = new Map<number, number>();
            const vlanSSIDCount = new Map<number, number>();

            for (const [ssidName, { profileId }] of ssidMap) {
              const vlanInfo = profileVlanMap.get(profileId);
              const clientCount = clientsBySSID.get(ssidName) ?? 0;
              const vlanId = vlanInfo?.vlan_id ?? null;
              const vlanName = vlanInfo?.vlan_name ?? null;
              const subnet = detectSubnet(ipsBySSID.get(ssidName) ?? []);

              topology.push({ ssid: ssidName, vlan_id: vlanId, vlan_name: vlanName, subnet, client_count: clientCount });

              if (vlanId) {
                vlanClientCount.set(vlanId, (vlanClientCount.get(vlanId) ?? 0) + clientCount);
                vlanSSIDCount.set(vlanId, (vlanSSIDCount.get(vlanId) ?? 0) + 1);
              }
            }

            // Build VLAN summary from all known VLANs
            const vlanSummary = Array.from(vlanProfileMap.values())
              .map(({ vlan_id, vlan_name, description }) => ({
                vlan_id,
                vlan_name,
                description,
                ssid_count: vlanSSIDCount.get(vlan_id) ?? 0,
                client_count: vlanClientCount.get(vlan_id) ?? 0,
              }))
              .filter((v) => v.vlan_id > 0);

            return {
              summary: {
                total_ssids: topology.length,
                total_vlans: vlanSummary.length,
                total_clients: totalClients,
                timestamp: new Date().toISOString(),
              },
              topology: topology.sort((a, b) => b.client_count - a.client_count),
              vlan_summary: vlanSummary.sort((a, b) => b.client_count - a.client_count),
            };
          } catch (e) {
            return { error: `Topology report failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        // ── xiq_radio_quality_report: composite — login → list devices → radio info → grouped report ──
        if (handlerType === 'xiq_radio_quality_report') {
          if (!credentialId) return { error: 'xiq_radio_quality_report requires a credentialId' };

          const loginUrl2 = (config['loginUrl'] as string | undefined) ?? 'https://api.extremecloudiq.com/login';
          const apiBase2 = 'https://api.extremecloudiq.com';

          const reach2 = await checkReachable(loginUrl2);
          if (!reach2.reachable) {
            return { error: reach2.error ?? `Cannot reach ${loginUrl2}`, hint: 'Check VPN or network connectivity' };
          }

          const { fetch: fetch2 } = await import('undici');

          const getToken2 = async (): Promise<string | null> => {
            let token = getCachedToken(credentialId!);
            if (!token) {
              const creds = await vault.resolve(credentialId!, agentPermissions);
              const username = String(creds['username'] ?? creds['xiq_username'] ?? '');
              const password = String(creds['password'] ?? creds['xiq_password'] ?? '');
              const resp = await fetch2(loginUrl2, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ username, password }),
              });
              if (!resp.ok) return null;
              const data = await resp.json() as { access_token?: string; expires_in?: number };
              token = data.access_token ?? null;
              if (token) setCachedToken(credentialId!, token, data.expires_in ?? 82800);
            }
            return token;
          };

          const xiqGet2 = async (token: string, path: string, params: Record<string, string | number> = {}): Promise<unknown[]> => {
            const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
            const url = `${apiBase2}${path}${qs ? '?' + qs : ''}`;
            const resp = await fetch2(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
            console.info(`[xiq_radio_quality_report] GET ${url} → ${resp.status}`);
            if (!resp.ok) {
              const errText = await resp.text().catch(() => '');
              console.warn(`[xiq_radio_quality_report] ${path} failed: ${resp.status} ${errText.slice(0, 200)}`);
              return [];
            }
            const body = await resp.json() as { data?: unknown[] } | unknown[];
            if (Array.isArray(body)) return body;
            return (body as { data?: unknown[] }).data ?? [];
          };

          try {
            const token = await getToken2();
            if (!token) return { error: 'XIQ login failed' };

            // Step 1: List all devices — extracts numeric IDs
            const devices = await xiqGet2(token, '/devices', { page: 1, limit: 100 });
            const deviceIds: number[] = [];
            const deviceMap = new Map<number, { hostname: string; location: string; mac: string }>();
            for (const d of devices as Array<Record<string, unknown>>) {
              const id = d['id'] as number | undefined;
              if (typeof id === 'number') {
                deviceIds.push(id);
                deviceMap.set(id, {
                  hostname: String(d['hostname'] ?? d['name'] ?? ''),
                  location: String(d['location_id'] ?? ''),
                  mac: String(d['mac_address'] ?? ''),
                });
              }
            }

            if (deviceIds.length === 0) {
              return { error: 'No devices found in XIQ account', devices_checked: 0 };
            }

            // Step 2: Radio information — pass numeric IDs in batches of 20
            const radioResults: Array<Record<string, unknown>> = [];
            const batchSize = 20;
            for (let i = 0; i < deviceIds.length; i += batchSize) {
              const batch = deviceIds.slice(i, i + batchSize);
              const qs = batch.map((id) => `deviceIds=${id}`).join('&');
              const url = `${apiBase2}/devices/radio-information?${qs}`;
              const resp = await fetch2(url, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
              });
              console.info(`[xiq_radio_quality_report] GET /devices/radio-information → ${resp.status}`);
              if (resp.ok) {
                const body = await resp.json() as { data?: unknown[] } | unknown[];
                const items = Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? []);
                radioResults.push(...(items as Array<Record<string, unknown>>));
              }
            }

            // Step 3: Build structured report grouped by location
            const locationMap = new Map<string, Array<{
              hostname: string;
              mac: string;
              radios: Array<{ type: string; channel: number; tx_power: number; noise_floor: number; utilization?: number }>;
            }>>();

            for (const r of radioResults) {
              const deviceId = r['device_id'] as number;
              const device = deviceMap.get(deviceId) ?? { hostname: `Device ${deviceId}`, location: 'Unknown', mac: '' };
              const location = device.location || 'Unknown';
              const radioList = (r['radio_list'] as Array<Record<string, unknown>>) ?? [];

              const radios = radioList.map((radio) => ({
                type: String(radio['radio_type'] ?? radio['type'] ?? ''),
                channel: Number(radio['channel'] ?? 0),
                tx_power: Number(radio['tx_power'] ?? 0),
                noise_floor: Number(radio['noise_floor'] ?? 0),
                utilization: Number(radio['channel_utilization'] ?? 0),
              }));

              if (!locationMap.has(location)) locationMap.set(location, []);
              locationMap.get(location)!.push({ hostname: device.hostname, mac: device.mac, radios });
            }

            const locations = Array.from(locationMap.entries()).map(([name, aps]) => ({ name, aps }));

            return {
              summary: {
                total_devices: deviceIds.length,
                devices_with_radio_data: radioResults.length,
                total_locations: locations.length,
                timestamp: new Date().toISOString(),
              },
              locations,
              // Flat list for table widget compatibility
              radio_details: radioResults.map((r) => {
                const deviceId = r['device_id'] as number;
                const device = deviceMap.get(deviceId) ?? { hostname: `Device ${deviceId}`, location: 'Unknown', mac: '' };
                const radios = (r['radio_list'] as Array<Record<string, unknown>>) ?? [];
                return radios.map((radio) => ({
                  hostname: device.hostname,
                  location: device.location,
                  radio_type: String(radio['radio_type'] ?? ''),
                  channel: Number(radio['channel'] ?? 0),
                  tx_power_dbm: Number(radio['tx_power'] ?? 0),
                  noise_floor_dbm: Number(radio['noise_floor'] ?? 0),
                }));
              }).flat(),
            };
          } catch (e) {
            return { error: `Radio quality report failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        // ── xiq_client_health_report: composite — active clients with full radio/health details ──
        if (handlerType === 'xiq_client_health_report') {
          if (!credentialId) return { error: 'xiq_client_health_report requires a credentialId' };

          const loginUrlH = (config['loginUrl'] as string | undefined) ?? 'https://api.extremecloudiq.com/login';
          const apiBaseH = 'https://api.extremecloudiq.com';

          const reachH = await checkReachable(loginUrlH);
          if (!reachH.reachable) {
            return { error: reachH.error ?? `Cannot reach ${loginUrlH}`, hint: 'Check VPN or network connectivity' };
          }

          const { fetch: fetchH } = await import('undici');

          const getTokenH = async (): Promise<string | null> => {
            let token = getCachedToken(credentialId!);
            if (!token) {
              const creds = await vault.resolve(credentialId!, agentPermissions);
              const username = String(creds['username'] ?? creds['xiq_username'] ?? '');
              const password = String(creds['password'] ?? creds['xiq_password'] ?? '');
              const resp = await fetchH(loginUrlH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ username, password }),
              });
              if (!resp.ok) return null;
              const data = await resp.json() as { access_token?: string; expires_in?: number };
              token = data.access_token ?? null;
              if (token) setCachedToken(credentialId!, token, data.expires_in ?? 82800);
            }
            return token;
          };

          const xiqGetH = async (token: string, path: string, params: Record<string, string | number | string[]> = {}): Promise<unknown[]> => {
            const qs = Object.entries(params).flatMap(([k, v]) =>
              Array.isArray(v) ? v.map((vi) => `${k}=${encodeURIComponent(String(vi))}`) : [`${k}=${encodeURIComponent(String(v))}`]
            ).join('&');
            const url = `${apiBaseH}${path}${qs ? '?' + qs : ''}`;
            const resp = await fetchH(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
            console.info(`[xiq_client_health_report] GET ${url} → ${resp.status}`);
            if (!resp.ok) {
              const errText = await resp.text().catch(() => '');
              console.warn(`[xiq_client_health_report] ${path} failed ${resp.status}: ${errText.slice(0, 200)}`);
              return [];
            }
            const body = await resp.json() as { data?: unknown[] } | unknown[];
            if (Array.isArray(body)) return body;
            return (body as { data?: unknown[] }).data ?? [];
          };

          try {
            const token = await getTokenH();
            if (!token) return { error: 'XIQ login failed' };

            // Fetch active clients with CLIENT_DETAILS and HEALTH_STATUS views
            const clients = await xiqGetH(token, '/clients/active', {
              views: ['CLIENT_DETAILS', 'HEALTH_STATUS', 'BASIC'],
              limit: 100,
            }) as Array<Record<string, unknown>>;

            // Normalise and flatten the client records for dashboard table rendering
            const clientList = clients.map((c) => ({
              hostname: String(c['hostname'] ?? c['name'] ?? c['mac_address'] ?? ''),
              mac_address: String(c['mac_address'] ?? ''),
              ip_address: String(c['ip_address'] ?? ''),
              ssid: String(c['ssid'] ?? ''),
              connected_ap: String(c['connected_ap'] ?? c['ap_name'] ?? ''),
              snr: Number(c['snr'] ?? 0),
              rssi: Number(c['rssi'] ?? 0),
              health_score: Number(c['health_score'] ?? 0),
              os_type: String(c['os_type'] ?? ''),
              channel: Number(c['channel'] ?? 0),
              health_category: String(c['health_category'] ?? (Number(c['health_score'] ?? 50) >= 70 ? 'GOOD' : Number(c['health_score'] ?? 50) >= 40 ? 'FAIR' : 'POOR')),
            }));

            // Summaries
            const bySsid: Record<string, number> = {};
            const byAp: Record<string, number> = {};
            let poorSignalCount = 0;
            for (const c of clientList) {
              if (c.ssid) bySsid[c.ssid] = (bySsid[c.ssid] ?? 0) + 1;
              if (c.connected_ap) byAp[c.connected_ap] = (byAp[c.connected_ap] ?? 0) + 1;
              if (c.snr > 0 && c.snr < 20) poorSignalCount++;
            }

            const ssid_breakdown = Object.entries(bySsid)
              .map(([ssid, count]) => ({ ssid, client_count: count }))
              .sort((a, b) => b.client_count - a.client_count);

            const ap_breakdown = Object.entries(byAp)
              .map(([ap, count]) => ({ access_point: ap, client_count: count }))
              .sort((a, b) => b.client_count - a.client_count);

            return {
              summary: {
                total_clients: clientList.length,
                poor_signal_clients: poorSignalCount,
                ssid_count: ssid_breakdown.length,
                ap_count: ap_breakdown.length,
                timestamp: new Date().toISOString(),
              },
              clients: clientList.sort((a, b) => b.health_score - a.health_score),
              ssid_breakdown,
              ap_breakdown,
              poor_signal_clients: clientList.filter((c) => c.snr > 0 && c.snr < 20),
            };
          } catch (e) {
            return { error: `Client health report failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }
        if (handlerType === 'xiq_client_snapshot') {
          if (!credentialId) return { error: 'xiq_client_snapshot requires a credentialId' };

          const loginUrlC = (config['loginUrl'] as string | undefined) ?? 'https://api.extremecloudiq.com/login';
          const apiBaseC = 'https://api.extremecloudiq.com';

          const reachC = await checkReachable(loginUrlC);
          if (!reachC.reachable) {
            return { error: reachC.error ?? `Cannot reach ${loginUrlC}`, hint: 'Check VPN or network connectivity' };
          }

          const clientName = String(args['clientName'] ?? args['name'] ?? args['hostname'] ?? '');
          const clientMac = String(args['macAddress'] ?? args['mac'] ?? '');
          const lookbackMs = Number(args['lookbackHours'] ?? 24) * 3_600_000;
          const endTime = Date.now();
          const startTime = endTime - lookbackMs;

          if (!clientName && !clientMac) {
            return { error: 'xiq_client_snapshot requires clientName or macAddress parameter' };
          }

          const { fetch: fetchC } = await import('undici');

          const getTokenC = async (): Promise<string | null> => {
            let token = getCachedToken(credentialId!);
            if (!token) {
              const creds = await vault.resolve(credentialId!, agentPermissions);
              const username = String(creds['username'] ?? creds['xiq_username'] ?? '');
              const password = String(creds['password'] ?? creds['xiq_password'] ?? '');
              const resp = await fetchC(loginUrlC, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ username, password }),
              });
              if (!resp.ok) return null;
              const data = await resp.json() as { access_token?: string; expires_in?: number };
              token = data.access_token ?? null;
              if (token) setCachedToken(credentialId!, token, data.expires_in ?? 82800);
            }
            return token;
          };

          const xiqGetC = async (token: string, path: string, params: Record<string, string | number | string[]> = {}): Promise<unknown> => {
            const qs = Object.entries(params).flatMap(([k, v]) =>
              Array.isArray(v) ? v.map((vi) => `${k}=${encodeURIComponent(String(vi))}`) : [`${k}=${encodeURIComponent(String(v))}`]
            ).join('&');
            const url = `${apiBaseC}${path}${qs ? '?' + qs : ''}`;
            const resp = await fetchC(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
            console.info(`[xiq_client_snapshot] GET ${url} → ${resp.status}`);
            if (!resp.ok) {
              const txt = await resp.text().catch(() => '');
              console.warn(`[xiq_client_snapshot] ${path} failed ${resp.status}: ${txt.slice(0, 200)}`);
              return null;
            }
            return resp.json();
          };

          try {
            const token = await getTokenC();
            if (!token) return { error: 'XIQ login failed' };

            // Step 1: Find client — by name or MAC
            let clientRecord: Record<string, unknown> | null = null;
            let resolvedMac = clientMac;

            if (clientName) {
              const searchResp = await xiqGetC(token, '/clients/active', {
                searchString: clientName,
                views: ['CLIENT_DETAILS', 'HEALTH_STATUS', 'BASIC'],
                limit: 10,
              }) as { data?: unknown[] } | null;
              const matches = searchResp?.data ?? [];
              clientRecord = (matches[0] as Record<string, unknown>) ?? null;
              if (clientRecord) resolvedMac = String(clientRecord['mac_address'] ?? '');
            }

            if (!clientRecord && resolvedMac) {
              const byMacResp = await xiqGetC(token, `/clients/byMac/${encodeURIComponent(resolvedMac)}`, {
                views: ['CLIENT_DETAILS', 'HEALTH_STATUS', 'BASIC'],
              }) as Record<string, unknown> | null;
              clientRecord = byMacResp;
              if (clientRecord) resolvedMac = String(clientRecord['mac_address'] ?? resolvedMac);
            }

            const isCurrentlyConnected = clientRecord != null;
            const clientId = clientRecord ? (clientRecord['id'] as number | undefined) : null;

            // Step 2: If we have a numeric ID, get detailed stats and events
            let detailsInfo: unknown = null;
            let events: unknown[] = [];
            let connectionTrail: unknown = null;

            if (clientId) {
              const [detailResp, eventsResp] = await Promise.all([
                xiqGetC(token, `/client-details/overview/info/${clientId}`, { startTime, endTime }),
                xiqGetC(token, `/client-details/client-trail/connectivity-experience/${clientId}`, {
                  startTime, endTime, precision: 300000,
                }),
              ]);
              detailsInfo = detailResp;
              events = (eventsResp as { data?: unknown[] } | null)?.data
                ?? (Array.isArray(eventsResp) ? (eventsResp as unknown[]) : []);
            }

            // Step 3: Connection trail by MAC (always available if we have MAC)
            if (resolvedMac) {
              connectionTrail = await xiqGetC(token, `/client-details/topology/client-trail/${encodeURIComponent(resolvedMac)}`);
            }

            // Step 4: Build structured response
            return {
              client_name: clientName || resolvedMac,
              mac_address: resolvedMac || null,
              is_currently_connected: isCurrentlyConnected,
              current_connection: isCurrentlyConnected ? {
                connected_ap: clientRecord!['connected_ap'] ?? clientRecord!['ap_name'] ?? null,
                ssid: clientRecord!['ssid'] ?? null,
                ip_address: clientRecord!['ip_address'] ?? null,
                snr: clientRecord!['snr'] ?? null,
                rssi: clientRecord!['rssi'] ?? null,
                health_score: clientRecord!['health_score'] ?? null,
                channel: clientRecord!['channel'] ?? null,
                os_type: clientRecord!['os_type'] ?? null,
              } : null,
              recent_events: events.slice(0, 50),
              details: detailsInfo,
              connection_trail: connectionTrail,
              query_window: {
                start: new Date(startTime).toISOString(),
                end: new Date(endTime).toISOString(),
                lookback_hours: Number(args['lookbackHours'] ?? 24),
              },
              timestamp: new Date().toISOString(),
            };
          } catch (e) {
            return { error: `Client snapshot failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        // ── fallback: schema-only (no handler) ───────────────────────────
        return { result: 'schema-only', args, note: 'Tool has no handler configured; used for planning only.' };
      },
    };
  }

  return tools;
}

export type RunLlmOptions = {
  model: LanguageModel;
  messages: CoreMessage[];
  tools?: Record<string, CoreTool>;
  systemPrompt?: string;
  maxSteps?: number;
};

export type RunLlmResult = {
  text: string;
  toolCalls: ToolCallResult[];
  usage: { promptTokens: number; completionTokens: number };
};

export async function runLlm(options: RunLlmOptions): Promise<RunLlmResult> {
  const { text, usage, steps } = await generateText({
    model: options.model,
    ...(options.systemPrompt !== undefined ? { system: options.systemPrompt } : {}),
    messages: options.messages,
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
    maxSteps: options.maxSteps ?? 10,
  });

  const allToolCalls: ToolCallResult[] = [];
  for (const step of steps) {
    const stepToolCalls = step.toolCalls as Array<{ toolCallId: string; toolName: string; args?: unknown }>;
    const stepToolResults = step.toolResults as Array<{ toolCallId: string; result: unknown }> | undefined;
    for (const tc of stepToolCalls) {
      console.info(`[llm-runner] Tool call: ${tc.toolName}`);
      const matchingResult = stepToolResults?.find((r) => r.toolCallId === tc.toolCallId);
      if (matchingResult?.result && typeof matchingResult.result === 'object' && 'error' in (matchingResult.result as object)) {
        console.info(`[llm-runner] Tool error: ${JSON.stringify(matchingResult.result)}`);
      }
      allToolCalls.push({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        result: matchingResult?.result ?? null,
      });
    }
  }

  return {
    text,
    toolCalls: allToolCalls,
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    },
  };
}
