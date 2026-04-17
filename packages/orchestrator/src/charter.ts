import type { ResolvedCharter } from '@bclaw/shared';
import { DEFAULT_CHARTER } from '@bclaw/shared';

// Merge DB charter with defaults
export function resolveCharter(charter: {
  mandate: string; posture: string; bearing: string; verbosity: string;
  conductBoundaries: string[]; escalationTriggers: string[]; scopeLimits: unknown;
} | null): ResolvedCharter {
  if (!charter) return DEFAULT_CHARTER;
  return {
    mandate: charter.mandate,
    posture: charter.posture as ResolvedCharter['posture'],
    bearing: charter.bearing as ResolvedCharter['bearing'],
    verbosity: charter.verbosity as ResolvedCharter['verbosity'],
    conductBoundaries: charter.conductBoundaries,
    escalationTriggers: charter.escalationTriggers,
    scopeLimits: (charter.scopeLimits as Record<string, unknown>) ?? {},
  };
}

// Build the system prompt preamble from a charter
export function buildCharterPrompt(charter: ResolvedCharter): string {
  const bearingDescriptions: Record<ResolvedCharter['bearing'], string> = {
    ANALYTICAL: 'Present findings in a structured, data-forward format with minimal commentary.',
    CONCISE: 'Be brief and action-oriented. Omit preamble and filler.',
    NARRATIVE: 'Explain reasoning with context. Use prose with clear logical flow.',
    FORMAL: 'Use professional, structured language. Avoid colloquialisms.',
  };

  const postureDescriptions: Record<ResolvedCharter['posture'], string> = {
    AUTONOMOUS: 'Act independently. Execute tasks without requesting confirmation. Notify the user on completion.',
    SUPERVISED: 'Plan and read independently. For any write, delete, or destructive operation, request explicit approval before proceeding.',
    INTERACTIVE: 'Before each significant action, present your intent and options to the user. Wait for explicit confirmation.',
    DELIBERATE: 'Present your analysis and proposed plan. Do NOT execute any action. Wait for explicit instruction before proceeding with each step.',
  };

  const verbosityDescriptions: Record<ResolvedCharter['verbosity'], string> = {
    TERSE: 'Respond with the minimum necessary information.',
    STANDARD: 'Include relevant context and next steps.',
    DETAILED: 'Provide comprehensive analysis including reasoning, alternatives considered, and confidence levels.',
  };

  const lines = [
    `## Operating Mandate\n${charter.mandate}`,
    `## Behavioral Posture\n${postureDescriptions[charter.posture]}`,
    `## Communication Bearing\n${bearingDescriptions[charter.bearing]}`,
    `## Verbosity\n${verbosityDescriptions[charter.verbosity]}`,
  ];

  if (charter.conductBoundaries.length > 0) {
    lines.push(`## Conduct Boundaries\nThe following actions ALWAYS require explicit human approval regardless of posture:\n${charter.conductBoundaries.map((b) => `- ${b}`).join('\n')}`);
  }

  if (charter.escalationTriggers.length > 0) {
    lines.push(`## Escalation Triggers\nImmediately escalate to human oversight if any of these conditions are detected:\n${charter.escalationTriggers.map((t) => `- ${t}`).join('\n')}`);
  }

  return lines.join('\n\n');
}

// Returns true if a tool call would violate conductBoundaries
export function isRestrictedAction(toolName: string, charter: ResolvedCharter): boolean {
  return charter.conductBoundaries.some((boundary) => {
    if (boundary.endsWith('.*')) {
      const prefix = boundary.slice(0, -2);
      return toolName.startsWith(prefix);
    }
    return toolName === boundary;
  });
}

// Returns true if an escalation trigger matches the current context
export function shouldEscalate(context: string, charter: ResolvedCharter): boolean {
  return charter.escalationTriggers.some((trigger) =>
    context.toLowerCase().includes(trigger.toLowerCase()),
  );
}
