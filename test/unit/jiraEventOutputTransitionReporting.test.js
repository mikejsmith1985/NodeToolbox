// jiraEventOutputTransitionReporting.test.js — A refused or failed transition must reach the run log.
//
// The ambiguity guard that stops a "Done" request resolving to Cancelled did its job silently: it
// console.logged and returned. On screen a refusal was indistinguishable from nothing happening,
// which is the worst possible presentation for a safety guard — the operator cannot tell a rule that
// did nothing from one that was stopped from doing harm.

'use strict';

jest.mock('../../src/utils/httpClient', () => ({ makeJiraApiRequest: jest.fn() }));
jest.mock('../../src/services/jiraWriteJournal', () => ({ recordJiraWrite: jest.fn() }));

const { makeJiraApiRequest } = require('../../src/utils/httpClient');
const { fireJiraTransition } = require('../../src/services/jiraEventOutput');

const CONFIGURATION = { sslVerify: false, jira: {} };

/** Two end states sharing the Done category — the shape that made Cancelled reachable. */
const AMBIGUOUS_DONE_TRANSITIONS = [
  { id: '11', to: { name: 'Cancelled', statusCategory: { name: 'Done' } } },
  { id: '21', to: { name: 'Closed', statusCategory: { name: 'Done' } } },
];

/**
 * Answers the changelog read the reversal guard makes before every move.
 *
 * The guard reads the issue's history first, so these tests route by PATH rather than by call order
 * — an order-based mock silently hands the changelog response to the transitions lookup the moment
 * anything upstream adds a request.
 */
function stubChangelog(histories) {
  makeJiraApiRequest.mockImplementation((method, path) => {
    if (String(path).includes('expand=changelog')) {
      return Promise.resolve({ body: { changelog: { histories: histories || [] } } });
    }
    return Promise.resolve({ body: {} });
  });
}

/** Routes the transitions lookup and the transition POST, with an empty changelog behind them. */
function stubTransitions(transitions) {
  makeJiraApiRequest.mockImplementation((method, path) => {
    if (String(path).includes('expand=changelog')) {
      return Promise.resolve({ body: { changelog: { histories: [] } } });
    }
    if (String(path).includes('/transitions')) {
      return Promise.resolve({ body: { transitions } });
    }
    return Promise.resolve({ body: {} });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  makeJiraApiRequest.mockReset();
});

describe('fireJiraTransition — reports its outcome', () => {
  test('a refused ambiguous move reports didMove false and says why', async () => {
    stubTransitions(AMBIGUOUS_DONE_TRANSITIONS);

    const outcome = await fireJiraTransition('ENFCT-1', 'Done', CONFIGURATION);

    expect(outcome.didMove).toBe(false);
    expect(outcome.reason).toMatch(/ambiguous/i);
    expect(outcome.reason).toMatch(/Cancelled/);
    // Refusing means WRITING nothing: every request issued was a GET.
    const methodsUsed = makeJiraApiRequest.mock.calls.map((call) => call[0]);
    expect(methodsUsed.every((method) => method === 'GET')).toBe(true);
  });

  test('a successful move reports the status it landed on', async () => {
    stubTransitions([{ id: '31', to: { name: 'Done', statusCategory: { name: 'Done' } } }]);

    const outcome = await fireJiraTransition('ENFCT-2', 'Done', CONFIGURATION);

    expect(outcome.didMove).toBe(true);
    expect(outcome.toStatusName).toBe('Done');
  });

  test('a Jira error is an outcome too, not a swallowed exception', async () => {
    // The changelog read is allowed to succeed: the guard must not be what swallows a Jira failure.
    makeJiraApiRequest.mockImplementation((method, path) => (String(path).includes('expand=changelog')
      ? Promise.resolve({ body: { changelog: { histories: [] } } })
      : Promise.reject(new Error('403 Forbidden'))));

    const outcome = await fireJiraTransition('ENFCT-3', 'Done', CONFIGURATION);

    expect(outcome.didMove).toBe(false);
    expect(outcome.reason).toMatch(/403 Forbidden/);
  });
});

describe('fireJiraTransition — a person overrules the automation', () => {
  test('holds the move when somebody already moved the issue out of that status', async () => {
    // The loop from GH #375: cancel, a person restores it, the next poll cancels it again. The
    // changelog is read BEFORE the transitions lookup, so a held move costs one GET and no write.
    stubChangelog([{
      created: '2026-08-21T09:41:29.000+0000',
      author: { name: 'smith.jane', displayName: 'Smith, Jane (CTR)' },
      items: [{ field: 'status', fromString: 'Cancelled', toString: 'Working' }],
    }]);

    const outcome = await fireJiraTransition('ENFCT-2019', 'Cancelled', { sslVerify: false, jira: { username: 'svc_toolbox' } });

    expect(outcome.didMove).toBe(false);
    expect(outcome.reason).toMatch(/Smith, Jane/);
    const methodsUsed = makeJiraApiRequest.mock.calls.map((call) => call[0]);
    expect(methodsUsed.every((method) => method === 'GET')).toBe(true);
  });

  test('a changelog Jira will not return never blocks the move', async () => {
    // The guard acts on a decision it can SEE. Treating a failed request as a reversal would stop
    // the automation working every time Jira hiccuped.
    makeJiraApiRequest.mockImplementation((method, path) => {
      if (String(path).includes('expand=changelog')) {
        return Promise.reject(new Error('500 Server Error'));
      }
      if (String(path).includes('/transitions')) {
        return Promise.resolve({ body: { transitions: [{ id: '31', to: { name: 'Done', statusCategory: { name: 'Done' } } }] } });
      }
      return Promise.resolve({ body: {} });
    });

    const outcome = await fireJiraTransition('ENFCT-5', 'Done', CONFIGURATION);
    expect(outcome.didMove).toBe(true);
  });
});

describe('a refused transition reaches the run log', () => {
  const { postJiraCommentForEvent } = require('../../src/services/jiraEventOutput');

  /** Routes the comment POST, the reversal guard's changelog read, and the transitions lookup. */
  function stubCommentThenTransitions(transitions) {
    makeJiraApiRequest.mockImplementation((method, path) => {
      if (String(path).includes('expand=changelog')) {
        return Promise.resolve({ body: { changelog: { histories: [] } } });
      }
      if (String(path).includes('/transitions')) {
        return Promise.resolve({ body: { transitions } });
      }
      return Promise.resolve({ status: 201, body: { id: '1' } });
    });
  }

  test('records a refusal as an unsuccessful result naming the reason', async () => {
    // Routed by path: the comment POST succeeds, the changelog is clean, and the transitions GET
    // offers two Done-category end states.
    stubCommentThenTransitions(AMBIGUOUS_DONE_TRANSITIONS);

    const recordedResults = [];
    await postJiraCommentForEvent(
      'ENFCT-9', 'a comment', 'pr_merged', 'org/repo', { prMerged: 'Done' }, CONFIGURATION,
      { recordResult: (record) => recordedResults.push(record) },
    );

    const refusal = recordedResults.find((record) => /did not move|refus/i.test(record.message));
    expect(refusal).toBeDefined();
    expect(refusal.isSuccess).toBe(false);
    expect(refusal.message).toMatch(/ambiguous/i);
    expect(refusal.jiraKey).toBe('ENFCT-9');
  });

  test('records a successful move too, so the log shows what the run actually did', async () => {
    stubCommentThenTransitions([{ id: '31', to: { name: 'Done', statusCategory: { name: 'Done' } } }]);

    const recordedResults = [];
    await postJiraCommentForEvent(
      'ENFCT-10', 'a comment', 'pr_merged', 'org/repo', { prMerged: 'Done' }, CONFIGURATION,
      { recordResult: (record) => recordedResults.push(record) },
    );

    const move = recordedResults.find((record) => /moved to "Done"/.test(record.message));
    expect(move).toBeDefined();
    expect(move.isSuccess).toBe(true);
  });
});
