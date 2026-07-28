// piDeliveryJira.ts — Builds the Jira write payloads for a planned delivery Story (spec 032, US2). ADDITIVE
// to 028's piPlanJira: it writes a Story that bridges repos plus ONE coding sub-task per repo (each carrying
// its repo on the components field), a single SL-test sub-task, and per-story INT/REL/PROD deploy sub-tasks.
// The payload builders are PURE (no I/O) so they are fully unit-testable; the apply function delegates every
// actual write to the existing createIssue primitive. Called only for accepted items.

import { createIssue, jiraGet, jiraPost } from '../../../services/jiraApi.ts';
import { saveFeatureReviewStoryPoints } from '../../SprintDashboard/featureReviewFixes.ts';
import type { CreateIssueRequest } from '../../../types/jira.ts';
import type { PlannedStory } from './piDeliveryEngine.ts';
import type { ScaffoldSubtask } from './piPlanRepoSubtasks.ts';
import type { DatedItem, SubTaskKind } from './piPlanTypes.ts';

/** The per-story deploy checkpoints and the date each one carries (SL test uses the internal-test end). */
const CHECKPOINT_SPEC: { kind: SubTaskKind; label: string; dateOf: (dates: DatedItem) => string | null }[] = [
  { kind: 'slTest', label: '[SL] SL Test', dateOf: (dates) => dates.internalTestEndIso },
  { kind: 'deployInt', label: '[INT] Deploy', dateOf: (dates) => dates.deployIntIso },
  { kind: 'deployRel', label: '[REL] Deploy', dateOf: (dates) => dates.deployRelIso },
  { kind: 'deployProd', label: '[PROD] Deploy', dateOf: (dates) => dates.dueIso },
];

/** Everything the delivery write flow needs about the target project, fields, and issue types. */
export interface DeliveryWriteContext {
  projectKey: string;
  storyIssueTypeId: string;
  subTaskIssueTypeId: string;
  /** Custom field ids discovered by name (never hardcoded). */
  fieldIds: { featureLink: string; targetStart: string; targetEnd: string };
  /** Roster display name → Jira accountId, to set assignees. Absent ⇒ assignee left unset. */
  accountIdByDisplayName?: Record<string, string>;
  /** Board sprints already present, name → id, for sprint assignment. */
  existingSprintIdByName?: Record<string, number>;
}

/** The payloads for one planned Story: the Story create + its coding/SL/deploy sub-task creates, in order. */
export interface DeliveryWriteRequests {
  storyRequest: CreateIssueRequest;
  subtaskRequests: CreateIssueRequest[];
}

/** Resolves an assignee display name to the `{ accountId }` field value, or undefined when unknown. */
function assigneeField(displayName: string | null, context: DeliveryWriteContext): { accountId: string } | undefined {
  const accountId = displayName ? context.accountIdByDisplayName?.[displayName] : undefined;
  return accountId ? { accountId } : undefined;
}

/** Builds the Story create payload (Feature link, Target Start/End, and the primary owner when known). */
export function buildDeliveryStoryRequest(story: PlannedStory, context: DeliveryWriteContext): CreateIssueRequest {
  const fields: Record<string, unknown> = {
    project: { key: context.projectKey },
    issuetype: { id: context.storyIssueTypeId },
    summary: story.summary,
    [context.fieldIds.featureLink]: story.featureKey,
    [context.fieldIds.targetStart]: story.dates.targetStartIso,
    [context.fieldIds.targetEnd]: story.dates.targetEndIso,
  };
  if (story.dates.dueIso) {
    fields.duedate = story.dates.dueIso;
  }
  // Stamp the fixVersion the process determined (the release covering the Story's PROD/Due date).
  if (story.fixVersionName) {
    fields.fixVersions = [{ name: story.fixVersionName }];
  }
  // The Story's primary owner defaults to the first coding sub-task's assignee.
  const primaryOwner = assigneeField(story.codingSubtasks[0]?.assignee ?? null, context);
  if (primaryOwner) {
    fields.assignee = primaryOwner;
  }
  return { fields };
}

/** Builds one coding sub-task create — carrying its repo on the components field and its own assignee. */
export function buildCodingSubtaskRequest(
  story: PlannedStory,
  codingIndex: number,
  parentKey: string,
  context: DeliveryWriteContext,
): CreateIssueRequest {
  const coding = story.codingSubtasks[codingIndex];
  const fields: Record<string, unknown> = {
    project: { key: context.projectKey },
    issuetype: { id: context.subTaskIssueTypeId },
    parent: { key: parentKey },
    summary: `[${coding.repoName}] ${story.summary}`,
  };
  if (coding.repoComponentId) {
    fields.components = [{ id: coding.repoComponentId }];
  }
  const owner = assigneeField(coding.assignee, context);
  if (owner) {
    fields.assignee = owner;
  }
  return { fields };
}

/** Builds one SL-test or deploy checkpoint sub-task create, carrying its cadence date as the due date. */
export function buildCheckpointRequest(
  story: PlannedStory,
  spec: (typeof CHECKPOINT_SPEC)[number],
  parentKey: string,
  context: DeliveryWriteContext,
): CreateIssueRequest {
  const fields: Record<string, unknown> = {
    project: { key: context.projectKey },
    issuetype: { id: context.subTaskIssueTypeId },
    parent: { key: parentKey },
    summary: `${spec.label} — ${story.summary}`,
  };
  const dueDate = spec.dateOf(story.dates);
  if (dueDate) {
    fields.duedate = dueDate;
  }
  if (spec.kind === 'slTest' && story.slAssignee) {
    const owner = assigneeField(story.slAssignee, context);
    if (owner) {
      fields.assignee = owner;
    }
  }
  return { fields };
}

/**
 * Builds all write payloads for one planned Story (Story + coding sub-tasks + SL-test + deploys). Pure — no
 * I/O — using a placeholder parent key so the sub-task shapes can be asserted before any real create runs.
 */
export function buildDeliveryWriteRequests(story: PlannedStory, context: DeliveryWriteContext, parentKey = story.tempId): DeliveryWriteRequests {
  const storyRequest = buildDeliveryStoryRequest(story, context);
  const codingRequests = story.codingSubtasks.map((_coding, index) => buildCodingSubtaskRequest(story, index, parentKey, context));
  const checkpointRequests = CHECKPOINT_SPEC.map((spec) => buildCheckpointRequest(story, spec, parentKey, context));
  return { storyRequest, subtaskRequests: [...codingRequests, ...checkpointRequests] };
}

/**
 * Builds the create payload for one gap-fill sub-task under an EXISTING carryover Story (no dates — carryover
 * work is not re-scheduled). A coding gap carries its repo on the components field; a checkpoint gap is a
 * bare sub-task with its conventional summary.
 */
export function buildGapSubtaskRequest(gap: ScaffoldSubtask, parentStoryKey: string, context: DeliveryWriteContext): CreateIssueRequest {
  const fields: Record<string, unknown> = {
    project: { key: context.projectKey },
    issuetype: { id: context.subTaskIssueTypeId },
    parent: { key: parentStoryKey },
    summary: gap.summary,
  };
  if (gap.kind === 'coding' && gap.repo?.repoComponentId) {
    fields.components = [{ id: gap.repo.repoComponentId }];
  }
  return { fields };
}

/** A minimal Jira issue as returned by a summary-only search — used by the idempotency look-ups below. */
interface SummaryIssue { key: string; fields?: { summary?: string } }

/**
 * Picks the key of an already-created Story whose summary exactly matches the one we are about to write, so a
 * retried commit reuses it instead of creating a duplicate. Pure (search results in → key out) and trimmed-match
 * to tolerate incidental whitespace. Returns null when no existing Story matches.
 */
export function pickExistingStoryKey(issues: readonly SummaryIssue[], targetSummary: string): string | null {
  const wanted = targetSummary.trim();
  const match = issues.find((issue) => (issue.fields?.summary ?? '').trim() === wanted);
  return match ? match.key : null;
}

/** Keeps only the sub-task create requests whose summary is NOT already present among a Story's children. */
export function selectUncreatedSubtasks(
  requests: readonly CreateIssueRequest[],
  existingChildSummaries: ReadonlySet<string>,
): CreateIssueRequest[] {
  return requests.filter((request) => !existingChildSummaries.has(String((request.fields as Record<string, unknown>).summary ?? '').trim()));
}

/** Reads the summaries of an issue's existing sub-task children (for dedupe), as a trimmed set. */
async function fetchChildSummaries(parentKey: string): Promise<Set<string>> {
  const jql = `parent = ${parentKey}`;
  const path = `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=summary&maxResults=200`;
  const issues = (await jiraGet<{ issues?: SummaryIssue[] }>(path)).issues ?? [];
  return new Set(issues.map((issue) => (issue.fields?.summary ?? '').trim()));
}

/** Finds an already-created Story under the same Feature with the same summary (retry idempotency), or null. */
async function findExistingStoryKey(story: PlannedStory, context: DeliveryWriteContext): Promise<string | null> {
  const fieldNumber = context.fieldIds.featureLink.replace('customfield_', '');
  const jql = `cf[${fieldNumber}] = "${story.featureKey}" AND issuetype = ${context.storyIssueTypeId}`;
  const path = `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=summary&maxResults=100`;
  const issues = (await jiraGet<{ issues?: SummaryIssue[] }>(path)).issues ?? [];
  return pickExistingStoryKey(issues, story.summary);
}

/** Creates the missing sub-tasks under an existing carryover Story, delegating each write to createIssue. */
export async function applyCarryoverGaps(
  parentStoryKey: string,
  gapSubtasks: ScaffoldSubtask[],
  context: DeliveryWriteContext,
): Promise<{ createdCount: number }> {
  for (const gap of gapSubtasks) {
    await createIssue(buildGapSubtaskRequest(gap, parentStoryKey, context));
  }
  return { createdCount: gapSubtasks.length };
}

/**
 * Applies one accepted Story, IDEMPOTENTLY so a retried commit never duplicates. First it looks for a Story
 * already created under this Feature with the same summary: if found it reuses that key (skipping the create,
 * points, and sprint assignment); otherwise it creates the Story, sets its points, and assigns its sprint.
 * Either way it then creates only the sub-tasks that do not already exist under the Story (matched by summary),
 * so a commit that partially failed can be safely re-run to fill in what is missing. Delegates every write to
 * an existing primitive.
 */
export async function applyDeliveryStory(
  story: PlannedStory,
  context: DeliveryWriteContext,
): Promise<{ storyKey: string; reused: boolean; createdSubtaskCount: number }> {
  const existingKey = await findExistingStoryKey(story, context);
  let storyKey: string;
  const reused = existingKey !== null;
  if (existingKey !== null) {
    storyKey = existingKey;
  } else {
    const { storyRequest } = buildDeliveryWriteRequests(story, context);
    const created = await createIssue(storyRequest);
    storyKey = created.key;
    await saveFeatureReviewStoryPoints(storyKey, String(story.sizePoints));
    const sprintId = context.existingSprintIdByName?.[story.sprintName];
    if (sprintId != null) {
      await jiraPost(`/rest/agile/1.0/sprint/${sprintId}/issue`, { issues: [storyKey] });
    }
  }
  // Create only the sub-tasks the Story is missing, so a re-run tops up rather than duplicates.
  const existingChildSummaries = await fetchChildSummaries(storyKey);
  const { subtaskRequests } = buildDeliveryWriteRequests(story, context, storyKey);
  const toCreate = selectUncreatedSubtasks(subtaskRequests, existingChildSummaries);
  for (const request of toCreate) {
    await createIssue(request);
  }
  return { storyKey, reused, createdSubtaskCount: toCreate.length };
}
