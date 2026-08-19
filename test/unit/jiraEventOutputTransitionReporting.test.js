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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fireJiraTransition — reports its outcome', () => {
  test('a refused ambiguous move reports didMove false and says why', async () => {
    makeJiraApiRequest.mockResolvedValueOnce({ body: { transitions: AMBIGUOUS_DONE_TRANSITIONS } });

    const outcome = await fireJiraTransition('ENFCT-1', 'Done', CONFIGURATION);

    expect(outcome.didMove).toBe(false);
    expect(outcome.reason).toMatch(/ambiguous/i);
    expect(outcome.reason).toMatch(/Cancelled/);
    // Refusing means writing nothing: only the transitions GET was issued.
    expect(makeJiraApiRequest).toHaveBeenCalledTimes(1);
  });

  test('a successful move reports the status it landed on', async () => {
    makeJiraApiRequest
      .mockResolvedValueOnce({ body: { transitions: [{ id: '31', to: { name: 'Done', statusCategory: { name: 'Done' } } }] } })
      .mockResolvedValueOnce({ body: {} });

    const outcome = await fireJiraTransition('ENFCT-2', 'Done', CONFIGURATION);

    expect(outcome.didMove).toBe(true);
    expect(outcome.toStatusName).toBe('Done');
  });

  test('a Jira error is an outcome too, not a swallowed exception', async () => {
    makeJiraApiRequest.mockRejectedValueOnce(new Error('403 Forbidden'));

    const outcome = await fireJiraTransition('ENFCT-3', 'Done', CONFIGURATION);

    expect(outcome.didMove).toBe(false);
    expect(outcome.reason).toMatch(/403 Forbidden/);
  });
});

describe('a refused transition reaches the run log', () => {
  const { postJiraCommentForEvent } = require('../../src/services/jiraEventOutput');

  test('records a refusal as an unsuccessful result naming the reason', async () => {
    makeJiraApiRequest
      // The comment POST succeeds…
      .mockResolvedValueOnce({ status: 201, body: { id: '1' } })
      // …then the transitions GET offers two Done-category end states.
      .mockResolvedValueOnce({ body: { transitions: AMBIGUOUS_DONE_TRANSITIONS } });

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
    makeJiraApiRequest
      .mockResolvedValueOnce({ status: 201, body: { id: '1' } })
      .mockResolvedValueOnce({ body: { transitions: [{ id: '31', to: { name: 'Done', statusCategory: { name: 'Done' } } }] } })
      .mockResolvedValueOnce({ body: {} });

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
