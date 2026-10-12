import type { PrismaClient } from '@prisma/client';

/**
 * Well-known short aliases → name patterns (regex, case-insensitive) matched against
 * agent names. First matching agent wins.
 */
const STATIC_ALIAS_PATTERNS: Record<string, RegExp[]> = {
  xiq:     [/\bxiq\b/i, /extremecloud\s*iq/i],
  iq:      [/\bxiq\b/i, /extremecloud\s*iq/i],
  xco:     [/\bxco\b/i, /extremecloud\s*(operator|orchestrat)/i, /extreme.*operator/i],
  rd:      [/r\.?\s*daneel/i, /\bdaneel\b/i],
  daneel:  [/\bdaneel\b/i],
  weather: [/\bweather\b/i, /\bdaneel\b/i],
  nexus:   [/\bnexus\b/i],
};

type AgentRow = { id: string; name: string };

/**
 * Derives a string of initials from an agent name.
 * "R. Daneel (Weather)" → "rdw"
 */
function initials(name: string): string {
  return name
    .replace(/[()[\]]/g, ' ')
    .split(/[\s.,-]+/)
    .filter((w) => w.length > 0 && /[a-zA-Z]/.test(w[0]!))
    .map((w) => w[0]!.toLowerCase())
    .join('');
}

/**
 * Resolves a short alias (e.g. "xiq", "xco", "rd") to an agent ID.
 *
 * Resolution order:
 *  1. Static alias table (hardcoded well-known patterns)
 *  2. Exact name match (case-insensitive)
 *  3. Name starts with alias
 *  4. Initials match: "rd" → "R. Daneel (Weather)"
 *  5. Alias appears anywhere in the name
 *
 * Returns null if no active agent matches.
 */
export async function resolveAgentAlias(hint: string, prisma: PrismaClient): Promise<string | null> {
  const agents: AgentRow[] = await prisma.agent.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
  });

  if (agents.length === 0) return null;

  const q = hint.toLowerCase().replace(/-/g, ' ').trim();

  // 1. Static alias table
  const patterns = STATIC_ALIAS_PATTERNS[q];
  if (patterns) {
    for (const re of patterns) {
      const found = agents.find((a) => re.test(a.name));
      if (found) return found.id;
    }
  }

  // 2. Exact name match
  let found = agents.find((a) => a.name.toLowerCase() === q);
  if (found) return found.id;

  // 3. Name starts with alias
  found = agents.find((a) => a.name.toLowerCase().startsWith(q));
  if (found) return found.id;

  // 4. Initials match (e.g. "rd" → "R. Daneel (Weather)" → "rdw".startsWith("rd"))
  found = agents.find((a) => {
    const ini = initials(a.name);
    return ini.startsWith(q) || ini === q;
  });
  if (found) return found.id;

  // 5. Alias substring match
  found = agents.find((a) => a.name.toLowerCase().includes(q));
  if (found) return found.id;

  return null;
}
