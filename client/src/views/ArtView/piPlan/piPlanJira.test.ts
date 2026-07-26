// piPlanJira.test.ts — Plan-write payload builders + the dry-run / idempotency guarantees (spec 028, US1).
// The Jira primitives are mocked so we assert payload shapes and that a dry run writes nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createIssue: vi.fn(async () => ({ id: '1', key: 'NEW-1', self: 'x' })),
  jiraPost: vi.fn(async () => ({})),
  saveFeatureReviewStoryPoints: vi.fn(async () => {}),
  saveFeatureReviewFixVersion: vi.fn(async () => {}),
}));
const { createIssue, jiraPost, saveFeatureReviewStoryPoints } = mocks;

vi.mock('../../../services/jiraApi.ts', () => ({ createIssue: mocks.createIssue, jiraPost: mocks.jiraPost }));
vi.mock('../../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewStoryPoints: mocks.saveFeatureReviewStoryPoints,
  saveFeatureReviewFixVersion: mocks.saveFeatureReviewFixVersion,
}));

import { applyStoryPlan, buildStoryCreateRequest, buildSubtaskCreateRequest } from './piPlanJira.ts';
import type { WriteContext } from './piPlanJira.ts';
import type { DatedItem, PlanItemProposal, ScheduledStory } from './piPlanTypes.ts';

const CTX: WriteContext = {
  projectKey: 'ABC',
  boardId: 42,
  fieldIds: { targetStart: 'customfield_10101', targetEnd: 'customfield_10102', due: 'duedate', featureLink: 'customfield_10108', programIncrement: 'customfield_10301' },
  storyIssueTypeId: '10001',
  subTaskIssueTypeId: '10002',
  existingSprintIdByName: { '26.3.1': 456 },
};

const STORY: ScheduledStory = {
  tempId: 'ABC-1#1', featureKey: 'ABC-1', summary: 'Login form', sizePoints: 8, devPoints: 6,
  internalTestPoints: 2, hasTestableOutput: true, assignee: 'Dev One', sprintName: '26.3.1',
  sprintStartIso: '2026-05-21', sprintEndIso: '2026-06-03',
};

const DATES: DatedItem = {
  targetStartIso: '2026-05-21', internalTestEndIso: '2026-05-27', targetEndIso: '2026-05-28',
  deployIntIso: '2026-05-28', deployRelIso: '2026-06-04', deployProdIso: '2026-06-15', dueIso: '2026-06-15', derivations: {},
};

function storyProposal(overrides: Partial<PlanItemProposal> = {}): PlanItemProposal {
  return { id: STORY.tempId, kind: 'story', status: 'new', parentKey: 'ABC-1', payload: STORY, dates: DATES, warnings: [], ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe('payload builders', () => {
  it('builds a Story create with project, Story type, feature link, and dates', () => {
    const request = buildStoryCreateRequest(STORY, DATES, CTX);
    expect(request.fields.project).toEqual({ key: 'ABC' });
    expect(request.fields.issuetype).toEqual({ id: '10001' });
    expect(request.fields.customfield_10108).toBe('ABC-1'); // feature link
    expect(request.fields.customfield_10101).toBe('2026-05-21'); // target start
    expect(request.fields.duedate).toBe('2026-06-15');
  });

  it('builds a Sub-task create with parent.key and the Sub-task type', () => {
    const request = buildSubtaskCreateRequest('deployRel', 'NEW-1', STORY, DATES, CTX);
    expect(request.fields.parent).toEqual({ key: 'NEW-1' });
    expect(request.fields.issuetype).toEqual({ id: '10002' });
    expect(request.fields.summary).toMatch(/\[REL\]/);
    expect(request.fields.duedate).toBe('2026-06-04');
  });
});

describe('applyStoryPlan', () => {
  it('dry run returns payloads and writes nothing', async () => {
    const result = await applyStoryPlan(storyProposal(), { ...CTX, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.storyRequest).not.toBeNull();
    expect(result.subtaskRequests).toHaveLength(4); // internal test + INT/REL/PROD
    expect(createIssue).not.toHaveBeenCalled();
    expect(jiraPost).not.toHaveBeenCalled();
  });

  it('omits the internal-test sub-task when the story is not testable', async () => {
    const nonTestable = { ...STORY, hasTestableOutput: false };
    const result = await applyStoryPlan(storyProposal({ payload: nonTestable }), { ...CTX, dryRun: true });
    expect(result.subtaskRequests).toHaveLength(3);
  });

  it('skips an existing item — zero writes (idempotency)', async () => {
    const result = await applyStoryPlan(storyProposal({ status: 'existing' }), CTX);
    expect(result.skipped).toBe(true);
    expect(createIssue).not.toHaveBeenCalled();
  });

  it('on a real run creates the Story, sets points, assigns the sprint, and creates sub-tasks', async () => {
    await applyStoryPlan(storyProposal(), CTX);
    expect(createIssue).toHaveBeenCalledTimes(5); // 1 story + 4 sub-tasks
    expect(saveFeatureReviewStoryPoints).toHaveBeenCalledWith('NEW-1', '8');
    expect(jiraPost).toHaveBeenCalledWith('/rest/agile/1.0/sprint/456/issue', { issues: ['NEW-1'] });
  });
});
