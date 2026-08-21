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

describe('selectTransitionForStatus — a cancellation is never INFERRED', () => {
  // The gap the ambiguity guard left open. It refuses when a category offers several end states, but
  // a workflow that offers exactly ONE Done-category transition out of "Working" — and that one is
  // Cancelled — sailed straight through the single-candidate rule. That is how a merged-PR rule
  // asking for "Done" cancelled live development work (GH #375).
  //
  // Cancelling is not a kind of completing. It discards the work, and no amount of category
  // agreement makes it a safe guess. It stays reachable, but only by an operator typing the name.

  test('REGRESSION: a "Done" request never resolves to a lone Cancelled transition', () => {
    const { transition, reason } = selectTransitionForStatus([CANCELLED, WORKING], 'Done');

    expect(transition).toBeNull();
    expect(reason).toMatch(/cancel/i);
    expect(reason).toContain('Cancelled');
  });

  test('the refusal names the exact status to type, so the operator can act on it', () => {
    const { reason } = selectTransitionForStatus([CANCELLED, WORKING], 'Done');
    expect(reason).toMatch(/name the exact status/i);
  });

  test('an operator who types "Cancelled" still gets exactly that', () => {
    // Refusing the inference must not remove the ability. Asked for by name, it fires.
    const { transition } = selectTransitionForStatus([CANCELLED, WORKING], 'Cancelled');
    expect(transition).toBe(CANCELLED);
  });

  test('other discard-style end states are refused by inference too', () => {
    ['Rejected', 'Abandoned', 'Withdrawn', "Won't Do", "Won't Fix", 'Duplicate', 'Canceled'].forEach((statusName) => {
      const discardTransition = buildTransition('90', statusName, 'Done');
      const { transition } = selectTransitionForStatus([discardTransition, WORKING], 'Done');
      expect(transition).toBeNull();
    });
  });

  test('a genuine completion is still inferred, so nothing that worked stops working', () => {
    expect(selectTransitionForStatus([CLOSED, WORKING], 'Done').transition).toBe(CLOSED);
    expect(selectTransitionForStatus([DONE, WORKING], 'Done').transition).toBe(DONE);
  });

  test('a category offering a discard AND a completion stays ambiguous, as it already did', () => {
    // Deliberately NOT "drop Cancelled, then Closed is unambiguous". That would quietly relax a
    // guard written after a real incident, and the safe answer when two end states are on offer is
    // still to refuse and ask. This rule only ever removes options, never adds one back.
    expect(selectTransitionForStatus([CANCELLED, CLOSED, WORKING], 'Done').transition).toBeNull();
  });
});
