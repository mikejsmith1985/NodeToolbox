// plannerFetch.test.ts — Verifies the PURE raw-Jira → PlannerSourceIssue transform and the orchestration wiring.
//
// The pure transform tests never touch the network. The orchestration tests mock `jiraGet` and route by
// the JQL in the requested path, proving primaries, sub-tasks, and linked external-test (DIP) issues are
// all emitted correctly (external issues carry projectKey 'DIP' and their linking team issue as parent).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import {
  fetchPlannerSourceIssues,
  toPlannerSourceIssue,
  type PlannerRawIssue,
} from './plannerFetch.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONFIGURED_STORY_POINTS_FIELD_ID = 'customfield_10236';
const LEGACY_STORY_POINTS_FIELD_ID = 'customfield_10016';

/** Builds a raw Jira issue, defaulting the noisy shape so each test states only what it cares about. */
function makeRawIssue(key: string, fields: PlannerRawIssue['fields']): PlannerRawIssue {
  return { key, fields };
}

// ── Pure transform ──────────────────────────────────────────────────────────

describe('toPlannerSourceIssue (pure transform)', () => {
  it('detects a sub-task from the issuetype.subtask flag', () => {
    const raw = makeRawIssue('DENP-2', { issuetype: { name: 'Sub-task', subtask: true } });
    const result = toPlannerSourceIssue(raw, { storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID });
    expect(result.isSubtask).toBe(true);
  });

  it('detects a sub-task from a present parent even when the subtask flag is absent', () => {
    const raw = makeRawIssue('DENP-3', { issuetype: { name: 'Task' }, parent: { key: 'DENP-1' } });
    const result = toPlannerSourceIssue(raw, { storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID });
    expect(result.isSubtask).toBe(true);
    expect(result.parentKey).toBe('DENP-1');
  });

  it('treats a parentless non-subtask story as primary (isSubtask false, parentKey null)', () => {
    const raw = makeRawIssue('DENP-4', { issuetype: { name: 'Story', subtask: false } });
    const result = toPlannerSourceIssue(raw, { storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID });
    expect(result.isSubtask).toBe(false);
    expect(result.parentKey).toBeNull();
  });

  it('reads the assignee display name, and null when unassigned', () => {
    const assigned = toPlannerSourceIssue(
      makeRawIssue('DENP-5', { assignee: { displayName: 'Ada Lovelace' } }),
      { storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID },
    );
    const unassigned = toPlannerSourceIssue(
      makeRawIssue('DENP-6', { assignee: null }),
      { storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID },
    );
    expect(assigned.assignee).toBe('Ada Lovelace');
    expect(unassigned.assignee).toBeNull();
  });

  it('reads story points from the configured custom field', () => {
    const raw = makeRawIssue('DENP-7', { [CONFIGURED_STORY_POINTS_FIELD_ID]: 5 });
    const result = toPlannerSourceIssue(raw, { storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID });
    expect(result.storyPoints).toBe(5);
  });

  it('falls back to the legacy story-points field when the configured id is not a real custom field', () => {
    const raw = makeRawIssue('DENP-8', { [LEGACY_STORY_POINTS_FIELD_ID]: 8 });
    const result = toPlannerSourceIssue(raw, { storyPointsFieldId: 'story_points' });
    expect(result.storyPoints).toBe(8);
  });

  it('returns null story points when neither the configured nor legacy field carries a value', () => {
    const raw = makeRawIssue('DENP-9', { issuetype: { name: 'Story' } });
    const result = toPlannerSourceIssue(raw, { storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID });
    expect(result.storyPoints).toBeNull();
  });

  it('resolves the project key from the fields.project.key when present', () => {
    const raw = makeRawIssue('DENP-10', { project: { key: 'DENP' } });
    const result = toPlannerSourceIssue(raw, { storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID });
    expect(result.projectKey).toBe('DENP');
  });

  it('falls back to the issue-key prefix for the project key when no project field is present', () => {
    const raw = makeRawIssue('ABC-11', { issuetype: { name: 'Story' } });
    const result = toPlannerSourceIssue(raw, { storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID });
    expect(result.projectKey).toBe('ABC');
  });

  it('carries the issue-type name through', () => {
    const raw = makeRawIssue('DENP-12', { issuetype: { name: 'Defect' } });
    const result = toPlannerSourceIssue(raw, { storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID });
    expect(result.issueType).toBe('Defect');
  });

  it('emits a DIP-linked issue with projectKey DIP and the team issue as parentKey via overrides', () => {
    const raw = makeRawIssue('DIP-99', {
      issuetype: { name: 'Test' },
      [CONFIGURED_STORY_POINTS_FIELD_ID]: 3,
      assignee: { displayName: 'Grace Hopper' },
    });
    const result = toPlannerSourceIssue(raw, {
      storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID,
      projectKeyOverride: 'DIP',
      parentKeyOverride: 'DENP-1',
    });
    expect(result.projectKey).toBe('DIP');
    expect(result.parentKey).toBe('DENP-1');
    expect(result.isSubtask).toBe(false);
    expect(result.storyPoints).toBe(3);
    expect(result.assignee).toBe('Grace Hopper');
  });

  it('never sets bucket or rankInBucket (priority is supplied downstream)', () => {
    const raw = makeRawIssue('DENP-13', { issuetype: { name: 'Story' } });
    const result = toPlannerSourceIssue(raw, { storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID });
    expect(result.bucket).toBeUndefined();
    expect(result.rankInBucket).toBeUndefined();
  });
});

// ── Orchestration (jiraGet mocked, routed by JQL) ─────────────────────────────

describe('fetchPlannerSourceIssues (orchestration)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches primaries, their sub-tasks, and linked DIP issues, mapping each correctly', async () => {
    // A primary story that links out to a DIP external-test issue.
    const primaryStory = makeRawIssue('DENP-1', {
      issuetype: { name: 'Story', subtask: false },
      [CONFIGURED_STORY_POINTS_FIELD_ID]: 5,
      assignee: { displayName: 'Ada Lovelace' },
      issuelinks: [{ outwardIssue: { key: 'DIP-99' } }],
    });
    // A sub-task of the primary story (discovered via the parent sweep).
    const subtask = makeRawIssue('DENP-2', {
      issuetype: { name: 'Sub-task', subtask: true },
      parent: { key: 'DENP-1' },
      [CONFIGURED_STORY_POINTS_FIELD_ID]: 2,
      assignee: { displayName: 'Charles Babbage' },
    });
    // The linked external-test issue in the DIP project.
    const externalTest = makeRawIssue('DIP-99', {
      issuetype: { name: 'External Test' },
      [CONFIGURED_STORY_POINTS_FIELD_ID]: 3,
      assignee: { displayName: 'Grace Hopper' },
    });

    // Route each mocked search by the JQL embedded in the requested path.
    mockJiraGet.mockImplementation((path: string) => {
      const decodedPath = decodeURIComponent(path);
      if (decodedPath.includes('key in (DENP-1)')) {
        return Promise.resolve({ issues: [primaryStory] });
      }
      if (decodedPath.includes('parent in (DENP-1)')) {
        return Promise.resolve({ issues: [subtask] });
      }
      if (decodedPath.includes('key in (DIP-99)')) {
        return Promise.resolve({ issues: [externalTest] });
      }
      return Promise.resolve({ issues: [] });
    });

    const results = await fetchPlannerSourceIssues({
      teamIssueKeys: ['DENP-1'],
      projectKey: 'DENP',
      piName: 'PI 2026.1',
      storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID,
    });

    const byKey = new Map(results.map((issue) => [issue.key, issue]));
    expect(results).toHaveLength(3);

    const primary = byKey.get('DENP-1');
    expect(primary?.isSubtask).toBe(false);
    expect(primary?.storyPoints).toBe(5);
    expect(primary?.parentKey).toBeNull();

    const child = byKey.get('DENP-2');
    expect(child?.isSubtask).toBe(true);
    expect(child?.parentKey).toBe('DENP-1');

    const external = byKey.get('DIP-99');
    expect(external?.projectKey).toBe('DIP');
    expect(external?.parentKey).toBe('DENP-1');
    expect(external?.storyPoints).toBe(3);
  });

  it('returns an empty list when there are no team keys and no scope JQL', async () => {
    const results = await fetchPlannerSourceIssues({
      teamIssueKeys: [],
      projectKey: 'DENP',
      piName: 'PI 2026.1',
      storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID,
    });
    expect(results).toEqual([]);
    expect(mockJiraGet).not.toHaveBeenCalled();
  });

  it('resolves primaries from a scope JQL when provided instead of keys', async () => {
    const primaryStory = makeRawIssue('DENP-1', { issuetype: { name: 'Story' }, [CONFIGURED_STORY_POINTS_FIELD_ID]: 1 });
    mockJiraGet.mockImplementation((path: string) => {
      const decodedPath = decodeURIComponent(path);
      if (decodedPath.includes('project = DENP')) {
        return Promise.resolve({ issues: [primaryStory] });
      }
      return Promise.resolve({ issues: [] });
    });

    const results = await fetchPlannerSourceIssues({
      scopeJql: 'project = DENP AND sprint in openSprints()',
      projectKey: 'DENP',
      piName: 'PI 2026.1',
      storyPointsFieldId: CONFIGURED_STORY_POINTS_FIELD_ID,
    });
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('DENP-1');
  });
});
