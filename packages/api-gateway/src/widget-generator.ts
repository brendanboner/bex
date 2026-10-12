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
import { buildLlmModel } from '@bex/orchestrator';
import type { Widget } from '@bex/shared';

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
      type: z.enum(['headline', 'table', 'chart', 'actions', 'stat', 'multiline', 'markdown', 'heatmap', 'mermaid']),
      title: z.string().optional(),
      dataKey: z.string().optional(),
      columns: z.array(z.string()).optional(),
      chartType: z.enum(['bar', 'line', 'pie']).optional(),
      xKey: z.string().optional(),
      yKey: z.string().optional(),
      yKeys: z.array(z.string()).optional(),
      unit: z.string().optional(),
      deltaKey: z.string().optional(),
      statusKey: z.string().optional(),
      thresholds: z.object({ warn: z.number(), crit: z.number() }).optional(),
      labelKey: z.string().optional(),
      valueKey: z.string().optional(),
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
    console.warn(`[widget-generator] Agent output for "${dashboardName}" is prose — using markdown fallback widget`);
    return [
      { id: 'w1', type: 'markdown', title: dashboardName, dataKey: '_text', colSpan: 4 },
      { id: 'w2', type: 'actions', actions: [{ label: 'Refresh', action: 'refresh', style: 'primary' }], colSpan: 1 },
    ] as Widget[];
  }

  const dataDescription = `The agent returned structured JSON data:\n\`\`\`json\n${JSON.stringify(parsedData, null, 2).slice(0, 3000)}\n\`\`\``;

  // ── Fast-path: if the data has well-known mermaid/diagram fields, return a mermaid widget directly
  // without burning LLM tokens — the LLM nearly always chooses mermaid anyway.
  if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
    const data = parsedData as Record<string, unknown>;
    const mermaidKey = ['topology_diagram', 'sankey_diagram', 'fabric_graph', 'mermaid_diagram', 'diagram']
      .find((k) => typeof data[k] === 'string' && (data[k] as string).length > 10);
    if (mermaidKey) {
      const widgets: Widget[] = [
        { id: 'w1', type: 'mermaid', title: dashboardName, dataKey: mermaidKey, colSpan: 4 } as Widget,
      ];
      // Add summary stats if present
      const summaryKeys = Object.keys(data).filter((k) => k !== mermaidKey && typeof data[k] !== 'object');
      for (let i = 0; i < Math.min(summaryKeys.length, 4); i++) {
        widgets.push({ id: `ws${i + 1}`, type: 'headline', title: summaryKeys[i]!, dataKey: summaryKeys[i]!, colSpan: 1 } as Widget);
      }
      // Add a table for the first array key if present
      const arrayKey = Object.keys(data).find((k) => Array.isArray(data[k]) && (data[k] as unknown[]).length > 0);
      if (arrayKey) {
        const arr = data[arrayKey] as Array<Record<string, unknown>>;
        const columns = typeof arr[0] === 'object' && arr[0] !== null ? Object.keys(arr[0]).slice(0, 8) : ['value'];
        widgets.push({ id: `wt1`, type: 'table', title: arrayKey, dataKey: arrayKey, columns, colSpan: 4 } as Widget);
      }
      widgets.push({ id: 'wz1', type: 'actions', actions: [{ label: 'Refresh', action: 'refresh', style: 'primary' }], colSpan: 1 } as Widget);
      console.info(`[widget-generator] Fast-path mermaid widget for "${dashboardName}" (key: ${mermaidKey})`);
      return widgets;
    }
  }

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
- MULTI-AGENT DATA: When data has top-level keys "xiq" and "xco", each is a namespace. Use dot-notation to access their children: e.g. "xiq.summary.total_clients", "xco.alarms" (for an array), "xco.fabric.spine_count". Group related widgets by namespace and add section headings.
- CRITICAL: "headline" and "stat" widget dataKey MUST resolve to a single scalar value (a number or a short string ≤ 30 chars). NEVER point headline or stat at an array or an object — if the data for a key is an array, use "table" instead. If the scalar you want lives inside a nested object, use dot-notation (e.g. "summary.total_clients", not "summary").
- IMPORTANT: When the data has an array of objects where each object itself contains a sub-array (e.g. access_points[].clients), do NOT use bracket-indexed paths like "access_points[0].clients". Instead create ONE table widget per unique sub-array using the top-level key (e.g. "access_points") with columns including fields from the nested objects flattened. Alternatively, if the data is already structured with named top-level arrays (e.g. "apple_clients"), use that key directly.
- Use "headline" widgets for single numeric or short-text values. Set "dataKey" to the exact dot-path to the value (e.g. "summary.total_ssids")
- Use "stat" widgets for a single metric that benefits from health colouring (green/amber/red). Add "unit" (e.g. "dB"), "thresholds": {"warn": N, "crit": M} for auto-colour. Good for SNR, uptime, counts.
- Use "table" widgets for arrays of objects — set "dataKey" to the key of the array, and "columns" to the EXACT field names from the data objects. Look at what keys actually exist in the first array item and use those. NEVER invent column names — if the data has {"key": "...", "value": "..."} use ["key", "value"], not ["feature", "status"] or any other label you make up.
- Use "chart" widgets for numeric comparisons — set chartType (bar/line/pie), xKey, yKey, and dataKey to the key of the array
- Use "multiline" widgets when you have multiple numeric series to compare on one line chart. Set "yKeys" to an array of field names (e.g. ["band_24ghz","band_5ghz"]), "xKey" to the time/label field, "dataKey" to the array.
- Use "markdown" widgets when data has a string field containing prose or formatted text (e.g. "summary_markdown", "analysis"). Set "dataKey" to that string field key.
- Use "mermaid" widgets when the data contains a Mermaid diagram string (e.g. key "topology_diagram", "fabric_graph", "sankey_diagram"). The string must be valid Mermaid syntax (e.g. starts with "graph LR", "flowchart TD", "sankey-beta", "sequenceDiagram"). Set "dataKey" to that string field. Always colSpan: 4. Good for: network topology (XCO fabric spine/leaf as graph LR), client-per-SSID Sankey, VLAN chain flowcharts.
- Use "heatmap" widgets for arrays where each item should be shown as a coloured cell (e.g. AP RF quality). Set "labelKey" (e.g. "hostname"), "valueKey" (e.g. "snr"), "thresholds": {"warn": 25, "crit": 15}, "unit" (e.g. "dB").
- Use "actions" widget at the end with a "Refresh" action (action: "refresh", style: "primary")
- colSpan: 1 for headlines/stat, 2-4 for tables/charts/heatmaps
- Keep it clean: 3–10 widgets max (up to 10 for multi-agent dashboards)
- Each widget id should be a short unique string like "w1", "w2", etc.

Return the widget array only.`,
    });

    return validateWidgetColumns(object.widgets as Widget[], parsedData);
  } catch (err) {
    console.error('[widget-generator] LLM widget generation failed, using fallback:', err);
    return fallbackWidgets(parsedData);
  }
}

/**
 * Post-processing: for each table widget, verify that the declared `columns`
 * actually exist as keys in the first row of the resolved array. If any column
 * is missing (the LLM invented a semantic name), replace the columns list with
 * the real keys from the data.
 */
function validateWidgetColumns(widgets: Widget[], parsedData: unknown): Widget[] {
  if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) return widgets;
  const data = parsedData as Record<string, unknown>;

  return widgets.map((w) => {
    if (w.type !== 'table' || !w.dataKey || !w.columns?.length) return w;

    // Resolve the array this table points at
    const arr = data[w.dataKey];
    if (!Array.isArray(arr) || arr.length === 0) return w;

    const firstRow = arr[0];
    if (typeof firstRow !== 'object' || firstRow === null) return w;

    const actualKeys = Object.keys(firstRow as object);
    if (actualKeys.length === 0) return w;

    // Check if ALL declared columns exist in the actual data
    const allMatch = w.columns.every((col) =>
      actualKeys.includes(col) || (firstRow as Record<string, unknown>)[col] !== undefined,
    );

    if (!allMatch) {
      console.warn(
        `[widget-generator] Column mismatch for table "${w.title ?? w.dataKey}": ` +
        `declared=[${w.columns.join(',')}] actual=[${actualKeys.slice(0, 8).join(',')}] — using actual keys`,
      );
      return { ...w, columns: actualKeys.slice(0, 8) };
    }
    return w;
  });
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
      } else if (typeof val === 'number') {
        widgets.push({ id: `w${wid++}`, type: 'headline', title: key, dataKey: key, colSpan: 1 });
      } else if (typeof val === 'string' && val.length > 0) {
        widgets.push({ id: `w${wid++}`, type: 'markdown', title: key, dataKey: key, colSpan: 2 });
      }
    }
  }

  if (widgets.length === 0) {
    widgets.push({
      id: 'w1',
      type: 'markdown',
      title: 'Agent Output',
      dataKey: '_text',
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
