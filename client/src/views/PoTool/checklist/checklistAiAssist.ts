// checklistAiAssist.ts — One prompt that reviews an Epic against the Definition of Ready and Definition of Done,
// and a strict reader for the answer.
//
// The prompt asks for a judgement per criterion, not a tick: satisfied, partly satisfied, or missing — with the
// words in the Epic that support it, and what is still needed. That last field is the one the PO actually works
// from, so a reply that omits it is incomplete even when its verdict is right.
//
// Same contract as every other AI surface here: prompt out, JSON reply in, nothing written to Jira by this file.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
import { DEFINITION_LABELS, type ReadinessCriterion } from './dorCriteria.ts';
import type { CriterionStatus, CriterionVerdict } from './readinessReport.ts';
import type { EpicChecklistSource } from './checklistField.ts';

/** The fixed discriminator the assistant must echo, so another reply cannot be ingested here by accident. */
const CHECKLIST_INGEST_KIND = 'epicReadinessReview';

/** The outcome of reading one reply: the verdicts that survived, and what was wrong with the rest. */
export interface ChecklistIngestResult {
  verdicts: CriterionVerdict[];
  errors: string[];
}

/** How much of the Epic's description to include, so one enormous Epic cannot crowd out the criteria. */
const MAX_DESCRIPTION_CHARS = 8000;

/** The statuses the assistant may answer with. */
const ALLOWED_STATUSES: CriterionStatus[] = ['satisfied', 'partial', 'missing'];

/** Trims one long field and says plainly that it was cut. */
function readTrimmedText(text: string): string {
  const trimmedText = text.trim();
  if (trimmedText.length <= MAX_DESCRIPTION_CHARS) {
    return trimmedText;
  }
  return `${trimmedText.slice(0, MAX_DESCRIPTION_CHARS)}\n… (truncated — open the Epic for the rest)`;
}

/** Writes one criterion as the prompt lists it: its id, its group, and its words. */
function describeCriterion(criterion: ReadinessCriterion): string {
  return `  ${criterion.id} — [${criterion.section}] ${criterion.text}`;
}

/** Lists one definition's criteria under its own heading, or nothing when it has none. */
function describeDefinitionCriteria(criteria: readonly ReadinessCriterion[], definition: 'dor' | 'dod'): string[] {
  const definitionCriteria = criteria.filter((criterion) => criterion.definition === definition);
  if (definitionCriteria.length === 0) {
    return [];
  }
  return [`${DEFINITION_LABELS[definition]}:`, ...definitionCriteria.map(describeCriterion), ''];
}

/**
 * Builds the prompt the PO copies into their assistant.
 *
 * The Epic leads and the criteria follow, deliberately: an assistant given the criteria first tends to argue each
 * one into being met, while one that reads the Epic first is judging what is actually written there.
 */
export function buildChecklistPrompt(
  epic: EpicChecklistSource,
  criteria: readonly ReadinessCriterion[],
  /** The Epic's children, as "KEY — status — summary" lines. Evidence for scope and delivery criteria. */
  childSummaryLines: readonly string[] = [],
): string {
  return [
    'You are reviewing a Jira Epic against a team\'s Definition of Ready and Definition of Done.',
    'You are the sceptical reviewer in a refinement session: your job is to find what is not yet written down,',
    'not to reassure the Product Owner.',
    '',
    `Epic ${epic.issueKey} (status: ${epic.status || 'unknown'})`,
    `Summary: ${epic.summary}`,
    '',
    'Description:',
    readTrimmedText(epic.description) || '(empty)',
    '',
    'Acceptance criteria:',
    readTrimmedText(epic.acceptanceCriteria) || '(none recorded)',
    '',
    childSummaryLines.length > 0
      ? `Work under this Epic:\n${childSummaryLines.join('\n')}`
      : 'Work under this Epic: (none found)',
    '',
    'Judge the Epic against every criterion below:',
    '',
    ...describeDefinitionCriteria(criteria, 'dor'),
    ...describeDefinitionCriteria(criteria, 'dod'),
    'For each criterion answer with one status:',
    '  "satisfied" — the Epic clearly meets it, and you can quote the words that show it.',
    '  "partial"   — something is written about it, but it is incomplete, vague, or unverifiable as written.',
    '  "missing"   — the Epic says nothing that meets it.',
    '',
    'Rules:',
    '  • "evidence" must quote or closely paraphrase the actual words in the Epic. A criterion cannot be',
    '    "satisfied" without evidence. If you have nothing to quote, the answer is "missing".',
    '  • "whatIsMissing" must say what would have to be added to the Epic to satisfy the criterion. For a',
    '    satisfied criterion, leave it as an empty string.',
    '  • Judge only what is written above. Do not assume work happened because the Epic looks mature, and do',
    '    not treat the Epic\'s status, its age, or the existence of child issues as evidence on its own.',
    '  • Answer every criterion id exactly once. Use only the ids given. Do not invent criteria.',
    '',
    'Respond ONLY with valid JSON:',
    `{"kind":"${CHECKLIST_INGEST_KIND}","items":[`
      + '{"criterionId":"dor-business-objective","status":"partial","evidence":"...","whatIsMissing":"..."}]}',
  ].join('\n');
}

/** Coerces anything to a trimmed string. */
function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Reads the status, defaulting an unrecognised one to missing rather than guessing in the Epic's favour. */
function readStatus(value: unknown): CriterionStatus | null {
  const statusText = readTrimmedString(value).toLowerCase();
  return ALLOWED_STATUSES.find((allowedStatus) => allowedStatus === statusText) ?? null;
}

/**
 * Reads the assistant's reply.
 *
 * Never throws. Three rules protect the report: a criterion id the prompt did not offer is dropped with an error
 * (an assistant must not invent criteria the team never agreed), a "satisfied" with no evidence is downgraded to
 * "partial" (the quote IS the argument), and a criterion nobody answered is simply left unanswered — the report
 * says so rather than counting it as a pass.
 */
export function parseChecklistIngest(
  responseText: string,
  offeredCriterionIds: readonly string[],
): ChecklistIngestResult {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(extractJsonPayload(responseText));
    if (typeof parsed !== 'object' || parsed === null) {
      return { verdicts: [], errors: ['The assistant response was not valid JSON.'] };
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return { verdicts: [], errors: ['No JSON object found in the assistant response.'] };
  }

  if (payload.kind !== CHECKLIST_INGEST_KIND) {
    return { verdicts: [], errors: [`Response kind "${String(payload.kind)}" is not ${CHECKLIST_INGEST_KIND}.`] };
  }
  if (!Array.isArray(payload.items)) {
    return { verdicts: [], errors: ['The "items" field is missing or is not a list.'] };
  }

  const allowedCriterionIds = new Set(offeredCriterionIds);
  const seenCriterionIds = new Set<string>();
  const verdicts: CriterionVerdict[] = [];
  const errors: string[] = [];

  payload.items.forEach((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) {
      errors.push('An entry in "items" was not an object, so it was ignored.');
      return;
    }
    const candidateItem = candidate as Record<string, unknown>;
    const criterionId = readTrimmedString(candidateItem.criterionId);

    if (!allowedCriterionIds.has(criterionId)) {
      errors.push(`"${criterionId || '(no id)'}" is not one of the criteria, so it was ignored.`);
      return;
    }
    if (seenCriterionIds.has(criterionId)) {
      errors.push(`"${criterionId}" was answered twice; only the first answer was kept.`);
      return;
    }
    seenCriterionIds.add(criterionId);

    const evidence = readTrimmedString(candidateItem.evidence);
    const claimedStatus = readStatus(candidateItem.status);
    if (claimedStatus === null) {
      errors.push(`"${criterionId}" came back with no usable status, so it is reported as missing.`);
    }

    // A claim of "satisfied" with nothing quoted is not a weaker claim — it is no claim, so it does not pass.
    const isUnevidencedPass = claimedStatus === 'satisfied' && evidence === '';
    const status: CriterionStatus = isUnevidencedPass ? 'partial' : claimedStatus ?? 'missing';

    verdicts.push({
      criterionId,
      status,
      evidence,
      whatIsMissing: isUnevidencedPass
        ? 'Reported as satisfied but nothing in the Epic was quoted — confirm this yourself before relying on it.'
        : readTrimmedString(candidateItem.whatIsMissing),
    });
  });

  offeredCriterionIds
    .filter((offeredCriterionId) => !seenCriterionIds.has(offeredCriterionId))
    .forEach((unansweredCriterionId) => {
      errors.push(`"${unansweredCriterionId}" was not answered, so it is reported as unanswered.`);
    });

  return { verdicts, errors };
}

/** The criteria the review judged satisfied — the ones a PO would tick if the checklist can be written. */
export function listSatisfiedCriterionIds(verdicts: readonly CriterionVerdict[]): string[] {
  return verdicts.filter((verdict) => verdict.status === 'satisfied').map((verdict) => verdict.criterionId);
}
