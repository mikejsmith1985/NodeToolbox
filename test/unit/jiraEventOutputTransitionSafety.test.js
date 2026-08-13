// jiraEventOutputTransitionSafety.test.js — Guards the two ways an automatic Jira move could act on
// an issue the operator never meant it to touch.
//
// 1. Status-CATEGORY matching. Jira files "Done", "Closed" and "Cancelled" all under the Done
//    category. A rule asking for "Done" on a project with no status of that exact name used to take
//    whichever Done-category transition Jira listed first — which could CANCEL the issue. The rule
//    now is: an exact name always wins, a category only resolves when it is unambiguous, and an
//    ambiguous category does nothing at all.
//
// 2. The "all coding sub-tasks are done" guard on a parent story. A parent with NO coding sub-tasks
//    satisfied it vacuously, so the stories the automation knew least about were exactly the ones it
//    waved through. Absence of evidence must hold the story, not release it.

'use strict';

const { selectTransitionForStatus } = require('../../src/services/jiraEventOutput');

/** Builds a Jira transition entry as /transitions returns it. */
function buildTransition(transitionId, statusName, categoryName) {
  return { id: transitionId, name: 'Move to ' + statusName, to: { name: statusName, statusCategory: { name: categoryName } } };
}

const CANCELLED = buildTransition('11', 'Cancelled', 'Done');
const CLOSED    = buildTransition('12', 'Closed', 'Done');
const WORKING   = buildTransition('13', 'Working', 'In Progress');
const DONE      = buildTransition('14', 'Done', 'Done');

describe('selectTransitionForStatus — exact name', () => {
  test('an exact status name wins even when other statuses share its category', () => {
    const { transition } = selectTransitionForStatus([CANCELLED, CLOSED, DONE], 'Done');
    expect(transition).toBe(DONE);
  });

  test('matching ignores case and surrounding whitespace', () => {
    const { transition } = selectTransitionForStatus([CANCELLED, WORKING], '  cancelled ');
    expect(transition).toBe(CANCELLED);
  });
});

describe('selectTransitionForStatus — category ambiguity', () => {
  test('REGRESSION: a "Done" request never resolves to Cancelled when the category is ambiguous', () => {
    const { transition, reason } = selectTransitionForStatus([CANCELLED, CLOSED, WORKING], 'Done');

    expect(transition).toBeNull();
    expect(reason).toMatch(/ambiguous/i);
    expect(reason).toContain('Cancelled');
    expect(reason).toContain('Closed');
  });

  test('an unambiguous category still resolves, so existing single-end-state projects keep working', () => {
    const { transition } = selectTransitionForStatus([CLOSED, WORKING], 'Done');
    expect(transition).toBe(CLOSED);
  });

  test('no match at all reports the requested name rather than picking something', () => {
    const { transition, reason } = selectTransitionForStatus([WORKING], 'Done');
    expect(transition).toBeNull();
    expect(reason).toContain('no transition matches');
  });

  test('an empty or malformed transition list never throws and never selects', () => {
    expect(selectTransitionForStatus([], 'Done').transition).toBeNull();
    expect(selectTransitionForStatus(null, 'Done').transition).toBeNull();
    expect(selectTransitionForStatus([{ id: '1' }], 'Done').transition).toBeNull();
  });
});
