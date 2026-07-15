// splitAiAssist.ts — The optional AI accelerator for the Feature Splitter.
//
// Toolbox generates a prompt for the PO to run in their own assistant, and ingests a strictly-validated
// reply. It never calls an AI service and opens no outbound channel. Ingesting writes nothing to Jira:
// proposals land in the same editable controls the PO types into, unaccepted, and Jira is reached only
// by the separate Commit button they already use.
//
// Validation is strict about IDENTITY and lenient about CONTENT. A reply of the wrong kind is rejected
// whole — that guard is what stops a stray payload from another surface being read as a split. But a bad
// field kills only its own increment: a split proposes a BATCH, and losing four good increments to one
// malformed fifth would be hostile.
//
// See specs/017-po-feature-tools/contracts/ai-assist-json.md.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
import { createEmptyIncrement, type ProposedIncrement, type SourceFeatureSnapshot } from '../drafts/draftModel';
import type { SplitHeuristic } from '../coaching/splitHeuristics';

/** The fixed discriminator the assistant must echo, so a stray JSON blob is never misread as a split. */
const SPLIT_INGEST_KIND = 'featureSplitIngest';

/** What an ingest produced: the items worth showing, and a plain account of what was skipped. */
export interface AiIngestResult<TItem> {
  items: TItem[];
  errors: string[];
}

/**
 * Builds the prompt a PO copies into their assistant.
 *
 * The coaching goes in too, so the assistant proposes splits along the same lines the tab teaches —
 * otherwise the AI half and the deterministic half would pull in different directions.
 */
export function buildSplitPrompt(
  source: SourceFeatureSnapshot,
  heuristics: readonly SplitHeuristic[],
): string {
  const heuristicLines = heuristics
    .map((heuristic) => `  - ${heuristic.name}: ${heuristic.description}`)
    .join('\n');

  return [
    `You are helping a Product Owner split one large Jira ${source.issueTypeName || 'Feature'} into smaller ones that each deliver value on their own.`,
    '',
    `The ${source.issueTypeName || 'Feature'} to split is ${source.key}:`,
    '',
    `Summary: ${source.summary}`,
    `Description: ${source.description || '(none)'}`,
    `Acceptance criteria: ${source.acceptanceCriteria || '(none)'}`,
    '',
    'Use one or more of these established splitting heuristics:',
    heuristicLines,
    '',
    'Each proposed increment MUST:',
    '  - deliver something a user or the business would notice, on its own',
    '  - be releasable without waiting for its siblings',
    '  - be small enough to finish comfortably inside one Program Increment',
    '  - be worth doing even if the remaining increments were never built',
    '',
    'Do not invent scope that is not implied by the text above. Do not propose issue types, projects, or',
    'field names — those are chosen by the Product Owner, not by you.',
    '',
    'Respond ONLY with valid JSON:',
    `{"kind":"${SPLIT_INGEST_KIND}","increments":[{"summary":"...","description":"...","acceptanceCriteria":"...","rationale":"..."}]}`,
  ].join('\n');
}

/** Coerces anything to a trimmed string, so a non-string field degrades rather than throwing. */
function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Reads the payload object, turning both unreadable cases into one plain error. */
function readPayloadObject(responseText: string): { payload?: Record<string, unknown>; error?: string } {
  let jsonText: string;
  try {
    jsonText = extractJsonPayload(responseText);
  } catch {
    return { error: 'No JSON object found in the assistant response.' };
  }
  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (typeof parsed !== 'object' || parsed === null) {
      return { error: 'The assistant response was not valid JSON.' };
    }
    return { payload: parsed as Record<string, unknown> };
  } catch {
    return { error: 'The assistant response was not valid JSON.' };
  }
}

/**
 * Ingests a split proposal.
 *
 * Never throws. Every increment lands `isAccepted: false` — the PO decides, one at a time.
 */
export function parseSplitIngest(
  responseText: string,
  existingIncrements: readonly ProposedIncrement[],
): AiIngestResult<ProposedIncrement> {
  const { payload, error } = readPayloadObject(responseText);
  if (!payload) {
    return { items: [], errors: [error!] };
  }

  // Strict on identity: the whole payload dies if it is not what we asked for.
  if (payload.kind !== SPLIT_INGEST_KIND) {
    return {
      items: [],
      errors: [`Response kind "${String(payload.kind)}" is not ${SPLIT_INGEST_KIND}.`],
    };
  }
  if (!Array.isArray(payload.increments)) {
    return { items: [], errors: ['The "increments" field is missing or is not an array.'] };
  }

  const items: ProposedIncrement[] = [];
  const errors: string[] = [];
  let mintedIndex = existingIncrements.length;

  payload.increments.forEach((rawIncrement: unknown, incrementIndex: number) => {
    if (typeof rawIncrement !== 'object' || rawIncrement === null) {
      errors.push(`Increment at position ${incrementIndex + 1} could not be read.`);
      return;
    }
    const candidate = rawIncrement as Record<string, unknown>;
    const summary = readTrimmedString(candidate.summary);
    // A summary is the one thing an increment cannot do without — it is the issue's name.
    if (summary === '') {
      errors.push(`Increment at position ${incrementIndex + 1} is missing a summary.`);
      return;
    }

    mintedIndex += 1;
    items.push({
      ...createEmptyIncrement(`increment-ai-${mintedIndex}`),
      summary,
      description: readTrimmedString(candidate.description),
      acceptanceCriteria: readTrimmedString(candidate.acceptanceCriteria),
      rationale: readTrimmedString(candidate.rationale),
      origin: 'ai',
      // The PO accepts each one deliberately. Nothing an assistant says is applied on its say-so.
      isAccepted: false,
    });
  });

  return { items, errors };
}
