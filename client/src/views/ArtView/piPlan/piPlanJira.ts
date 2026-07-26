// piPlanJira.ts — The plan-write orchestration (spec 028, contract jira-writes.md). Every write DELEGATES
// to an existing primitive (createIssue, saveFeatureReviewStoryPoints, saveFeatureReviewFixVersion,
// jiraPost for sprint assignment); the only new behavior is creating a Story under a Feature and
// Sub-tasks with a `parent`. Called ONLY for accepted items; a `dryRun` returns payloads without writing.

import { createIssue, jiraPost } from '../../../services/jiraApi.ts';
import { saveFeatureReviewFixVersion, saveFeatureReviewStoryPoints } from '../../SprintDashboard/featureReviewFixes.ts';
import type { CreateIssueRequest } from '../../../types/jira.ts';
import type { PiPlanFieldIds } from './piPlanFields.ts';
import type { DatedItem, PlanItemProposal, ScheduledStory, SubTaskKind } from './piPlanTypes.ts';

/** Human-facing prefix + the date field each sub-task kind carries, keyed by kind. */
const SUBTASK_SPEC: Record<SubTaskKind, { label: string; dateOf: (dates: DatedItem) => string | null }> = {
  internalTest: { label: '[IT] Internal Test', dateOf: (dates) => dates.internalTestEndIso },
  deployInt: { label: '[INT] Deploy to INT', dateOf: (dates) => dates.deployIntIso },
  deployRel: { label: '[REL] Deploy to REL', dateOf: (dates) => dates.deployRelIso },
  deployProd: { label: '[PROD] Deploy to PROD', dateOf: (dates) => dates.dueIso },
};

/** Everything the write flow needs about the target project, board, fields, and issue types. */
export interface WriteContext {
  projectKey: string;
  boardId: number;
  fieldIds: PiPlanFieldIds;
  storyIssueTypeId: string;
  subTaskIssueTypeId: string;
  /** Board sprints already present, by name → id (reused; creation of missing sprints is US4). */
  existingSprintIdByName: Record<string, number>;
  /** Roster display name → Jira accountId, to set the assignee. Absent ⇒ assignee left unset. */
  accountIdByDisplayName?: Record<string, string>;
  dryRun?: boolean;
}

/** The outcome of applying one Story: the payloads built and, when not a dry run, the created key. */
export interface ApplyResult {
  skipped: boolean;
  dryRun: boolean;
  storyRequest: CreateIssueRequest | null;
  subtaskRequests: CreateIssueRequest[];
  storyKey?: string;
}

/** Builds the create payload for a Story under its Feature, with dates and (when known) its assignee. */
export function buildStoryCreateRequest(story: ScheduledStory, dates: DatedItem, context: WriteContext): CreateIssueRequest {
  const fields: Record<string, unknown> = {
    project: { key: context.projectKey },
    issuetype: { id: context.storyIssueTypeId },
    summary: story.summary,
    [context.fieldIds.featureLink]: story.featureKey,
    [context.fieldIds.targetStart]: dates.targetStartIso,
    [context.fieldIds.targetEnd]: dates.targetEndIso,
  };
  if (dates.dueIso) {
    fields.duedate = dates.dueIso;
  }
  const accountId = story.assignee ? context.accountIdByDisplayName?.[story.assignee] : undefined;
  if (accountId) {
    fields.assignee = { accountId };
  }
  return { fields };
}

/** Builds the create payload for one Sub-task under a Story, carrying its cadence date as the due date. */
export function buildSubtaskCreateRequest(
  kind: SubTaskKind,
  parentStoryKey: string,
  story: ScheduledStory,
  dates: DatedItem,
  context: WriteContext,
): CreateIssueRequest {
  const spec = SUBTASK_SPEC[kind];
  const fields: Record<string, unknown> = {
    project: { key: context.projectKey },
    issuetype: { id: context.subTaskIssueTypeId },
    parent: { key: parentStoryKey },
    summary: `${spec.label} — ${story.summary}`,
  };
  const dueDate = spec.dateOf(dates);
  if (dueDate) {
    fields.duedate = dueDate;
  }
  return { fields };
}

/** The sub-task kinds a Story gets — internal test only when it has testable output. */
function subtaskKindsFor(story: ScheduledStory): SubTaskKind[] {
  const deploys: SubTaskKind[] = ['deployInt', 'deployRel', 'deployProd'];
  return story.hasTestableOutput ? ['internalTest', ...deploys] : deploys;
}

/**
 * Applies one accepted Story and its sub-tasks. Skips an item already present (idempotency, FR-055).
 * On a dry run, returns the built payloads and writes nothing; otherwise creates the Story, sets points
 * and fixVersion, assigns the sprint, and creates each sub-task under the new Story key.
 */
export async function applyStoryPlan(
  storyItem: PlanItemProposal,
  context: WriteContext,
): Promise<ApplyResult> {
  const story = storyItem.payload as ScheduledStory;
  const dates = storyItem.dates as DatedItem;

  if (storyItem.status === 'existing') {
    return { skipped: true, dryRun: !!context.dryRun, storyRequest: null, subtaskRequests: [] };
  }

  const storyRequest = buildStoryCreateRequest(story, dates, context);
  const subtaskKinds = subtaskKindsFor(story);

  if (context.dryRun) {
    const subtaskRequests = subtaskKinds.map((kind) => buildSubtaskCreateRequest(kind, story.tempId, story, dates, context));
    return { skipped: false, dryRun: true, storyRequest, subtaskRequests };
  }

  const created = await createIssue(storyRequest);
  await saveFeatureReviewStoryPoints(created.key, String(story.sizePoints));
  const fixVersionName = fixVersionForStory(story, dates, context);
  if (fixVersionName) {
    await saveFeatureReviewFixVersion(created.key, fixVersionName);
  }
  await assignToSprint(created.key, story.sprintName, context);
  const subtaskRequests = subtaskKinds.map((kind) => buildSubtaskCreateRequest(kind, created.key, story, dates, context));
  for (const request of subtaskRequests) {
    await createIssue(request);
  }
  return { skipped: false, dryRun: false, storyRequest, subtaskRequests, storyKey: created.key };
}

/** The production release a Story delivers into — used only to stamp the Story's fixVersion. */
function fixVersionForStory(story: ScheduledStory, _dates: DatedItem, _context: WriteContext): string | null {
  return null; // fixVersion selection is refined in US5; Story create omits it until then.
}

/** Places the created Story in its planned sprint when that sprint already exists on the board. */
async function assignToSprint(issueKey: string, sprintName: string, context: WriteContext): Promise<void> {
  const sprintId = context.existingSprintIdByName[sprintName];
  if (sprintId != null) {
    await jiraPost(`/rest/agile/1.0/sprint/${sprintId}/issue`, { issues: [issueKey] });
  }
}
