// piPlanFields.ts — Resolves the Jira custom-field ids the planner writes to, REUSING the existing
// name→id discovery (loadHygieneFieldConfig). Returns the single best id per concept with the known
// platform defaults as fallbacks; Due date is Jira-native. No new discovery mechanism is built.

import { jiraGet } from '../../../services/jiraApi.ts';
import { loadHygieneFieldConfig } from '../../Hygiene/checks/hygieneFieldConfig.ts';

const DEFAULT_TARGET_START_FIELD_ID = 'customfield_10101';
const DEFAULT_TARGET_END_FIELD_ID = 'customfield_10102';
const DEFAULT_FEATURE_LINK_FIELD_ID = 'customfield_10108';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';

/** The field ids the plan-write flow needs. Due date is the native `duedate` field, not a custom field. */
export interface PiPlanFieldIds {
  targetStart: string;
  targetEnd: string;
  due: 'duedate';
  featureLink: string;
  programIncrement: string;
}

/** Returns the first id in a discovered list, or the platform default when the instance has none. */
function firstOrDefault(fieldIds: string[] | undefined, fallback: string): string {
  return fieldIds && fieldIds.length > 0 ? fieldIds[0] : fallback;
}

/** Resolves the planner's field ids from the connected instance (admin overrides already applied upstream). */
export async function resolvePiPlanFieldIds(): Promise<PiPlanFieldIds> {
  const config = await loadHygieneFieldConfig();
  return {
    targetStart: firstOrDefault(config.targetStartFieldIds, DEFAULT_TARGET_START_FIELD_ID),
    targetEnd: firstOrDefault(config.targetEndFieldIds, DEFAULT_TARGET_END_FIELD_ID),
    due: 'duedate',
    featureLink: firstOrDefault(config.featureLinkFieldIds, DEFAULT_FEATURE_LINK_FIELD_ID),
    programIncrement: firstOrDefault(config.programIncrementFieldIds, DEFAULT_PI_FIELD_ID),
  };
}

/** One Jira issue type as returned by /rest/api/2/issuetype. */
export interface JiraIssueTypeSummary {
  id: string;
  name: string;
  subtask: boolean;
}

/** The Story + Sub-task issue-type ids the delivery write flow creates against. */
export interface DeliveryIssueTypeIds {
  storyIssueTypeId: string;
  subTaskIssueTypeId: string;
}

/**
 * Picks the Story and Sub-task issue-type ids from a Jira issue-type list. Story prefers a type literally
 * named "Story"; Sub-task prefers a `subtask: true` type named like "Sub-task", then any subtask type. Falls
 * back to the first non-subtask / first subtask type so a non-standard naming still resolves. Pure.
 */
export function pickDeliveryIssueTypeIds(issueTypes: JiraIssueTypeSummary[]): DeliveryIssueTypeIds {
  const named = (name: string) => issueTypes.find((type) => type.name.toLowerCase() === name);
  const story = named('story') ?? issueTypes.find((type) => !type.subtask);
  const subtaskCandidates = issueTypes.filter((type) => type.subtask);
  const subTask = subtaskCandidates.find((type) => /sub-?task/i.test(type.name)) ?? subtaskCandidates[0];
  return {
    storyIssueTypeId: story?.id ?? '',
    subTaskIssueTypeId: subTask?.id ?? '',
  };
}

/** Fetches the instance's issue types and resolves the Story + Sub-task ids the delivery write flow needs. */
export async function resolveDeliveryIssueTypeIds(): Promise<DeliveryIssueTypeIds> {
  const issueTypes = await jiraGet<JiraIssueTypeSummary[]>('/rest/api/2/issuetype');
  return pickDeliveryIssueTypeIds(Array.isArray(issueTypes) ? issueTypes : []);
}
