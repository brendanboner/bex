/**
 * skill-learning.ts — Persistent skill knowledge accumulation
 *
 * Provides a `skill_add_note` tool that the LLM can call when it discovers
 * API quirks, correct parameter values, pagination patterns, etc. during a
 * real interaction.  The note is persisted to `Skill.learnedNotes` in the DB
 * and is injected into every future prompt for that skill domain, so the
 * agent never has to re-learn the same thing.
 *
 * Notes are appended with a timestamp and never deleted (only added to),
 * forming a growing knowledge base per skill.
 */

import type { PrismaClient } from '@prisma/client';
import type { CoreTool } from 'ai';
import { z } from 'zod';

/** Max characters for learnedNotes before we summarise (safety valve) */
const MAX_NOTES_LENGTH = 8_000;

/**
 * Append a new note to the skill's learnedNotes field.
 * Creates a timestamped bullet entry.
 * If learnedNotes exceeds MAX_NOTES_LENGTH, trims oldest entries.
 */
export async function appendSkillNote(
  prisma: PrismaClient,
  domain: string,
  note: string,
): Promise<{ updated: boolean; domain: string }> {
  const skills = await prisma.skill.findMany({ where: { domain } });
  if (skills.length === 0) return { updated: false, domain };

  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const entry = `[${timestamp}] ${note.trim()}`;

  for (const skill of skills) {
    const current = (skill.learnedNotes ?? '').trim();
    let updated = current ? `${current}\n- ${entry}` : `- ${entry}`;

    // Trim oldest entries if too long
    if (updated.length > MAX_NOTES_LENGTH) {
      const lines = updated.split('\n').filter(Boolean);
      while (updated.length > MAX_NOTES_LENGTH && lines.length > 1) {
        lines.shift(); // remove oldest
        updated = lines.join('\n');
      }
    }

    await prisma.skill.update({
      where: { id: skill.id },
      data: { learnedNotes: updated },
    });
  }

  return { updated: true, domain };
}

/**
 * Build the `skill_add_note` tool definition for inclusion in every agent run.
 * The agent calls this when it:
 *   - Discovers a parameter doesn't work as documented
 *   - Learns the correct way to perform a common task
 *   - Identifies a pagination pattern
 *   - Finds that certain filter values are unreliable
 */
export function buildSkillLearningTool(
  prisma: PrismaClient,
  linkedSkillDomains: string[],
): Record<string, CoreTool> {
  if (linkedSkillDomains.length === 0) return {};

  const domainList = linkedSkillDomains.join(', ');

  return {
    skill_add_note: {
      description: [
        'Persist a contextual note about how a skill or API actually behaves in practice.',
        'Call this whenever you discover:',
        '  - A parameter that does not filter correctly (e.g. os_type returns "unknown" for iPhones)',
        '  - The correct way to perform a common operation (e.g. must list all devices then filter by substring)',
        '  - Pagination patterns or response field names that differ from docs',
        '  - Any API quirk that would help future interactions with this skill',
        `Active skill domains: ${domainList}`,
        'Notes are permanently saved and included in future prompts — you will not need to re-discover this.',
      ].join('\n'),
      parameters: z.object({
        domain: z.string().describe(
          `The skill domain this note applies to. One of: ${domainList}`,
        ),
        note: z.string().describe(
          'The concise, actionable note. Start with the problem, then the solution. ' +
          'Example: "clientOsNames filter unreliable for iPhones (os_type=unknown). ' +
          'Use searchString=iPhone on list_active_clients instead."',
        ),
      }),
      execute: async ({ domain, note }: { domain: string; note: string }) => {
        try {
          const result = await appendSkillNote(prisma, domain, note);
          if (!result.updated) {
            return { success: false, message: `No skill found for domain: ${domain}` };
          }
          console.info(`[skill-learning] Note added to ${domain}: ${note.slice(0, 80)}...`);
          return {
            success: true,
            message: `Note saved to skill "${domain}". It will be included in all future prompts.`,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, message: `Failed to save note: ${msg}` };
        }
      },
    } as CoreTool,
  };
}

/**
 * Build the combined system prompt for an agent run, including:
 *   1. The base systemPrompt from the skill definition (generated from docs)
 *   2. The learnedNotes from real interactions (appended chronologically)
 *
 * This ensures the LLM sees both the original intent AND accumulated experience.
 */
export function buildEnrichedSystemPrompt(
  baseSystemPrompt: string,
  skills: Array<{ domain: string; learnedNotes?: string | null }>,
): string {
  const noteSections = skills
    .filter((s) => s.learnedNotes && s.learnedNotes.trim())
    .map((s) => `## Learned API Notes for ${s.domain}\n${s.learnedNotes!.trim()}`);

  if (noteSections.length === 0) return baseSystemPrompt;

  return [
    baseSystemPrompt,
    '',
    '---',
    '## Accumulated Knowledge from Real Interactions',
    'These notes were learned during previous sessions and override documentation where they conflict.',
    'ALWAYS apply these before making tool calls.',
    '',
    noteSections.join('\n\n'),
  ].join('\n');
}
