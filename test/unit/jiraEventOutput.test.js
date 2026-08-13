// test/unit/jiraEventOutput.test.js — Unit tests for the shared Jira event-output helper.
// HTTP is intercepted with nock. Covers the dry-run and comment-only additions the email engine relies on.

'use strict';

const nock = require('nock');
const { postJiraCommentForEvent, extractJiraIssueKey, TRANSITION_KEY_MAP } = require('../../src/services/jiraEventOutput');

const JIRA_BASE = 'https://jira.example.com';

function buildConfig() {
  return {
    jira:      { baseUrl: JIRA_BASE, pat: 'jira-pat', username: '', apiToken: '' },
    sslVerify: true,
  };
}

const TRANSITIONS = { branchCreated: '', commitPushed: '', prOpened: 'In Progress', prMerged: 'Done' };

afterEach(() => {
  nock.cleanAll();
});

describe('extractJiraIssueKey', () => {
  it('pulls the first key out of a branch name or free text', () => {
    expect(extractJiraIssueKey('feature/DENP-1414-add-thing')).toBe('DENP-1414');
    expect(extractJiraIssueKey('no key here')).toBeNull();
  });
});

describe('TRANSITION_KEY_MAP', () => {
  it('maps each event type to its transition config key', () => {
    expect(TRANSITION_KEY_MAP).toEqual({
      branch_created: 'branchCreated',
      commit_pushed:  'commitPushed',
      pr_opened:      'prOpened',
      pr_merged:      'prMerged',
    });
  });
});

describe('postJiraCommentForEvent', () => {
  it('dry run: records a would-post result and makes NO Jira calls', async () => {
    const results = [];
    // No nock interceptors registered — any HTTP call would throw, proving nothing was sent.
    await postJiraCommentForEvent('PROJ-1', 'hi', 'pr_opened', 'owner/repo', TRANSITIONS, buildConfig(), {
      dryRun: true,
      recordResult: (record) => results.push(record),
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ jiraKey: 'PROJ-1', eventType: 'pr_opened', isSuccess: true });
    expect(results[0].message).toMatch(/dry run/i);
  });

  it('posts a comment and fires the configured transition', async () => {
    const commentScope = nock(JIRA_BASE).post('/rest/api/2/issue/PROJ-1/comment').reply(201, {});
    const transitionsGet = nock(JIRA_BASE)
      .get('/rest/api/2/issue/PROJ-1/transitions')
      .reply(200, { transitions: [{ id: '31', to: { name: 'In Progress', statusCategory: { name: 'In Progress' } } }] });
    const transitionPost = nock(JIRA_BASE).post('/rest/api/2/issue/PROJ-1/transitions', { transition: { id: '31' } }).reply(204);

    const results = [];
    await postJiraCommentForEvent('PROJ-1', 'PR opened', 'pr_opened', 'owner/repo', TRANSITIONS, buildConfig(), {
      recordResult: (record) => results.push(record),
    });

    expect(commentScope.isDone()).toBe(true);
    expect(transitionsGet.isDone()).toBe(true);
    expect(transitionPost.isDone()).toBe(true);
    expect(results[0]).toMatchObject({ jiraKey: 'PROJ-1', isSuccess: true });
  });

  it('comment-only mode posts the comment but fires no transition', async () => {
    const commentScope = nock(JIRA_BASE).post('/rest/api/2/issue/PROJ-1/comment').reply(201, {});
    // No transitions interceptor: if a transition were attempted, the test would fail with an unmatched request.

    const results = [];
    await postJiraCommentForEvent('PROJ-1', 'PR opened', 'pr_opened', 'owner/repo', TRANSITIONS, buildConfig(), {
      suppressTransition: true,
      recordResult: (record) => results.push(record),
    });

    expect(commentScope.isDone()).toBe(true);
    expect(results[0]).toMatchObject({ jiraKey: 'PROJ-1', isSuccess: true });
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('records a failure when the comment POST errors', async () => {
    nock(JIRA_BASE).post('/rest/api/2/issue/PROJ-1/comment').reply(400, { errorMessages: ['bad'] });

    const results = [];
    await postJiraCommentForEvent('PROJ-1', 'PR opened', 'pr_opened', 'owner/repo', TRANSITIONS, buildConfig(), {
      recordResult: (record) => results.push(record),
    });

    expect(results[0]).toMatchObject({ jiraKey: 'PROJ-1', isSuccess: false });
  });
});

// ── Parent-story actions (merge → sub-task Done, parent → Ready for Testing + Sub-status) ──

/** parentActions used across the suite: transition + sub-status, with the all-dev-done guard on. */
function buildParentActions(overrides) {
  return {
    transitionStatus: 'Ready for Testing',
    requireAllDevDone: true,
    subStatusValue: 'Dev Complete',
    subStatusFieldId: 'customfield_10201',
    ...(overrides || {}),
  };
}

/** Mocks the matched issue as a sub-task of STORY-9. */
function mockSubtaskLookup() {
  return nock(JIRA_BASE)
    .get('/rest/api/2/issue/SUB-1')
    .query({ fields: 'parent,issuetype' })
    .reply(200, { fields: { issuetype: { subtask: true }, parent: { key: 'STORY-9' } } });
}

/** Mocks the parent's sub-task stubs. */
function mockParentSubtasks(subtaskStubs) {
  return nock(JIRA_BASE)
    .get('/rest/api/2/issue/STORY-9')
    .query({ fields: 'subtasks' })
    .reply(200, { fields: { subtasks: subtaskStubs } });
}

function doneStub(key, summary) {
  return { key, fields: { summary, status: { name: 'Done', statusCategory: { key: 'done' } } } };
}

function workingStub(key, summary) {
  return { key, fields: { summary, status: { name: 'Working', statusCategory: { key: 'indeterminate' } } } };
}

describe('postJiraCommentForEvent — parent-story actions', () => {
  it('moves the parent and sets Sub-status when every coding sub-task is Done', async () => {
    nock(JIRA_BASE).post('/rest/api/2/issue/SUB-1/comment').reply(201, {});
    mockSubtaskLookup();
    mockParentSubtasks([
      doneStub('SUB-1', 'Repo A dev execute'),
      doneStub('SUB-2', 'Repo B dev execute'),
      workingStub('SUB-3', '[SL] SL Test: story'), // scaffold sub-task — must NOT hold the parent
    ]);
    const parentTransitionsGet = nock(JIRA_BASE)
      .get('/rest/api/2/issue/STORY-9/transitions')
      .reply(200, { transitions: [{ id: '41', to: { name: 'Ready for Testing', statusCategory: { name: 'In Progress' } } }] });
    const parentTransitionPost = nock(JIRA_BASE)
      .post('/rest/api/2/issue/STORY-9/transitions', { transition: { id: '41' } })
      .reply(204);
    const subStatusPut = nock(JIRA_BASE)
      .put('/rest/api/2/issue/STORY-9', { fields: { customfield_10201: { value: 'Dev Complete' } } })
      .reply(204);

    const results = [];
    await postJiraCommentForEvent('SUB-1', 'merged', 'pr_merged', 'owner/repo', {}, buildConfig(), {
      parentActions: buildParentActions(),
      recordResult: (record) => results.push(record),
    });

    expect(parentTransitionsGet.isDone()).toBe(true);
    expect(parentTransitionPost.isDone()).toBe(true);
    expect(subStatusPut.isDone()).toBe(true);
    expect(results.some((record) => record.jiraKey === 'STORY-9' && record.isSuccess)).toBe(true);
  });

  it('holds the parent while a coding sub-task is not Done (and skips the Sub-status write)', async () => {
    nock(JIRA_BASE).post('/rest/api/2/issue/SUB-1/comment').reply(201, {});
    mockSubtaskLookup();
    mockParentSubtasks([
      doneStub('SUB-1', 'Repo A dev execute'),
      workingStub('SUB-2', 'Repo B dev execute'), // still coding — parent must not move
    ]);
    // No parent transitions/PUT interceptors: an attempt would fail the test as an unmatched request.

    const results = [];
    await postJiraCommentForEvent('SUB-1', 'merged', 'pr_merged', 'owner/repo', {}, buildConfig(), {
      parentActions: buildParentActions(),
      recordResult: (record) => results.push(record),
    });

    expect(nock.pendingMocks()).toEqual([]);
    const holdRecord = results.find((record) => record.jiraKey === 'STORY-9');
    expect(holdRecord).toBeDefined();
    expect(holdRecord.message).toMatch(/not .*done|held/i);
  });

  it('skips parent actions when the matched issue is not a sub-task', async () => {
    nock(JIRA_BASE).post('/rest/api/2/issue/SUB-1/comment').reply(201, {});
    nock(JIRA_BASE)
      .get('/rest/api/2/issue/SUB-1')
      .query({ fields: 'parent,issuetype' })
      .reply(200, { fields: { issuetype: { subtask: false }, parent: null } });

    const results = [];
    await postJiraCommentForEvent('SUB-1', 'merged', 'pr_merged', 'owner/repo', {}, buildConfig(), {
      parentActions: buildParentActions(),
      recordResult: (record) => results.push(record),
    });

    expect(nock.pendingMocks()).toEqual([]);
    expect(results.some((record) => /not a sub-task/i.test(record.message || ''))).toBe(true);
  });

  it('moves the parent immediately when the all-dev-done guard is off', async () => {
    nock(JIRA_BASE).post('/rest/api/2/issue/SUB-1/comment').reply(201, {});
    mockSubtaskLookup();
    // Guard off → the sibling read never happens; only the transition fires (no sub-status configured).
    const parentTransitionsGet = nock(JIRA_BASE)
      .get('/rest/api/2/issue/STORY-9/transitions')
      .reply(200, { transitions: [{ id: '41', to: { name: 'Ready for Testing', statusCategory: { name: 'In Progress' } } }] });
    const parentTransitionPost = nock(JIRA_BASE)
      .post('/rest/api/2/issue/STORY-9/transitions', { transition: { id: '41' } })
      .reply(204);

    await postJiraCommentForEvent('SUB-1', 'merged', 'pr_merged', 'owner/repo', {}, buildConfig(), {
      parentActions: buildParentActions({ requireAllDevDone: false, subStatusValue: '' }),
      recordResult: () => {},
    });

    expect(parentTransitionsGet.isDone()).toBe(true);
    expect(parentTransitionPost.isDone()).toBe(true);
    expect(nock.pendingMocks()).toEqual([]);
  });

  it('dry run with parent actions records the plan and makes NO Jira calls', async () => {
    const results = [];
    await postJiraCommentForEvent('SUB-1', 'merged', 'pr_merged', 'owner/repo', {}, buildConfig(), {
      dryRun: true,
      parentActions: buildParentActions(),
      recordResult: (record) => results.push(record),
    });

    expect(results.some((record) => /parent/i.test(record.message || ''))).toBe(true);
  });

  it('comment-only mode never touches the parent', async () => {
    nock(JIRA_BASE).post('/rest/api/2/issue/SUB-1/comment').reply(201, {});

    await postJiraCommentForEvent('SUB-1', 'merged', 'pr_merged', 'owner/repo', {}, buildConfig(), {
      suppressTransition: true,
      parentActions: buildParentActions(),
      recordResult: () => {},
    });

    expect(nock.pendingMocks()).toEqual([]);
  });
});

// ── Guard integrity: a parent with no coding sub-tasks ──
//
// The "every coding sub-task is done" check used to pass vacuously on a parent that had no coding
// sub-tasks at all — an empty list contains nothing that is not-done — so the stories the automation
// had the least information about were exactly the ones it moved without hesitation. Absence of
// evidence must HOLD the story.

describe('postJiraCommentForEvent — parent held when there is nothing to verify', () => {
  it('REGRESSION: does not move a parent that has no coding sub-tasks', async () => {
    nock(JIRA_BASE).post('/rest/api/2/issue/SUB-1/comment').reply(201, {});
    mockSubtaskLookup();
    mockParentSubtasks([
      workingStub('SUB-3', '[SL] SL Test: story'),
      doneStub('SUB-4', '[INT] Deploy to INT'),
    ]);

    const results = [];
    await postJiraCommentForEvent('SUB-1', 'merged', 'pr_merged', 'owner/repo', {}, buildConfig(), {
      parentActions: buildParentActions({ subStatusValue: '' }),
      recordResult: (record) => results.push(record),
    });

    // No parent transition interceptors were registered, so any parent move would have thrown.
    expect(nock.pendingMocks()).toEqual([]);
    expect(results.some((record) => /no coding sub-tasks/i.test(record.message || ''))).toBe(true);
  });

  it('REGRESSION: does not move a parent whose sub-task list is empty', async () => {
    nock(JIRA_BASE).post('/rest/api/2/issue/SUB-1/comment').reply(201, {});
    mockSubtaskLookup();
    mockParentSubtasks([]);

    const results = [];
    await postJiraCommentForEvent('SUB-1', 'merged', 'pr_merged', 'owner/repo', {}, buildConfig(), {
      parentActions: buildParentActions({ subStatusValue: '' }),
      recordResult: (record) => results.push(record),
    });

    expect(nock.pendingMocks()).toEqual([]);
    expect(results.some((record) => /no coding sub-tasks/i.test(record.message || ''))).toBe(true);
  });

  it('still moves the parent when the operator has turned the guard off', async () => {
    nock(JIRA_BASE).post('/rest/api/2/issue/SUB-1/comment').reply(201, {});
    mockSubtaskLookup();
    nock(JIRA_BASE).post('/rest/api/2/issue/STORY-9/comment').reply(201, {});
    nock(JIRA_BASE)
      .get('/rest/api/2/issue/STORY-9/transitions')
      .reply(200, { transitions: [{ id: '41', to: { name: 'Ready for Testing', statusCategory: { name: 'In Progress' } } }] });
    const parentTransitionPost = nock(JIRA_BASE).post('/rest/api/2/issue/STORY-9/transitions').reply(204);

    await postJiraCommentForEvent('SUB-1', 'merged', 'pr_merged', 'owner/repo', {}, buildConfig(), {
      parentActions: buildParentActions({ requireAllDevDone: false, subStatusValue: '' }),
      recordResult: () => {},
    });

    expect(parentTransitionPost.isDone()).toBe(true);
  });
});
