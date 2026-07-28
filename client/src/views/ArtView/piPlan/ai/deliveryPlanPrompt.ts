// deliveryPlanPrompt.ts — Builds the propose-only PI Delivery planning prompt (spec 032, US1,
// contract ai-delivery-plan.md). The prompt embeds the PI Planning Fact Sheet verbatim (compact tables) and
// the engine-flagged bottlenecks, and asks the AI for ONLY two judgements: how to group each Feature's repos
// into Stories, and a mitigation per bottleneck. It explicitly forbids dates/capacity/assignments — those
// are computed by the engine — so the AI cannot supply a fact it could get wrong (agree-by-construction).

import type { Bottleneck, PiPlanningFactSheet } from '../piPlanTypes.ts';

/** The reply envelope kind, so a reply pasted from a different AI surface is caught rather than misread. */
export const DELIVERY_PLAN_REPLY_KIND = 'piDeliveryPlan';

/** How many Features to embed per prompt chunk before splitting (keeps a single reply pasteable). */
const FEATURES_PER_CHUNK = 12;

/** Renders each Feature as a brief block — key, size, repos, and (when present) a description snippet — so the
 *  AI decomposes and writes acceptance-criteria hints from real content rather than the title alone. */
function renderFeatureBriefs(factSheet: PiPlanningFactSheet): string {
  return factSheet.features.map((feature) => {
    const repos = feature.repoComponentNames.join(', ') || '(none — map repos first)';
    const lines = [
      `### ${feature.key} — ${feature.summary}`,
      `- Size: ${feature.sizePoints ?? '?'} pts`,
      `- Repo components: ${repos}`,
    ];
    if (feature.description && feature.description.trim() !== '') {
      lines.push(`- Detail: ${feature.description}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

/** Renders the roster + roles so the AI knows who exists (it never assigns — the engine does). */
function renderRosterTable(factSheet: PiPlanningFactSheet): string {
  const rows = factSheet.people.map((person) => `| ${person.displayName} | ${person.roles.join(', ')} |`);
  return ['| Person | Roles |', '|---|---|', ...rows].join('\n');
}

/** Renders the engine-flagged bottlenecks the AI must write mitigations for (by id). */
function renderBottleneckList(bottlenecks: Bottleneck[]): string {
  if (bottlenecks.length === 0) {
    return '(none flagged)';
  }
  return bottlenecks.map((bottleneck) => `- ${bottleneck.id}: ${bottleneck.statement}`).join('\n');
}

/** Builds the prompt for a single chunk of Features. */
function buildChunkPrompt(factSheet: PiPlanningFactSheet, bottlenecks: Bottleneck[], chunkIndex: number, chunkCount: number): string {
  const chunkNote = chunkCount > 1 ? ` (chunk ${chunkIndex + 1} of ${chunkCount})` : '';
  return [
    `You are helping plan Program Increment ${factSheet.piName}${chunkNote}. Work ONLY from the facts below.`,
    '',
    'Return ONE JSON object with two arrays: a Story decomposition and bottleneck mitigations. For each Feature,',
    'group the repositories it touches into one or more Stories (a Story may bridge several repos under one owner);',
    'give each Story a clear, specific summary and 2–4 concrete acceptance-criteria hints DERIVED FROM the Detail',
    'text below — not generic restatements of the title. Prefer several focused Stories over one catch-all Story',
    'when the Detail describes distinct slices of work. Use ONLY the repo names and Feature keys shown.',
    'Do NOT return dates, sprints, assignments, or point estimates — those are computed for you and any you return',
    'will be ignored.',
    '',
    '## Features (decompose each into Stories over its repo components)',
    renderFeatureBriefs(factSheet),
    '',
    '## Roster (for context only — you do NOT assign people)',
    renderRosterTable(factSheet),
    '',
    `## Delivery deadline: all delivery must complete by ${factSheet.deliveryDeadlineIso} (Sprint-5 Week-1).`,
    '',
    '## Bottlenecks flagged by the planner — write a mitigation for each id',
    renderBottleneckList(bottlenecks),
    '',
    'Return ONLY this JSON shape:',
    '{',
    `  "kind": "${DELIVERY_PLAN_REPLY_KIND}",`,
    '  "stories": [',
    '    { "featureKey": "KEY-1", "summary": "Story summary", "repos": ["repo-a", "repo-b"], "acHints": ["…"] }',
    '  ],',
    '  "mitigations": [',
    '    { "bottleneckId": "an-id-from-above", "mitigation": "concrete mitigation" }',
    '  ]',
    '}',
  ].join('\n');
}

/** The result of building the prompt(s): one string per chunk (usually one). */
export interface DeliveryPromptResult {
  prompts: string[];
  featureCount: number;
  chunkCount: number;
}

/**
 * Builds the delivery-plan prompt from the fact sheet + engine-flagged bottlenecks. Chunks automatically when
 * the Feature set is large so each reply stays pasteable (FR-021). The AI is constrained to decomposition +
 * mitigations only; everything checkable is embedded as fact.
 */
export function buildDeliveryPlanPrompt(factSheet: PiPlanningFactSheet, bottlenecks: Bottleneck[] = []): DeliveryPromptResult {
  // Only NEW Features are decomposed by the AI; carryover Features already have Stories in flight and are
  // reconciled deterministically (never sent to the AI, so it can't propose duplicates).
  const newFeatures = factSheet.features.filter((feature) => !feature.isCarryover);
  const chunkCount = Math.max(1, Math.ceil(newFeatures.length / FEATURES_PER_CHUNK));
  const prompts: string[] = [];
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkFeatures = newFeatures.slice(chunkIndex * FEATURES_PER_CHUNK, (chunkIndex + 1) * FEATURES_PER_CHUNK);
    prompts.push(buildChunkPrompt({ ...factSheet, features: chunkFeatures }, bottlenecks, chunkIndex, chunkCount));
  }
  return { prompts, featureCount: newFeatures.length, chunkCount };
}
