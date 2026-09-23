// checklistAiAssist.ts — One prompt that asks an assistant which Definition of Ready / Done items the Epic
// already satisfies, and a strict reader for the answer.
//
// Same contract as every other AI surface here: the prompt goes out, the reply comes back as JSON, nothing is
// written to Jira until the PO says so. What is specific to a checklist is the evidence rule — an item may only
// be called satisfied if the assistant can quote the words in the Epic that satisfy it. Without that, "yes" is
// just agreeableness, and the PO would be ticking a Definition of Done on the strength of nothing.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
import type { ChecklistItem } from './smartChecklist.ts';
import type { EpicChecklistSource } from './checklistField.ts';

/** The fixed discriminator the assistant must echo, so another reply cannot be ingested here by accident. */
const CHECKLIST_INGEST_KIND = 'epicChecklistReview';

/** What the assistant decided about one checklist item. */
export interface ChecklistVerdict {
  /** The item id from the prompt. Anything the prompt did not offer is rejected. */
  itemId: string;
  isSatisfied: boolean;
  /** The words in the Epic that satisfy it, or why it cannot be judged. Shown beside every proposed tick. */
  evidence: string;
}

/** The outcome of reading one reply: the verdicts that survived, and what was wrong with the rest. */
export interface ChecklistIngestResult {
  verdicts: ChecklistVerdict[];
  errors: string[];
}

/** How much of the Epic's description to include, so one enormous Epic cannot crowd out the checklist itself. */
const MAX_DESCRIPTION_CHARS = 6000;

/** Trims one long field and says plainly that it was cut. */
function readTrimmedText(text: string): string {
  const trimmedText = text.trim();
  if (trimmedText.length <= MAX_DESCRIPTION_CHARS) {
    return trimmedText;
  }
  return `${trimmedText.slice(0, MAX_DESCRIPTION_CHARS)}\n… (truncated — open the Epic for the rest)`;
}

/** Writes one checklist item as the prompt lists it: its id, the group it belongs to, and its words. */
function describeChecklistItem(item: ChecklistItem): string {
  const sectionLabel = item.section === '' ? '' : `[${item.section}] `;
  return `  ${item.id}: ${sectionLabel}${item.text}`;
}

/**
 * Builds the prompt the PO copies into their assistant.
 *
 * The Epic leads and the checklist follows, deliberately: an assistant handed the checklist first tends to argue
 * each item into being satisfied, while one that reads the Epic first is judging what is actually written there.
 */
export function buildChecklistPrompt(
  epic: EpicChecklistSource,
  openItems: readonly ChecklistItem[],
  /** The Epic's children, as "KEY — status — summary" lines. Evidence for scope and delivery items. */
  childSummaryLines: readonly string[] = [],
): string {
  return [
    'You are helping a Product Owner check an Epic against their team\'s Definition of Ready and Definition of Done.',
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
    'These checklist items are not yet ticked:',
    ...openItems.map(describeChecklistItem),
    '',
    'For each item, decide whether the Epic ALREADY satisfies it, judging only by what is written above.',
    'An item is satisfied only if you can quote the words that satisfy it. Quote them in "evidence".',
    'If the Epic does not say, answer false and use "evidence" to say what is missing. Do not assume that work',
    'has been done because the Epic looks mature, and do not treat a status as evidence on its own.',
    'Use only the item ids given above. Do not invent items and do not leave any out.',
    '',
    'Respond ONLY with valid JSON:',
    `{"kind":"${CHECKLIST_INGEST_KIND}","items":[{"itemId":"line-3","isSatisfied":true,"evidence":"..."}]}`,
  ].join('\n');
}

/** Coerces anything to a trimmed string. */
function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Reads the assistant's reply.
 *
 * Never throws. Two rules do the protecting: an item id the prompt did not offer is dropped with an error rather
 * than passed through (an assistant must not be able to tick an item nobody showed it), and a satisfied verdict
 * with no evidence is downgraded to unsatisfied — the evidence IS the argument, so a claim without one is not a
 * weaker claim, it is no claim.
 */
export function parseChecklistIngest(
  responseText: string,
  offeredItemIds: readonly string[],
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

  const allowedItemIds = new Set(offeredItemIds);
  const seenItemIds = new Set<string>();
  const verdicts: ChecklistVerdict[] = [];
  const errors: string[] = [];

  payload.items.forEach((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) {
      errors.push('An entry in "items" was not an object, so it was ignored.');
      return;
    }
    const candidateItem = candidate as Record<string, unknown>;
    const itemId = readTrimmedString(candidateItem.itemId);

    if (!allowedItemIds.has(itemId)) {
      errors.push(`"${itemId || '(no id)'}" is not one of the checklist items, so it was ignored.`);
      return;
    }
    if (seenItemIds.has(itemId)) {
      errors.push(`"${itemId}" was answered twice; only the first answer was kept.`);
      return;
    }
    seenItemIds.add(itemId);

    const evidence = readTrimmedString(candidateItem.evidence);
    const claimsSatisfied = candidateItem.isSatisfied === true;

    verdicts.push({
      itemId,
      // No evidence, no tick. Stated as its own rule because it is the one that keeps the PO honest.
      isSatisfied: claimsSatisfied && evidence !== '',
      evidence: claimsSatisfied && evidence === '' ? 'Said to be satisfied, but quoted nothing from the Epic.' : evidence,
    });
  });

  offeredItemIds
    .filter((offeredItemId) => !seenItemIds.has(offeredItemId))
    .forEach((unansweredItemId) => {
      errors.push(`"${unansweredItemId}" was not answered, so it stays as it is.`);
    });

  return { verdicts, errors };
}

/** The ids the PO would be ticking — the satisfied verdicts, in checklist order. */
export function listSatisfiedItemIds(verdicts: readonly ChecklistVerdict[]): string[] {
  return verdicts.filter((verdict) => verdict.isSatisfied).map((verdict) => verdict.itemId);
}
