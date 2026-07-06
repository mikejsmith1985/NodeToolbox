// commitJira.ts — Executes an approved Review & Commit diff against Jira in two safe phases.
//
// Phase A reconciles provisional containers into real Jira sprints/versions (creating them and
// backfilling their ids). Phase B then writes the member assignments, points, and priorities.
// This ordering guarantees no assignment ever targets a container that does not yet exist, and
// every write reports its own success/failure so partial failures leave the rest of the plan intact.

import { createSprint, createVersion, jiraPost, jiraPut } from '../../../services/jiraApi.ts';
import { saveFeatureReviewFixVersion, saveFeatureReviewStoryPoints } from '../../SprintDashboard/featureReviewFixes.ts';
import type { CanvasContainer } from '../overlay/overlayModel.ts';
import type { CommitDiffItem } from '../logic/canvasTypes.ts';

/** The outcome of attempting one commit item. */
export interface CommitResult {
  itemId: string;
  status: 'success' | 'failed' | 'skipped';
  message?: string;
}

/** Context the executor needs to resolve provisional containers into real Jira objects. */
export interface CommitContext {
  containers: readonly CanvasContainer[];
  boardId: number | null;
  projectKey: string;
}

/** Resolved real ids for a container after Phase A. */
interface ResolvedContainer {
  sprintId: number | null;
  versionName: string | null;
  createFailed: boolean;
}

/** Assigns one issue to a sprint via the Jira Agile API. */
async function assignIssueToSprint(sprintId: number, issueKey: string): Promise<void> {
  await jiraPost(`/rest/agile/1.0/sprint/${sprintId}/issue`, { issues: [issueKey] });
}

/** Runs Phase A: create every selected provisional container, recording ids or a failure flag. */
async function reconcileContainers(
  selectedItems: readonly CommitDiffItem[],
  context: CommitContext,
  results: CommitResult[],
): Promise<Map<string, ResolvedContainer>> {
  const resolved = new Map<string, ResolvedContainer>();
  for (const container of context.containers) {
    resolved.set(container.id, {
      sprintId: container.provenance.jiraSprintId,
      versionName: container.provenance.jiraVersionName,
      createFailed: false,
    });
  }

  for (const item of selectedItems) {
    if (item.kind !== 'createSprint' && item.kind !== 'createVersion') {
      continue;
    }
    const containerId = item.containerId ?? '';
    try {
      if (item.kind === 'createSprint') {
        const created = await createSprint({ name: String(item.to), originBoardId: context.boardId ?? 0 });
        resolved.set(containerId, { sprintId: created.id, versionName: null, createFailed: false });
      } else {
        const created = await createVersion({ name: String(item.to), project: context.projectKey });
        resolved.set(containerId, { sprintId: null, versionName: created.name, createFailed: false });
      }
      results.push({ itemId: item.id, status: 'success' });
    } catch (error) {
      resolved.set(containerId, { sprintId: null, versionName: null, createFailed: true });
      results.push({ itemId: item.id, status: 'failed', message: error instanceof Error ? error.message : 'Create failed' });
    }
  }
  return resolved;
}

/** Executes one Phase-B assignment/points/priority item, honoring its container dependency. */
async function executeAssignment(
  item: CommitDiffItem,
  resolved: Map<string, ResolvedContainer>,
): Promise<CommitResult> {
  const container = item.containerId ? resolved.get(item.containerId) : undefined;
  if (item.dependsOn && container?.createFailed) {
    return { itemId: item.id, status: 'skipped', message: 'Container creation failed.' };
  }
  try {
    if (item.kind === 'sprintAssign' && container?.sprintId != null && item.issueKey) {
      await assignIssueToSprint(container.sprintId, item.issueKey);
    } else if (item.kind === 'versionAssign' && container?.versionName != null && item.issueKey) {
      await saveFeatureReviewFixVersion(item.issueKey, container.versionName);
    } else if (item.kind === 'pointsSet' && item.issueKey) {
      await saveFeatureReviewStoryPoints(item.issueKey, String(item.to));
    } else if (item.kind === 'prioritySet' && item.issueKey) {
      await jiraPut(`/rest/api/2/issue/${item.issueKey}`, { fields: { priority: { name: String(item.to) } } });
    } else if (item.kind === 'parkComment' && item.issueKey) {
      await jiraPost(`/rest/api/2/issue/${item.issueKey}/comment`, { body: `Parked on Feature Canvas: ${String(item.to)}` });
    } else if (item.kind === 'comment' && item.issueKey) {
      await jiraPost(`/rest/api/2/issue/${item.issueKey}/comment`, { body: String(item.to) });
    } else {
      return { itemId: item.id, status: 'skipped', message: 'Unresolved target.' };
    }
    return { itemId: item.id, status: 'success' };
  } catch (error) {
    return { itemId: item.id, status: 'failed', message: error instanceof Error ? error.message : 'Write failed' };
  }
}

/**
 * Commits the selected diff items to Jira. Only items with `selected === true` are written;
 * container-create items run first, then assignments. Returns a per-item result list.
 */
export async function commitToJira(diff: readonly CommitDiffItem[], context: CommitContext): Promise<CommitResult[]> {
  const selectedItems = diff.filter((item) => item.selected);
  const results: CommitResult[] = [];
  const resolved = await reconcileContainers(selectedItems, context, results);

  for (const item of selectedItems) {
    if (item.kind === 'createSprint' || item.kind === 'createVersion') {
      continue;
    }
    results.push(await executeAssignment(item, resolved));
  }
  return results;
}
