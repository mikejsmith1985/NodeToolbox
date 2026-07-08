// commitJira.test.ts — Verifies the two-phase commit executor against mocked Jira writers.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSprint, jiraPost, jiraPut } from '../../../services/jiraApi.ts';
import { saveFeatureReviewStoryPoints } from '../../SprintDashboard/featureReviewFixes.ts';
import type { CanvasContainer } from '../overlay/overlayModel.ts';
import type { CommitDiffItem } from '../logic/canvasTypes.ts';
import { commitToJira } from './commitJira.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  createSprint: vi.fn(),
  createVersion: vi.fn(),
  jiraPost: vi.fn(),
  jiraPut: vi.fn(),
}));
vi.mock('../../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewFixVersion: vi.fn(),
  saveFeatureReviewStoryPoints: vi.fn(),
}));

function provisionalSprintContainer(): CanvasContainer {
  return {
    id: 'ctr-p', kind: 'sprint', title: 'Sprint 25', bounds: { x: 0, y: 0, width: 400, height: 300 },
    capacityBudget: 20,
    provenance: { state: 'provisional', jiraSprintId: null, jiraVersionName: null, startDateIso: null, endDateIso: null },
  };
}

const CREATE_ITEM: CommitDiffItem = { id: 'create:ctr-p', kind: 'createSprint', issueKey: null, containerId: 'ctr-p', from: null, to: 'Sprint 25', dependsOn: null, selected: true };
const ASSIGN_ITEM: CommitDiffItem = { id: 'a1', kind: 'sprintAssign', issueKey: 'DENP-2', containerId: 'ctr-p', from: null, to: 'Sprint 25', dependsOn: 'create:ctr-p', selected: true };

describe('commitToJira', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a provisional sprint first, then assigns the story to the returned id', async () => {
    vi.mocked(createSprint).mockResolvedValue({ id: 456, name: 'Sprint 25' });
    vi.mocked(jiraPost).mockResolvedValue(undefined as never);

    const results = await commitToJira([CREATE_ITEM, ASSIGN_ITEM], { containers: [provisionalSprintContainer()], boardId: 10, projectKey: 'DENP' });

    expect(createSprint).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sprint 25', originBoardId: 10 }));
    expect(jiraPost).toHaveBeenCalledWith('/rest/agile/1.0/sprint/456/issue', { issues: ['DENP-2'] });
    expect(results.every((result) => result.status === 'success')).toBe(true);
  });

  it('skips an assignment whose container creation failed', async () => {
    vi.mocked(createSprint).mockRejectedValue(new Error('boom'));

    const results = await commitToJira([CREATE_ITEM, ASSIGN_ITEM], { containers: [provisionalSprintContainer()], boardId: 10, projectKey: 'DENP' });

    expect(results.find((result) => result.itemId === 'create:ctr-p')?.status).toBe('failed');
    expect(results.find((result) => result.itemId === 'a1')?.status).toBe('skipped');
    expect(jiraPost).not.toHaveBeenCalled();
  });

  it('writes story points via the shared helper', async () => {
    vi.mocked(saveFeatureReviewStoryPoints).mockResolvedValue(undefined);
    const pointsItem: CommitDiffItem = { id: 'p1', kind: 'pointsSet', issueKey: 'DENP-1', containerId: null, from: 2, to: 5, dependsOn: null, selected: true };

    const results = await commitToJira([pointsItem], { containers: [], boardId: null, projectKey: 'DENP' });

    expect(saveFeatureReviewStoryPoints).toHaveBeenCalledWith('DENP-1', '5');
    expect(results[0].status).toBe('success');
  });

  it('posts the park reason as a Jira comment for a parkComment item', async () => {
    vi.mocked(jiraPost).mockResolvedValue(undefined as never);
    const parkComment: CommitDiffItem = { id: 'pc1', kind: 'parkComment', issueKey: 'DENP-7', containerId: null, from: null, to: 'stale — no activity', dependsOn: null, selected: true };

    const results = await commitToJira([parkComment], { containers: [], boardId: null, projectKey: 'DENP' });

    expect(jiraPost).toHaveBeenCalledWith('/rest/api/2/issue/DENP-7/comment', { body: 'Parked on Feature Canvas: stale — no activity' });
    expect(results[0].status).toBe('success');
  });

  it('writes an assigneeSet by resolving the display name to a Jira user id', async () => {
    vi.mocked(jiraPut).mockResolvedValue(undefined as never);
    const assigneeItem: CommitDiffItem = { id: 'as1', kind: 'assigneeSet', issueKey: 'DENP-2', containerId: null, from: 'Old Owner', to: 'Jane Doe', dependsOn: null, selected: true };

    const results = await commitToJira([assigneeItem], { containers: [], boardId: null, projectKey: 'DENP', assigneeIdByName: { 'Jane Doe': 'user-123' } });

    expect(jiraPut).toHaveBeenCalledWith('/rest/api/2/issue/DENP-2', { fields: { assignee: { name: 'user-123' } } });
    expect(results[0].status).toBe('success');
  });

  it('SKIPS an assigneeSet for an unknown user rather than mis-assigning it', async () => {
    const assigneeItem: CommitDiffItem = { id: 'as2', kind: 'assigneeSet', issueKey: 'DENP-2', containerId: null, from: null, to: 'Ghost User', dependsOn: null, selected: true };

    const results = await commitToJira([assigneeItem], { containers: [], boardId: null, projectKey: 'DENP', assigneeIdByName: { 'Jane Doe': 'user-123' } });

    expect(jiraPut).not.toHaveBeenCalled();
    expect(results[0].status).toBe('skipped');
    expect(results[0].message).toContain('Ghost User');
  });

  it('does not write deselected items', async () => {
    const deselected: CommitDiffItem = { id: 'p1', kind: 'pointsSet', issueKey: 'DENP-1', containerId: null, from: 2, to: 5, dependsOn: null, selected: false };

    const results = await commitToJira([deselected], { containers: [], boardId: null, projectKey: 'DENP' });

    expect(saveFeatureReviewStoryPoints).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
  });
});
