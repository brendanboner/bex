import { generateObject } from 'ai';
import { z } from 'zod';
import { buildModel } from './model.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  domain: string;
  goal: string;
  requiredCapabilities: string[];
  dependsOn: string[];
  constraintNotes?: string;
}

export interface DomainConstraintSummary {
  sourceDomain: string;
  targetDomain: string;
  compatible: 'FULL' | 'PARTIAL' | 'NONE';
  notes?: string;
}

export interface WorkflowPlan {
  goal: string;
  steps: WorkflowStep[];
  domainConstraints: DomainConstraintSummary[];
  estimatedParallelism: number;
}

// ─── Zod schemas (used with generateObject) ───────────────────────────────────

const WorkflowStepSchema = z.object({
  id: z.string().describe('Unique step identifier (e.g. step-1)'),
  domain: z.string().describe('Domain this step targets (e.g. networking.extreme-xiq)'),
  goal: z.string().describe('What this step needs to accomplish'),
  requiredCapabilities: z.array(z.string()).describe('Capability strings needed for this step'),
  dependsOn: z.array(z.string()).describe('IDs of steps that must complete before this one'),
  constraintNotes: z.string().optional().describe('Notes about domain constraints affecting this step'),
});

const DomainConstraintSummarySchema = z.object({
  sourceDomain: z.string(),
  targetDomain: z.string(),
  compatible: z.enum(['FULL', 'PARTIAL', 'NONE']),
  notes: z.string().optional(),
});

const WorkflowPlanSchema = z.object({
  goal: z.string(),
  steps: z.array(WorkflowStepSchema),
  domainConstraints: z.array(DomainConstraintSummarySchema),
  estimatedParallelism: z.number().int().min(1).describe('How many steps can run concurrently at peak'),
});

// ─── System prompt ────────────────────────────────────────────────────────────

const PLANNER_SYSTEM_PROMPT = `You are a workflow planner for an enterprise agentic framework.
Given a multi-domain goal, decompose it into an ordered set of sub-tasks.

Rules:
- Each step targets a single domain.
- Use dependsOn to express data-flow dependencies between steps.
- Steps with no dependsOn can run in parallel.
- Identify domain compatibility constraints (e.g. PARTIAL compatibility between XIQ and XCO).
- estimatedParallelism is the maximum number of steps that can run concurrently.
- Keep step IDs short (step-1, step-2, ...).`;

// ─── WorkflowPlanner ──────────────────────────────────────────────────────────

export class WorkflowPlanner {
  constructor(
    private readonly llmProvider: string = process.env['LLM_PROVIDER'] ?? 'openai',
    private readonly llmModel: string = process.env['LLM_MODEL'] ?? 'gpt-4o',
  ) {}

  async plan(goal: string, availableCapabilities: string[]): Promise<WorkflowPlan> {
    const model = buildModel(this.llmProvider, this.llmModel);

    const capabilitiesText =
      availableCapabilities.length > 0
        ? `Available capabilities: ${availableCapabilities.join(', ')}`
        : 'No pre-discovered capabilities — infer what is needed from the goal.';

    const { object } = await generateObject({
      model,
      schema: WorkflowPlanSchema,
      system: PLANNER_SYSTEM_PROMPT,
      prompt: `Goal: ${goal}\n\n${capabilitiesText}`,
    });

    return object as WorkflowPlan;
  }
}
