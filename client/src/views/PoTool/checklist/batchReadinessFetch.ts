// batchReadinessFetch.ts — Loads everything a JQL-wide readiness review needs, in two requests.
//
// Two, not two per Epic: one search for the Epics themselves, and one more for every child of every Epic. A
// twenty-Epic review that made a request per Epic would take long enough that a PO would stop using it, and
// would hammer an instance that is already the slowest thing in the loop.

import { jiraGet } from '../../../services/jiraApi.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import { findChecklistFieldInIssue, type EpicChecklistSource } from './checklistField.ts';
import type { BatchEpic } from './batchReadiness.ts';

/** How many Epics one review covers. Beyond this the report stops being something a person reads in a sitting. */
export const MAX_EPICS_PER_REVIEW = 25;

/** How many children to fetch across the whole batch. */
const MAX_CHILDREN_PER_BATCH = 200;

/** What a JQL review found, including what it had to leave out. */
export interface BatchFetchResult {
  epics: BatchEpic[];
  /** How many issues the query matched in total, which may be more than were reviewed. */
  totalMatching: number;
  /** True when the query matched more than one review covers — said plainly rather than silently truncated. */
  wasTruncated: boolean;
}

/** Reads a string field, tolerating the shapes Jira returns for empty and wrapped values. */
function readFieldAsText(fieldValue: unknown): string {
  if (typeof fieldValue === 'string') {
    return fieldValue;
  }
  if (fieldValue && typeof fieldValue === 'object' && 'value' in fieldValue) {
    const wrappedValue = (fieldValue as { value: unknown }).value;
    return typeof wrappedValue === 'string' ? wrappedValue : '';
  }
  return '';
}

/** One issue as the search returned it. */
interface SearchedIssue {
  key: string;
  fields: Record<string, unknown>;
}

/** Turns one searched issue into the shape the review works from. */
function buildEpicSource(
  issue: SearchedIssue,
  checklistFieldId: string | null,
  acceptanceCriteriaFieldId: string | null,
): EpicChecklistSource & { checklistFieldId: string | null } {
  const issueFields = issue.fields ?? {};
  const statusValue = issueFields.status as { name?: string } | undefined;
  const foundChecklist = findChecklistFieldInIssue(issueFields, checklistFieldId);

  return {
    issueKey: issue.key,
    summary: readFieldAsText(issueFields.summary),
    status: statusValue?.name ?? '',
    // Stripped to plain text: this instance returns rendered HTML, and a prompt carrying
    // `<p dir="auto">` markup spends its budget on markup instead of on the Epic.
    description: normalizeRichTextToPlainText(issueFields.description),
    acceptanceCriteria: acceptanceCriteriaFieldId
      ? normalizeRichTextToPlainText(issueFields[acceptanceCriteriaFieldId])
      : '',
    checklistText: foundChecklist?.text ?? '',
    checklistFieldId: foundChecklist?.fieldId ?? null,
  };
}

/**
 * Fetches every child of the given Epics in ONE query, grouped by parent.
 *
 * Returns nothing rather than failing: an instance that will not answer a `parent in (…)` query should cost the
 * review its delivery evidence, not the whole run.
 */
export async function fetchChildLinesByParent(issueKeys: readonly string[]): Promise<Record<string, string[]>> {
  if (issueKeys.length === 0) {
    return {};
  }
  try {
    const parentClause = `parent in (${issueKeys.join(',')}) ORDER BY key ASC`;
    const searchResult = await jiraGet<{ issues?: SearchedIssue[] }>(
      `/rest/api/2/search?jql=${encodeURIComponent(parentClause)}`
        + `&fields=summary,status,parent&maxResults=${MAX_CHILDREN_PER_BATCH}`,
    );

    const linesByParent: Record<string, string[]> = {};
    (searchResult.issues ?? []).forEach((childIssue) => {
      const parentKey = (childIssue.fields.parent as { key?: string } | undefined)?.key;
      if (!parentKey) {
        return;
      }
      const status = (childIssue.fields.status as { name?: string } | undefined)?.name ?? 'unknown';
      (linesByParent[parentKey] ??= []).push(
        `  ${childIssue.key} — ${status} — ${String(childIssue.fields.summary ?? '')}`,
      );
    });
    return linesByParent;
  } catch {
    return {};
  }
}

/**
 * Runs the query and loads every Epic it returned, with its children.
 *
 * Every field is requested because the checklist is recognised by its own syntax rather than by field name — the
 * same reason the single-Epic review asks for all of them.
 */
export async function fetchEpicsForReview(
  jql: string,
  checklistFieldId: string | null,
  acceptanceCriteriaFieldId: string | null,
): Promise<BatchFetchResult & { checklistFieldIdByIssueKey: Record<string, string | null> }> {
  const searchResult = await jiraGet<{ issues?: SearchedIssue[]; total?: number }>(
    `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=*all&maxResults=${MAX_EPICS_PER_REVIEW}`,
  );
  const foundIssues = searchResult.issues ?? [];
  const totalMatching = searchResult.total ?? foundIssues.length;

  const epicSources = foundIssues.map(
    (issue) => buildEpicSource(issue, checklistFieldId, acceptanceCriteriaFieldId),
  );
  const childLinesByParent = await fetchChildLinesByParent(epicSources.map((source) => source.issueKey));

  return {
    epics: epicSources.map((source) => ({
      source,
      childSummaryLines: childLinesByParent[source.issueKey] ?? [],
    })),
    totalMatching,
    wasTruncated: totalMatching > foundIssues.length,
    checklistFieldIdByIssueKey: Object.fromEntries(
      epicSources.map((source) => [source.issueKey, source.checklistFieldId]),
    ),
  };
}
