import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import type { CoreMessage, CoreTool, LanguageModel } from 'ai';
import { generateText } from 'ai';
import { z } from 'zod';
import jwt from 'jsonwebtoken';

import type { LlmProvider, SkillTool, ToolCallResult } from '@bex/shared';
import type { CredentialVaultService } from '@bex/credential-vault';

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
    case 'azure':
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
 * Only populated by SUCCESSFUL probes. Used by tool-router.ts for domain-level
 * routing decisions (skip a domain that has never successfully been reached).
 * Positive results cached 60s.
 */
const reachabilityCache = new Map<string, { reachable: boolean; checkedAt: number }>();

/**
 * Returns the current cached reachability status for a base URL.
 * Used by tool-router.ts to skip entire skill domains that are unreachable.
 *  - `true`      — endpoint confirmed reachable (within TTL)
 *  - `undefined` — not yet confirmed (allow through — will be attempted at first call)
 *
 * Note: never returns `false` — a failed probe is not enough evidence to block a
 * domain. Only actual API call failures (network-level) update the cache negatively.
 */
export function getCachedReachability(baseUrl: string): boolean | undefined {
  try {
    const origin = new URL(baseUrl).origin;
    const cached = reachabilityCache.get(origin);
    if (!cached) return undefined;
    if (Date.now() - cached.checkedAt > 60_000) return undefined;  // stale
    return cached.reachable ? true : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fire-and-forget background probe — populates the reachability cache so the
 * tool-router can make smarter domain-selection decisions on subsequent requests.
 * NEVER blocks handler execution and NEVER causes a request to fail.
 */
function probeReachabilityBackground(baseUrl: string): void {
  void (async () => {
    try {
      const parsed = new URL(baseUrl);
      const origin = parsed.origin;
      const now = Date.now();
      const cached = reachabilityCache.get(origin);
      if (cached && now - cached.checkedAt < 60_000) return; // already fresh

      const { fetch: undiFetch, Agent: UndiAgent } = await import('undici');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const dispatcher = origin.startsWith('https:')
        ? new UndiAgent({ connect: { rejectUnauthorized: false } }) : undefined;
      try {
        await undiFetch(origin, { method: 'HEAD', signal: controller.signal, ...(dispatcher ? { dispatcher } : {}) });
        reachabilityCache.set(origin, { reachable: true, checkedAt: now });
      } catch {
        // Probe failure is not evidence of unreachability — do not cache negative results
      } finally {
        clearTimeout(timer);
      }
    } catch { /* invalid URL — ignore */ }
  })();
}

/** @deprecated Use probeReachabilityBackground — kept for call-site compatibility */
async function checkReachable(baseUrl: string, _timeoutMs?: number): Promise<{ reachable: boolean; error?: string }> {
  probeReachabilityBackground(baseUrl);
  return { reachable: true };
}

/**
 * Converts a skill's tool definitions into Vercel AI SDK tool objects.
 * Supports legacy endpoint-based tools as well as the newer handlerType/config format.
 */
export function buildTools(
  skillTools: SkillTool[],
  vault: CredentialVaultService,
  agentPermissions: string[],
  agentCredentialId: string | undefined,
): Record<string, CoreTool> {
  const tools: Record<string, CoreTool> = {};

  for (const rawTool of skillTools) {
    const skillTool = rawTool as ExtendedSkillTool;

    const paramDef = (skillTool.parameters ?? {}) as {
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
        // Resolve effective credential: domain-level (resolvedCredentialId injected by
        // orchestrator's domain cred map) takes priority; fall back to agent-level credential.
        // Only apply agent-level credentials for tools that explicitly declare a handler type —
        // plain endpoint tools (no handlerType) are public and must not inherit agent credentials.
        const credentialId = (config['resolvedCredentialId'] as string | undefined) ??
          (handlerType ? agentCredentialId : undefined);

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
          // Spring @RequestParam List<> params (views, fields, deviceIds etc.) require repeated params: views=A&views=B
          // NOT comma-joined: views=A,B,C is rejected with 400
          const REPEATED_ARRAY_PARAMS = new Set([
            'views', 'fields', 'deviceIds', 'locationIds', 'ssids', 'vlans',
            'userNames', 'clientOsNames', 'clientConnectionTypes', 'userProfileNames',
          ]);
          const expandValue = (k: string, v: unknown): string => {
            // Normalise to array: JSON array OR comma-string for known array params
            let items: string[] | null = null;
            if (Array.isArray(v)) {
              items = v.map(String);
            } else if (typeof v === 'string' && v.includes(',') && REPEATED_ARRAY_PARAMS.has(k)) {
              items = v.split(',').map((s) => s.trim()).filter(Boolean);
            }
            if (items) {
              // Repeated params: views=CLIENT_DETAILS&views=HEALTH_STATUS
              return items.map((item) => `${k}=${encodeURIComponent(item)}`).join('&');
            }
            return `${k}=${encodeURIComponent(String(v))}`;
          };

          // Guard against ReDoS: URL templates should never be excessively long
          if (urlTemplate.length > 4096) return { error: 'URL template exceeds maximum allowed length' };

          let rawUrl = urlTemplate
            // Query string params: [?&]key={param} — use \w+ for key names to avoid backtracking
            .replace(/([?&])(\w+)=\{(\w+)\}/g, (full, sep, k, argKey) => {
              const v = args[argKey];
              if (v == null || v === '') return '';
              return `${sep}${expandValue(k, v)}`;
            })
            // Path params: {param}
            .replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(args[k] ?? '')));

          // Normalize: if ? was stripped but & params remain, promote the first & to ?
          // e.g. "https://api.example.com/devices&limit=100" → "...devices?limit=100"
          // Use regex replacement to make single-occurrence intent explicit.
          if (!rawUrl.includes('?') && rawUrl.includes('&')) {
            rawUrl = rawUrl.replace(/^([^&]*)&/, '$1?');
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

        // ── p1_http_call: Extreme Platform One API — direct Bearer token ───
        // Platform One uses API keys directly as Bearer tokens — no login step.
        // Supports all cloudapi.extremecloudiq.com services (XIQ, IAM, Site,
        // Alert, NVO, PM, DLCS, PCS, etc.)
        if (handlerType === 'p1_http_call') {
          if (!credentialId) {
            return { error: 'p1_http_call requires a credentialId — configure system.extremep1_api_token in the credential vault' };
          }
          const urlTemplate = (config['urlTemplate'] as string | undefined) ?? '';
          const method = ((config['method'] as string | undefined) ?? 'GET').toUpperCase();
          if (!urlTemplate) return { error: 'No urlTemplate configured for p1_http_call tool' };
          if (urlTemplate.length > 4096) return { error: 'URL template exceeds maximum allowed length' };

          const { fetch } = await import('undici');

          // Resolve API token from vault
          const creds = await vault.resolve(credentialId, agentPermissions);
          const apiToken = String(creds['api_token'] ?? creds['p1_api_token'] ?? creds['extremep1_api_token'] ?? '');
          if (!apiToken) return { error: 'No api_token found in credential — re-run bex init or update system.extremep1_api_token in the vault' };

          // Build URL — same template expansion as xiq_http_call
          const REPEATED_ARRAY_PARAMS_P1 = new Set([
            'views', 'fields', 'deviceIds', 'locationIds', 'ssids', 'vlans',
            'metrics', 'entityIds', 'alertIds', 'siteIds', 'buildingIds',
          ]);
          const expandValueP1 = (k: string, v: unknown): string => {
            let items: string[] | null = null;
            if (Array.isArray(v)) {
              items = v.map(String);
            } else if (typeof v === 'string' && v.includes(',') && REPEATED_ARRAY_PARAMS_P1.has(k)) {
              items = v.split(',').map((s) => s.trim()).filter(Boolean);
            }
            if (items) return items.map((item) => `${k}=${encodeURIComponent(item)}`).join('&');
            return `${k}=${encodeURIComponent(String(v))}`;
          };

          let rawUrl = urlTemplate
            .replace(/([?&])(\w+)=\{(\w+)\}/g, (full, sep, k, argKey) => {
              const v = args[argKey];
              if (v == null || v === '') return '';
              return `${sep}${expandValueP1(k, v)}`;
            })
            .replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(args[k] ?? '')));

          if (!rawUrl.includes('?') && rawUrl.includes('&')) rawUrl = rawUrl.replace(/^([^&]*)&/, '$1?');
          const url = rawUrl.replace(/[?&]+$/, '').replace(/\?&/g, '?').replace(/&&+/g, '&');

          // Call API with Bearer token
          const p1FetchOpts: Parameters<typeof fetch>[1] = {
            method,
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
          };
          if (method !== 'GET' && method !== 'HEAD') {
            p1FetchOpts.body = JSON.stringify(args);
          }
          const p1Resp = await fetch(url, p1FetchOpts);
          const p1Text = await p1Resp.text();
          console.info(`[p1_http_call] ${method} ${url} → ${p1Resp.status}`);
          if (!p1Resp.ok) {
            return { error: `Platform One API error ${p1Resp.status}`, url, detail: p1Text.slice(0, 500) };
          }
          try {
            return JSON.parse(p1Text);
          } catch {
            return { result: p1Text.slice(0, 2000) };
          }
        }

        // ── p1_clients_by_vendor: vendor-filtered client list via Platform One ─
        if (handlerType === 'p1_clients_by_vendor') {
          const cred2 = credentialId ?? '';
          if (!cred2) return { error: 'p1_clients_by_vendor requires a credentialId' };
          const vendor = String(args['vendor'] ?? 'apple').toLowerCase();
          const apNameFilter = String(args['apName'] ?? '');

          const { fetch: f2 } = await import('undici');
          const creds2 = await vault.resolve(cred2, agentPermissions);
          const token2 = String(creds2['api_token'] ?? creds2['p1_api_token'] ?? '');
          if (!token2) return { error: 'No api_token in credential' };

          const hdrs2 = { 'Authorization': `Bearer ${token2}`, 'Accept': 'application/json' };

          // Fetch up to 1000 active clients
          const clientsRes = await f2('https://cloudapi.extremecloudiq.com/xiq/v1/clients/active?page=1&limit=1000&views=CLIENT_DETAILS', { headers: hdrs2 });
          if (!clientsRes.ok) return { error: `Failed to list clients: ${clientsRes.status}` };
          const clientsData = await clientsRes.json() as { data?: Array<Record<string, unknown>> };
          const allClients = clientsData.data ?? [];

          // Apple OUI prefixes (first 3 octets, uppercase, no separators)
          const APPLE_OUIS = new Set([
            '000393','000A27','000A95','000D93','001124','001451','0016CB','001750',
            '001E52','001E63','001EC2','002312','002500','0025BC','002608','003065',
            '00306C','0050E4','005056','006171','006D52','008CC8','009033','00C610',
            '040CCE','044BED','0452F3','047D7B','04D3CF','04F7E4','086698','087402',
            '08F4AB','0C1539','0C4DE9','0C6347','0C7C02','10411A','10DDB1','10F381',
            '148FC6','14999E','18AF61','18E7F4','1C36BB','200CED','204E7F','20A2E4',
            '24A07E','285AEB','2C6120','30F7C5','34159E','34363B','346085','38CAda',
            '3C0712','3C15C2','3C2EFF','40330A','403004','408D5C','44D884','44FB42',
            '489D24','4888CA','489E24','4C57CA','4C74BF','4C8D79','502CB4','5010E0',
            '50EAD6','543553','586694','58B035','5C5948','5CF938','600308','60334B',
            '60D9B7','60F4E8','64E682','686092','686F92','6C40088','6C4008','6C709F',
            '70480F','70CD60','70E72C','743212','744AC1','7831C1','78CA39','78D75F',
            '7C6D62','80649F','807D3A','84385D','848506','84FCAC','880032','88653D',
            '886B6E','88C663','8C0073','8C2937','9006F7','906C3B','90B0ED','90C1C6',
            '906FD4','9810E8','98B8E3','98D6BB','98E0D9','9C207B','9C293F','9CB9A8',
            'A01699','A09FE0','A41773','A45E60','A860B6','A88D3B','A8BBD0','A8FAD8',
            'AC1F74','AC3C0B','AC4BC8','AC5F3E','ACE4B5','ACD9B5','ACFDEC','B065BD',
            'B418D1','B477BF','B87516','B8782E','B8C75D','BC3BAF','BC674D','BC920A',
            'C06384','C082CB','C0D015','C41297','C85B76','C86F1D','C8D083','CC08E0',
            'D0034B','D023DB','D04F7E','D0817A','D43D7E','D46A6A','D4F46F','D8004D',
            'D89695','D8BB2C','DC2B2A','DC37B8','DC86D8','DCA904','E0B52D','E0B9BA',
            'E0CCF8','E49A79','E4C63D','E8040B','E80688','ECF40B','F023B9','F02475',
            'F0794D','F0B479','F0CCA1','F40F24','F42033','F4F15A','F86077','F8038A',
            'F87BF4','F8E76B','FC25D9','FCC23D',
          ]);

          const VENDOR_MATCHERS: Record<string, (c: Record<string, unknown>) => boolean> = {
            apple: (c) => {
              const os = String(c['os_type'] ?? '').toLowerCase();
              const hn = String(c['hostname'] ?? '').toLowerCase();
              const mac = String(c['mac_address'] ?? '').toUpperCase().replace(/[:\-\.]/g, '').slice(0, 6);
              return os.includes('apple') || os.includes('ios') || os.includes('macos') || os.includes('ipad') ||
                hn.includes('iphone') || hn.includes('ipad') || hn.includes('macbook') || hn.includes('imac') || hn.includes('airpod') ||
                APPLE_OUIS.has(mac);
            },
            android: (c) => {
              const os = String(c['os_type'] ?? '').toLowerCase();
              return os.includes('android') || os.includes('samsung') || os.includes('pixel');
            },
            windows: (c) => {
              const os = String(c['os_type'] ?? '').toLowerCase();
              const hn = String(c['hostname'] ?? '').toLowerCase();
              return os.includes('windows') || hn.includes('desktop') || hn.includes('laptop') || hn.includes('win');
            },
            linux: (c) => {
              const os = String(c['os_type'] ?? '').toLowerCase();
              return os.includes('linux') || os.includes('ubuntu') || os.includes('debian');
            },
          };

          const matcher = (VENDOR_MATCHERS[vendor] ?? VENDOR_MATCHERS['apple'])!;
          let filtered = allClients.filter(matcher);
          if (apNameFilter) filtered = filtered.filter(c => String(c['connected_ap'] ?? '').toLowerCase().includes(apNameFilter.toLowerCase()));

          return {
            vendor,
            total_clients: allClients.length,
            matched: filtered.length,
            clients: filtered.slice(0, 100).map(c => ({
              hostname: c['hostname'],
              mac_address: c['mac_address'],
              ip_address: c['ip_address'],
              os_type: c['os_type'],
              ssid: c['ssid'],
              connected_ap: c['connected_ap'],
              vlan: c['vlan'],
              rssi: c['rssi'],
              snr: c['snr'],
            })),
          };
        }

        // ── p1_client_snapshot: full status for a named client ────────────────
        if (handlerType === 'p1_client_snapshot') {
          const cred3 = credentialId ?? '';
          if (!cred3) return { error: 'p1_client_snapshot requires a credentialId' };
          const creds3 = await vault.resolve(cred3, agentPermissions);
          const token3 = String(creds3['api_token'] ?? creds3['p1_api_token'] ?? '');
          if (!token3) return { error: 'No api_token in credential' };
          const { fetch: f3 } = await import('undici');
          const hdrs3 = { 'Authorization': `Bearer ${token3}`, 'Accept': 'application/json' };

          const clientName = String(args['clientName'] ?? '').toLowerCase();
          const macAddress = String(args['macAddress'] ?? '').toLowerCase();

          // Search active clients
          const searchRes = await f3('https://cloudapi.extremecloudiq.com/xiq/v1/clients/active?page=1&limit=1000&views=CLIENT_DETAILS', { headers: hdrs3 });
          if (!searchRes.ok) return { error: `Failed to search clients: ${searchRes.status}` };
          const searchData = await searchRes.json() as { data?: Array<Record<string, unknown>> };
          const allC = searchData.data ?? [];

          const found = allC.find(c => {
            if (macAddress) return String(c['mac_address'] ?? '').toLowerCase().includes(macAddress);
            if (clientName) return String(c['hostname'] ?? '').toLowerCase().includes(clientName);
            return false;
          });

          if (!found) return { error: `Client not found: ${clientName || macAddress}`, available_count: allC.length };

          // Get detailed info if we have an ID
          const clientId = found['id'];
          let details: Record<string, unknown> = {};
          if (clientId) {
            try {
              const detRes = await f3(`https://cloudapi.extremecloudiq.com/xiq/v1/clients/${clientId}/details`, { headers: hdrs3 });
              if (detRes.ok) details = await detRes.json() as Record<string, unknown>;
            } catch { /* non-fatal */ }
          }

          return { client: found, details };
        }

        // ── p1_network_health: health scores for a location ───────────────────
        if (handlerType === 'p1_network_health') {
          const cred4 = credentialId ?? '';
          if (!cred4) return { error: 'p1_network_health requires a credentialId' };
          const creds4 = await vault.resolve(cred4, agentPermissions);
          const token4 = String(creds4['api_token'] ?? creds4['p1_api_token'] ?? '');
          if (!token4) return { error: 'No api_token in credential' };
          const { fetch: f4 } = await import('undici');
          const hdrs4 = { 'Authorization': `Bearer ${token4}`, 'Accept': 'application/json' };

          let locationId = args['locationId'] as number | undefined;
          const locationName = String(args['locationName'] ?? '');

          // Auto-resolve location name to ID via site tree
          if (!locationId && locationName) {
            const treeRes = await f4('https://cloudapi.extremecloudiq.com/site/v1/tree', { headers: hdrs4 });
            if (treeRes.ok) {
              const treeData = await treeRes.json() as { data?: Array<Record<string, unknown>> };
              // Also try XIQ location tree
              const xiqTreeRes = await f4('https://cloudapi.extremecloudiq.com/xiq/v1/locations/tree', { headers: hdrs4 });
              if (xiqTreeRes.ok) {
                const xiqTree = await xiqTreeRes.json() as Record<string, unknown>;
                // Recursively search for location by name
                function findLocation(node: Record<string, unknown>): number | undefined {
                  const name = String(node['name'] ?? '').toLowerCase();
                  if (name.includes(locationName.toLowerCase())) return node['id'] as number;
                  const children = (node['children'] ?? node['buildings'] ?? node['floors'] ?? []) as Array<Record<string, unknown>>;
                  for (const child of children) {
                    const found2 = findLocation(child);
                    if (found2) return found2;
                  }
                  return undefined;
                }
                locationId = findLocation(xiqTree);
              }
            }
          }
          if (!locationId) return { error: `Could not resolve location: "${locationName}". Use p1_get_location_tree to list available locations.` };

          // Fetch all health scores in parallel
          const [wifiRes, devRes, clientRes] = await Promise.all([
            f4(`https://cloudapi.extremecloudiq.com/xiq/v1/locations/${locationId}/wifi-health`, { headers: hdrs4 }),
            f4(`https://cloudapi.extremecloudiq.com/xiq/v1/locations/${locationId}/device-health`, { headers: hdrs4 }),
            f4(`https://cloudapi.extremecloudiq.com/xiq/v1/locations/${locationId}/client-health`, { headers: hdrs4 }),
          ]);

          return {
            locationId,
            locationName,
            wifi_health: wifiRes.ok ? await wifiRes.json() : null,
            device_health: devRes.ok ? await devRes.json() : null,
            client_health: clientRes.ok ? await clientRes.json() : null,
          };
        }

        // ── p1_device_health: device health for a location ────────────────────
        if (handlerType === 'p1_device_health') {
          // Same as p1_network_health but focused on device health
          const cred5 = credentialId ?? '';
          if (!cred5) return { error: 'p1_device_health requires a credentialId' };
          const creds5 = await vault.resolve(cred5, agentPermissions);
          const token5 = String(creds5['api_token'] ?? creds5['p1_api_token'] ?? '');
          if (!token5) return { error: 'No api_token in credential' };
          const { fetch: f5 } = await import('undici');
          const hdrs5 = { 'Authorization': `Bearer ${token5}`, 'Accept': 'application/json' };
          let locationId5 = args['locationId'] as number | undefined;
          const locationName5 = String(args['locationName'] ?? '');
          if (!locationId5 && locationName5) {
            const xiqRes = await f5('https://cloudapi.extremecloudiq.com/xiq/v1/locations/tree', { headers: hdrs5 });
            if (xiqRes.ok) {
              const tree5 = await xiqRes.json() as Record<string, unknown>;
              function findLoc(node: Record<string, unknown>): number | undefined {
                if (String(node['name'] ?? '').toLowerCase().includes(locationName5.toLowerCase())) return node['id'] as number;
                const ch = (node['children'] ?? []) as Array<Record<string, unknown>>;
                for (const c of ch) { const r = findLoc(c); if (r) return r; }
                return undefined;
              }
              locationId5 = findLoc(tree5);
            }
          }
          if (!locationId5) return { error: `Could not resolve location: "${locationName5}"` };
          const dRes = await f5(`https://cloudapi.extremecloudiq.com/xiq/v1/locations/${locationId5}/device-health`, { headers: hdrs5 });
          return dRes.ok ? await dRes.json() as Record<string, unknown> : { error: `Device health API error: ${dRes.status}` };
        }

        // ── p1_topology_report: SSID→VLAN→Client mapping ─────────────────────
        if (handlerType === 'p1_topology_report') {
          const cred6 = credentialId ?? '';
          if (!cred6) return { error: 'p1_topology_report requires a credentialId' };
          const creds6 = await vault.resolve(cred6, agentPermissions);
          const token6 = String(creds6['api_token'] ?? creds6['p1_api_token'] ?? '');
          if (!token6) return { error: 'No api_token in credential' };
          const { fetch: f6 } = await import('undici');
          const hdrs6 = { 'Authorization': `Bearer ${token6}`, 'Accept': 'application/json' };
          const ssidFilter6 = String(args['ssidFilter'] ?? '').toLowerCase();

          const [policiesRes, clientsRes] = await Promise.all([
            f6('https://cloudapi.extremecloudiq.com/xiq/v1/network-policies?page=1&limit=100', { headers: hdrs6 }),
            f6('https://cloudapi.extremecloudiq.com/xiq/v1/clients/active?page=1&limit=1000&views=BASIC', { headers: hdrs6 }),
          ]);
          if (!policiesRes.ok) return { error: `Failed to list network policies: ${policiesRes.status}` };
          const policies = (await policiesRes.json() as { data?: Array<Record<string, unknown>> }).data ?? [];
          const clients = ((await clientsRes.json()) as { data?: Array<Record<string, unknown>> }).data ?? [];

          // Group clients by SSID
          const clientsBySSID: Record<string, Array<Record<string, unknown>>> = {};
          for (const c of clients) {
            const ssid = String(c['ssid'] ?? 'Unknown');
            if (!clientsBySSID[ssid]) clientsBySSID[ssid] = [];
            clientsBySSID[ssid].push(c);
          }

          const topology = [];
          for (const policy of policies) {
            const policyId = policy['id'];
            if (!policyId) continue;
            const ssidsRes = await f6(`https://cloudapi.extremecloudiq.com/xiq/v1/network-policies/${policyId}/ssids`, { headers: hdrs6 });
            if (!ssidsRes.ok) continue;
            const ssids = (await ssidsRes.json() as { data?: Array<Record<string, unknown>> }).data ?? [];
            for (const ssid of ssids) {
              const ssidName = String(ssid['name'] ?? '');
              if (ssidFilter6 && !ssidName.toLowerCase().includes(ssidFilter6)) continue;
              topology.push({
                ssid: ssidName,
                policy: policy['name'],
                vlan: ssid['vlan'],
                user_profile: ssid['user_profile_name'],
                connected_clients: clientsBySSID[ssidName]?.length ?? 0,
                clients: (clientsBySSID[ssidName] ?? []).slice(0, 20).map(c => ({ hostname: c['hostname'], ip: c['ip_address'], mac: c['mac_address'] })),
              });
            }
          }
          return { topology, total_policies: policies.length, total_ssids: topology.length };
        }

        // ── p1_radio_quality: radio metrics for APs via Platform One ─────────
        if (handlerType === 'p1_radio_quality') {
          const cred7 = credentialId ?? '';
          if (!cred7) return { error: 'p1_radio_quality requires a credentialId' };
          const creds7 = await vault.resolve(cred7, agentPermissions);
          const token7 = String(creds7['api_token'] ?? creds7['p1_api_token'] ?? '');
          if (!token7) return { error: 'No api_token in credential' };
          const { fetch: f7 } = await import('undici');
          const hdrs7 = { 'Authorization': `Bearer ${token7}`, 'Accept': 'application/json' };
          const apFilter7 = String(args['apNameFilter'] ?? '').toLowerCase();
          const radioType7 = String(args['radioType'] ?? '').toLowerCase();

          // Get all devices first
          const devRes7 = await f7('https://cloudapi.extremecloudiq.com/xiq/v1/devices?page=1&limit=500&views=BASIC', { headers: hdrs7 });
          if (!devRes7.ok) return { error: `Failed to list devices: ${devRes7.status}` };
          let devices7 = (await devRes7.json() as { data?: Array<Record<string, unknown>> }).data ?? [];
          if (apFilter7) devices7 = devices7.filter(d => String(d['hostname'] ?? '').toLowerCase().includes(apFilter7));
          const deviceIds7 = devices7.slice(0, 100).map(d => d['id']).filter(Boolean);
          if (deviceIds7.length === 0) return { error: 'No matching devices found', filter: apFilter7 };

          // Get radio info
          const idsParam7 = deviceIds7.join('&deviceIds=');
          const radioRes7 = await f7(`https://cloudapi.extremecloudiq.com/xiq/v1/devices/radio-information?deviceIds=${idsParam7}`, { headers: hdrs7 });
          if (!radioRes7.ok) return { error: `Radio info API error: ${radioRes7.status}` };
          let radioData7 = (await radioRes7.json() as { data?: Array<Record<string, unknown>> }).data ?? [];
          if (radioType7) radioData7 = radioData7.filter(r => String(r['radio_type'] ?? '').toLowerCase().includes(radioType7));
          return { devices_queried: deviceIds7.length, radios: radioData7.length, data: radioData7.slice(0, 200) };
        }

        // ── p1_ap_client_sankey: AP→SSID→Vendor→DeviceType flow diagram ──────
        if (handlerType === 'p1_ap_client_sankey') {
          const cred8 = credentialId ?? '';
          if (!cred8) return { error: 'p1_ap_client_sankey requires a credentialId' };
          const creds8 = await vault.resolve(cred8, agentPermissions);
          const token8 = String(creds8['api_token'] ?? creds8['p1_api_token'] ?? '');
          if (!token8) return { error: 'No api_token in credential' };
          const { fetch: f8 } = await import('undici');
          const hdrs8 = { 'Authorization': `Bearer ${token8}`, 'Accept': 'application/json' };
          const apFilter8 = String(args['apFilter'] ?? '').toLowerCase();

          const cliRes8 = await f8('https://cloudapi.extremecloudiq.com/xiq/v1/clients/active?page=1&limit=1000&views=CLIENT_DETAILS', { headers: hdrs8 });
          if (!cliRes8.ok) return { error: `Failed to list clients: ${cliRes8.status}` };
          let clients8 = (await cliRes8.json() as { data?: Array<Record<string, unknown>> }).data ?? [];
          if (apFilter8) clients8 = clients8.filter(c => String(c['connected_ap'] ?? '').toLowerCase().includes(apFilter8));

          // Build flow data
          const flows: Record<string, number> = {};
          for (const c of clients8) {
            const ap = String(c['connected_ap'] ?? 'Unknown AP').slice(0, 30);
            const ssid = String(c['ssid'] ?? 'Unknown SSID').slice(0, 20);
            const os = String(c['os_type'] ?? '').toLowerCase();
            let vendor = 'Other';
            if (os.includes('apple') || os.includes('ios') || os.includes('macos')) vendor = 'Apple';
            else if (os.includes('android') || os.includes('samsung')) vendor = 'Android';
            else if (os.includes('windows')) vendor = 'Windows';
            else if (os.includes('linux')) vendor = 'Linux';
            const key = `${ap}|${ssid}|${vendor}`;
            flows[key] = (flows[key] ?? 0) + 1;
          }

          const sankeyLines = Object.entries(flows).map(([k, v]) => {
            const [ap, ssid, vendor] = k.split('|');
            return `  "${ap}" --> "${ssid}" [${v}]\n  "${ssid}" --> "${vendor}" [${v}]`;
          });
          const sankey_diagram = `sankey-beta\n${sankeyLines.join('\n')}`;

          return { total_clients: clients8.length, sankey_diagram, flows: Object.entries(flows).map(([k, v]) => { const [ap, ssid, vendor] = k.split('|'); return { ap, ssid, vendor, count: v }; }) };
        }

        // ── p1_alert_summary: aggregated alert overview ────────────────────────
        if (handlerType === 'p1_alert_summary') {
          const cred9 = credentialId ?? '';
          if (!cred9) return { error: 'p1_alert_summary requires a credentialId' };
          const creds9 = await vault.resolve(cred9, agentPermissions);
          const token9 = String(creds9['api_token'] ?? creds9['p1_api_token'] ?? '');
          if (!token9) return { error: 'No api_token in credential' };
          const { fetch: f9 } = await import('undici');
          const hdrs9 = { 'Authorization': `Bearer ${token9}`, 'Accept': 'application/json' };
          const severities9 = String(args['severities'] ?? '');

          const [countRes, severityRes, recentRes] = await Promise.all([
            f9('https://cloudapi.extremecloudiq.com/alert/v1/alerts/count-by-group', { headers: hdrs9 }),
            f9('https://cloudapi.extremecloudiq.com/alert/v1/alerts/severity-counts', { headers: hdrs9 }),
            f9(`https://cloudapi.extremecloudiq.com/alert/v1/alerts?page=1&limit=20${severities9 ? '&severities=' + severities9 : ''}`, { headers: hdrs9 }),
          ]);

          return {
            counts_by_group: countRes.ok ? await countRes.json() : null,
            severity_summary: severityRes.ok ? await severityRes.json() : null,
            recent_alerts: recentRes.ok ? (await recentRes.json() as { data?: unknown[] }).data ?? [] : [],
          };
        }

        // ── p1_client_health_report: health scores for all active clients ─────
        if (handlerType === 'p1_client_health_report') {
          const credA = credentialId ?? '';
          if (!credA) return { error: 'p1_client_health_report requires a credentialId' };
          const credsA = await vault.resolve(credA, agentPermissions);
          const tokenA = String(credsA['api_token'] ?? credsA['p1_api_token'] ?? '');
          if (!tokenA) return { error: 'No api_token in credential' };
          const { fetch: fA } = await import('undici');
          const hdrsA = { 'Authorization': `Bearer ${tokenA}`, 'Accept': 'application/json' };
          const healthFilter = String(args['healthFilter'] ?? '').toLowerCase();
          const apFilter = String(args['apFilter'] ?? '').toLowerCase();

          const cliResA = await fA('https://cloudapi.extremecloudiq.com/xiq/v1/clients/active?page=1&limit=500&views=HEALTH_STATUS', { headers: hdrsA });
          if (!cliResA.ok) return { error: `Failed to list clients: ${cliResA.status}` };
          let clients = (await cliResA.json() as { data?: Array<Record<string, unknown>> }).data ?? [];
          if (apFilter) clients = clients.filter(c => String(c['connected_ap'] ?? '').toLowerCase().includes(apFilter));

          // Classify health based on SNR
          const classified = clients.map(c => {
            const snr = Number(c['snr'] ?? c['signal_quality'] ?? 0);
            const health = snr >= 25 ? 'good' : snr >= 15 ? 'fair' : 'poor';
            return { ...c, health_classification: health };
          });

          const filtered = healthFilter ? classified.filter(c => c['health_classification'] === healthFilter) : classified;
          const summary = { good: 0, fair: 0, poor: 0 };
          for (const c of classified) summary[c['health_classification'] as 'good' | 'fair' | 'poor']++;

          return { total: clients.length, filtered: filtered.length, summary, clients: filtered.slice(0, 100) };
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
          // Guard against ReDoS: URL templates should never be excessively long
          if (urlTemplate.length > 4096) return { error: 'URL template exceeds maximum allowed length' };
          const method = ((config['method'] as string | undefined) ?? 'GET').toUpperCase();

          // Resolve credential early so we can extract `host` for {xco-host} template substitution.
          // This prevents the LLM from having to guess the XCO hostname.
          const credsForHost = await vault.resolve(effectiveCredId, agentPermissions);
          const credHost = String(credsForHost['host'] ?? credsForHost['xco_host'] ?? credsForHost['xco-host'] ?? '');

          // Replace {param} placeholders — hyphenated names like {fabric-name} use [-\w]+ (bounded).
          // {xco-host} is resolved from the credential vault first, falling back to LLM-supplied arg.
          const url = urlTemplate.replace(/\{([-\w]+)\}/g, (full, k: string) => {
            const isXcoHost = k === 'xco-host' || k === 'xco_host';
            const val = isXcoHost
              ? (credHost || (args[k] ?? args[k.replace(/-/g, '_')] ?? args[k.replace(/_/g, '-')]))
              : (args[k] ?? args[k.replace(/-/g, '_')] ?? args[k.replace(/_/g, '-')]);
            return val !== undefined && val !== '' ? encodeURIComponent(String(val)) : full;
          });

          // Derive XCO EFA auth URL: strip path and append the correct token endpoint.
          // Also substitute {xco-host} in the config authUrl in case it was stored as a template.
          const substituteHost = (template: string) =>
            credHost ? template.replace(/\{xco[-_]host\}/g, credHost) : template;
          const defaultAuthUrl = (() => {
            try { const u = new URL(url); return `${u.protocol}//${u.host}/v1/auth/token/access-token`; } catch { return ''; }
          })();
          const rawAuthUrl = (config['authUrl'] as string | undefined) ?? defaultAuthUrl;
          const authUrl = substituteHost(rawAuthUrl);
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

          const doAuth = async (targetAuthUrl = authUrl): Promise<string | null> => {
            const creds = credsForHost;
            const authResp = await xcoFetch(targetAuthUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ username: String(creds['username'] ?? ''), password: String(creds['password'] ?? '') }),
            });
            // If the configured authUrl is wrong (e.g. old skill from registry), fall back to the
            // standard XCO/EFA path /v1/auth/token/access-token automatically.
            if (authResp.status === 404 && targetAuthUrl !== defaultAuthUrl && defaultAuthUrl) {
              console.warn(`[xco_http_call] Auth URL ${targetAuthUrl} returned 404, retrying with ${defaultAuthUrl}`);
              return doAuth(defaultAuthUrl);
            }
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
            console.info(`[xco_http_call] Authenticated to XCO (${targetAuthUrl}), token cached`);
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
            // Detect HTML error pages (XCO reverse proxy / SPA fallback on non-2xx)
            const isHtml = apiText.trimStart().startsWith('<');
            return {
              error: `XCO API error ${apiResp.status}`,
              url,
              detail: isHtml
                ? `XCO returned an HTML error page — this endpoint may not exist on your XCO version (${apiResp.status})`
                : apiText.slice(0, 500),
            };
          }
          // Detect 200-OK HTML (SPA index.html served for unknown paths)
          if (apiText.trimStart().startsWith('<')) {
            return {
              error: 'XCO endpoint returned HTML instead of JSON',
              url,
              hint: 'This API path does not exist on your XCO version or the host is a web UI. Verify the endpoint is correct.',
            };
          }
          try { return JSON.parse(apiText); } catch { return { result: apiText.slice(0, 2000) }; }
        }

        // ── public_http_call: direct fetch, no credentials ────────────────
        if (handlerType === 'public_http_call') {
          const urlTemplate = (config['urlTemplate'] as string | undefined) ?? skillTool.endpoint ?? '';
          if (!urlTemplate) return { error: 'No URL template configured for this tool' };
          // Guard against ReDoS: URL templates should never be excessively long
          if (urlTemplate.length > 4096) return { error: 'URL template exceeds maximum allowed length' };
          const method = ((config['method'] as string | undefined) ?? 'GET').toUpperCase();
          // Replace {param} placeholders in URL template — use \w+ to avoid backtracking on key names
          let publicRawUrl = urlTemplate.replace(/([?&]\w+=)\{(\w+)\}/g, (full, prefix, k) => {
            const v = args[k];
            return v != null && v !== '' ? `${prefix}${encodeURIComponent(String(v))}` : '';
          }).replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(args[k] ?? '')));
          // Use regex replacement to make single-occurrence intent explicit
          if (!publicRawUrl.includes('?') && publicRawUrl.includes('&')) publicRawUrl = publicRawUrl.replace(/^([^&]*)&/, '$1?');
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
            console.info(`[llm-runner] public GET: ${publicUrl}`);
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

        // ── composio_call: proxy a tool action through Composio's execute API ─
        if (handlerType === 'composio_call') {
          const composioApiKey = process.env['COMPOSIO_API_KEY'] ?? '';
          if (!composioApiKey) {
            return { error: 'COMPOSIO_API_KEY not configured. Add it to .env and restart.' };
          }
          const action = (skillTool as Record<string, unknown>)['composioAction'] as string | undefined;
          if (!action) return { error: 'composio_call: no composioAction defined on this tool' };

          const entityId = (args['composioEntityId'] as string | undefined) ?? 'default';
          try {
            const res = await fetch(`https://backend.composio.dev/api/v2/actions/${encodeURIComponent(action)}/execute`, {
              method: 'POST',
              headers: {
                'x-api-key': composioApiKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ entityId, input: args }),
            });
            const data = await res.json() as Record<string, unknown>;
            if (!res.ok) {
              const msg = (data['message'] as string | undefined) ?? (data['error'] as string | undefined) ?? `HTTP ${res.status}`;
              return { error: `Composio error: ${msg}` };
            }
            return (data['data'] ?? data['response'] ?? data) as Record<string, unknown>;
          } catch (e) {
            return { error: `Composio call failed: ${e instanceof Error ? e.message : String(e)}` };
          }
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
                console.info(`[xiq_radio_quality_report] radio-information body keys: ${Object.keys(body as object).join(', ')} | isArray: ${Array.isArray(body)} | sample: ${JSON.stringify(body).slice(0, 300)}`);
                const items = Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? []);
                console.info(`[xiq_radio_quality_report] items extracted: ${items.length}`);
                radioResults.push(...(items as Array<Record<string, unknown>>));
              } else {
                const errText = await resp.text().catch(() => '');
                console.warn(`[xiq_radio_quality_report] radio-information error body: ${errText.slice(0, 300)}`);
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
              // API returns 'radios' array (not 'radio_list')
              const radioList = (r['radios'] as Array<Record<string, unknown>>) ?? (r['radio_list'] as Array<Record<string, unknown>>) ?? [];

              const radios = radioList.map((radio) => ({
                // API uses: name (wifi0/wifi1), frequency (2.4GHz/5GHz), channel_number, power, channel_width
                type: String(radio['name'] ?? radio['frequency'] ?? radio['radio_type'] ?? radio['type'] ?? ''),
                channel: Number(radio['channel_number'] ?? radio['channel'] ?? 0),
                tx_power: Number(radio['power'] ?? radio['tx_power'] ?? 0),
                noise_floor: Number(radio['noise_floor'] ?? 0),
                utilization: Number(radio['channel_utilization'] ?? 0),
                channel_width: String(radio['channel_width'] ?? ''),
                mode: String(radio['mode'] ?? ''),
                client_count: Array.isArray(radio['clients']) ? (radio['clients'] as unknown[]).length : 0,
              }));

              // Skip devices with no active radios (e.g. controllers)
              if (radios.length === 0) continue;
              if (!locationMap.has(location)) locationMap.set(location, []);
              locationMap.get(location)!.push({ hostname: device.hostname, mac: device.mac, radios });
            }

            const locations = Array.from(locationMap.entries()).map(([name, aps]) => ({ name, aps }));

            return {
              summary: {
                total_devices: deviceIds.length,
                aps_with_radio_data: Array.from(locationMap.values()).reduce((sum, aps) => sum + aps.length, 0),
                total_locations: locations.length,
                timestamp: new Date().toISOString(),
              },
              locations,
              // Flat list for table widget compatibility
              radio_details: radioResults.map((r) => {
                const deviceId = r['device_id'] as number;
                const device = deviceMap.get(deviceId) ?? { hostname: `Device ${deviceId}`, location: 'Unknown', mac: '' };
                const radios = (r['radios'] as Array<Record<string, unknown>>) ?? (r['radio_list'] as Array<Record<string, unknown>>) ?? [];
                return radios.map((radio) => ({
                  hostname: device.hostname,
                  location: device.location,
                  radio: String(radio['name'] ?? radio['frequency'] ?? radio['radio_type'] ?? ''),
                  frequency: String(radio['frequency'] ?? ''),
                  channel: Number(radio['channel_number'] ?? radio['channel'] ?? 0),
                  channel_width: String(radio['channel_width'] ?? ''),
                  tx_power_dbm: Number(radio['power'] ?? radio['tx_power'] ?? 0),
                  noise_floor_dbm: Number(radio['noise_floor'] ?? 0),
                  mode: String(radio['mode'] ?? ''),
                  client_count: Array.isArray(radio['clients']) ? (radio['clients'] as unknown[]).length : 0,
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
            // XIQ uses comma-separated list for array params (not repeated key=val)
            const qs = Object.entries(params).map(([k, v]) =>
              Array.isArray(v) ? `${k}=${v.map(encodeURIComponent).join(',')}` : `${k}=${encodeURIComponent(String(v))}`
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

            // Fetch active clients — no views parameter, basic fields work reliably
            const clients = await xiqGetH(token, '/clients/active', {
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

        // ── xiq_clients_by_vendor: filter active clients by OS/vendor, get radio metrics ──
        // Use for: "show apple clients", "list all iPhones", "android radio quality", etc.
        // Apple detection: os_type match + hostname pattern + MAC OUI (multi-strategy)
        if (handlerType === 'xiq_clients_by_vendor') {
          if (!credentialId) return { error: 'xiq_clients_by_vendor requires a credentialId' };

          const loginUrlV = (config['loginUrl'] as string | undefined) ?? 'https://api.extremecloudiq.com/login';
          const apiBaseV = 'https://api.extremecloudiq.com';

          const reachV = await checkReachable(loginUrlV);
          if (!reachV.reachable) {
            return { error: reachV.error ?? `Cannot reach ${loginUrlV}`, hint: 'Check VPN or network connectivity' };
          }

          const { fetch: fetchV } = await import('undici');

          const getTokenV = async (): Promise<string | null> => {
            let token = getCachedToken(credentialId!);
            if (!token) {
              const creds = await vault.resolve(credentialId!, agentPermissions);
              const username = String(creds['username'] ?? creds['xiq_username'] ?? '');
              const password = String(creds['password'] ?? creds['xiq_password'] ?? '');
              const resp = await fetchV(loginUrlV, {
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

          const xiqGetV = async (token: string, path: string, params: Record<string, string | number> = {}): Promise<unknown> => {
            const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
            const url = `${apiBaseV}${path}${qs ? '?' + qs : ''}`;
            const resp = await fetchV(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
            console.info(`[xiq_clients_by_vendor] GET ${url} → ${resp.status}`);
            if (!resp.ok) {
              const errText = await resp.text().catch(() => '');
              console.warn(`[xiq_clients_by_vendor] ${path} failed ${resp.status}: ${errText.slice(0, 200)}`);
              return null;
            }
            return resp.json();
          };

          // Vendor filter predicates — network engineer multi-signal approach
          // Each predicate checks os_type, hostname, and (where applicable) MAC OUI prefix
          const vendor = String(args['vendor'] ?? 'apple').toLowerCase();
          const apFilter = String(args['apName'] ?? '').toLowerCase();

          type ClientRecord = Record<string, unknown>;

          const VENDOR_MATCHERS: Record<string, (c: ClientRecord) => boolean> = {
            apple: (c) => {
              const os = String(c['os_type'] ?? '').toLowerCase();
              const hostname = String(c['hostname'] ?? c['name'] ?? '').toLowerCase();
              const mac = String(c['mac_address'] ?? '').toUpperCase().replace(/[:\-]/g, '');
              // os_type signals
              if (os.includes('apple') || os.includes('ios') || os.includes('macos') ||
                  os.includes('mac os') || os.includes('ipad') || os.includes('watchos') ||
                  os.includes('tvos')) return true;
              // Hostname patterns common for Apple devices
              if (/iphone|ipad|macbook|imac|mac mini|mac pro|apple|airpod|ipod|apple watch|apple tv/i.test(hostname)) return true;
              // Apple MAC OUI prefixes (IEEE registered; covers most consumer devices)
              // See https://regauth.standards.ieee.org/standards-ra-web/pub/view.html#registries
              const appleOuis = [
                'F81EDF','F0DB30','F0B429','ECA6B4','E8FAC6','E0F5C6','E0ACEF','DCA904',
                'D83062','D0A637','CCA223','CC08E0','BC9FEF','BC3400','B8FF61','B844D9',
                'B82AAA','B0BE76','ACF6F7','ACBC32','AC87A3','A8969D','A45E60','A4C361',
                'A030D6','9CF48E','9CF387','9C8BB1','9C4FB0','9C293F','98FEDC','98EFC9',
                '98E0D9','94BF2D','90B21F','90840D','8CAAB5','8C7B9D','8C29F7','88E9FE',
                '885166','8845DD','84B153','84A134','80ED2C','786C1C','78D75F','706E6D',
                '6C96CF','6C70AC','6C40A3','68AE20','683B78','6010F3','5C96A4','5CACB9',
                '5857CA','544E90','50EA66','504BAA','4CA560','48D705','48437C','48A195',
                '440010','40CB00','40484C','3C5282','3C2EFF','38CAC5','34363B','2095F0',
                '18E7F4','18AF61','189EFC','143C4A','10DDB1','102477','0CFE45','0C5415',
                '087130','089E08','080007','040CCE','001CBE','001B63','001124','001050',
              ];
              const oui = mac.substring(0, 6);
              return appleOuis.includes(oui);
            },
            android: (c) => {
              const os = String(c['os_type'] ?? '').toLowerCase();
              return os.includes('android') || os.includes('google') || os.includes('chrome os');
            },
            windows: (c) => {
              const os = String(c['os_type'] ?? '').toLowerCase();
              return os.includes('windows') || os.includes('microsoft');
            },
            linux: (c) => {
              const os = String(c['os_type'] ?? '').toLowerCase();
              return os.includes('linux') || os.includes('ubuntu') || os.includes('debian');
            },
            embedded: (c) => {
              const os = String(c['os_type'] ?? '').toLowerCase();
              return os.includes('embedded') || os.includes('iot') || os.includes('rtos');
            },
          };

          const matchFn = VENDOR_MATCHERS[vendor] ?? VENDOR_MATCHERS['apple']!;

          try {
            const token = await getTokenV();
            if (!token) return { error: 'XIQ login failed' };

            // Paginate to get all active clients — vendors can be a minority so we need all
            let allClients: ClientRecord[] = [];
            let page = 1;
            const pageSize = 100;
            while (allClients.length < 1000) {
              const resp = await xiqGetV(token, '/clients/active', { page, limit: pageSize }) as { data?: ClientRecord[]; total_count?: number } | null;
              if (!resp) break;
              const batch = resp?.data ?? (Array.isArray(resp) ? (resp as ClientRecord[]) : []);
              if (batch.length === 0) break;
              allClients = allClients.concat(batch);
              if (batch.length < pageSize) break;
              page++;
            }

            console.info(`[xiq_clients_by_vendor] Fetched ${allClients.length} total clients, filtering for vendor="${vendor}"`);

            // Filter by vendor AND optional AP name filter
            let matched = allClients.filter(matchFn);
            if (apFilter) {
              matched = matched.filter((c) =>
                String(c['connected_ap'] ?? c['ap_name'] ?? '').toLowerCase().includes(apFilter)
              );
            }

            // Build os_type breakdown for transparency (useful for debugging false negatives)
            const osBreakdown: Record<string, number> = {};
            for (const c of allClients) {
              const os = String(c['os_type'] ?? 'unknown');
              osBreakdown[os] = (osBreakdown[os] ?? 0) + 1;
            }

            // Enrich up to 20 matched clients with radio details
            const enrichedClients: Array<Record<string, unknown>> = [];
            const detailBatch = matched.slice(0, 20);
            await Promise.all(
              detailBatch.map(async (c) => {
                const clientId = c['id'] as number | undefined;
                let snr = Number(c['snr'] ?? 0);
                let rssi = Number(c['rssi'] ?? 0);
                let healthScore = Number(c['health_score'] ?? 0);
                let channel = Number(c['channel'] ?? 0);

                if (clientId && (snr === 0 || rssi === 0)) {
                  try {
                    const now = Date.now();
                    // /client-details/overview/info gives connection metadata but NOT radio metrics
                    // Use connectivity-experience trail for SNR/RSSI time-series; take latest point
                    const trail = await xiqGetV(token, `/client-details/client-trail/connectivity-experience/${clientId}`, {
                      startTime: now - 3_600_000,
                      endTime: now,
                      precision: 300000, // 5 min buckets
                    }) as { data?: Record<string, unknown>[] } | Record<string, unknown>[] | null;

                    const trailPoints = (Array.isArray(trail) ? trail : (trail as { data?: Record<string, unknown>[] })?.data ?? []) as Array<Record<string, unknown>>;
                    if (trailPoints.length > 0) {
                      // Take the latest point with non-zero values
                      const latestPoint = [...trailPoints].reverse().find((p) =>
                        Number(p['snr'] ?? 0) !== 0 || Number(p['rssi'] ?? 0) !== 0
                      ) ?? trailPoints[trailPoints.length - 1];
                      if (latestPoint) {
                        snr = Number(latestPoint['snr'] ?? latestPoint['avg_snr'] ?? snr) || snr;
                        rssi = Number(latestPoint['rssi'] ?? latestPoint['avg_rssi'] ?? rssi) || rssi;
                        healthScore = Number(latestPoint['health_score'] ?? latestPoint['client_health_score'] ?? healthScore) || healthScore;
                        channel = Number(latestPoint['channel'] ?? channel) || channel;
                      }
                    }

                    // Also get overview for AP name / connection details
                    const overview = await xiqGetV(token, `/client-details/overview/info/${clientId}`, {
                      startTime: now - 3_600_000,
                      endTime: now,
                    }) as Record<string, unknown> | null;
                    if (overview) {
                      // connection_to = connected AP name; supplement if missing from basic record
                      const detailAp = String(overview['connection_to'] ?? overview['connected_ap'] ?? '');
                      if (detailAp) c['connected_ap'] = detailAp;
                    }
                  } catch { /* detail fetch failed — use basic values */ }
                }

                enrichedClients.push({
                  hostname: String(c['hostname'] ?? c['name'] ?? c['mac_address'] ?? ''),
                  mac_address: String(c['mac_address'] ?? ''),
                  ip_address: String(c['ip_address'] ?? ''),
                  os_type: String(c['os_type'] ?? ''),
                  connected_ap: String(c['connected_ap'] ?? c['ap_name'] ?? ''),
                  ssid: String(c['ssid'] ?? ''),
                  snr,
                  rssi,
                  health_score: healthScore,
                  channel,
                  // iOS 14+/macOS 12+ uses random MACs by default — radio metrics may be unavailable
                  mac_randomized: snr === 0 && rssi === 0 ? 'likely (iOS/macOS private MAC)' : undefined,
                });
              })
            );

            // Sort by SNR descending (best signal first)
            enrichedClients.sort((a, b) => Number(b['snr'] ?? 0) - Number(a['snr'] ?? 0));

            return {
              vendor_filter: vendor,
              ap_filter: apFilter || null,
              total_scanned: allClients.length,
              matched_count: matched.length,
              shown_count: enrichedClients.length,
              note: matched.length > 20 ? `Showing top 20 of ${matched.length} matched ${vendor} clients` : undefined,
              clients: enrichedClients,
              os_type_breakdown: Object.entries(osBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([os, count]) => ({ os_type: os, count })),
              ap_breakdown: enrichedClients.reduce((acc: Record<string, number>, c) => {
                const ap = String(c['connected_ap'] ?? '');
                if (ap) acc[ap] = (acc[ap] ?? 0) + 1;
                return acc;
              }, {}),
              timestamp: new Date().toISOString(),
            };
          } catch (e) {
            return { error: `Vendor client filter failed: ${e instanceof Error ? e.message : String(e)}` };
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
            // XIQ uses comma-separated list for array params
            const qs = Object.entries(params).map(([k, v]) =>
              Array.isArray(v) ? `${k}=${v.map(encodeURIComponent).join(',')}` : `${k}=${encodeURIComponent(String(v))}`
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

            // ── Multi-strategy client search ──────────────────────────────
            // Strategy 1: searchString against active clients (fast path)
            let clientRecord: Record<string, unknown> | null = null;
            let resolvedMac = clientMac;

            // Normalise search term: strip common iOS suffixes for broader matching
            const normName = clientName.replace(/'s\s+(iphone|ipad|macbook|phone|laptop|watch)/i, '').trim();

            if (clientName) {
              const searchResp = await xiqGetC(token, '/clients/active', {
                searchString: clientName,
                limit: 20,
              }) as { data?: unknown[] } | null;
              const matches = (searchResp?.data ?? []) as Array<Record<string, unknown>>;
              clientRecord = matches[0] ?? null;
              if (!clientRecord && normName !== clientName) {
                // Try normalised name too
                const normResp = await xiqGetC(token, '/clients/active', { searchString: normName, limit: 20 }) as { data?: unknown[] } | null;
                clientRecord = ((normResp?.data ?? []) as Array<Record<string, unknown>>)[0] ?? null;
              }
              if (clientRecord) resolvedMac = String(clientRecord['mac_address'] ?? '');
            }

            // Strategy 2: if MAC known, search active clients by MAC (searchString accepts MAC)
            if (!clientRecord && resolvedMac) {
              try {
                const byMacResp = await xiqGetC(token, '/clients/active', {
                  searchString: resolvedMac,
                  limit: 5,
                }) as { data?: unknown[] } | null;
                const macMatches = (byMacResp?.data ?? []) as Array<Record<string, unknown>>;
                clientRecord = macMatches[0] ?? null;
                if (clientRecord) resolvedMac = String(clientRecord['mac_address'] ?? resolvedMac);
              } catch { /* continue */ }
            }

            // Strategy 3: fetch broader active client list and match by hostname (client-side)
            if (!clientRecord && clientName) {
              try {
                const broadResp = await xiqGetC(token, '/clients/active', { limit: 500 }) as { data?: unknown[] } | null;
                const allActive = (broadResp?.data ?? []) as Array<Record<string, unknown>>;
                const lowerSearch = clientName.toLowerCase();
                clientRecord = allActive.find((c) => {
                  const h = String(c['hostname'] ?? c['name'] ?? '').toLowerCase();
                  const alias = String(c['alias'] ?? c['username'] ?? '').toLowerCase();
                  return h.includes(lowerSearch) || alias.includes(lowerSearch) ||
                    lowerSearch.includes(h.split('-')[0] ?? '') && h.length > 2;
                }) ?? null;
                if (clientRecord) resolvedMac = String(clientRecord['mac_address'] ?? '');
              } catch { /* broad search failed — continue */ }
            }

            // Strategy 4: try searchString in active clients with MAC (if we have MAC but no record)
            if (!clientRecord && resolvedMac) {
              try {
                // Try normalized MAC format (remove colons/dashes)
                const normMac = resolvedMac.replace(/[:\-]/g, '').toUpperCase();
                const macResp = await xiqGetC(token, '/clients/active', { searchString: normMac, limit: 5 }) as { data?: unknown[] } | null;
                const macMatches = (macResp?.data ?? []) as Array<Record<string, unknown>>;
                clientRecord = macMatches[0] ?? null;
                if (clientRecord) resolvedMac = String(clientRecord['mac_address'] ?? resolvedMac);
              } catch { /* continue */ }
            }

            // Strategy 5: offline device — search historical events via alerts endpoint
            // Note: /clients (without /active) returns 404 on some XIQ environments — skip it

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

            // Step 3: Connection trail by MAC — available even for offline devices
            // Note: /client-details/topology/client-trail/{mac} is unreliable (XIQ server-side bug with null stack members)
            // Skip it and derive last-seen from events/details instead
            if (resolvedMac && events.length === 0) {
              // Only try if we have no events yet — this endpoint is fragile
              try {
                connectionTrail = await xiqGetC(token, `/client-details/topology/client-trail/${encodeURIComponent(resolvedMac)}`);
              } catch { /* XIQ topology trail is unreliable — ignore */ }
            }

            // Step 4: Derive last-seen from events or connection trail
            let lastSeenAt: string | null = null;
            let lastSeenAp: string | null = null;
            let lastSeenSsid: string | null = null;

            if (Array.isArray(events) && events.length > 0) {
              const lastEvent = events[events.length - 1] as Record<string, unknown>;
              const ts = lastEvent['timestamp'] ?? lastEvent['time'] ?? lastEvent['create_time'];
              if (ts) lastSeenAt = new Date(Number(ts)).toISOString();
            }

            if (!lastSeenAt && connectionTrail) {
              const trailData = connectionTrail as Record<string, unknown>;
              const entries = (trailData['data'] ?? trailData['trail'] ?? trailData['entries'] ?? []) as Array<Record<string, unknown>>;
              if (Array.isArray(entries) && entries.length > 0) {
                const sorted = [...entries].sort((a, b) => {
                  const ta = Number(a['timestamp'] ?? a['last_seen'] ?? a['time'] ?? 0);
                  const tb = Number(b['timestamp'] ?? b['last_seen'] ?? b['time'] ?? 0);
                  return tb - ta;
                });
                const latest = sorted[0]!;
                const ts = latest['timestamp'] ?? latest['last_seen'] ?? latest['time'];
                if (ts) {
                  lastSeenAt = new Date(Number(ts)).toISOString();
                  lastSeenAp = String(latest['ap_name'] ?? latest['device_name'] ?? latest['hostname'] ?? '');
                  lastSeenSsid = String(latest['ssid'] ?? '');
                }
              }
            }

            // Build a human-readable status message the LLM can use directly
            const statusMessage = isCurrentlyConnected
              ? `${clientName || resolvedMac} is CONNECTED on ${String(clientRecord!['connected_ap'] ?? clientRecord!['ap_name'] ?? 'unknown AP')} (${String(clientRecord!['ssid'] ?? 'unknown SSID')})`
              : lastSeenAt
                ? `${clientName || resolvedMac} is NOT currently connected. Last seen: ${lastSeenAt}${lastSeenAp ? ` on AP "${lastSeenAp}"` : ''}${lastSeenSsid ? ` SSID "${lastSeenSsid}"` : ''}`
                : resolvedMac
                  ? `${clientName || resolvedMac} is NOT connected. No events found in the last ${Number(args['lookbackHours'] ?? 24)} hours.`
                  : `${clientName || 'Device'} not found in active clients. Provide macAddress to retrieve connection history.`;

            // Extract radio metrics — prefer detailsInfo (full client details) over basic client record
            const details = detailsInfo as Record<string, unknown> | null;
            const extractMetric = (field: string, fallback?: string): number | null => {
              const fromDetails = details ? Number(details[field] ?? details[fallback ?? ''] ?? NaN) : NaN;
              if (!isNaN(fromDetails) && fromDetails !== 0) return fromDetails;
              const fromRecord = clientRecord ? Number(clientRecord![field] ?? NaN) : NaN;
              return (!isNaN(fromRecord) && fromRecord !== 0) ? fromRecord : null;
            };

            return {
              client_name: clientName || resolvedMac,
              mac_address: resolvedMac || null,
              is_currently_connected: isCurrentlyConnected,
              status_message: statusMessage,
              current_connection: isCurrentlyConnected ? {
                connected_ap: clientRecord!['connected_ap'] ?? clientRecord!['ap_name'] ?? details?.['connected_ap'] ?? null,
                ssid: clientRecord!['ssid'] ?? details?.['ssid'] ?? null,
                ip_address: clientRecord!['ip_address'] ?? details?.['ip_address'] ?? null,
                snr: extractMetric('snr', 'signal_to_noise_ratio'),
                rssi: extractMetric('rssi', 'received_signal_strength'),
                health_score: extractMetric('health_score'),
                channel: extractMetric('channel'),
                os_type: String(clientRecord!['os_type'] ?? details?.['os_type'] ?? ''),
              } : null,
              last_seen_at: isCurrentlyConnected ? new Date().toISOString() : (lastSeenAt ?? null),
              last_seen_ap: isCurrentlyConnected ? String(clientRecord!['connected_ap'] ?? clientRecord!['ap_name'] ?? '') : (lastSeenAp ?? null),
              last_seen_ssid: isCurrentlyConnected ? String(clientRecord!['ssid'] ?? '') : (lastSeenSsid ?? null),
              recent_events: events.slice(0, 50),
              details: detailsInfo,
              connection_trail: connectionTrail,
              query_window: {
                start: new Date(startTime).toISOString(),
                end: new Date(endTime).toISOString(),
                lookback_hours: Number(args['lookbackHours'] ?? 24),
              },
              // Include hostname from the found client record for transparency
              found_hostname: isCurrentlyConnected ? String(clientRecord!['hostname'] ?? clientRecord!['name'] ?? '') : null,
              timestamp: new Date().toISOString(),
            };
          } catch (e) {
            return { error: `Client snapshot failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        // ── xco_topology_mermaid: composite — auth → list switches → LLDP → Mermaid graph LR ──
        // Returns { topology_diagram: "graph LR\n...", fabrics: [...], switches: [...] }
        if (handlerType === 'xco_topology_mermaid') {
          const effectiveCredIdXco = (config['resolvedCredentialId'] as string | undefined) ?? credentialId;
          if (!effectiveCredIdXco) return { error: 'xco_topology_mermaid requires an XCO credential. Configure an xco-admin credential in the dashboard.' };

          // Base URL and auth URL — substitute {xco-host} from credential vault
          const xcoCredForTopology = await vault.resolve(effectiveCredIdXco, agentPermissions);
          const xcoCredHost = String(xcoCredForTopology['host'] ?? xcoCredForTopology['xco_host'] ?? xcoCredForTopology['xco-host'] ?? '');
          const subHost = (t: string) => xcoCredHost ? t.replace(/\{xco[-_]host\}/g, xcoCredHost) : t;

          const rawAuthUrl = subHost((config['authUrl'] as string | undefined) ?? '');
          const rawBaseUrl = subHost((config['baseUrl'] as string | undefined) ?? (() => {
            try { const u = new URL(rawAuthUrl); return `${u.protocol}//${u.host}/v1`; } catch { return ''; }
          })());
          if (!rawBaseUrl) return { error: 'xco_topology_mermaid: cannot determine XCO base URL — check Endpoint record has correct baseUrl' };

          const authUrlXco = rawAuthUrl || `${rawBaseUrl}/auth/token/access-token`;
          const baseUrlXco = rawBaseUrl;

          const { fetch: xcoFetch2, Agent: XcoAgent } = await import('undici');
          const tlsAgent2 = new (XcoAgent)({ connect: { rejectUnauthorized: false } });
          const xcoFetch = (u: Parameters<typeof xcoFetch2>[0], opts?: Parameters<typeof xcoFetch2>[1]) =>
            xcoFetch2(u, { ...opts, dispatcher: tlsAgent2 });

          const reach = await checkReachable(authUrlXco || baseUrlXco);
          if (!reach.reachable) {
            return { error: reach.error ?? 'Cannot reach XCO endpoint', hint: 'XCO is on a private network — ensure VPN or network access is available' };
          }

          const cacheKeyXco = `${effectiveCredIdXco}:${authUrlXco}`;
          const doXcoAuth = async (): Promise<string | null> => {
            const creds = xcoCredForTopology;
            const resp = await xcoFetch(authUrlXco, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ username: String(creds['username'] ?? ''), password: String(creds['password'] ?? '') }),
            });
            if (!resp.ok) {
              console.error(`[xco_topology_mermaid] Auth failed (${resp.status})`);
              return null;
            }
            const d = await resp.json() as Record<string, unknown>;
            const tok = String(d['access-token'] ?? d['token'] ?? d['access_token'] ?? '');
            if (!tok) return null;
            setXcoToken(cacheKeyXco, tok, Number(d['expires_in'] ?? 3600));
            return tok;
          };

          const xcoToken = getXcoToken(cacheKeyXco) ?? await doXcoAuth();
          if (!xcoToken) return { error: 'XCO authentication failed — check credentials in vault' };

          const xcoGet = async (path: string): Promise<unknown[]> => {
            const url = `${baseUrlXco}${path}`;
            const resp = await xcoFetch(url, { headers: { Authorization: `Bearer ${xcoToken}`, Accept: 'application/json' } });
            console.info(`[xco_topology_mermaid] GET ${url} → ${resp.status}`);
            if (!resp.ok) { console.warn(`[xco_topology_mermaid] ${path} failed: ${resp.status}`); return []; }
            const body = await resp.json() as unknown;
            if (Array.isArray(body)) return body;
            if (body && typeof body === 'object') {
              const b = body as Record<string, unknown>;
              for (const k of ['switches', 'result', 'data', 'items', 'neighbors']) {
                if (Array.isArray(b[k])) return b[k] as unknown[];
              }
            }
            return [];
          };

          try {
            const [switchData, lldpData, fabricData] = await Promise.all([
              xcoGet('/inventory/switches'),
              xcoGet('/monitor/lldp').catch(() => [] as unknown[]),
              xcoGet('/fabric/fabrics').catch(() => [] as unknown[]),
            ]);

            type Switch = { ip: string; name: string; fabric: string; role: string; state: string; model: string };
            const switches: Switch[] = (switchData as Array<Record<string, unknown>>).map((s) => {
              // fabric may be an object {name, id} from some XCO API versions — extract string safely
              const rawFabric = s['fabric'] ?? s['fabric_name'] ?? s['tenantName'];
              const fabricStr = rawFabric && typeof rawFabric === 'object'
                ? String((rawFabric as Record<string, unknown>)['name'] ?? (rawFabric as Record<string, unknown>)['id'] ?? 'unknown')
                : (rawFabric ? String(rawFabric) : 'unknown');
              return {
                ip: String(s['ip_address'] ?? s['management_ip'] ?? s['ip'] ?? ''),
                name: String(s['name'] ?? s['host_name'] ?? s['hostname'] ?? s['ip_address'] ?? 'unknown'),
                fabric: fabricStr,
                role: String(s['role'] ?? s['node_role'] ?? '').toLowerCase(),
                state: String(s['app_state'] ?? s['status'] ?? s['state'] ?? ''),
                model: String(s['model'] ?? s['chassis_type'] ?? ''),
              };
            });

            const fabrics = (fabricData as Array<Record<string, unknown>>).map((f) => ({
              name: String(f['name'] ?? ''),
              status: String(f['status'] ?? f['health'] ?? ''),
              type: String(f['type'] ?? ''),
              stage: f['stage'] ?? null,
            }));

            // Build IP → Switch map for LLDP lookup
            const switchByIp = new Map<string, Switch>();
            for (const sw of switches) if (sw.ip) switchByIp.set(sw.ip, sw);

            type LldpLink = { local: string; neighbor: string; localPort: string; neighborPort: string };
            const lldpLinks: LldpLink[] = (lldpData as Array<Record<string, unknown>>).map((l) => ({
              local: String(l['local_ip_address'] ?? l['local_ip'] ?? l['ip_address'] ?? ''),
              neighbor: String(l['neighbor_ip_address'] ?? l['neighbor_ip'] ?? l['remote_ip'] ?? ''),
              localPort: String(l['local_port'] ?? l['local_interface'] ?? ''),
              neighborPort: String(l['neighbor_port'] ?? l['remote_port'] ?? l['remote_interface'] ?? ''),
            })).filter((l) => l.local && l.neighbor && l.local !== l.neighbor);

            // Deduplicate links — treat A→B and B→A as the same edge
            const seenLinks = new Set<string>();
            const uniqueLinks: LldpLink[] = [];
            for (const link of lldpLinks) {
              const key = [link.local, link.neighbor].sort().join('|');
              if (!seenLinks.has(key)) { seenLinks.add(key); uniqueLinks.push(link); }
            }

            // Build a safe Mermaid node ID from a switch name or IP
            const nodeId = (s: Switch) =>
              `sw_${(s.name || s.ip).replace(/[^a-zA-Z0-9]/g, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '')}`;

            // Determine shape by role: spine = stadium, leaf/border-leaf = box, super-spine = hexagon, unknown = box
            const nodeShape = (sw: Switch, id: string, label: string): string => {
              const r = sw.role;
              if (r.includes('super')) return `${id}{{${label}}}`;
              if (r.includes('spine')) return `${id}([${label}])`;
              if (r.includes('border') || r.includes('gateway')) return `${id}[/${label}/]`;
              if (r.includes('leaf')) return `${id}[${label}]`;
              return `${id}[${label}]`;
            };

            const escapeMermaid = (s: string) => s.replace(/["\n\r]/g, ' ').trim();

            // Build mermaid graph LR
            const lines: string[] = ['graph LR'];

            // Group switches by fabric into subgraphs
            const fabricGroups = new Map<string, Switch[]>();
            for (const sw of switches) {
              if (!fabricGroups.has(sw.fabric)) fabricGroups.set(sw.fabric, []);
              fabricGroups.get(sw.fabric)!.push(sw);
            }

            for (const [fabricName, fSwitches] of fabricGroups) {
              // subgraph ID must be alphanumeric+underscore; label is quoted
              const subName = fabricName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '') || 'fabric';
              lines.push(`  subgraph ${subName}["${escapeMermaid(fabricName)}"]`);
              for (const sw of fSwitches) {
                const id = nodeId(sw);
                const label = escapeMermaid(`${sw.name}\\n${sw.role || 'switch'}\\n${sw.model || sw.ip}`);
                lines.push(`    ${nodeShape(sw, id, label)}`);
              }
              lines.push('  end');
            }

            // Add LLDP edges
            if (uniqueLinks.length > 0) {
              lines.push('');
              for (const link of uniqueLinks) {
                const localSw = switchByIp.get(link.local);
                const neighborSw = switchByIp.get(link.neighbor);
                // Only draw edges where both endpoints are known
                if (localSw && neighborSw) {
                  lines.push(`  ${nodeId(localSw)} -- "${escapeMermaid(link.localPort)}" --> ${nodeId(neighborSw)}`);
                }
              }
            } else if (switches.length > 1) {
              // No LLDP data — draw inferred spine→leaf edges based on roles
              lines.push('');
              const spines = switches.filter((s) => s.role.includes('spine') && !s.role.includes('super'));
              const leaves = switches.filter((s) => s.role.includes('leaf'));
              if (spines.length > 0 && leaves.length > 0) {
                lines.push('  %% Inferred topology (no LLDP data)');
                for (const spine of spines) {
                  for (const leaf of leaves) {
                    lines.push(`  ${nodeId(spine)} --> ${nodeId(leaf)}`);
                  }
                }
              }
            }

            // Style nodes by role × state — vibrant palette visible on dark backgrounds
            lines.push('');
            // Spine: indigo tones
            lines.push('  classDef spine_healthy fill:#1e3a5f,color:#bfdbfe,stroke:#3b82f6,stroke-width:2px');
            lines.push('  classDef spine_warn    fill:#451a03,color:#fed7aa,stroke:#f97316,stroke-width:2px');
            lines.push('  classDef spine_error   fill:#450a0a,color:#fca5a5,stroke:#ef4444,stroke-width:2px');
            lines.push('  classDef spine_unknown fill:#1e293b,color:#93c5fd,stroke:#3b82f6,stroke-width:1px');
            // Leaf: emerald/teal tones
            lines.push('  classDef leaf_healthy  fill:#052e16,color:#bbf7d0,stroke:#22c55e,stroke-width:2px');
            lines.push('  classDef leaf_warn     fill:#431407,color:#fde68a,stroke:#f59e0b,stroke-width:2px');
            lines.push('  classDef leaf_error    fill:#450a0a,color:#fca5a5,stroke:#ef4444,stroke-width:2px');
            lines.push('  classDef leaf_unknown  fill:#0f2926,color:#5eead4,stroke:#14b8a6,stroke-width:1px');
            // Border-leaf / gateway: purple tones
            lines.push('  classDef border_healthy fill:#1a1033,color:#ddd6fe,stroke:#8b5cf6,stroke-width:2px');
            lines.push('  classDef border_warn    fill:#3b1506,color:#fed7aa,stroke:#f97316,stroke-width:2px');
            lines.push('  classDef border_error   fill:#450a0a,color:#fca5a5,stroke:#ef4444,stroke-width:2px');
            lines.push('  classDef border_unknown fill:#1e1040,color:#c4b5fd,stroke:#7c3aed,stroke-width:1px');
            // Fallback
            lines.push('  classDef sw_healthy fill:#052e16,color:#bbf7d0,stroke:#22c55e,stroke-width:2px');
            lines.push('  classDef sw_warn    fill:#431407,color:#fde68a,stroke:#f59e0b,stroke-width:2px');
            lines.push('  classDef sw_error   fill:#450a0a,color:#fca5a5,stroke:#ef4444,stroke-width:2px');
            lines.push('  classDef sw_unknown fill:#1e293b,color:#cbd5e1,stroke:#475569,stroke-width:1px');

            for (const sw of switches) {
              const id = nodeId(sw);
              const r = sw.role.toLowerCase();
              const roleKey = r.includes('super') ? 'spine'
                : r.includes('border') || r.includes('gateway') ? 'border'
                : r.includes('spine') ? 'spine'
                : r.includes('leaf') ? 'leaf'
                : 'sw';
              const st = sw.state.toLowerCase();
              const stateKey = (st.includes('in-sync') || st.includes('insync') || st === 'provisioned') ? 'healthy'
                : (st.includes('error') || st.includes('failed') || st.includes('unreachable')) ? 'error'
                : (st.includes('refresh') || st.includes('maintenance')) ? 'warn'
                : 'unknown';
              lines.push(`  class ${id} ${roleKey}_${stateKey}`);
            }

            const topology_diagram = lines.join('\n');

            return {
              topology_diagram,
              summary: {
                total_switches: switches.length,
                total_fabrics: fabricGroups.size,
                lldp_links: uniqueLinks.length,
                spines: switches.filter((s) => s.role.includes('spine')).length,
                leaves: switches.filter((s) => s.role.includes('leaf')).length,
                timestamp: new Date().toISOString(),
              },
              fabrics,
              switches: switches.map((s) => ({ name: s.name, ip: s.ip, fabric: s.fabric, role: s.role, state: s.state, model: s.model })),
            };
          } catch (e) {
            return { error: `XCO topology mermaid failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        // ── xco_fabric_overview: full fabric picture — devices, fabrics, health, alarms, BGP, topology ──
        // Returns { topology_diagram, headline, fabrics, devices, alarm_summary, bgp_sessions, health_score }
        if (handlerType === 'xco_fabric_overview') {
          const effectiveCredIdFo = (config['resolvedCredentialId'] as string | undefined) ?? credentialId;
          if (!effectiveCredIdFo) return { error: 'xco_fabric_overview requires an XCO credential.' };

          const rawAuthUrlFo = (config['authUrl'] as string | undefined) ?? '';
          const rawBaseUrlFo = (config['baseUrl'] as string | undefined) ?? (() => {
            try { const u = new URL(rawAuthUrlFo); return `${u.protocol}//${u.host}/v1`; } catch { return ''; }
          })();
          if (!rawBaseUrlFo) return { error: 'xco_fabric_overview: cannot determine XCO base URL — check Endpoint record has correct baseUrl' };

          const authUrlFo = rawAuthUrlFo || `${rawBaseUrlFo}/auth/token/access-token`;
          const baseUrlFo = rawBaseUrlFo;

          const reach = await checkReachable(authUrlFo || baseUrlFo);
          if (!reach.reachable) {
            return { error: reach.error ?? 'Cannot reach XCO endpoint', hint: 'XCO is on a private network — ensure VPN or network access is available' };
          }

          const { fetch: foFetchBase, Agent: FoAgent } = await import('undici');
          const foTlsAgent = new (FoAgent)({ connect: { rejectUnauthorized: false } });
          const foFetch = (u: Parameters<typeof foFetchBase>[0], opts?: Parameters<typeof foFetchBase>[1]) =>
            foFetchBase(u, { ...opts, dispatcher: foTlsAgent });

          const cacheKeyFo = `${effectiveCredIdFo}:${authUrlFo}`;
          const doFoAuth = async (): Promise<string | null> => {
            const creds = await vault.resolve(effectiveCredIdFo, agentPermissions);
            const resp = await foFetch(authUrlFo, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ username: String(creds['username'] ?? ''), password: String(creds['password'] ?? '') }),
            });
            if (!resp.ok) { console.error(`[xco_fabric_overview] Auth failed (${resp.status})`); return null; }
            const d = await resp.json() as Record<string, unknown>;
            const tok = String(d['access-token'] ?? d['token'] ?? d['access_token'] ?? '');
            if (!tok) return null;
            setXcoToken(cacheKeyFo, tok, Number(d['expires_in'] ?? 3600));
            return tok;
          };

          const foToken = getXcoToken(cacheKeyFo) ?? await doFoAuth();
          if (!foToken) return { error: 'XCO authentication failed — check credentials in vault' };

          const foGet = async (path: string): Promise<unknown[]> => {
            const url = `${baseUrlFo}${path}`;
            const resp = await foFetch(url, { headers: { Authorization: `Bearer ${foToken}`, Accept: 'application/json' } });
            console.info(`[xco_fabric_overview] GET ${url} → ${resp.status}`);
            if (!resp.ok) { console.warn(`[xco_fabric_overview] ${path} failed: ${resp.status}`); return []; }
            const body = await resp.json() as unknown;
            if (Array.isArray(body)) return body;
            if (body && typeof body === 'object') {
              const b = body as Record<string, unknown>;
              for (const k of ['switches', 'fabrics', 'result', 'data', 'items', 'sessions', 'neighbors', 'alarms']) {
                if (Array.isArray(b[k])) return b[k] as unknown[];
              }
            }
            return [];
          };

          try {
            const [switchData, fabricData, fabricHealthData, alarmRaw, bgpData, lldpData] = await Promise.all([
              foGet('/inventory/switches'),
              foGet('/fabric/fabrics').catch(() => [] as unknown[]),
              foGet('/fabric/fabrics-health').catch(() => [] as unknown[]),
              foFetch(`${baseUrlFo}/faultmanager/alarm/summary`, {
                headers: { Authorization: `Bearer ${foToken}`, Accept: 'application/json' },
              }).then((r) => r.json() as Promise<unknown>).catch(() => null),
              foGet('/monitor/bgp').catch(() => [] as unknown[]),
              foGet('/monitor/lldp').catch(() => [] as unknown[]),
            ]);

            // ── Device normalisation ────────────────────────────────────────────
            type FoSwitch = { ip: string; name: string; fabric: string; role: string; state: string; model: string };
            const devices: FoSwitch[] = (switchData as Array<Record<string, unknown>>).map((s) => {
              const rawFabric = s['fabric'] ?? s['fabric_name'] ?? s['tenantName'];
              const fabricStr = rawFabric && typeof rawFabric === 'object'
                ? String((rawFabric as Record<string, unknown>)['name'] ?? (rawFabric as Record<string, unknown>)['id'] ?? 'unknown')
                : (rawFabric ? String(rawFabric) : 'unknown');
              return {
                ip: String(s['ip_address'] ?? s['management_ip'] ?? s['ip'] ?? ''),
                name: String(s['name'] ?? s['host_name'] ?? s['hostname'] ?? s['ip_address'] ?? 'unknown'),
                fabric: fabricStr,
                role: String(s['role'] ?? s['node_role'] ?? '').toLowerCase(),
                state: String(s['app_state'] ?? s['status'] ?? s['state'] ?? ''),
                model: String(s['model'] ?? s['chassis_type'] ?? ''),
              };
            });

            // ── Fabric normalisation ────────────────────────────────────────────
            const fabricHealthMap = new Map<string, string>();
            for (const fh of fabricHealthData as Array<Record<string, unknown>>) {
              const fname = String(fh['name'] ?? fh['fabric_name'] ?? '');
              if (fname) fabricHealthMap.set(fname, String(fh['health'] ?? fh['status'] ?? ''));
            }
            const fabrics = (fabricData as Array<Record<string, unknown>>).map((f) => {
              const name = String(f['name'] ?? '');
              return {
                name,
                type: String(f['type'] ?? ''),
                stage: f['stage'] != null ? String(f['stage']) : null,
                status: String(f['status'] ?? ''),
                health: fabricHealthMap.get(name) ?? String(f['health'] ?? ''),
                device_count: devices.filter((d) => d.fabric === name).length,
              };
            });

            // ── Alarm summary ───────────────────────────────────────────────────
            const alarmSummary = { critical: 0, major: 0, minor: 0, warning: 0, info: 0 };
            if (alarmRaw && typeof alarmRaw === 'object') {
              const a = alarmRaw as Record<string, unknown>;
              // Handle both flat { Critical: N } and nested { summary: { Critical: N } } shapes
              const src = (a['summary'] && typeof a['summary'] === 'object') ? a['summary'] as Record<string, unknown> : a;
              alarmSummary.critical = Number(src['Critical'] ?? src['critical'] ?? src['CRITICAL'] ?? 0);
              alarmSummary.major    = Number(src['Major']    ?? src['major']    ?? src['MAJOR']    ?? 0);
              alarmSummary.minor    = Number(src['Minor']    ?? src['minor']    ?? src['MINOR']    ?? 0);
              alarmSummary.warning  = Number(src['Warning']  ?? src['warning']  ?? src['WARNING']  ?? 0);
              alarmSummary.info     = Number(src['Info']     ?? src['info']     ?? src['INFO']     ?? 0);
            }

            // ── BGP sessions ────────────────────────────────────────────────────
            const bgp_sessions = (bgpData as Array<Record<string, unknown>>).map((b) => ({
              local_ip:    String(b['local_ip_address'] ?? b['local_ip'] ?? b['ip_address'] ?? ''),
              peer_ip:     String(b['neighbor_ip_address'] ?? b['neighbor_ip'] ?? b['peer_ip'] ?? ''),
              state:       String(b['state'] ?? b['bgp_state'] ?? '').toUpperCase(),
              fabric:      String(b['fabric'] ?? b['fabric_name'] ?? ''),
              local_asn:   String(b['local_asn'] ?? b['asn'] ?? ''),
              peer_asn:    String(b['neighbor_asn'] ?? b['peer_asn'] ?? ''),
            })).filter((s) => s.local_ip || s.peer_ip);

            // ── Health score ────────────────────────────────────────────────────
            const healthy  = devices.filter((d) => { const s = d.state.toLowerCase(); return s.includes('in-sync') || s.includes('insync') || s === 'provisioned'; }).length;
            const failed   = devices.filter((d) => { const s = d.state.toLowerCase(); return s.includes('error') || s.includes('failed') || s.includes('unreachable'); }).length;
            const degraded = devices.filter((d) => { const s = d.state.toLowerCase(); return s.includes('refresh') || s.includes('maintenance'); }).length;
            const health_score = { total: devices.length, healthy, degraded, failed };

            const overallStatus = (failed > 0 || alarmSummary.critical > 0) ? 'CRITICAL'
              : (degraded > 0 || alarmSummary.major > 0) ? 'DEGRADED'
              : devices.length === 0 ? 'UNKNOWN'
              : 'HEALTHY';

            const parts: string[] = [];
            if (failed > 0)   parts.push(`${failed} device${failed > 1 ? 's' : ''} failed`);
            if (degraded > 0) parts.push(`${degraded} degraded`);
            if (alarmSummary.critical > 0) parts.push(`${alarmSummary.critical} critical alarm${alarmSummary.critical > 1 ? 's' : ''}`);
            if (alarmSummary.major > 0)    parts.push(`${alarmSummary.major} major alarm${alarmSummary.major > 1 ? 's' : ''}`);
            const headline = {
              status: overallStatus,
              message: parts.length > 0 ? parts.join(', ') : `${healthy} of ${devices.length} devices healthy`,
            };

            // ── Topology diagram (same render pipeline as xco_topology_mermaid) ─
            const switchByIpFo = new Map<string, FoSwitch>();
            for (const sw of devices) if (sw.ip) switchByIpFo.set(sw.ip, sw);

            type FoLldpLink = { local: string; neighbor: string; localPort: string; neighborPort: string };
            const lldpLinks: FoLldpLink[] = (lldpData as Array<Record<string, unknown>>).map((l) => ({
              local: String(l['local_ip_address'] ?? l['local_ip'] ?? l['ip_address'] ?? ''),
              neighbor: String(l['neighbor_ip_address'] ?? l['neighbor_ip'] ?? l['remote_ip'] ?? ''),
              localPort: String(l['local_port'] ?? l['local_interface'] ?? ''),
              neighborPort: String(l['neighbor_port'] ?? l['remote_port'] ?? l['remote_interface'] ?? ''),
            })).filter((l) => l.local && l.neighbor && l.local !== l.neighbor);

            const seenLinksFo = new Set<string>();
            const uniqueLinksFo: FoLldpLink[] = [];
            for (const link of lldpLinks) {
              const key = [link.local, link.neighbor].sort().join('|');
              if (!seenLinksFo.has(key)) { seenLinksFo.add(key); uniqueLinksFo.push(link); }
            }

            const foNodeId = (s: FoSwitch) =>
              `sw_${(s.name || s.ip).replace(/[^a-zA-Z0-9]/g, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '')}`;

            const foNodeShape = (sw: FoSwitch, id: string, label: string): string => {
              const r = sw.role;
              if (r.includes('super'))  return `${id}{{${label}}}`;
              if (r.includes('spine'))  return `${id}([${label}])`;
              if (r.includes('border') || r.includes('gateway')) return `${id}[/${label}/]`;
              return `${id}[${label}]`;
            };

            const foEscape = (s: string) => s.replace(/["\n\r]/g, ' ').trim();

            const topoLines: string[] = ['graph LR'];
            const fabricGroupsFo = new Map<string, FoSwitch[]>();
            for (const sw of devices) {
              if (!fabricGroupsFo.has(sw.fabric)) fabricGroupsFo.set(sw.fabric, []);
              fabricGroupsFo.get(sw.fabric)!.push(sw);
            }
            for (const [fabricName, fSwitches] of fabricGroupsFo) {
              const subName = fabricName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '') || 'fabric';
              topoLines.push(`  subgraph ${subName}["${foEscape(fabricName)}"]`);
              for (const sw of fSwitches) {
                const id = foNodeId(sw);
                const label = foEscape(`${sw.name}\\n${sw.role || 'switch'}\\n${sw.model || sw.ip}`);
                topoLines.push(`    ${foNodeShape(sw, id, label)}`);
              }
              topoLines.push('  end');
            }
            if (uniqueLinksFo.length > 0) {
              topoLines.push('');
              for (const link of uniqueLinksFo) {
                const localSw = switchByIpFo.get(link.local);
                const neighborSw = switchByIpFo.get(link.neighbor);
                if (localSw && neighborSw) {
                  topoLines.push(`  ${foNodeId(localSw)} -- "${foEscape(link.localPort)}" --> ${foNodeId(neighborSw)}`);
                }
              }
            } else if (devices.length > 1) {
              topoLines.push('');
              const spines = devices.filter((s) => s.role.includes('spine') && !s.role.includes('super'));
              const leaves = devices.filter((s) => s.role.includes('leaf'));
              if (spines.length > 0 && leaves.length > 0) {
                topoLines.push('  %% Inferred topology (no LLDP data)');
                for (const spine of spines) {
                  for (const leaf of leaves) {
                    topoLines.push(`  ${foNodeId(spine)} --> ${foNodeId(leaf)}`);
                  }
                }
              }
            }
            // Role × state colour palette
            topoLines.push('');
            topoLines.push('  classDef spine_healthy fill:#1e3a5f,color:#bfdbfe,stroke:#3b82f6,stroke-width:2px');
            topoLines.push('  classDef spine_warn    fill:#451a03,color:#fed7aa,stroke:#f97316,stroke-width:2px');
            topoLines.push('  classDef spine_error   fill:#450a0a,color:#fca5a5,stroke:#ef4444,stroke-width:2px');
            topoLines.push('  classDef spine_unknown fill:#1e293b,color:#93c5fd,stroke:#3b82f6,stroke-width:1px');
            topoLines.push('  classDef leaf_healthy  fill:#052e16,color:#bbf7d0,stroke:#22c55e,stroke-width:2px');
            topoLines.push('  classDef leaf_warn     fill:#431407,color:#fde68a,stroke:#f59e0b,stroke-width:2px');
            topoLines.push('  classDef leaf_error    fill:#450a0a,color:#fca5a5,stroke:#ef4444,stroke-width:2px');
            topoLines.push('  classDef leaf_unknown  fill:#0f2926,color:#5eead4,stroke:#14b8a6,stroke-width:1px');
            topoLines.push('  classDef border_healthy fill:#1a1033,color:#ddd6fe,stroke:#8b5cf6,stroke-width:2px');
            topoLines.push('  classDef border_warn    fill:#3b1506,color:#fed7aa,stroke:#f97316,stroke-width:2px');
            topoLines.push('  classDef border_error   fill:#450a0a,color:#fca5a5,stroke:#ef4444,stroke-width:2px');
            topoLines.push('  classDef border_unknown fill:#1e1040,color:#c4b5fd,stroke:#7c3aed,stroke-width:1px');
            topoLines.push('  classDef sw_healthy fill:#052e16,color:#bbf7d0,stroke:#22c55e,stroke-width:2px');
            topoLines.push('  classDef sw_warn    fill:#431407,color:#fde68a,stroke:#f59e0b,stroke-width:2px');
            topoLines.push('  classDef sw_error   fill:#450a0a,color:#fca5a5,stroke:#ef4444,stroke-width:2px');
            topoLines.push('  classDef sw_unknown fill:#1e293b,color:#cbd5e1,stroke:#475569,stroke-width:1px');
            for (const sw of devices) {
              const id = foNodeId(sw);
              const r = sw.role.toLowerCase();
              const roleKey = r.includes('super') ? 'spine'
                : (r.includes('border') || r.includes('gateway')) ? 'border'
                : r.includes('spine') ? 'spine'
                : r.includes('leaf') ? 'leaf'
                : 'sw';
              const st = sw.state.toLowerCase();
              const stateKey = (st.includes('in-sync') || st.includes('insync') || st === 'provisioned') ? 'healthy'
                : (st.includes('error') || st.includes('failed') || st.includes('unreachable')) ? 'error'
                : (st.includes('refresh') || st.includes('maintenance')) ? 'warn'
                : 'unknown';
              topoLines.push(`  class ${id} ${roleKey}_${stateKey}`);
            }

            return {
              topology_diagram: topoLines.join('\n'),
              headline,
              health_score,
              alarm_summary: alarmSummary,
              fabrics,
              devices: devices.map((d) => ({ name: d.name, ip: d.ip, fabric: d.fabric, role: d.role, state: d.state, model: d.model })),
              bgp_sessions,
            };
          } catch (e) {
            return { error: `XCO fabric overview failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }


        // Returns { sankey_diagram: "sankey-beta\n...", summary: {...}, flows: [...] }
        if (handlerType === 'xiq_policy_sankey') {
          if (!credentialId) return { error: 'xiq_policy_sankey requires a credentialId' };

          const loginUrlSk = (config['loginUrl'] as string | undefined) ?? 'https://api.extremecloudiq.com/login';
          const apiBaseSk = 'https://api.extremecloudiq.com';

          const reachSk = await checkReachable(loginUrlSk);
          if (!reachSk.reachable) {
            return { error: reachSk.error ?? `Cannot reach ${loginUrlSk}`, hint: 'Check network connectivity — XIQ requires internet access' };
          }

          const { fetch: skFetch } = await import('undici');

          const getSkToken = async (): Promise<string | null> => {
            let token = getCachedToken(credentialId!);
            if (!token) {
              const creds = await vault.resolve(credentialId!, agentPermissions);
              const username = String(creds['username'] ?? creds['xiq_username'] ?? '');
              const password = String(creds['password'] ?? creds['xiq_password'] ?? '');
              const resp = await skFetch(loginUrlSk, {
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

          const skGet = async (token: string, path: string, params: Record<string, string | number> = {}): Promise<unknown[]> => {
            const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
            const url = `${apiBaseSk}${path}${qs ? '?' + qs : ''}`;
            const resp = await skFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
            console.info(`[xiq_policy_sankey] GET ${url} → ${resp.status}`);
            if (!resp.ok) {
              const txt = await resp.text().catch(() => '');
              console.warn(`[xiq_policy_sankey] ${path} failed: ${resp.status} ${txt.slice(0, 200)}`);
              return [];
            }
            const body = await resp.json() as { data?: unknown[] } | unknown[];
            if (Array.isArray(body)) return body;
            return (body as { data?: unknown[] }).data ?? [];
          };

          // Paginated helper — fetches up to maxPages pages, with optional extra query params
          const skGetAll = async (token: string, path: string, maxPages = 5, extraParams: Record<string, string | number> = {}): Promise<unknown[]> => {
            const all: unknown[] = [];
            for (let page = 1; page <= maxPages; page++) {
              const batch = await skGet(token, path, { page, limit: 100, ...extraParams });
              all.push(...batch);
              if (batch.length < 100) break;
            }
            return all;
          };

          try {
            const token = await getSkToken();
            if (!token) return { error: 'XIQ login failed — check credentials in vault' };

            // Maker detection — same OUI/OS logic as xiq_ap_client_sankey
            const detectMakerPol = (c: Record<string, unknown>): string => {
              const os = String(c['os_type'] ?? '').toLowerCase();
              const hostname = String(c['hostname'] ?? c['name'] ?? '').toLowerCase();
              const mac = String(c['mac_address'] ?? '').toUpperCase().replace(/[:\-]/g, '');
              const oui = mac.substring(0, 6);
              if (os.includes('apple') || os.includes('ios') || os.includes('macos') || os.includes('mac os') ||
                  os.includes('ipad') || os.includes('watchos') || os.includes('tvos') ||
                  /iphone|ipad|macbook|imac|mac mini|mac pro|airpod|ipod|apple/i.test(hostname) ||
                  ['F81EDF','F0DB30','F0B429','ECA6B4','E8FAC6','DCA904','D83062','D0A637','B82AAA',
                   'B0BE76','A4C361','9CF48E','8CAAB5','706E6D','6C96CF','5C96A4','504BAA','48D705',
                   '440010','3C5282','2095F0','143C4A','0CFE45','001CBE','001B63'].includes(oui)) return 'Apple';
              if (os.includes('android') || os.includes('google') || os.includes('chrome os')) return 'Android';
              if (os.includes('windows') || os.includes('microsoft')) return 'Windows';
              if (os.includes('linux') || os.includes('ubuntu') || os.includes('debian')) return 'Linux';
              if (os.includes('embedded') || os.includes('iot') || os.includes('rtos')) return 'IoT/Embedded';
              return 'Unknown';
            };

            // /24 subnet grouping for IP leaf nodes — keeps the diagram readable
            const toSubnet24 = (ip: string): string => {
              if (!ip) return 'Unknown';
              const parts = ip.split('.');
              return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : ip;
            };

            // Fetch device list (paginated) to resolve device_id → AP hostname
            let allDevices: Array<Record<string, unknown>> = [];
            for (let pg = 1; pg <= 5; pg++) {
              const batch = await skGet(token, '/devices', { page: pg, limit: 100 });
              allDevices = allDevices.concat(batch as Array<Record<string, unknown>>);
              if ((batch as unknown[]).length < 100) break;
            }
            const deviceMap = new Map<number, string>();
            for (const d of allDevices) {
              const id = d['id'] as number | undefined;
              const hostname = String(d['hostname'] ?? d['host_name'] ?? d['name'] ?? '');
              if (id && hostname) deviceMap.set(id, hostname);
            }

            // Fetch network policies (paginated)
            const policies = await skGetAll(token, '/network-policies', 5);

            // Fetch SSIDs per policy in parallel
            type PolicyInfo = { id: number; name: string; ssids: string[] };
            const policyList: PolicyInfo[] = await Promise.all(
              (policies as Array<Record<string, unknown>>).map(async (p) => {
                const pid = p['id'] as number;
                const pname = String(p['name'] ?? `Policy ${pid}`);
                const ssids = await skGet(token, `/network-policies/${pid}/ssids`, { page: 1, limit: 100 });
                const ssidNames = (ssids as Array<Record<string, unknown>>).map((s) =>
                  String(s['name'] ?? s['ssid'] ?? s['ssid_name'] ?? '')
                ).filter(Boolean);
                return { id: pid, name: pname, ssids: ssidNames };
              }),
            );

            // SSID → policy map — track all policies per SSID to detect shared SSIDs
            const ssidToPolicies = new Map<string, string[]>();
            for (const pol of policyList) {
              for (const ssid of pol.ssids) {
                const existing = ssidToPolicies.get(ssid) ?? [];
                if (!existing.includes(pol.name)) existing.push(pol.name);
                ssidToPolicies.set(ssid, existing);
              }
            }
            const ssidToPolicy = new Map<string, string>();
            for (const [ssid, polNames] of ssidToPolicies) {
              ssidToPolicy.set(ssid, polNames.length === 1 ? (polNames[0] ?? 'Unknown Policy') : 'Shared (Multiple Policies)');
            }

            // Fetch all active clients (paginated)
            const allClients = await skGetAll(token, '/clients/active', 5);

            // Build 5-level edges: Policy → AP → SSID → Maker → /24 Subnet
            const policyToAp  = new Map<string, Map<string, number>>();
            const apToSsid    = new Map<string, Map<string, number>>();
            const ssidToMaker = new Map<string, Map<string, number>>();
            const makerToSubnet = new Map<string, Map<string, number>>();

            // Summary helpers
            const apClientCounts = new Map<string, number>();
            const ssidClientCounts = new Map<string, number>();
            const apSsidSet = new Map<string, Set<string>>();

            const addEdge = (m: Map<string, Map<string, number>>, src: string, tgt: string) => {
              if (!m.has(src)) m.set(src, new Map());
              m.get(src)!.set(tgt, (m.get(src)!.get(tgt) ?? 0) + 1);
            };

            for (const client of allClients as Array<Record<string, unknown>>) {
              const ssid = String(client['ssid'] ?? '').trim();
              if (!ssid) continue;

              // Resolve AP name via device_id (exact field returned by XIQ /clients/active)
              const devId = (client['device_id'] ?? client['connected_ap_id']) as number | undefined;
              const ap = (devId ? (deviceMap.get(devId) ?? '') : '').trim() ||
                         String(client['connected_ap'] ?? '').trim() || 'Unknown AP';

              const policyName = ssidToPolicy.get(ssid) ?? 'Unknown Policy';
              const maker = detectMakerPol(client);
              const rawIp = String(client['ip_address'] ?? '').trim();
              const subnet = rawIp ? toSubnet24(rawIp) : `${maker} (no IP)`;

              addEdge(policyToAp, policyName, ap);
              addEdge(apToSsid, ap, ssid);
              addEdge(ssidToMaker, ssid, maker);
              addEdge(makerToSubnet, maker, subnet);

              apClientCounts.set(ap, (apClientCounts.get(ap) ?? 0) + 1);
              ssidClientCounts.set(ssid, (ssidClientCounts.get(ssid) ?? 0) + 1);
              if (!apSsidSet.has(ap)) apSsidSet.set(ap, new Set());
              apSsidSet.get(ap)!.add(ssid);
            }

            // Build sankey-beta lines
            const sanitize = (s: string) => `"${s.replace(/"/g, "'").replace(/[\n\r]/g, ' ').trim()}"`;
            const sankeyLines: string[] = ['sankey-beta', ''];
            const flows: Array<{ source: string; target: string; value: number }> = [];

            const emitEdges = (m: Map<string, Map<string, number>>) => {
              for (const [src, tgtMap] of m) {
                for (const [tgt, count] of tgtMap) {
                  if (count > 0) {
                    sankeyLines.push(`${sanitize(src)},${sanitize(tgt)},${count}`);
                    flows.push({ source: src, target: tgt, value: count });
                  }
                }
              }
            };

            emitEdges(policyToAp);
            emitEdges(apToSsid);
            emitEdges(ssidToMaker);
            emitEdges(makerToSubnet);

            // Zero-client fallback: show policy/SSID skeleton
            if (flows.length === 0 && policyList.length > 0) {
              sankeyLines.push('%% No active clients — showing policy/SSID structure');
              for (const pol of policyList) {
                for (const ssid of pol.ssids) {
                  sankeyLines.push(`${sanitize(pol.name)},${sanitize(ssid)},1`);
                  flows.push({ source: pol.name, target: ssid, value: 1 });
                }
              }
            }

            // Summary tables
            const ap_summary = Array.from(apClientCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([ap, count]) => ({ ap, ssid_count: apSsidSet.get(ap)?.size ?? 0, client_count: count }));

            const ssid_summary = Array.from(ssidClientCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([ssid, count]) => ({
                ssid,
                policy: ssidToPolicy.get(ssid) ?? 'Unknown Policy',
                client_count: count,
              }));

            return {
              sankey_diagram: sankeyLines.join('\n'),
              summary: {
                total_clients: allClients.length,
                total_policies: policyList.length,
                total_aps: apClientCounts.size,
                total_ssids: ssidClientCounts.size,
                timestamp: new Date().toISOString(),
              },
              ap_summary,
              ssid_summary,
              policies: policyList.map((p) => ({ name: p.name, ssid_count: p.ssids.length, ssids: p.ssids })),
              flows,
            };
          } catch (e) {
            return { error: `XIQ policy sankey failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        // ── xiq_ap_client_sankey: AP → SSID → Maker → Device Type ──
        // Returns { sankey_diagram, flows, summary } with 4-level client breakdown
        if (handlerType === 'xiq_ap_client_sankey') {
          if (!credentialId) return { error: 'xiq_ap_client_sankey requires a credentialId' };

          const loginUrlAcs = (config['loginUrl'] as string | undefined) ?? 'https://api.extremecloudiq.com/login';
          const apiBaseAcs = 'https://api.extremecloudiq.com';

          const reachAcs = await checkReachable(loginUrlAcs);
          if (!reachAcs.reachable) {
            return { error: reachAcs.error ?? `Cannot reach ${loginUrlAcs}`, hint: 'Check network connectivity — XIQ requires internet access' };
          }

          const { fetch: acsF } = await import('undici');

          const getAcsToken = async (): Promise<string | null> => {
            let token = getCachedToken(credentialId!);
            if (!token) {
              const creds = await vault.resolve(credentialId!, agentPermissions);
              const username = String(creds['username'] ?? creds['xiq_username'] ?? '');
              const password = String(creds['password'] ?? creds['xiq_password'] ?? '');
              const resp = await acsF(loginUrlAcs, {
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

          const acsGet = async (token: string, path: string, params: Record<string, string | number> = {}): Promise<unknown> => {
            const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
            const url = `${apiBaseAcs}${path}${qs ? '?' + qs : ''}`;
            const resp = await acsF(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
            console.info(`[xiq_ap_client_sankey] GET ${url} → ${resp.status}`);
            if (!resp.ok) {
              console.warn(`[xiq_ap_client_sankey] ${path} failed: ${resp.status}`);
              return null;
            }
            return resp.json();
          };

          type AcsClient = Record<string, unknown>;

          // Map os_type + hostname + MAC → normalised maker name
          const detectMaker = (c: AcsClient): string => {
            const os = String(c['os_type'] ?? '').toLowerCase();
            const hostname = String(c['hostname'] ?? c['name'] ?? '').toLowerCase();
            const mac = String(c['mac_address'] ?? '').toUpperCase().replace(/[:\-]/g, '');
            const oui = mac.substring(0, 6);

            if (os.includes('apple') || os.includes('ios') || os.includes('macos') || os.includes('mac os') ||
                os.includes('ipad') || os.includes('watchos') || os.includes('tvos') ||
                /iphone|ipad|macbook|imac|mac mini|mac pro|airpod|ipod|apple/i.test(hostname) ||
                ['F81EDF','F0DB30','F0B429','ECA6B4','E8FAC6','DCA904','D83062','D0A637','B82AAA',
                 'B0BE76','A4C361','9CF48E','8CAAB5','706E6D','6C96CF','5C96A4','504BAA','48D705',
                 '440010','3C5282','2095F0','143C4A','0CFE45','001CBE','001B63'].includes(oui)) return 'Apple';

            if (os.includes('android') || os.includes('google') || os.includes('chrome os')) return 'Android';
            if (os.includes('windows') || os.includes('microsoft')) return 'Windows';
            if (os.includes('linux') || os.includes('ubuntu') || os.includes('debian')) return 'Linux';
            if (os.includes('embedded') || os.includes('iot') || os.includes('rtos')) return 'IoT/Embedded';
            return 'Unknown';
          };

          // Map os_type + hostname → normalised device type
          const detectDeviceType = (c: AcsClient): string => {
            const os = String(c['os_type'] ?? '').toLowerCase();
            const hostname = String(c['hostname'] ?? c['name'] ?? '').toLowerCase();

            if (/ipad|tablet/i.test(hostname) || os.includes('ipad') || os.includes('tablet')) return 'Tablet';
            if (/iphone|ipod/i.test(hostname) || os.includes('iphone') || os.includes('ios')) return 'Phone';
            if (/macbook|laptop|notebook/i.test(hostname) || os.includes('macbook')) return 'Laptop';
            if (/imac|mac mini|mac pro|desktop|workstation/i.test(hostname) || os.includes('macos') || os.includes('mac os')) return 'Desktop/Mac';
            if (os.includes('android')) return 'Phone';
            if (os.includes('windows')) return 'Windows Device';
            if (os.includes('linux')) return 'Linux Device';
            if (os.includes('embedded') || os.includes('iot')) return 'IoT Device';
            return 'Unknown Device';
          };

          try {
            const token = await getAcsToken();
            if (!token) return { error: 'XIQ login failed — check credentials in vault' };

            // Fetch device list once to resolve connected_ap_id → AP hostname
            // XIQ max limit is 100; use pagination if needed
            const deviceResp = await acsGet(token, '/devices', { page: 1, limit: 100 });
            const deviceList: AcsClient[] = Array.isArray(deviceResp)
              ? (deviceResp as AcsClient[])
              : ((deviceResp as { data?: AcsClient[] })?.data ?? []);
            const deviceMap = new Map<number, string>();
            for (const d of deviceList) {
              const id = d['id'] as number | undefined;
              const hostname = String(d['hostname'] ?? d['host_name'] ?? d['name'] ?? '');
              if (id && hostname) deviceMap.set(id, hostname);
            }

            // Fetch all active clients (paginated) — don't send unsupported views param
            let allClients: AcsClient[] = [];
            let page = 1;
            while (allClients.length < 2000) {
              const resp = await acsGet(token, '/clients/active', { page, limit: 100 }) as { data?: AcsClient[] } | AcsClient[] | null;
              if (!resp) break;
              const batch: AcsClient[] = Array.isArray(resp) ? resp : ((resp as { data?: AcsClient[] }).data ?? []);
              if (batch.length === 0) break;
              allClients = allClients.concat(batch);
              if (batch.length < 100) break;
              page++;
            }

            // apFilter from args
            const apFilter = String(args['apFilter'] ?? '').toLowerCase();

            // Build 4-level edges: AP → SSID, SSID → Maker, Maker → DeviceType
            // Using compound keys to disambiguate (e.g. same SSID on different APs)
            const apToSsid = new Map<string, Map<string, number>>();
            const ssidMakerKey = new Map<string, Map<string, number>>();   // "SSID|AP" → maker → count
            const makerToDeviceType = new Map<string, Map<string, number>>();

            for (const client of allClients) {
              const ssid = String(client['ssid'] ?? '').trim();
              // Resolve AP name: device_id field maps directly to the AP device record
              const connectedApId = (client['device_id'] ?? client['connected_ap_id']) as number | undefined;
              const apFromMap = connectedApId ? (deviceMap.get(connectedApId) ?? '') : '';
              const ap = (apFromMap || String(client['connected_ap'] ?? client['ap_name'] ?? client['device_name'] ?? '')).trim() || 'Unknown AP';
              if (!ssid) continue;
              if (apFilter && !ap.toLowerCase().includes(apFilter)) continue;

              const maker = detectMaker(client);
              const deviceType = detectDeviceType(client);
              const ssidApKey = `${ssid}|${ap}`;

              // AP → SSID
              if (!apToSsid.has(ap)) apToSsid.set(ap, new Map());
              apToSsid.get(ap)!.set(ssid, (apToSsid.get(ap)!.get(ssid) ?? 0) + 1);

              // SSID (with AP context) → Maker
              if (!ssidMakerKey.has(ssidApKey)) ssidMakerKey.set(ssidApKey, new Map());
              ssidMakerKey.get(ssidApKey)!.set(maker, (ssidMakerKey.get(ssidApKey)!.get(maker) ?? 0) + 1);

              // Maker → DeviceType
              if (!makerToDeviceType.has(maker)) makerToDeviceType.set(maker, new Map());
              makerToDeviceType.get(maker)!.set(deviceType, (makerToDeviceType.get(maker)!.get(deviceType) ?? 0) + 1);
            }

            const sanitize = (s: string) => `"${s.replace(/"/g, "'").replace(/[\n\r]/g, ' ').trim()}"`;
            const sankeyLines: string[] = ['sankey-beta', ''];
            const flows: Array<{ source: string; target: string; value: number }> = [];

            // AP → SSID edges
            for (const [ap, ssidMap] of apToSsid) {
              for (const [ssid, count] of ssidMap) {
                if (count > 0) {
                  sankeyLines.push(`${sanitize(ap)},${sanitize(ssid)},${count}`);
                  flows.push({ source: ap, target: ssid, value: count });
                }
              }
            }

            // SSID → Maker edges (aggregate across APs so Maker node totals are correct)
            const ssidToMaker = new Map<string, Map<string, number>>();
            for (const [ssidApKey, makerMap] of ssidMakerKey) {
              const ssid = ssidApKey.split('|')[0]!;
              if (!ssidToMaker.has(ssid)) ssidToMaker.set(ssid, new Map());
              for (const [maker, count] of makerMap) {
                ssidToMaker.get(ssid)!.set(maker, (ssidToMaker.get(ssid)!.get(maker) ?? 0) + count);
              }
            }
            for (const [ssid, makerMap] of ssidToMaker) {
              for (const [maker, count] of makerMap) {
                if (count > 0) {
                  sankeyLines.push(`${sanitize(ssid)},${sanitize(maker)},${count}`);
                  flows.push({ source: ssid, target: maker, value: count });
                }
              }
            }

            // Maker → DeviceType edges
            for (const [maker, dtMap] of makerToDeviceType) {
              for (const [dt, count] of dtMap) {
                if (count > 0) {
                  sankeyLines.push(`${sanitize(maker)},${sanitize(dt)},${count}`);
                  flows.push({ source: maker, target: dt, value: count });
                }
              }
            }

            // Fallback: no active clients
            if (flows.length === 0) {
              sankeyLines.push('%% No active clients found');
            }

            // Summary
            const makerCounts: Record<string, number> = {};
            for (const [maker, dtMap] of makerToDeviceType) {
              makerCounts[maker] = [...dtMap.values()].reduce((a, b) => a + b, 0);
            }

            return {
              sankey_diagram: sankeyLines.join('\n'),
              flows,
              summary: {
                total_clients: allClients.length,
                total_aps: apToSsid.size,
                total_ssids: ssidToMaker.size,
                maker_breakdown: makerCounts,
                timestamp: new Date().toISOString(),
              },
            };
          } catch (e) {
            return { error: `XIQ AP client sankey failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        // ── xiq_network_health: location-aware network health scorecard ──
        // Auto-discovers locationId from stored facts, then calls /network-scorecard/networkHealth/{id}
        if (handlerType === 'xiq_network_health' || handlerType === 'xiq_device_health' || handlerType === 'xiq_client_health_score') {
          if (!credentialId) return { error: `${handlerType} requires a credentialId` };

          const nhLoginUrl = (config['loginUrl'] as string | undefined) ?? 'https://api.extremecloudiq.com/login';
          const nhApiBase = 'https://api.extremecloudiq.com';

          const reachNh = await checkReachable(nhLoginUrl);
          if (!reachNh.reachable) return { error: reachNh.error ?? `Cannot reach ${nhLoginUrl}` };

          const { fetch: nhFetch } = await import('undici');

          const getNhToken = async (): Promise<string | null> => {
            let token = getCachedToken(credentialId!);
            if (!token) {
              const creds = await vault.resolve(credentialId!, agentPermissions);
              const username = String(creds['username'] ?? creds['xiq_username'] ?? '');
              const password = String(creds['password'] ?? creds['xiq_password'] ?? '');
              const resp = await nhFetch(nhLoginUrl, {
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

          const nhGet = async (token: string, path: string, params: Record<string, string | number> = {}): Promise<unknown> => {
            const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
            const url = `${nhApiBase}${path}${qs ? '?' + qs : ''}`;
            const resp = await nhFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
            console.info(`[${handlerType}] GET ${url} → ${resp.status}`);
            if (!resp.ok) {
              const txt = await resp.text().catch(() => '');
              return { error: `XIQ API ${resp.status}`, detail: txt.slice(0, 300) };
            }
            return resp.json();
          };

          try {
            const token = await getNhToken();
            if (!token) return { error: 'XIQ login failed — check credentials in vault' };

            // Resolve locationId: prefer explicit numeric arg, then resolve name to ID
            // The LLM already has default_xiq_location from agent facts in the system prompt,
            // so it will pass locationName when the user hasn't specified one.
            let locationId = typeof args['locationId'] === 'number' ? (args['locationId'] as number) : null;
            const locationName = String(args['locationName'] ?? args['location'] ?? '').trim();

            if (!locationId && locationName) {
              // Resolve name → ID: try sites, buildings, floors in order
              for (const endpoint of ['/locations/sites', '/locations/buildings', '/locations/floors']) {
                const res = await nhGet(token, endpoint, { name: locationName, limit: 10 }) as { data?: Array<{id: number; name: string}> } | null;
                const items = (res as { data?: Array<{id: number; name: string}> })?.data ?? [];
                const match = items.find((i) => i.name.toLowerCase().includes(locationName.toLowerCase()));
                if (match) { locationId = match.id; break; }
              }
            }

            if (!locationId) {
              // Last resort: use location tree root, pick first folder
              const tree = await nhGet(token, '/locations', {}) as { data?: Array<{id: number; name: string}> } | null;
              const treeItems = (tree as { data?: Array<{id: number; name: string}> })?.data ?? [];
              if (treeItems.length > 0) locationId = treeItems[0]!.id;
            }

            if (!locationId) {
              return { error: 'Could not resolve a locationId. Pass locationName or set your default XIQ location with set_fact("default_xiq_location", "SiteName").' };
            }

            const now = Date.now();
            const timeParams = { startTime: now - 24 * 60 * 60 * 1000, endTime: now };

            if (handlerType === 'xiq_network_health') {
              const health = await nhGet(token, `/network-scorecard/networkHealth/${locationId}`, timeParams);
              return { locationId, health };
            } else if (handlerType === 'xiq_device_health') {
              const health = await nhGet(token, `/network-scorecard/deviceHealth/${locationId}`, timeParams);
              return { locationId, health };
            } else {
              const health = await nhGet(token, `/network-scorecard/clientHealth/${locationId}`, timeParams);
              return { locationId, health };
            }
          } catch (e) {
            return { error: `${handlerType} failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        // ── xiq_wireless_performance_all_locations ─────────────────────────────
        // The global /copilot/connectivity/wireless/performance|quality-index|experience
        // endpoints require a `viewType` Java enum that rejects every string value tried.
        // This composite handler bypasses them entirely: enumerate all buildings, then
        // fan-out to the working /locations/* endpoints (no viewType required).
        if (handlerType === 'xiq_wireless_performance_all_locations') {
          if (!credentialId) return { error: 'xiq_wireless_performance_all_locations requires a credentialId' };

          const wpLogin = (config['loginUrl'] as string | undefined) ?? 'https://api.extremecloudiq.com/login';
          const wpBase  = 'https://api.extremecloudiq.com';

          const reachWp = await checkReachable(wpLogin);
          if (!reachWp.reachable) return { error: reachWp.error ?? `Cannot reach ${wpLogin}` };

          const { fetch: wpFetch } = await import('undici');

          const getWpToken = async (): Promise<string | null> => {
            let token = getCachedToken(credentialId!);
            if (!token) {
              const creds = await vault.resolve(credentialId!, agentPermissions);
              const username = String(creds['username'] ?? creds['xiq_username'] ?? '');
              const password = String(creds['password'] ?? creds['xiq_password'] ?? '');
              const resp = await wpFetch(wpLogin, {
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

          const wpGet = async (token: string, path: string, params: Record<string, string | number> = {}): Promise<unknown> => {
            const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
            const url = `${wpBase}${path}${qs ? '?' + qs : ''}`;
            const resp = await wpFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
            console.info(`[xiq_wireless_performance] GET ${url} → ${resp.status}`);
            if (!resp.ok) {
              const txt = await resp.text().catch(() => '');
              return { error: `XIQ API ${resp.status}`, detail: txt.slice(0, 300) };
            }
            return resp.json();
          };

          try {
            const token = await getWpToken();
            if (!token) return { error: 'XIQ login failed — check credentials in vault' };

            const now = Date.now();
            const startTime = typeof args['startTime'] === 'number' ? (args['startTime'] as number) : now - 24 * 60 * 60 * 1000;
            const endTime   = typeof args['endTime']   === 'number' ? (args['endTime']   as number) : now;
            const ssid      = typeof args['ssid']      === 'string' ? (args['ssid']      as string) : '';
            const osType    = typeof args['osType']    === 'string' ? (args['osType']    as string) : '';

            // Step 1: enumerate all buildings
            const buildingsRes = await wpGet(token, '/locations/buildings', { limit: 100 }) as { data?: Array<{ id: number; name: string }> };
            const buildings = buildingsRes?.data ?? [];

            if (buildings.length === 0) {
              // Fall back to sites if no buildings defined
              const sitesRes = await wpGet(token, '/locations/sites', { limit: 100 }) as { data?: Array<{ id: number; name: string }> };
              const sites = sitesRes?.data ?? [];
              buildings.push(...sites);
            }

            if (buildings.length === 0) {
              return { error: 'No buildings or sites found in XIQ location tree. Ensure locations are configured.' };
            }

            // Step 2: fan-out to working _by_location endpoints per building
            const timeParams: Record<string, string | number> = { startTime, endTime };
            if (ssid)   timeParams['ssid']   = ssid;
            if (osType) timeParams['osType'] = osType;

            const results = await Promise.all(
              buildings.map(async (b) => {
                const bParams = { ...timeParams, buildingId: b.id };
                const [performance, qualityIndex, timeToConnect] = await Promise.all([
                  wpGet(token, '/copilot/connectivity/wireless/locations/performance', bParams),
                  wpGet(token, '/copilot/connectivity/wireless/locations/quality-index', bParams),
                  wpGet(token, '/copilot/connectivity/wireless/locations/time-to-connect', bParams),
                ]);
                return { buildingId: b.id, buildingName: b.name, performance, qualityIndex, timeToConnect };
              }),
            );

            return {
              buildingCount: buildings.length,
              timeRangeMs:   { startTime, endTime },
              results,
            };
          } catch (e) {
            return { error: `xiq_wireless_performance_all_locations failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        // ── xiq_client_radio_quality: find named client → AP device ID → radio-information ──
        // Use for: "show radio quality of the fridge", "what are the radio stats for the iPad"
        if (handlerType === 'xiq_client_radio_quality') {
          if (!credentialId) return { error: 'xiq_client_radio_quality requires a credentialId' };

          const crqLogin = (config['loginUrl'] as string | undefined) ?? 'https://api.extremecloudiq.com/login';
          const crqBase = 'https://api.extremecloudiq.com';
          const reachCrq = await checkReachable(crqLogin);
          if (!reachCrq.reachable) return { error: reachCrq.error ?? `Cannot reach ${crqLogin}` };

          const { fetch: crqFetch } = await import('undici');

          const getCrqToken = async (): Promise<string | null> => {
            let token = getCachedToken(credentialId!);
            if (!token) {
              const creds = await vault.resolve(credentialId!, agentPermissions);
              const username = String(creds['username'] ?? creds['xiq_username'] ?? '');
              const password = String(creds['password'] ?? creds['xiq_password'] ?? '');
              const resp = await crqFetch(crqLogin, {
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

          const crqGet = async (token: string, path: string, params: Record<string, string | number> = {}): Promise<unknown> => {
            const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
            const url = `${crqBase}${path}${qs ? '?' + qs : ''}`;
            const resp = await crqFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
            console.info(`[xiq_client_radio_quality] GET ${url} → ${resp.status}`);
            if (!resp.ok) return null;
            return resp.json();
          };

          try {
            const token = await getCrqToken();
            if (!token) return { error: 'XIQ login failed' };

            const hostname = String(args['hostname'] ?? args['clientName'] ?? args['name'] ?? '').toLowerCase();
            if (!hostname) return { error: 'hostname is required (e.g. "fridge", "ipad")' };

            // Step 1: Find the client
            let page = 1;
            type CrqClient = Record<string, unknown>;
            let foundClient: CrqClient | null = null;
            while (page <= 5 && !foundClient) {
              const resp = await crqGet(token, '/clients/active', { page, limit: 100 }) as { data?: CrqClient[] } | CrqClient[] | null;
              const batch: CrqClient[] = Array.isArray(resp) ? resp : ((resp as { data?: CrqClient[] })?.data ?? []);
              if (batch.length === 0) break;
              foundClient = batch.find((c) =>
                String(c['hostname'] ?? c['name'] ?? '').toLowerCase().includes(hostname)
              ) ?? null;
              if (batch.length < 100) break;
              page++;
            }

            if (!foundClient) return { error: `No active client found matching "${hostname}"` };

            const clientMac = String(foundClient['mac_address'] ?? '');
            const connectedAp = String(foundClient['connected_ap'] ?? foundClient['ap_name'] ?? '').trim();
            const clientSignal = {
              hostname: foundClient['hostname'],
              mac: clientMac,
              ssid: foundClient['ssid'],
              connected_ap: connectedAp,
              snr: foundClient['snr'],
              rssi: foundClient['rssi'],
              channel: foundClient['channel'],
              os_type: foundClient['os_type'],
              health_category: foundClient['health_category'],
            };

            if (!connectedAp) {
              return { client: clientSignal, ap_radio: null, note: 'Client has no connected AP recorded — may be disconnected' };
            }

            // Step 2: Resolve connected AP → device integer ID
            const devResp = await crqGet(token, '/devices', { page: 1, limit: 100 }) as { data?: Array<Record<string, unknown>> } | null;
            const devices: Array<Record<string, unknown>> = (devResp as { data?: Array<Record<string, unknown>> })?.data ?? [];
            const apDevice = devices.find((d) =>
              String(d['hostname'] ?? '').toLowerCase().includes(connectedAp.toLowerCase()) ||
              connectedAp.toLowerCase().includes(String(d['hostname'] ?? '').toLowerCase())
            );

            if (!apDevice) {
              return { client: clientSignal, ap_radio: null, note: `AP "${connectedAp}" not found in device inventory — radio-information unavailable` };
            }

            const apDeviceId = apDevice['id'] as number;

            // Step 3: Get radio-information for the AP (deviceIds[] as query param)
            const radioUrl = `${crqBase}/devices/radio-information?deviceIds=${apDeviceId}`;
            const radioRespDirect = await crqFetch(radioUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
            console.info(`[xiq_client_radio_quality] GET ${radioUrl} → ${radioRespDirect.status}`);
            let apRadio: unknown = null;
            if (radioRespDirect.ok) {
              const radioData = await radioRespDirect.json() as { data?: unknown[] } | unknown[];
              apRadio = Array.isArray(radioData) ? radioData : (radioData as { data?: unknown[] }).data ?? null;
            }

            return {
              client: clientSignal,
              ap_device: { id: apDeviceId, hostname: apDevice['hostname'], ip: apDevice['ip_address'], model: apDevice['product_type'] },
              ap_radio: apRadio,
              note: apRadio ? undefined : 'Radio-information not available for this AP',
            };
          } catch (e) {
            return { error: `xiq_client_radio_quality failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        // ── xiq_client_connection_history: client connection trail + roaming history ──
        // Use for: "show radio history of the ipad", "show connection history of the fridge"
        if (handlerType === 'xiq_client_connection_history') {
          if (!credentialId) return { error: 'xiq_client_connection_history requires a credentialId' };

          const cchLogin = (config['loginUrl'] as string | undefined) ?? 'https://api.extremecloudiq.com/login';
          const cchBase = 'https://api.extremecloudiq.com';
          const reachCch = await checkReachable(cchLogin);
          if (!reachCch.reachable) return { error: reachCch.error ?? `Cannot reach ${cchLogin}` };

          const { fetch: cchFetch } = await import('undici');

          const getCchToken = async (): Promise<string | null> => {
            let token = getCachedToken(credentialId!);
            if (!token) {
              const creds = await vault.resolve(credentialId!, agentPermissions);
              const username = String(creds['username'] ?? creds['xiq_username'] ?? '');
              const password = String(creds['password'] ?? creds['xiq_password'] ?? '');
              const resp = await cchFetch(cchLogin, {
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

          const cchGet = async (token: string, path: string, params: Record<string, string | number> = {}): Promise<unknown> => {
            const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
            const url = `${cchBase}${path}${qs ? '?' + qs : ''}`;
            const resp = await cchFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
            console.info(`[xiq_client_connection_history] GET ${url} → ${resp.status}`);
            if (!resp.ok) return null;
            return resp.json();
          };

          try {
            const token = await getCchToken();
            if (!token) return { error: 'XIQ login failed' };

            const hostname = String(args['hostname'] ?? args['clientName'] ?? args['name'] ?? '').toLowerCase();
            // MAC can be passed directly (from conversation context) or resolved by hostname
            let macAddress = String(args['mac'] ?? args['macAddress'] ?? args['mac_address'] ?? '').trim();
            const hours = Math.max(1, Math.min(168, Number(args['hours'] ?? 4)));

            if (!hostname && !macAddress) return { error: 'hostname or mac is required' };

            // Resolve MAC from hostname if not provided
            if (!macAddress && hostname) {
              let page = 1;
              type CchClient = Record<string, unknown>;
              let foundClient: CchClient | null = null;
              while (page <= 5 && !foundClient) {
                const resp = await cchGet(token, '/clients/active', { page, limit: 100 }) as { data?: CchClient[] } | CchClient[] | null;
                const batch: CchClient[] = Array.isArray(resp) ? resp : ((resp as { data?: CchClient[] })?.data ?? []);
                if (batch.length === 0) break;
                foundClient = batch.find((c) =>
                  String(c['hostname'] ?? c['name'] ?? '').toLowerCase().includes(hostname)
                ) ?? null;
                if (batch.length < 100) break;
                page++;
              }
              if (!foundClient) {
                // Try historical clients too
                const histResp = await cchGet(token, '/clients', { page: 1, limit: 100, searchString: hostname }) as { data?: CchClient[] } | null;
                const histBatch = (histResp as { data?: CchClient[] })?.data ?? [];
                foundClient = histBatch.find((c) =>
                  String(c['hostname'] ?? c['name'] ?? '').toLowerCase().includes(hostname)
                ) ?? null;
              }
              if (!foundClient) return { error: `No client found matching "${hostname}"` };
              macAddress = String(foundClient['mac_address'] ?? '');
            }

            if (!macAddress) return { error: 'Could not resolve a MAC address for this client' };

            const now = Date.now();
            const startTime = now - hours * 60 * 60 * 1000;

            // Fetch connection trail + roaming trail in parallel
            const [connectionTrail, roamingTrail, roamingCount] = await Promise.all([
              cchGet(token, `/client-details/topology/client-trail/${macAddress}`, { startTime, endTime: now }),
              cchGet(token, `/client-details/topology/roaming-trail`, { macAddress, startTime, endTime: now, page: 1, limit: 50 }),
              cchGet(token, `/client-details/topology/roaming-count`, { macAddress, startTime, endTime: now }),
            ]);

            return {
              mac: macAddress,
              hostname,
              hours_requested: hours,
              time_range: { from: new Date(startTime).toISOString(), to: new Date(now).toISOString() },
              connection_trail: connectionTrail,
              roaming_trail: roamingTrail,
              roaming_count: roamingCount,
            };
          } catch (e) {
            return { error: `xiq_client_connection_history failed: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        // ── BEX system admin handlers ─────────────────────────────────────

        if (handlerType === 'bex_list_scheduled_jobs') {
          try {
            const bexUrl = process.env['API_GATEWAY_URL'] ?? 'http://localhost:4000';
            const bexKey = process.env['BEX_BOT_API_KEY'] ?? process.env['BEX_ADMIN_TOKEN'] ?? '';
            const res = await fetch(`${bexUrl}/scheduled-jobs`, {
              headers: { Authorization: `Bearer ${bexKey}` },
            });
            const data = (await res.json()) as { ok: boolean; data?: unknown[] };
            if (!data.ok) return { error: 'Failed to fetch scheduled jobs' };
            const jobs = (data.data ?? []) as Array<Record<string, unknown>>;
            return {
              scheduled_jobs: jobs.map((j) => ({
                id: j['id'],
                name: j['name'],
                enabled: j['enabled'],
                cronExpr: j['cronExpr'],
                lastRunAt: j['lastRunAt'],
                nextRunAt: j['nextRunAt'],
                agentId: j['agentId'],
              })),
              total: jobs.length,
              active: jobs.filter((j) => j['enabled']).length,
              paused: jobs.filter((j) => !j['enabled']).length,
            };
          } catch (e) {
            return { error: `Failed to list scheduled jobs: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        if (handlerType === 'bex_toggle_scheduled_job') {
          const jobIdOrName = String(args['jobId'] ?? args['jobName'] ?? args['name'] ?? '');
          const enable = args['enable'] !== false && String(args['action'] ?? 'pause') !== 'pause';
          try {
            const bexUrl = process.env['API_GATEWAY_URL'] ?? 'http://localhost:4000';
            const bexKey = process.env['BEX_BOT_API_KEY'] ?? process.env['BEX_ADMIN_TOKEN'] ?? '';

            // Resolve by name if not a cuid
            let resolvedId = jobIdOrName;
            if (!jobIdOrName.match(/^c[a-z0-9]{20,}$/) && !jobIdOrName.match(/^[0-9a-f-]{36}$/)) {
              const listRes = await fetch(`${bexUrl}/scheduled-jobs`, { headers: { Authorization: `Bearer ${bexKey}` } });
              const listData = (await listRes.json()) as { ok: boolean; data?: Array<Record<string, unknown>> };
              const match = (listData.data ?? []).find((j) =>
                String(j['name']).toLowerCase().includes(jobIdOrName.toLowerCase())
              );
              if (!match) return { error: `No scheduled job found matching "${jobIdOrName}"` };
              resolvedId = String(match['id']);
            }

            const patchRes = await fetch(`${bexUrl}/scheduled-jobs/${resolvedId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bexKey}` },
              body: JSON.stringify({ enabled: enable }),
            });
            const patchData = (await patchRes.json()) as { ok: boolean; data?: Record<string, unknown> };
            if (!patchData.ok) return { error: `Failed to update job: ${JSON.stringify(patchData)}` };
            return {
              success: true,
              job_id: resolvedId,
              job_name: patchData.data?.['name'],
              enabled: enable,
              message: `Job "${patchData.data?.['name'] ?? resolvedId}" is now ${enable ? 'enabled ▶️' : 'paused ⏸️'}`,
            };
          } catch (e) {
            return { error: `Failed to update scheduled job: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        if (handlerType === 'bex_toggle_all_scheduled_jobs') {
          const enable = args['enable'] !== false && String(args['action'] ?? 'pause') !== 'pause';
          try {
            const bexUrl = process.env['API_GATEWAY_URL'] ?? 'http://localhost:4000';
            const bexKey = process.env['BEX_BOT_API_KEY'] ?? process.env['BEX_ADMIN_TOKEN'] ?? '';
            const listRes = await fetch(`${bexUrl}/scheduled-jobs`, { headers: { Authorization: `Bearer ${bexKey}` } });
            const listData = (await listRes.json()) as { ok: boolean; data?: Array<Record<string, unknown>> };
            const jobs = listData.data ?? [];
            const results = await Promise.all(
              jobs.map((j) =>
                fetch(`${bexUrl}/scheduled-jobs/${j['id']}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bexKey}` },
                  body: JSON.stringify({ enabled: enable }),
                }).then((r) => r.json() as Promise<{ ok: boolean }>)
              )
            );
            const succeeded = results.filter((r) => r.ok).length;
            return {
              success: true,
              total: jobs.length,
              updated: succeeded,
              action: enable ? 'enabled' : 'paused',
              message: `${succeeded} of ${jobs.length} scheduled jobs are now ${enable ? 'enabled ▶️' : 'paused ⏸️'}`,
            };
          } catch (e) {
            return { error: `Failed to update all scheduled jobs: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        if (handlerType === 'bex_list_agents') {
          try {
            const bexUrl = process.env['API_GATEWAY_URL'] ?? 'http://localhost:4000';
            const bexKey = process.env['BEX_BOT_API_KEY'] ?? process.env['BEX_ADMIN_TOKEN'] ?? '';
            const res = await fetch(`${bexUrl}/agents`, { headers: { Authorization: `Bearer ${bexKey}` } });
            const data = (await res.json()) as { ok: boolean; data?: unknown[] };
            const agents = (data.data ?? []) as Array<Record<string, unknown>>;
            return {
              agents: agents.map((a) => ({
                id: a['id'],
                name: a['name'],
                status: a['status'],
                description: a['description'],
              })),
              total: agents.length,
            };
          } catch (e) {
            return { error: `Failed to list agents: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        if (handlerType === 'bex_get_recent_requests') {
          const limit = Number(args['limit'] ?? 10);
          try {
            const bexUrl = process.env['API_GATEWAY_URL'] ?? 'http://localhost:4000';
            const bexKey = process.env['BEX_BOT_API_KEY'] ?? process.env['BEX_ADMIN_TOKEN'] ?? '';
            const res = await fetch(`${bexUrl}/requests?limit=${limit}`, { headers: { Authorization: `Bearer ${bexKey}` } });
            const data = (await res.json()) as { ok: boolean; data?: unknown[] };
            const requests = (data.data ?? []) as Array<Record<string, unknown>>;
            return {
              requests: requests.map((r) => ({
                id: r['id'],
                agentId: r['agentId'],
                status: r['status'],
                channel: r['channel'],
                input: String(r['input'] ?? '').slice(0, 120),
                createdAt: r['createdAt'],
              })),
              total: requests.length,
            };
          } catch (e) {
            return { error: `Failed to list recent requests: ${e instanceof Error ? e.message : String(e)}` };
          }
        }

        if (handlerType === 'bex_system_status') {
          try {
            const bexUrl = process.env['API_GATEWAY_URL'] ?? 'http://localhost:4000';
            const bexKey = process.env['BEX_BOT_API_KEY'] ?? process.env['BEX_ADMIN_TOKEN'] ?? '';
            const [agentsRes, jobsRes, healthRes] = await Promise.all([
              fetch(`${bexUrl}/agents`, { headers: { Authorization: `Bearer ${bexKey}` } }).then((r) => r.json() as Promise<{ ok: boolean; data?: unknown[] }>),
              fetch(`${bexUrl}/scheduled-jobs`, { headers: { Authorization: `Bearer ${bexKey}` } }).then((r) => r.json() as Promise<{ ok: boolean; data?: unknown[] }>),
              fetch(`${bexUrl}/health`).then((r) => r.json() as Promise<{ ok: boolean; version?: string }>),
            ]);
            const agents = (agentsRes.data ?? []) as Array<Record<string, unknown>>;
            const jobs = (jobsRes.data ?? []) as Array<Record<string, unknown>>;
            return {
              status: 'online',
              version: healthRes.version ?? 'unknown',
              agents: { total: agents.length, active: agents.filter((a) => a['status'] === 'ACTIVE').length },
              scheduled_jobs: { total: jobs.length, enabled: jobs.filter((j) => j['enabled']).length },
            };
          } catch (e) {
            return { error: `System status check failed: ${e instanceof Error ? e.message : String(e)}` };
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
      const argsStr = tc.args ? ` args=${JSON.stringify(tc.args).slice(0, 200)}` : (tc as Record<string,unknown>)['input'] ? ` input=${JSON.stringify((tc as Record<string,unknown>)['input']).slice(0, 200)}` : '';
      console.info(`[llm-runner] Tool call: ${tc.toolName}${argsStr}`);
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
