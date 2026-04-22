/**
 * LLM-assisted widget layout generator.
 *
 * Given a raw agent response string, this module:
 *  1. Attempts to parse structured JSON out of the response.
 *  2. Uses generateObject to ask the LLM to produce a widget layout config.
 *  3. Falls back to a single generic table widget on any failure.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { buildLlmModel } from '@bclaw/orchestrator';
import type { Widget } from '@bclaw/shared';

// ─── JSON extraction ──────────────────────────────────────────────────────────

function extractJson(text: string): unknown | null {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {}

  // Look for fenced JSON block
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  // Scan for first { ... } or [ ... ] block
  const braceIdx = text.indexOf('{');
  const bracketIdx = text.indexOf('[');
  const start = braceIdx >= 0 && (bracketIdx < 0 || braceIdx < bracketIdx) ? braceIdx : bracketIdx;
  if (start >= 0) {
    try {
      // Find matching close — crude but effective for typical LLM outputs
      const opener = text[start];
      const closer = opener === '{' ? '}' : ']';
      let depth = 0;
      let end = -1;
      for (let i = start; i < text.length; i++) {
        if (text[i] === opener) depth++;
        else if (text[i] === closer) {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      if (end > start) {
        return JSON.parse(text.slice(start, end + 1));
      }
    } catch {}
  }

  return null;
}

// ─── Widget generation ────────────────────────────────────────────────────────

const WidgetLayoutSchema = z.object({
  widgets: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['headline', 'table', 'chart', 'actions']),
      title: z.string().optional(),
      dataKey: z.string().optional(),
      columns: z.array(z.string()).optional(),
      chartType: z.enum(['bar', 'line', 'pie']).optional(),
      xKey: z.string().optional(),
      yKey: z.string().optional(),
      colSpan: z.number().int().min(1).max(4).optional(),
      actions: z
        .array(
          z.object({
            label: z.string(),
            action: z.enum(['refresh', 'prompt']),
            prompt: z.string().optional(),
            style: z.enum(['primary', 'secondary', 'danger']).optional(),
          }),
        )
        .optional(),
    }),
  ),
});

/**
 * Generate a widget layout from agent output using LLM.
 *
 * @param agentOutput - Raw text output from the agent
 * @param dashboardName - Human-readable name used as context
 * @param prompt - The original prompt sent to the agent
 * @returns Array of Widget configs
 */
export async function generateWidgets(
  agentOutput: string,
  dashboardName: string,
  prompt: string,
): Promise<Widget[]> {
  const parsedData = extractJson(agentOutput);

  // If the agent returned prose/markdown (no structured JSON), skip LLM widget gen —
  // we can't invent dataKeys that don't exist. Return a text-display fallback instead.
  const isTextOnly = !parsedData || (
    typeof parsedData === 'object' &&
    parsedData !== null &&
    Object.keys(parsedData as object).length === 1 &&
    '_text' in (parsedData as object)
  );

  if (isTextOnly) {
    console.warn(`[widget-generator] Agent output for "${dashboardName}" is prose — using text fallback widgets`);
    return [
      { id: 'w1', type: 'table', title: dashboardName, dataKey: '_text', columns: ['value'], colSpan: 4 },
      { id: 'w2', type: 'actions', actions: [{ label: 'Refresh', action: 'refresh', style: 'primary' }], colSpan: 1 },
    ] as Widget[];
  }

  const dataDescription = `The agent returned structured JSON data:\n\`\`\`json\n${JSON.stringify(parsedData, null, 2).slice(0, 3000)}\n\`\`\``;

  const provider = (process.env['LLM_PROVIDER'] ?? 'openai') as 'openai' | 'anthropic' | 'azure-openai';
  const model = process.env['LLM_MODEL'] ?? 'gpt-4o-mini';

  try {
    const llmModel = buildLlmModel(provider, model);

    const { object } = await generateObject({
      model: llmModel,
      schema: WidgetLayoutSchema,
      prompt: `You are designing a data dashboard widget layout.

Dashboard name: "${dashboardName}"
Original prompt: "${prompt}"

${dataDescription}

Generate a widget layout that best presents this data. Rules:
- "dataKey" is REQUIRED for every widget type including headlines.
- Use dot-notation for nested scalar fields: e.g. "summary.total_clients"
- For arrays at the top level, use the key name directly: e.g. "topology" for data.topology[]
- IMPORTANT: When the data has an array of objects where each object itself contains a sub-array (e.g. access_points[].clients), do NOT use bracket-indexed paths like "access_points[0].clients". Instead create ONE table widget per unique sub-array using the top-level key (e.g. "access_points") with columns including fields from the nested objects flattened. Alternatively, if the data is already structured with named top-level arrays (e.g. "apple_clients"), use that key directly.
- Use "headline" widgets for single numeric or short-text values. Set "dataKey" to the exact dot-path to the value (e.g. "summary.total_ssids")
- Use "table" widgets for arrays of objects — set "dataKey" to the key of the array, and "columns" to the field names to show
- Use "chart" widgets for numeric comparisons — set chartType (bar/line/pie), xKey, yKey, and dataKey to the key of the array
- Use "actions" widget at the end with a "Refresh" action (action: "refresh", style: "primary")
- colSpan: 1 for headlines, 2-4 for tables/charts
- Keep it clean: 3–8 widgets max
- Each widget id should be a short unique string like "w1", "w2", etc.

Return the widget array only.`,
    });

    return object.widgets as Widget[];
  } catch (err) {
    console.error('[widget-generator] LLM widget generation failed, using fallback:', err);
    return fallbackWidgets(parsedData);
  }
}

/**
 * Produce a sensible fallback widget layout when LLM generation fails.
 */
function fallbackWidgets(parsedData: unknown): Widget[] {
  const widgets: Widget[] = [];

  if (Array.isArray(parsedData) && parsedData.length > 0) {
    const columns = typeof parsedData[0] === 'object' && parsedData[0] !== null
      ? Object.keys(parsedData[0] as object).slice(0, 8)
      : ['value'];
    widgets.push({
      id: 'w1',
      type: 'table',
      title: 'Results',
      dataKey: '_root',
      columns,
      colSpan: 4,
    });
  } else if (parsedData && typeof parsedData === 'object') {
    const keys = Object.keys(parsedData as object);
    let wid = 1;
    for (const key of keys.slice(0, 4)) {
      const val = (parsedData as Record<string, unknown>)[key];
      if (Array.isArray(val) && val.length > 0) {
        const cols = typeof val[0] === 'object' && val[0] !== null
          ? Object.keys(val[0] as object).slice(0, 8)
          : ['value'];
        widgets.push({ id: `w${wid++}`, type: 'table', title: key, dataKey: key, columns: cols, colSpan: 4 });
      } else if (typeof val === 'number' || typeof val === 'string') {
        widgets.push({ id: `w${wid++}`, type: 'headline', title: key, dataKey: key, colSpan: 1 });
      }
    }
  }

  if (widgets.length === 0) {
    widgets.push({
      id: 'w1',
      type: 'table',
      title: 'Agent Output',
      dataKey: '_text',
      columns: ['value'],
      colSpan: 4,
    });
  }

  widgets.push({
    id: `w${widgets.length + 1}`,
    type: 'actions',
    title: 'Controls',
    actions: [{ label: 'Refresh', action: 'refresh', style: 'primary' }],
    colSpan: 1,
  });

  return widgets;
}
