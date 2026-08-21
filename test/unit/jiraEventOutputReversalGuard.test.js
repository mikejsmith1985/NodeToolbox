// jiraEventOutputReversalGuard.test.js — The automation must not fight a person.
//
// GH #375: the intake cancelled issues, somebody moved them back to Working, and the next poll
// cancelled them again. The duplicate-event ledger only stops the same EMAIL being processed twice;
// a fresh notification about the same branch is a new event, so the move re-fired against a
// decision a human had already reversed.
//
// The rule: if a person moved an issue OUT of the status the automation is about to set, that is
// the person overruling the automation, and the automation stands down.

'use strict';

const { wasStatusReversedByPerson } = require('../../src/services/jiraEventOutput');

/** Builds a changelog history entry as Jira's ?expand=changelog returns it. */
function buildStatusChange(authorName, fromStatus, toStatus, createdIso) {
  return {
    created: createdIso,
    author: { name: authorName, displayName: authorName },
    items: [{ field: 'status', fromString: fromStatus, toString: toStatus }],
  };
}

const AUTOMATION_USER = 'svc_toolbox';

describe('wasStatusReversedByPerson', () => {
  test('stands down when a person moved the issue out of the status being requested', () => {
    const histories = [
      buildStatusChange(AUTOMATION_USER, 'Working', 'Cancelled', '2026-08-20T18:00:09.000+0000'),
      buildStatusChange('smith.jane', 'Cancelled', 'Working', '2026-08-21T09:41:29.000+0000'),
    ];

    const verdict = wasStatusReversedByPerson(histories, 'Cancelled', AUTOMATION_USER);

    expect(verdict.wasReversed).toBe(true);
    expect(verdict.reason).toContain('smith.jane');
    expect(verdict.reason).toMatch(/Cancelled/);
  });

  test('acts normally when nobody has moved the issue out of that status', () => {
    const histories = [buildStatusChange('smith.jane', 'To Do', 'Working', '2026-08-21T09:00:00.000+0000')];
    expect(wasStatusReversedByPerson(histories, 'Cancelled', AUTOMATION_USER).wasReversed).toBe(false);
  });

  test('does not count the automation moving its own work onward as a reversal', () => {
    // The automation walking an issue Working → Ready for Testing → Done is its own pipeline, not a
    // person overruling it. Treating that as a reversal would stop the automation working at all.
    const histories = [
      buildStatusChange(AUTOMATION_USER, 'Working', 'Ready for Testing', '2026-08-20T18:00:00.000+0000'),
      buildStatusChange(AUTOMATION_USER, 'Ready for Testing', 'Done', '2026-08-20T19:00:00.000+0000'),
    ];
    expect(wasStatusReversedByPerson(histories, 'Ready for Testing', AUTOMATION_USER).wasReversed).toBe(false);
  });

  test('a person reversal stands even when the automation moved it again afterwards', () => {
    // Chronology is not the test; the person's decision is. An automation move made after the
    // reversal is the very loop being stopped, so it must not clear the flag.
    const histories = [
      buildStatusChange('smith.jane', 'Cancelled', 'Working', '2026-08-21T09:41:29.000+0000'),
      buildStatusChange(AUTOMATION_USER, 'Working', 'Cancelled', '2026-08-21T15:30:36.000+0000'),
    ];
    expect(wasStatusReversedByPerson(histories, 'Cancelled', AUTOMATION_USER).wasReversed).toBe(true);
  });

  test('matches the automation account regardless of case or surrounding space', () => {
    const histories = [buildStatusChange('  SVC_Toolbox ', 'Cancelled', 'Working', '2026-08-21T09:00:00.000+0000')];
    expect(wasStatusReversedByPerson(histories, 'Cancelled', AUTOMATION_USER).wasReversed).toBe(false);
  });

  test('compares the status name ignoring case and space', () => {
    const histories = [buildStatusChange('smith.jane', ' cancelled ', 'Working', '2026-08-21T09:00:00.000+0000')];
    expect(wasStatusReversedByPerson(histories, 'Cancelled', AUTOMATION_USER).wasReversed).toBe(true);
  });

  test('ignores non-status changes, which are most of a changelog', () => {
    const histories = [{
      created: '2026-08-21T09:00:00.000+0000',
      author: { name: 'smith.jane' },
      items: [{ field: 'assignee', fromString: 'Cancelled', toString: 'Working' }],
    }];
    expect(wasStatusReversedByPerson(histories, 'Cancelled', AUTOMATION_USER).wasReversed).toBe(false);
  });

  test('never throws on a missing, empty or malformed changelog', () => {
    expect(wasStatusReversedByPerson(null, 'Cancelled', AUTOMATION_USER).wasReversed).toBe(false);
    expect(wasStatusReversedByPerson([], 'Cancelled', AUTOMATION_USER).wasReversed).toBe(false);
    expect(wasStatusReversedByPerson([{}], 'Cancelled', AUTOMATION_USER).wasReversed).toBe(false);
  });

  test('with no automation account known, every move looks like a person and the guard holds', () => {
    // Without an identity there is no way to tell the automation's own moves from anyone else's.
    // Holding is the safe direction: it declines to act rather than acting on a bad assumption.
    const histories = [buildStatusChange('svc_toolbox', 'Cancelled', 'Working', '2026-08-21T09:00:00.000+0000')];
    expect(wasStatusReversedByPerson(histories, 'Cancelled', '').wasReversed).toBe(true);
  });
});
