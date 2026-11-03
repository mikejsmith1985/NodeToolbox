// testStoryBackfill.ts — Decides which empty Description / Acceptance Criteria on open [QE]/[SL] issues to fill,
// and from which source issue.
//
// A Jira automation created [QE] and [SL] issues without cloning the description and acceptance criteria
// from the work they test. This module is the pure half of the clean-up: given the targets and their
// candidate sources, it plans every field write and never talks to Jira. The source chain, per field, is
//   1. a linked issue whose summary contains [DEV]
//   2. a linked issue of type Defect
//   3. the parent — the sub-task parent, else the Epic Link
// and the first tier holding a real value wins. A field that already has content is never written, and
// two DIFFERENT values in one tier are reported rather than guessed between.

// ── Named constants ──

/** The projects the owner asked this clean-up to cover; editable on the panel. */
export const DEFAULT_BACKFILL_PROJECT_KEYS: readonly string[] = ['ENCUC', 'ENFCT'];

/** A summary carrying either test tag marks an issue this clean-up may fill. */
const TARGET_TAG_PATTERN = /\[(QE|SL)\]/i;
/** The tag the team puts on the coding story a test story was made from. */
const DEV_TAG_PATTERN = /\[DEV\]/i;
/** The issue type name of a defect, matched whole and case-insensitively. */
const DEFECT_TYPE_PATTERN = /^defect$/i;
/** Jira's description field id; a system field, so the same on every instance. */
export const DESCRIPTION_FIELD_ID = 'description';

// ── Types ──

/** The slice of a Jira issue this module reads: its key and raw REST v2 fields. */
export interface BackfillIssue {
  key: string;
  fields: Record<string, unknown>;
}

/** Which instance fields hold Acceptance Criteria and the Epic Link. */
export interface BackfillFieldConfig {
  /** The single AC field a write targets. */
  acWriteFieldId: string;
  /** Every AC field worth reading; content in ANY of them means the AC is already there. */
  acReadFieldIds: readonly string[];
  /** The Epic Link field, used as the parent of a Story; empty when the instance has none. */
  epicLinkFieldId: string;
}

export type SourceTierName = 'DEV' | 'Defect' | 'Parent';

/** One rung of the source chain and the issues standing on it. */
export interface SourceTier {
  tierName: SourceTierName;
  issueKeys: string[];
}

/** What the clean-up will do with one field of one target. */
export type FieldDecision =
  | { action: 'write'; tierName: SourceTierName; sourceKey: string; value: string }
  | { action: 'has-content' }
  | { action: 'ambiguous'; tierName: SourceTierName; candidateKeys: string[] }
  | { action: 'no-source' };

/** The plan for one [QE]/[SL] issue. */
export interface BackfillPlanRow {
  targetKey: string;
  summary: string;
  statusName: string;
  description: FieldDecision;
  acceptanceCriteria: FieldDecision;
}

// ── Target selection ──

/** True when a summary carries [QE] or [SL]. */
export function isBackfillTargetSummary(summary: unknown): boolean {
  return TARGET_TAG_PATTERN.test(String(summary ?? ''));
}

/** Turns the panel's comma-separated project text into clean, upper-case keys. */
export function parseProjectKeys(projectText: string): string[] {
  return String(projectText ?? '')
    .split(',')
    .map((projectKey) => projectKey.trim().toUpperCase())
    .filter((projectKey) => projectKey !== '');
}

/**
 * The search that finds candidate targets. Jira's text search ignores the brackets, so this is
 * deliberately broad; `isBackfillTargetSummary` applies the exact [QE]/[SL] rule afterwards.
 */
export function buildTargetSearchJql(projectKeys: readonly string[]): string {
  return `project in (${projectKeys.join(', ')}) AND statusCategory != Done `
    + 'AND (summary ~ "QE" OR summary ~ "SL") ORDER BY key ASC';
}

/** True for null, undefined, or text that is only whitespace. */
export function isEmptyFieldValue(fieldValue: unknown): boolean {
  return fieldValue === null || fieldValue === undefined || String(fieldValue).trim() === '';
}

// ── Source chain ──

/** Every issue on the other end of a target's links, whichever direction the link runs. */
function readLinkedIssues(target: BackfillIssue): BackfillIssue[] {
  const issueLinks = Array.isArray(target.fields.issuelinks) ? target.fields.issuelinks : [];
  return issueLinks
    .map((issueLink) => {
      const linkRecord = issueLink as { inwardIssue?: BackfillIssue; outwardIssue?: BackfillIssue };
      return linkRecord.inwardIssue ?? linkRecord.outwardIssue ?? null;
    })
    .filter((linkedIssue): linkedIssue is BackfillIssue => linkedIssue !== null && Boolean(linkedIssue.key));
}

/** Reads a nested name like issuetype.name without trusting the shape. */
function readNestedName(fieldValue: unknown): string {
  return String((fieldValue as { name?: unknown } | null)?.name ?? '');
}

/** The sub-task parent when there is one, otherwise the Epic Link. */
function readParentKey(target: BackfillIssue, epicLinkFieldId: string): string | null {
  const parentKey = (target.fields.parent as { key?: string } | null | undefined)?.key;
  if (parentKey) return parentKey;
  const epicLinkValue = epicLinkFieldId ? target.fields[epicLinkFieldId] : null;
  return typeof epicLinkValue === 'string' && epicLinkValue.trim() !== '' ? epicLinkValue.trim() : null;
}

/** Builds the ordered DEV → Defect → Parent chain for one target. */
export function buildSourceTiers(target: BackfillIssue, epicLinkFieldId: string): SourceTier[] {
  // Another test story is never a source: copying [SL] text into a [QE] story would spread the gap.
  const linkedIssues = readLinkedIssues(target)
    .filter((linkedIssue) => !isBackfillTargetSummary(linkedIssue.fields?.summary));
  const devKeys = linkedIssues
    .filter((linkedIssue) => DEV_TAG_PATTERN.test(String(linkedIssue.fields?.summary ?? '')))
    .map((linkedIssue) => linkedIssue.key);
  const defectKeys = linkedIssues
    .filter((linkedIssue) => DEFECT_TYPE_PATTERN.test(readNestedName(linkedIssue.fields?.issuetype)))
    .map((linkedIssue) => linkedIssue.key);
  const parentKey = readParentKey(target, epicLinkFieldId);

  return [
    { tierName: 'DEV', issueKeys: [...new Set(devKeys)] },
    { tierName: 'Defect', issueKeys: [...new Set(defectKeys)] },
    { tierName: 'Parent', issueKeys: parentKey ? [parentKey] : [] },
  ];
}

/** Every distinct issue key any target might copy from, so they can be fetched in one sweep. */
export function collectSourceKeys(tiersList: readonly SourceTier[][]): string[] {
  return [...new Set(tiersList.flatMap((tiers) => tiers.flatMap((tier) => tier.issueKeys)))];
}

// ── Planning ──

/** The first readable text value among a list of fields, or null. Non-text values are never copied. */
function readFirstText(issueFields: Record<string, unknown>, fieldIds: readonly string[]): string | null {
  for (const fieldId of fieldIds) {
    const fieldValue = issueFields[fieldId];
    if (typeof fieldValue === 'string' && !isEmptyFieldValue(fieldValue)) return fieldValue;
  }
  return null;
}

/** Walks the chain for one field; the first tier with real text decides, unless it disagrees with itself. */
function decideFieldSource(
  tiers: readonly SourceTier[],
  sourceByKey: ReadonlyMap<string, BackfillIssue>,
  readFieldIds: readonly string[],
): FieldDecision {
  for (const tier of tiers) {
    const candidates = tier.issueKeys
      .map((issueKey) => ({ issueKey, value: readFirstText(sourceByKey.get(issueKey)?.fields ?? {}, readFieldIds) }))
      .filter((candidate): candidate is { issueKey: string; value: string } => candidate.value !== null);
    if (candidates.length === 0) continue;

    const distinctValues = new Set(candidates.map((candidate) => candidate.value.trim()));
    if (distinctValues.size > 1) {
      return { action: 'ambiguous', tierName: tier.tierName, candidateKeys: candidates.map((candidate) => candidate.issueKey) };
    }
    return { action: 'write', tierName: tier.tierName, sourceKey: candidates[0].issueKey, value: candidates[0].value };
  }
  return { action: 'no-source' };
}

/** Plans one field: leave it if it has content anywhere, otherwise find a source. */
function planField(
  target: BackfillIssue,
  tiers: readonly SourceTier[],
  sourceByKey: ReadonlyMap<string, BackfillIssue>,
  readFieldIds: readonly string[],
): FieldDecision {
  const hasContent = readFieldIds.some((fieldId) => !isEmptyFieldValue(target.fields[fieldId]));
  if (hasContent) return { action: 'has-content' };
  return decideFieldSource(tiers, sourceByKey, readFieldIds);
}

/** Plans every target's description and Acceptance Criteria. Pure — nothing here writes. */
export function buildBackfillPlan(
  targets: readonly BackfillIssue[],
  sources: readonly BackfillIssue[],
  fieldConfig: BackfillFieldConfig,
): BackfillPlanRow[] {
  const sourceByKey = new Map(sources.map((sourceIssue) => [sourceIssue.key, sourceIssue]));
  // The write field is read first so a value copied from a source lands in the same field it came from.
  const acReadOrder = [...new Set([fieldConfig.acWriteFieldId, ...fieldConfig.acReadFieldIds])].filter(Boolean);

  return targets.map((target) => {
    const tiers = buildSourceTiers(target, fieldConfig.epicLinkFieldId);
    return {
      targetKey: target.key,
      summary: String(target.fields.summary ?? ''),
      statusName: readNestedName(target.fields.status),
      description: planField(target, tiers, sourceByKey, [DESCRIPTION_FIELD_ID]),
      acceptanceCriteria: planField(target, tiers, sourceByKey, acReadOrder),
    };
  });
}

/** Counts the field writes a plan contains. */
export function countPlannedWrites(plan: readonly BackfillPlanRow[]): number {
  return plan.reduce((writeCount, row) => writeCount
    + (row.description.action === 'write' ? 1 : 0)
    + (row.acceptanceCriteria.action === 'write' ? 1 : 0), 0);
}

/**
 * The PUT body for one target, built against a FRESH read of the issue: a field somebody filled
 * between preview and apply is dropped, so the clean-up can never overwrite a person's text.
 */
export function buildUpdateFields(
  row: BackfillPlanRow,
  freshFields: Record<string, unknown>,
  fieldConfig: BackfillFieldConfig,
): Record<string, string> {
  const updateFields: Record<string, string> = {};
  if (row.description.action === 'write' && isEmptyFieldValue(freshFields[DESCRIPTION_FIELD_ID])) {
    updateFields[DESCRIPTION_FIELD_ID] = row.description.value;
  }
  const acReadOrder = [fieldConfig.acWriteFieldId, ...fieldConfig.acReadFieldIds];
  const isAcStillEmpty = acReadOrder.every((fieldId) => isEmptyFieldValue(freshFields[fieldId]));
  if (row.acceptanceCriteria.action === 'write' && isAcStillEmpty) {
    updateFields[fieldConfig.acWriteFieldId] = row.acceptanceCriteria.value;
  }
  return updateFields;
}

/** A short, human label for one field decision, used in the preview table. */
export function describeFieldDecision(decision: FieldDecision): string {
  switch (decision.action) {
    case 'write': return `Fill from ${decision.sourceKey} (${decision.tierName})`;
    case 'has-content': return 'Already filled';
    case 'ambiguous': return `Skipped: ${decision.tierName} issues disagree (${decision.candidateKeys.join(', ')})`;
    case 'no-source': return 'No source found';
  }
}
