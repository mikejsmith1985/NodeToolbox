// releasePriorityApply.ts — The two Jira round trips around a release ranking: reading the signals
// the prompt needs, and writing the accepted order into Status Summary.
//
// The Releases tab already holds each release's issues, but its fetch asks for neither `created`
// nor `duedate` nor the Status Summary field, and it never reads the linked Features' dates at all.
// Rather than widen a fetch every other release feature shares, this module asks for exactly the
// extra fields the ranking needs, in two `key in (…)` requests: one for the issues, one for their
// Features. Every field id comes from `jiraFieldMapping.ts` — nothing here names a customfield.
//
// Writes go through the SAME writers the Feature Review quick fixes use. The Status Summary field
// may be plain text on one Jira and a select list on another, so the writer is chosen from the
// field's edit metadata rather than assumed — a text value PUT into a select field is a 400 that
// looks, from the panel, like Jira refusing the whole idea.

import { jiraGet } from '../../../services/jiraApi.ts';
import { resolveConfiguredFieldIds, resolveWriteFieldId } from '../../../services/jiraFieldMapping.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { escapeJqlValue } from '../../../utils/jqlValue.ts';
import {
  fetchFeatureReviewEditMeta,
  saveFeatureReviewOptionField,
  saveFeatureReviewSimpleField,
  type FeatureReviewEditMetaField,
} from '../featureReviewFixes.ts';
import type { StatusSummaryPlanEntry } from './releasePriorityRank.ts';

/** The field ids one ranking run reads and writes, resolved once from the mapping. */
export interface ReleasePriorityFieldIds {
  /** Where the accepted order is written. */
  statusSummaryFieldId: string;
  /** Every field a Feature's target end may sit in, most authoritative first. */
  featureTargetEndFieldIds: string[];
}

/** The per-issue signals the release fetch does not carry. */
export interface IssuePriorityContext {
  createdIso: string | null;
  dueDateIso: string | null;
  currentStatusSummary: string | null;
}

/** The dates on a linked Feature that can move its children up the list. */
export interface FeaturePriorityContext {
  targetEndIso: string | null;
  dueDateIso: string | null;
}

export interface ReleasePriorityContext {
  issueContextByKey: Map<string, IssuePriorityContext>;
  featureContextByKey: Map<string, FeaturePriorityContext>;
}

/** What happened to one write, so a partial success is reported row by row rather than rounded. */
export interface StatusSummaryWriteOutcome {
  issueKey: string;
  value: string;
  isWritten: boolean;
  errorMessage: string | null;
}

/** The Jira calls a write run makes. Injected so the sequencing is testable without Jira. */
export interface StatusSummaryWriters {
  readEditMeta: (issueKey: string) => Promise<Record<string, FeatureReviewEditMetaField | undefined>>;
  writeSimple: (issueKey: string, fieldId: string, value: string) => Promise<void>;
  writeOption: (
    issueKey: string,
    fieldId: string,
    value: string,
    editMetaField: FeatureReviewEditMetaField | undefined,
  ) => Promise<void>;
}

/** A Jira search response, narrowed to what these fetches read. */
interface JiraSearchResponse {
  issues?: JiraIssue[];
}

type FetchJson = <ResponseBody>(path: string) => Promise<ResponseBody>;

const DEFAULT_WRITERS: StatusSummaryWriters = {
  readEditMeta: fetchFeatureReviewEditMeta,
  writeSimple: saveFeatureReviewSimpleField,
  writeOption: saveFeatureReviewOptionField,
};

// ── Field ids ──

/** Resolves the ids this run needs from the one mapping every other reader consults. */
export function resolveReleasePriorityFieldIds(storage: Storage): ReleasePriorityFieldIds {
  return {
    statusSummaryFieldId: resolveWriteFieldId('statusSummaryFieldId', storage),
    featureTargetEndFieldIds: resolveConfiguredFieldIds('piReviewTargetEndFieldId', storage),
  };
}

// ── Reading ──

/** The search path for a set of keys and a set of fields. Exported so the exact query is testable. */
export function buildKeysSearchPath(issueKeys: readonly string[], fields: readonly string[]): string {
  const keyList = issueKeys.map((issueKey) => `"${escapeJqlValue(issueKey)}"`).join(',');
  return `/rest/api/2/search?jql=${encodeURIComponent(`key in (${keyList})`)}`
    + `&maxResults=${issueKeys.length}&fields=${fields.join(',')}`;
}

/**
 * Reads a field as text whatever shape Jira returned it in: a plain string, a select option
 * (`{value}`), a named object (`{name}`), or a number. Blank reads as nothing.
 */
export function readFieldText(rawValue: unknown): string | null {
  if (typeof rawValue === 'string') return rawValue.trim() === '' ? null : rawValue.trim();
  if (typeof rawValue === 'number') return String(rawValue);
  if (typeof rawValue === 'object' && rawValue !== null) {
    const record = rawValue as { value?: unknown; name?: unknown };
    return readFieldText(record.value ?? record.name ?? null);
  }
  return null;
}

/** The first non-empty value across the candidate fields, in the order the mapping ranks them. */
function readFirstFieldText(fields: Record<string, unknown>, fieldIds: readonly string[]): string | null {
  for (const fieldId of fieldIds) {
    const fieldText = readFieldText(fields[fieldId]);
    if (fieldText !== null) return fieldText;
  }
  return null;
}

async function fetchIssueContexts(
  issueKeys: readonly string[],
  statusSummaryFieldId: string,
  fetchJson: FetchJson,
): Promise<Map<string, IssuePriorityContext>> {
  if (issueKeys.length === 0) return new Map();
  const response = await fetchJson<JiraSearchResponse>(
    buildKeysSearchPath(issueKeys, ['created', 'duedate', statusSummaryFieldId]),
  );
  return new Map((response.issues ?? []).map((issue) => {
    const fields = issue.fields as Record<string, unknown>;
    return [issue.key, {
      createdIso: readFieldText(fields.created),
      dueDateIso: readFieldText(fields.duedate),
      currentStatusSummary: readFieldText(fields[statusSummaryFieldId]),
    }];
  }));
}

async function fetchFeatureContexts(
  featureKeys: readonly string[],
  targetEndFieldIds: readonly string[],
  fetchJson: FetchJson,
): Promise<Map<string, FeaturePriorityContext>> {
  if (featureKeys.length === 0) return new Map();
  const response = await fetchJson<JiraSearchResponse>(
    buildKeysSearchPath(featureKeys, ['duedate', ...targetEndFieldIds]),
  );
  return new Map((response.issues ?? []).map((issue) => {
    const fields = issue.fields as Record<string, unknown>;
    return [issue.key, {
      targetEndIso: readFirstFieldText(fields, targetEndFieldIds),
      dueDateIso: readFieldText(fields.duedate),
    }];
  }));
}

/**
 * Reads everything the ranking prompt needs that the release fetch did not carry, in two requests.
 * A failure here is the caller's to surface — the prompt can still be built with ages unknown, but
 * the person should know the assistant is ranking with less than it could have had.
 */
export async function fetchReleasePriorityContext(
  issueKeys: readonly string[],
  featureKeys: readonly string[],
  fieldIds: ReleasePriorityFieldIds,
  fetchJson: FetchJson = jiraGet,
): Promise<ReleasePriorityContext> {
  const [issueContextByKey, featureContextByKey] = await Promise.all([
    fetchIssueContexts(issueKeys, fieldIds.statusSummaryFieldId, fetchJson),
    fetchFeatureContexts(featureKeys, fieldIds.featureTargetEndFieldIds, fetchJson),
  ]);
  return { issueContextByKey, featureContextByKey };
}

// ── Writing ──

/**
 * The Status Summary field's edit metadata, read once from the first issue in the plan.
 *
 * Null when it cannot be read: the write still goes ahead as plain text, because an unreadable
 * edit screen is not evidence the field is a select list, and refusing would block the common case
 * to guard the rare one.
 */
async function readStatusSummaryEditMeta(
  firstIssueKey: string,
  fieldId: string,
  writers: StatusSummaryWriters,
): Promise<FeatureReviewEditMetaField | null> {
  try {
    const editMetaByFieldId = await writers.readEditMeta(firstIssueKey);
    return editMetaByFieldId[fieldId] ?? null;
  } catch {
    return null;
  }
}

/** A field with allowed values is a select list and must be written as an option, not as text. */
function isSelectField(editMetaField: FeatureReviewEditMetaField | null): boolean {
  return (editMetaField?.allowedValues?.length ?? 0) > 0;
}

/**
 * Writes the accepted ranking into Jira, one issue at a time, top of the list first.
 *
 * Sequential rather than parallel on purpose: fifty simultaneous PUTs is how a Jira starts
 * answering 429, and the order the writes land in is the order a person watching the progress
 * expects. A failure is recorded and the run CONTINUES — the rows that succeeded are correct, and
 * the ones that did not are named, which beats an all-or-nothing that leaves nothing written.
 */
export async function writeStatusSummaryPlan(
  plan: readonly StatusSummaryPlanEntry[],
  fieldId: string,
  onOutcome?: (outcome: StatusSummaryWriteOutcome) => void,
  writers: StatusSummaryWriters = DEFAULT_WRITERS,
): Promise<StatusSummaryWriteOutcome[]> {
  if (plan.length === 0) return [];

  const editMetaField = await readStatusSummaryEditMeta(plan[0].issueKey, fieldId, writers);
  const shouldWriteAsOption = isSelectField(editMetaField);
  const outcomes: StatusSummaryWriteOutcome[] = [];

  for (const planEntry of plan) {
    const outcome = await writeOneStatusSummary(planEntry, fieldId, shouldWriteAsOption, editMetaField, writers);
    outcomes.push(outcome);
    onOutcome?.(outcome);
  }

  return outcomes;
}

async function writeOneStatusSummary(
  planEntry: StatusSummaryPlanEntry,
  fieldId: string,
  shouldWriteAsOption: boolean,
  editMetaField: FeatureReviewEditMetaField | null,
  writers: StatusSummaryWriters,
): Promise<StatusSummaryWriteOutcome> {
  try {
    if (shouldWriteAsOption) {
      await writers.writeOption(planEntry.issueKey, fieldId, planEntry.value, editMetaField ?? undefined);
    } else {
      await writers.writeSimple(planEntry.issueKey, fieldId, planEntry.value);
    }
    return { issueKey: planEntry.issueKey, value: planEntry.value, isWritten: true, errorMessage: null };
  } catch (caughtError) {
    const errorMessage = caughtError instanceof Error ? caughtError.message : 'Jira rejected the change.';
    return { issueKey: planEntry.issueKey, value: planEntry.value, isWritten: false, errorMessage };
  }
}
