// forecastAdapters.ts — Turns each surface's own issue shape into the one the engine reads.
//
// The Roll-Up Board and the Today tab arrive at the forecast from opposite directions: the board
// holds fully-routed items with columns, sub-statuses and Feature links, while Today holds hygiene
// findings from a plain Jira search and has no board at all. An engine that insisted on the board's
// shape would have forced Today to fabricate twenty fields it does not have.
//
// So each surface adapts here, and there is still exactly one engine — which is what stops the two
// screens ever disagreeing about a figure they both show.

import { readStoryPointsFromFields } from '../../Hygiene/checks/storyPointsField.ts';
import type { RollupBoardItem } from '../rollupBoard/rollupBoardTypes.ts';
import type { ForecastIssue, ForecastIssueType } from './forecastTypes.ts';

/** Jira status-category names that mean the work is finished. */
const DONE_STATUS_CATEGORY_NAMES = new Set(['done', 'complete', 'completed']);

/** Issue-type names that mean a defect, whatever this instance happens to call it. */
const DEFECT_TYPE_NAMES = new Set(['defect', 'bug']);

/** The minimum a Jira issue must expose for the Today adapter to read it. */
export interface JiraIssueLike {
  key: string;
  fields: Record<string, unknown>;
}

/** True when Jira's own status category says the work is finished. Names never decide this. */
function readIsComplete(statusField: unknown): boolean {
  const status = statusField as { statusCategory?: { name?: string }; name?: string } | undefined;
  const categoryName = (status?.statusCategory?.name ?? status?.name ?? '').trim().toLowerCase();
  return DONE_STATUS_CATEGORY_NAMES.has(categoryName);
}

/** Reads a Jira field as trimmed text, treating blank as absent. */
function readText(fields: Record<string, unknown>, fieldId: string): string | null {
  const rawValue = fields[fieldId];
  return typeof rawValue === 'string' && rawValue.trim() !== '' ? rawValue.trim() : null;
}

/**
 * Reads the Feature this issue delivers, from whichever configured field carries it.
 *
 * Jira returns a Feature link as a bare key on a custom field, or as an object on `parent`. Both
 * shapes are read; anything else yields null, which the assessments treat as "nothing attributes
 * this" rather than guessing a parent.
 */
function readFeatureKey(fields: Record<string, unknown>, fieldIds: readonly string[]): string | null {
  for (const fieldId of fieldIds) {
    const rawValue = fields[fieldId];
    if (typeof rawValue === 'string' && rawValue.trim() !== '') {
      return rawValue.trim();
    }
    const linkedKey = (rawValue as { key?: string } | undefined)?.key;
    if (typeof linkedKey === 'string' && linkedKey.trim() !== '') {
      return linkedKey.trim();
    }
  }
  return null;
}

/** Buckets a Jira issue-type name the way the sizing and chain rules need it. */
function readTypeBucket(typeName: string, isSubtask: boolean): ForecastIssueType {
  if (isSubtask) return 'subtask';
  const normalizedName = typeName.trim().toLowerCase();
  if (DEFECT_TYPE_NAMES.has(normalizedName)) return 'defect';
  return normalizedName === 'story' ? 'story' : 'other';
}

/**
 * Adapts one Roll-Up Board item.
 *
 * The board already carries everything except whether Jira considers the issue finished, which it
 * keeps on the raw issue rather than on the item.
 */
export function adaptBoardItem(item: RollupBoardItem): ForecastIssue {
  return {
    key: item.key,
    summary: item.summary,
    typeBucket: item.typeBucket,
    featureKey: item.featureKey,
    columnId: item.columnId,
    statusName: item.statusName,
    subStatusValue: item.subStatusValue,
    assigneeAccountId: item.assigneeAccountId,
    assigneeDisplayName: item.assigneeDisplayName,
    fixVersionNames: item.fixVersionNames,
    storyPoints: item.storyPoints,
    isComplete: readIsComplete((item.issue.fields as { status?: unknown }).status),
    // The board fetches no changelogs and does not request the Target Start field, so neither is
    // available here. Both are stated as absent rather than guessed.
    actualStartIso: null,
    storedTargetStartIso: null,
  };
}

/** Adapts a whole board. */
export function adaptBoardItems(items: readonly RollupBoardItem[]): ForecastIssue[] {
  return items.map((item) => adaptBoardItem(item));
}

/** Which field ids the Today adapter must read, since it works from a plain Jira issue. */
export interface TodayAdapterFieldIds {
  storyPointsFieldIds: readonly string[];
  subStatusFieldIds: readonly string[];
  targetStartFieldIds: readonly string[];
  /**
   * Where this instance keeps the Feature link.
   *
   * Optional: a caller with no Feature configuration gets issues that claim no Feature, and the
   * Feature-level assessments are simply absent rather than wrong. Supplying it is what lets a
   * surface working from a plain Jira search answer the PI question at all.
   */
  featureLinkFieldIds?: readonly string[];
}

/**
 * Adapts one issue from a hygiene scan.
 *
 * Today has no board, so there is no column to earn credit from: every item is charged at full
 * size. That is stated in the completeness record rather than left for a reader to infer, and it is
 * why the Today figures are conservative rather than wrong.
 *
 * The field ids arrive as arguments. This module never resolves one itself — that belongs to the
 * caller, which already has the resolved hygiene configuration in hand.
 */
export function adaptHygieneIssue(issue: JiraIssueLike, fieldIds: TodayAdapterFieldIds): ForecastIssue {
  const fields = issue.fields;
  const statusField = fields.status as { name?: string } | undefined;
  const issueTypeField = fields.issuetype as { name?: string; subtask?: boolean } | undefined;
  const assigneeField = fields.assignee as { accountId?: string; displayName?: string } | undefined;
  const fixVersionsField = Array.isArray(fields.fixVersions)
    ? fields.fixVersions as Array<{ name?: string }>
    : [];

  const subStatusFieldId = fieldIds.subStatusFieldIds[0];
  const subStatusRaw = subStatusFieldId ? fields[subStatusFieldId] : undefined;
  // A cascading Jira field returns an object with a `value`; a plain select returns a string.
  const subStatusValue = typeof subStatusRaw === 'string'
    ? subStatusRaw
    : (subStatusRaw as { value?: string } | undefined)?.value ?? null;

  return {
    key: issue.key,
    summary: readText(fields, 'summary') ?? '',
    typeBucket: readTypeBucket(issueTypeField?.name ?? '', issueTypeField?.subtask === true),
    // Read from the configured Feature-link field where the caller supplied one. Absent means
    // nothing attributes this issue, which is reported rather than inferred from a chain of links —
    // that fuller resolution belongs to the Roll-Up Board, which fetches what it needs for it.
    featureKey: readFeatureKey(fields, fieldIds.featureLinkFieldIds ?? []),
    // No board, so no column: every item is charged at full size, and completeness says so.
    columnId: '',
    statusName: statusField?.name ?? '',
    subStatusValue: typeof subStatusValue === 'string' && subStatusValue.trim() !== '' ? subStatusValue.trim() : null,
    assigneeAccountId: assigneeField?.accountId ?? null,
    assigneeDisplayName: assigneeField?.displayName ?? null,
    fixVersionNames: fixVersionsField
      .map((fixVersion) => (fixVersion.name ?? '').trim())
      .filter((versionName) => versionName !== ''),
    // Read through the SHARED reader. This instance keeps story points in a SELECT field, so Jira
    // returns { id, value } rather than a number — a local reader that handled only numbers and
    // strings saw all thirty-three estimated issues as unestimated and produced a forecast of
    // nothing at all.
    storyPoints: readStoryPointsFromFields(fields, fieldIds.storyPointsFieldIds),
    isComplete: readIsComplete(fields.status),
    actualStartIso: null,
    storedTargetStartIso: fieldIds.targetStartFieldIds
      .map((fieldId) => readText(fields, fieldId))
      .find((storedValue): storedValue is string => storedValue !== null)?.slice(0, 10) ?? null,
  };
}

/** Adapts a whole hygiene scan's worth of issues. */
export function adaptHygieneIssues(
  issues: readonly JiraIssueLike[],
  fieldIds: TodayAdapterFieldIds,
): ForecastIssue[] {
  return issues.map((issue) => adaptHygieneIssue(issue, fieldIds));
}

/** Every fix version named by any of these issues, de-duplicated and in first-seen order. */
export function collectFixVersionNames(issues: readonly ForecastIssue[]): string[] {
  const seenNames = new Set<string>();
  issues.forEach((issue) => issue.fixVersionNames.forEach((versionName) => seenNames.add(versionName)));
  return [...seenNames];
}
