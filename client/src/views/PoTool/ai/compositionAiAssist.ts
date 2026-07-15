// compositionAiAssist.ts — The optional AI accelerator for Feature Composition.
//
// Same contract as the splitter's: prompt out, strictly-validated reply in, nothing written to Jira, and
// every proposal editable before it counts.
//
// What is different is the input. A composition already has everything the assistant needs — the PO's own
// words about the Feature, plus the Confluence page, the spreadsheet, the tickets and the notes they
// gathered. The prompt's job is to hand all of that over at once, which is exactly the context-switching
// the tab exists to remove.
//
// See specs/017-po-feature-tools/contracts/ai-assist-json.md.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
import type { ReadinessCriterion } from '../coaching/definitionOfReady';
import type { CompositionDraft } from '../drafts/draftModel';
import { describeSourceOrigin, describeSourceTitle, readSourceText } from '../sources/sourceModel';
import type { AiIngestResult } from './splitAiAssist';

/** The fixed discriminator the assistant must echo. */
const COMPOSITION_INGEST_KIND = 'featureCompositionIngest';

/** A proposed Feature draft. Every field is editable, and none of it is applied until accepted. */
export interface CompositionProposal {
  summary: string;
  description: string;
  acceptanceCriteria: string;
  /** Only field ids the prompt whitelisted; anything invented is dropped and reported. */
  fields: Record<string, unknown>;
  rationale: string;
}

/** How much of one source to include, so a long page cannot crowd out everything else. */
const MAX_SOURCE_TEXT_LENGTH = 4000;

/** Trims one source's text and says plainly when it has been cut. */
function readTrimmedSourceText(sourceText: string): string {
  if (sourceText.length <= MAX_SOURCE_TEXT_LENGTH) {
    return sourceText;
  }
  return `${sourceText.slice(0, MAX_SOURCE_TEXT_LENGTH)}\n… (truncated — open the source for the rest)`;
}

/**
 * Builds the prompt a PO copies into their assistant.
 *
 * The PO's own words lead, deliberately: the gathered material is evidence, but their explanation is the
 * intent, and an assistant handed only documents will write a summary of the documents (FR-031).
 */
export function buildCompositionPrompt(
  draft: CompositionDraft,
  readinessCriteria: readonly ReadinessCriterion[],
  writableFieldNamesById: Readonly<Record<string, string>>,
): string {
  const sourceBlocks = draft.sources.map((source) => [
    `--- ${describeSourceTitle(source)} (${describeSourceOrigin(source)}) ---`,
    readTrimmedSourceText(readSourceText(source)),
  ].join('\n'));

  const readinessLines = readinessCriteria
    .map((criterion) => `  - ${criterion.name}: ${criterion.description}`)
    .join('\n');

  const writableFieldEntries = Object.entries(writableFieldNamesById);
  const fieldLines = writableFieldEntries.length > 0
    ? writableFieldEntries.map(([fieldId, fieldName]) => `  - "${fieldId}" (${fieldName})`).join('\n')
    : '  (none — do not include a "fields" object)';

  return [
    'You are helping a Product Owner write a Jira Feature so their team can understand and commit to it.',
    '',
    'The Product Owner describes it like this:',
    draft.poNarrative.trim() || '(they have not written this yet — work from the material below)',
    '',
    draft.summary.trim() !== '' ? `Their current draft summary: ${draft.summary}` : 'They have no draft summary yet.',
    '',
    sourceBlocks.length > 0
      ? `They have gathered the following material:\n\n${sourceBlocks.join('\n\n')}`
      : 'They have not gathered any supporting material.',
    '',
    'A Feature is ready when:',
    readinessLines,
    '',
    'Write the Feature so it meets that bar. Lead the description with the problem and who has it, not the',
    'solution. Make every acceptance criterion something a tester could check without asking a question.',
    '',
    'You may set ONLY these Jira fields, using the exact ids given. Do not invent field ids:',
    fieldLines,
    '',
    'Do not invent facts that are not in the material or the Product Owner\'s description. Do not choose the',
    'project or the issue type — the Product Owner does that.',
    '',
    'Respond ONLY with valid JSON:',
    `{"kind":"${COMPOSITION_INGEST_KIND}","feature":{"summary":"...","description":"...","acceptanceCriteria":"...","fields":{},"rationale":"..."}}`,
  ].join('\n');
}

/** Coerces anything to a trimmed string. */
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
 * Ingests a composed-Feature proposal.
 *
 * Never throws. A field the prompt did not whitelist is dropped WITH an error rather than passed
 * through — an assistant must not be able to steer a write at a field nobody offered it (FR-037).
 */
export function parseCompositionIngest(
  responseText: string,
  writableFieldIds: readonly string[],
): AiIngestResult<CompositionProposal> {
  const { payload, error } = readPayloadObject(responseText);
  if (!payload) {
    return { items: [], errors: [error!] };
  }

  if (payload.kind !== COMPOSITION_INGEST_KIND) {
    return {
      items: [],
      errors: [`Response kind "${String(payload.kind)}" is not ${COMPOSITION_INGEST_KIND}.`],
    };
  }
  if (typeof payload.feature !== 'object' || payload.feature === null) {
    return { items: [], errors: ['The "feature" field is missing or is not an object.'] };
  }

  const candidate = payload.feature as Record<string, unknown>;
  const summary = readTrimmedString(candidate.summary);
  if (summary === '') {
    return { items: [], errors: ['The proposed Feature is missing a summary.'] };
  }

  const errors: string[] = [];
  const fields: Record<string, unknown> = {};
  const allowedFieldIds = new Set(writableFieldIds);

  if (typeof candidate.fields === 'object' && candidate.fields !== null) {
    Object.entries(candidate.fields as Record<string, unknown>).forEach(([fieldId, fieldValue]) => {
      if (!allowedFieldIds.has(fieldId)) {
        errors.push(`Field "${fieldId}" is not a known field for this project, so it was ignored.`);
        return;
      }
      fields[fieldId] = fieldValue;
    });
  }

  return {
    items: [{
      summary,
      description: readTrimmedString(candidate.description),
      acceptanceCriteria: readTrimmedString(candidate.acceptanceCriteria),
      fields,
      rationale: readTrimmedString(candidate.rationale),
    }],
    errors,
  };
}
