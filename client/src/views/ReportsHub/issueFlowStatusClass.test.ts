// issueFlowStatusClass.test.ts — Unit tests for what a status MEANS.
//
// Jira puts every in-flight status in one category, so "In Progress" and "Ready for QA" look
// identical to it. Separating work from waiting is a judgement call, and the tests below pin the two
// properties that keep a wrong judgement from becoming a wrong conclusion:
//
//   • A status we cannot honestly classify is `unclassified` and its time STILL COUNTS. Guessing
//     "waiting" would move real work into the queue bucket and have the report blame a queue that
//     does not exist — a bigger failure than admitting we do not know.
//   • Reclassifying a status changes its bucket and never a duration. Meaning and arithmetic stay
//     separate, which is what makes the classification safely revisable later.

import { describe, expect, it } from 'vitest';

import { classifyStatusFlow, createStatusClassifier } from './issueFlowStatusClass.ts';

/** Classifies with no overrides, so a test states only the status it is about. */
function classify(statusName: string, statusCategoryKey: string | undefined) {
  return classifyStatusFlow({ statusId: 'any', statusName, statusCategoryKey, overridesByStatusId: {} });
}

describe('classifyStatusFlow — queue-shaped names are waiting', () => {
  const waitingNames = [
    'Ready for QA',
    'Waiting on Vendor',
    'Blocked',
    'On Hold',
    'Pending Approval',
    'In Review',
    'To Be Verified',
    'Deployment Queue',
  ];

  waitingNames.forEach((statusName) => {
    it(`classifies "${statusName}" as waiting`, () => {
      expect(classify(statusName, 'indeterminate')).toBe('waiting');
    });
  });

  it('matches the patterns case-insensitively', () => {
    expect(classify('READY FOR REVIEW', 'indeterminate')).toBe('waiting');
    expect(classify('blocked', 'indeterminate')).toBe('waiting');
  });
});

describe('classifyStatusFlow — everything else follows the Jira category', () => {
  it('treats any other in-flight status as active', () => {
    expect(classify('In Progress', 'indeterminate')).toBe('active');
    expect(classify('Development', 'indeterminate')).toBe('active');
  });

  it('treats a new-category status as not started', () => {
    expect(classify('Backlog', 'new')).toBe('not-started');
  });

  it('treats a done-category status as completed', () => {
    expect(classify('Done', 'done')).toBe('completed');
  });

  it('does not let a queue-shaped name override a done or new category', () => {
    // "Ready for Development" is a backlog state, not a queue inside the work.
    expect(classify('Ready for Development', 'new')).toBe('not-started');
  });
});

describe('classifyStatusFlow — honest uncertainty', () => {
  it('returns unclassified when the status category is unknown', () => {
    expect(classify('Some Custom State', undefined)).toBe('unclassified');
  });

  it('returns unclassified rather than guessing for an unrecognised category key', () => {
    expect(classify('Some Custom State', 'no-such-category')).toBe('unclassified');
  });
});

describe('classifyStatusFlow — an override always wins', () => {
  it('beats the default pattern', () => {
    const classification = classifyStatusFlow({
      statusId: '7',
      statusName: 'Ready for QA',
      statusCategoryKey: 'indeterminate',
      overridesByStatusId: { 7: 'active' },
    });

    expect(classification).toBe('active');
  });

  it('beats the category rule too, so a team can correct any status', () => {
    const classification = classifyStatusFlow({
      statusId: '7',
      statusName: 'Backlog',
      statusCategoryKey: 'new',
      overridesByStatusId: { 7: 'waiting' },
    });

    expect(classification).toBe('waiting');
  });
});

describe('createStatusClassifier — the adapter the flow engine consumes', () => {
  const statusCategoryByStatusId = { 1: 'new', 2: 'indeterminate', 3: 'indeterminate', 4: 'done' };

  it('resolves each status id through its category', () => {
    const classifier = createStatusClassifier(statusCategoryByStatusId, {});

    expect(classifier('1', 'Backlog')).toBe('not-started');
    expect(classifier('2', 'In Progress')).toBe('active');
    expect(classifier('3', 'Ready for QA')).toBe('waiting');
    expect(classifier('4', 'Done')).toBe('completed');
  });

  it('applies overrides supplied by the user', () => {
    const classifier = createStatusClassifier(statusCategoryByStatusId, { 3: 'active' });

    expect(classifier('3', 'Ready for QA')).toBe('active');
  });

  it('reports unclassified for a status id the category map does not know', () => {
    const classifier = createStatusClassifier(statusCategoryByStatusId, {});

    expect(classifier('99', 'Mystery')).toBe('unclassified');
  });

  it('is pure — the same status classifies the same way every time', () => {
    const classifier = createStatusClassifier(statusCategoryByStatusId, {});

    expect(classifier('3', 'Ready for QA')).toBe(classifier('3', 'Ready for QA'));
  });
});
