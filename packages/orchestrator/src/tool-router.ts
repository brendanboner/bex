/**
 * tool-router.ts — Lazy-loading, progressive-disclosure tool selector
 *
 * Replaces the naive keyword-scoring `selectRelevantTools()` with a system that:
 *
 *  1. DOMAIN CLASSIFICATION  — identifies which skill domain(s) the query relates to
 *     using explicit term maps + conversation-history context.  This prevents the XCO
 *     fabric tools from appearing in an XIQ wireless query, and vice-versa.
 *
 *  2. AVAILABILITY GATING    — skips entire skill domains whose base URL is unreachable
 *     (uses the reachabilityCache already populated by llm-runner).  No point presenting
 *     XCO tools if the XCO VPN is down.
 *
 *  3. TIERED LOADING         — within a domain, tools are grouped into 3 tiers:
 *       Tier 1 – discovery (read / list / get)          ≤ 20 tools, always loaded
 *       Tier 2 – operational (create / update / config) ≤ 25 tools, loaded when needed
 *       Tier 3 – destructive (delete / reset / exec)    ≤ 10 tools, loaded on demand
 *
 *  4. PROGRESSIVE DISCLOSURE — tool budget starts at 30 (Tier 1 from matched domain +
 *     5 utility tools), grows to ≤ 55 when the query contains action intent.
 *
 *  5. CONVERSATION CONTEXT   — incorporates recent message history to maintain a
 *     "working domain" across multi-turn conversations.  Once we establish we're talking
 *     about XIQ, we don't reset to all-domains on the next turn.
 */

import type { SkillTool } from '@bclaw/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExtendedTool = SkillTool & {
  handlerType?: string;
  config?: {
    isWrite?: boolean;
    urlTemplate?: string;
    loginUrl?: string;
    [key: string]: unknown;
  };
};

export interface ToolRouterContext {
  /** The current user query */
  query: string;
  /** Recent conversation messages (role + content) */
  history?: Array<{ role: string; content: string }>;
  /** Max tools to return (hard cap, default 55) */
  maxTools?: number;
}

export interface RoutingResult {
  tools: SkillTool[];
  domains: string[];
  tier: number;
  reasoning: string;
}

// ─── Domain Definitions ───────────────────────────────────────────────────────
//
// Each definition maps a logical "domain" to:
//   - the skill domain name patterns it covers
//   - strong / weak indicator terms
//   - terms that EXCLUDE this domain if present alongside ambiguous terms
//   - per-domain tier classifiers (which action verbs → tier 2 / tier 3)

interface DomainDef {
  /** Short id, used in reasoning output */
  id: string;
  /** Friendly name */
  label: string;
  /** Matches against skill.domain using these prefixes/substrings */
  skillPatterns: string[];
  /** If any of these terms appear in the query → strong candidate */
  primaryTerms: string[];
  /** Additional supporting terms */
  secondaryTerms: string[];
  /** If these terms appear WITH ambiguous primary terms, this domain should be excluded */
  excludeTerms: string[];
  /** Base URL(s) to check for reachability — skip domain if all are unreachable */
  reachabilityUrls?: string[];
}

const DOMAIN_DEFS: DomainDef[] = [
  {
    id: 'xciq',
    label: 'ExtremeCloud IQ (XIQ)',
    skillPatterns: ['extremecloudiq'],
    primaryTerms: [
      'xiq', 'xciq', 'extreme cloud iq', 'extremecloudiq',
      'access point', 'ap3000', 'ap4000', 'wireless', 'ssid', 'wlan',
      'client', 'station', 'radio', 'copilot', 'viq',
    ],
    secondaryTerms: [
      'location', 'floor plan', 'network policy', 'portal', 'pcg',
      'cloud management', 'cloud controller', 'extreme networks cloud',
    ],
    // If someone says "fabric" AND "xco" → XCO, not XIQ
    excludeTerms: ['xco', 'clos', 'vxlan', 'fabric switch', 'data center fabric'],
    reachabilityUrls: ['https://api.extremecloudiq.com'],
  },
  {
    id: 'xco',
    label: 'Extreme Cloud Orchestrator (XCO)',
    skillPatterns: ['networking.extreme-xco', 'monitoring.extreme-xco'],
    primaryTerms: [
      'xco', 'fabric', 'clos', 'vxlan', 'spine', 'leaf', 'rack',
      'data center', 'dcf', 'underlay', 'overlay', 'bgp', 'evpn',
      'alarm', 'certificate expiry', 'xco platform',
    ],
    secondaryTerms: [
      'fabric health', 'fabric drift', 'fabric topology',
      'k8s pod', 'orchestrator', 'xco audit',
    ],
    excludeTerms: ['wireless', 'ssid', 'access point', 'client station', 'extremecloudiq'],
    // XCO is typically on a private network — reachability check uses the configured host
    // Leave out so it's not blocked by reachability (host varies per deployment)
  },
  {
    id: 'weather',
    label: 'Weather / Forecast',
    skillPatterns: ['weather'],
    primaryTerms: [
      'weather', 'forecast', 'temperature', 'rain', 'wind', 'humidity',
      'precipitation', 'celsius', 'fahrenheit', 'sunny', 'cloudy', 'storm',
    ],
    secondaryTerms: ['climate', 'outdoor', 'today outside'],
    excludeTerms: [],
    reachabilityUrls: ['https://api.open-meteo.com'],
  },
  {
    id: 'utility',
    label: 'Utility (SSH / HTTP)',
    skillPatterns: [],          // catches tools with no domain pattern
    primaryTerms: ['ssh', 'exec', 'command', 'shell', 'ping', 'http', 'curl', 'api call'],
    secondaryTerms: ['run', 'execute', 'request'],
    excludeTerms: [],
  },
];

// ─── Tier Classifiers ────────────────────────────────────────────────────────
//
// A tool is assigned a tier based on its name / isWrite flag:
//
//   Tier 1 (discovery)   — GET, LIST, SEARCH, CHECK, SHOW, GET_*, list_*, get_*, check_*
//   Tier 2 (operational) — CREATE, UPDATE, SET, PUSH, ADD, CONFIGURE, enable_*, create_*
//   Tier 3 (destructive) — DELETE, RESET, REBOOT, WIPE, REMOVE, DISCONNECT, override_*

function toolTier(tool: ExtendedTool): 1 | 2 | 3 {
  const name = (tool.name ?? '').toLowerCase();
  const isWrite = tool.config?.isWrite ?? false;

  // Explicit destructive patterns → Tier 3
  if (/^(delete|remove|wipe|reset|reboot|purge|override|disconnect|revoke)/.test(name)) return 3;
  if (/_(delete|remove|wipe|reset|reboot|purge|override|disconnect|revoke)(_|$)/.test(name)) return 3;

  // If not a write op → Tier 1 (discovery / read)
  if (!isWrite) return 1;

  // Write ops that are mild (create, update, configure) → Tier 2
  return 2;
}

// ─── Intent detection ─────────────────────────────────────────────────────────

function detectIntentTier(text: string): 1 | 2 | 3 {
  const t = text.toLowerCase();
  if (/\b(delete|remove|wipe|reset|reboot|purge|disconnect|override|revoke)\b/.test(t)) return 3;
  if (/\b(create|update|set|push|add|configure|enable|disable|assign|change|modify|deploy)\b/.test(t)) return 2;
  return 1;
}

// ─── Domain Scorer ────────────────────────────────────────────────────────────

interface DomainScore {
  def: DomainDef;
  score: number;
  excluded: boolean;
}

function scoreDomain(def: DomainDef, text: string): DomainScore {
  const t = text.toLowerCase();

  // Check exclusion — if strong exclusion terms are present with ambiguous primary terms
  const hasExclusion = def.excludeTerms.some((x) => t.includes(x));
  // But only exclude if we also don't have direct domain identifiers
  const hasDirectId = def.primaryTerms.slice(0, 4).some((p) => t.includes(p));
  const excluded = hasExclusion && !hasDirectId;

  let score = 0;
  for (const term of def.primaryTerms) {
    if (t.includes(term)) score += 3;
  }
  for (const term of def.secondaryTerms) {
    if (t.includes(term)) score += 1;
  }

  return { def, score: excluded ? -1 : score, excluded };
}

// ─── Conversation Context Extractor ──────────────────────────────────────────

function buildContextText(
  query: string,
  history: Array<{ role: string; content: string }> = [],
): string {
  // Use last 6 messages (3 turns) for context — older messages decay in relevance
  const recent = history.slice(-6).map((m) => m.content).join(' ');
  return `${recent} ${query}`;
}

// ─── Main Router ──────────────────────────────────────────────────────────────

/**
 * Select tools using domain classification + tiered progressive loading.
 *
 * Algorithm:
 *  1. Build context text from query + recent history
 *  2. Score each domain definition against context
 *  3. Pick top 1-2 matching domains (or all if no clear winner)
 *  4. Detect intent tier from query (read vs write vs destructive)
 *  5. Filter tools: only those in matched domains + intent tier(s)
 *  6. Apply per-tier budgets to stay within OpenAI's 128 limit
 *  7. Always append utility tools (ssh_exec etc.) if they're in the tool set
 */
export function routeTools(
  allTools: SkillTool[],
  skillDomains: Map<string, string>, // tool.name → skill.domain
  ctx: ToolRouterContext,
): RoutingResult {
  const { query, history = [], maxTools = 55 } = ctx;
  const contextText = buildContextText(query, history);

  // 1. Score all domain definitions
  const scores: DomainScore[] = DOMAIN_DEFS.map((def) => scoreDomain(def, contextText));
  scores.sort((a, b) => b.score - a.score);

  // 2. Identify winning domains
  const topScore = scores[0]?.score ?? 0;
  let matchedDomainIds: string[];

  if (topScore <= 0) {
    // No domain signal — include all domains but apply tight tier filtering
    matchedDomainIds = DOMAIN_DEFS.map((d) => d.id);
  } else if (topScore <= 2) {
    // Weak signal — include top 2 domains
    matchedDomainIds = scores.slice(0, 2).filter((s) => s.score > 0).map((s) => s.def.id);
  } else {
    // Strong signal — focus on top domain only (or top 2 if very close scores)
    const closeThreshold = Math.max(topScore - 2, 1);
    matchedDomainIds = scores
      .filter((s) => s.score >= closeThreshold && !s.excluded)
      .slice(0, 2)
      .map((s) => s.def.id);
  }

  // 3. Map domain IDs back to skill domain patterns
  const matchedPatterns = new Set<string>();
  for (const id of matchedDomainIds) {
    const def = DOMAIN_DEFS.find((d) => d.id === id);
    if (def) def.skillPatterns.forEach((p) => matchedPatterns.add(p));
  }

  // 4. Filter tools by matched domain
  const extended = allTools as ExtendedTool[];
  const domainTools = matchedPatterns.size > 0
    ? extended.filter((t) => {
        const domain = skillDomains.get(t.name) ?? '';
        return [...matchedPatterns].some((p) => domain.startsWith(p));
      })
    : extended;   // no pattern → include all

  // If domain matched but returned few tools (e.g. weather=2, xco=3), keep them
  // but supplement with utility tools up to the budget. Only fall back to ALL tools
  // if domain had NO match at all (topScore <= 0).
  let toolsToTier: ExtendedTool[];
  if (domainTools.length > 0 || matchedPatterns.size === 0) {
    // Domain had a clear match — use only those tools (even if just 1-2)
    toolsToTier = domainTools;
  } else {
    // No tools found for matched domain — relax to all (skill may not be linked)
    toolsToTier = extended;
  }

  // 5. Detect intent tier
  const intentTier = detectIntentTier(query);

  // 6. Apply tiered budgets
  //    Tier 1 always included; Tier 2 included if intent ≥ 2; Tier 3 only if intent = 3
  const TIER_BUDGETS = { 1: 25, 2: 20, 3: 10 } as const;

  const byTier: Record<1 | 2 | 3, ExtendedTool[]> = { 1: [], 2: [], 3: [] };
  for (const tool of toolsToTier) {
    const tier = toolTier(tool);
    byTier[tier].push(tool);
  }

  // Within each tier, rank by relevance to the query (keyword scoring)
  const queryTokens = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  const rankByQuery = (tools: ExtendedTool[]): ExtendedTool[] => {
    return [...tools].sort((a, b) => {
      const aScore = queryTokens.reduce(
        (s, tok) => ((`${a.name} ${a.description ?? ''}`).toLowerCase().includes(tok) ? s + 1 : s), 0,
      );
      const bScore = queryTokens.reduce(
        (s, tok) => ((`${b.name} ${b.description ?? ''}`).toLowerCase().includes(tok) ? s + 1 : s), 0,
      );
      return bScore - aScore;
    });
  };

  const selected: SkillTool[] = [];

  // Always include Tier 1 tools (discovery/read)
  const t1 = rankByQuery(byTier[1]).slice(0, TIER_BUDGETS[1]);
  selected.push(...t1);

  // Include Tier 2 if intent is write/action
  if (intentTier >= 2) {
    const remaining2 = Math.max(0, maxTools - selected.length - (intentTier >= 3 ? TIER_BUDGETS[3] : 0));
    const t2 = rankByQuery(byTier[2]).slice(0, Math.min(TIER_BUDGETS[2], remaining2));
    selected.push(...t2);
  }

  // Include Tier 3 only for destructive intent
  if (intentTier >= 3) {
    const remaining3 = Math.max(0, maxTools - selected.length);
    const t3 = rankByQuery(byTier[3]).slice(0, Math.min(TIER_BUDGETS[3], remaining3));
    selected.push(...t3);
  }

  // 7. Utility tools: include ssh_exec, http_call, and any non-domain tools not already included
  const utilityTools = extended.filter((t) => {
    const domain = skillDomains.get(t.name) ?? '';
    return domain === '' || domain === 'utility';
  });
  for (const ut of utilityTools) {
    if (selected.length >= maxTools) break;
    if (!selected.some((s) => s.name === ut.name)) selected.push(ut);
  }

  // Build reasoning string
  const matchedLabels = matchedDomainIds
    .map((id) => DOMAIN_DEFS.find((d) => d.id === id)?.label ?? id)
    .join(', ');
  const reasoning = [
    `Domain: ${matchedLabels || 'all'} (score=${topScore})`,
    `Intent tier: ${intentTier} (${intentTier === 1 ? 'read/discover' : intentTier === 2 ? 'write/configure' : 'destructive'})`,
    `Tools: ${byTier[1].length}T1 + ${byTier[2].length}T2 + ${byTier[3].length}T3 → selected ${selected.length}`,
  ].join(' | ');

  return {
    tools: selected,
    domains: matchedDomainIds,
    tier: intentTier,
    reasoning,
  };
}

// ─── Availability Gating ─────────────────────────────────────────────────────
//
// Before presenting tools from a skill domain, verify the domain's endpoint
// is reachable.  Uses the existing reachabilityCache in llm-runner (shared module
// level), accessed here via a supplied lookup function.

export function filterUnavailableSkills(
  tools: SkillTool[],
  skillDomains: Map<string, string>,
  isReachable: (baseUrl: string) => boolean | undefined,
): { tools: SkillTool[]; skippedDomains: string[] } {
  // Collect base URLs per skill domain
  const domainBaseUrl = new Map<string, string>();
  for (const tool of tools as ExtendedTool[]) {
    const domain = skillDomains.get(tool.name) ?? '';
    if (!domain || domainBaseUrl.has(domain)) continue;
    const loginUrl = tool.config?.loginUrl as string | undefined;
    const urlTemplate = tool.config?.urlTemplate as string | undefined;
    const url = loginUrl ?? urlTemplate ?? '';
    if (url) {
      try {
        domainBaseUrl.set(domain, new URL(url).origin);
      } catch {
        // invalid URL — skip reachability check for this domain
      }
    }
  }

  const skippedDomains: string[] = [];
  const available = tools.filter((tool) => {
    const domain = skillDomains.get(tool.name) ?? '';
    const baseUrl = domainBaseUrl.get(domain);
    if (!baseUrl) return true; // no URL configured — allow through

    const reachable = isReachable(baseUrl);
    if (reachable === false) {
      if (!skippedDomains.includes(domain)) skippedDomains.push(domain);
      return false;
    }
    return true;
  });

  return { tools: available, skippedDomains };
}

// ─── Helper: build skillDomains map ──────────────────────────────────────────
//
// Given an array of { skill: { domain }, tools: [...] } entries,
// builds a Map<toolName, skillDomain>.

export function buildSkillDomainMap(
  linkedSkills: Array<{ domain: string; tools: unknown }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const skill of linkedSkills) {
    const tools = Array.isArray(skill.tools) ? skill.tools as Array<{ name?: string }> : [];
    for (const tool of tools) {
      if (tool.name) map.set(tool.name, skill.domain);
    }
  }
  return map;
}
