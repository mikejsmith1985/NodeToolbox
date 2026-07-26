// featureChildren.ts — Reads a Feature's already-present child Stories and each Story's sub-tasks so the
// planner can recognise them and never propose a duplicate (spec 028, US6, FR-055). Read-only. This is
// the one small gap the codebase lacked (no existing fetch requests `subtasks` or traverses child Stories).

import { jiraGet } from '../../../services/jiraApi.ts';
import type { ExistingChild, SubTaskKind } from './piPlanTypes.ts';

const CHILD_SEARCH_PAGE_SIZE = 100;

/** The minimal Jira search shape we read (extra fields are ignored). */
interface ChildSearchResponse {
  issues?: Array<{
    key: string;
    fields?: {
      summary?: string;
      issuetype?: { name?: string };
      subtasks?: Array<{ key: string; fields?: { summary?: string } }>;
    };
  }>;
}

/** Classifies a sub-task by the summary prefix the planner stamps on the ones it creates. */
export function classifySubtask(summary: string): SubTaskKind | 'unknown' {
  if (/^\[IT\]/i.test(summary)) return 'internalTest';
  if (/^\[INT\]/i.test(summary)) return 'deployInt';
  if (/^\[REL\]/i.test(summary)) return 'deployRel';
  if (/^\[PROD\]/i.test(summary)) return 'deployProd';
  return 'unknown';
}

/**
 * Fetches the Feature's child Stories (via the feature-link JQL reference) and each Story's sub-tasks,
 * flattened and classified into ExistingChild records for idempotency matching.
 */
export async function fetchFeatureChildren(featureKey: string, featureLinkJqlRef: string): Promise<ExistingChild[]> {
  const jql = `${featureLinkJqlRef} = "${featureKey}"`;
  const encoded = encodeURIComponent(jql);
  const response = await jiraGet<ChildSearchResponse>(
    `/rest/api/2/search?jql=${encoded}&fields=summary,issuetype,subtasks&maxResults=${CHILD_SEARCH_PAGE_SIZE}`,
  );

  const children: ExistingChild[] = [];
  (response.issues ?? []).forEach((issue) => {
    const summary = issue.fields?.summary ?? '';
    children.push({ key: issue.key, kind: 'story', parentKey: featureKey, summary });
    (issue.fields?.subtasks ?? []).forEach((subtask) => {
      const subtaskSummary = subtask.fields?.summary ?? '';
      children.push({ key: subtask.key, kind: classifySubtask(subtaskSummary), parentKey: issue.key, summary: subtaskSummary });
    });
  });
  return children;
}
