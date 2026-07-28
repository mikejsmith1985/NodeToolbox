// piDeliveryJira.ts — Builds the Jira write payloads for a planned delivery Story (spec 032, US2). ADDITIVE
// to 028's piPlanJira: it writes a Story that bridges repos plus ONE coding sub-task per repo (each carrying
// its repo on the components field), a single SL-test sub-task, and per-story INT/REL/PROD deploy sub-tasks.
// The payload builders are PURE (no I/O) so they are fully unit-testable; the apply function delegates every
// actual write to the existing createIssue primitive. Called only for accepted items.

import { createIssue, jiraPost } from '../../../services/jiraApi.ts';
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
 * Applies one accepted Story: creates the Story, sets its points, assigns its sprint, then creates each
 * sub-task under the real Story key. Delegates every write to an existing primitive.
 */
export async function applyDeliveryStory(story: PlannedStory, context: DeliveryWriteContext): Promise<{ storyKey: string }> {
  const { storyRequest } = buildDeliveryWriteRequests(story, context);
  const created = await createIssue(storyRequest);
  await saveFeatureReviewStoryPoints(created.key, String(story.sizePoints));
  const sprintId = context.existingSprintIdByName?.[story.sprintName];
  if (sprintId != null) {
    await jiraPost(`/rest/agile/1.0/sprint/${sprintId}/issue`, { issues: [created.key] });
  }
  const { subtaskRequests } = buildDeliveryWriteRequests(story, context, created.key);
  for (const request of subtaskRequests) {
    await createIssue(request);
  }
  return { storyKey: created.key };
}
