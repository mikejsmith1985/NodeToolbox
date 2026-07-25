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
