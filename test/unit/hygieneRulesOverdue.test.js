// hygieneRulesOverdue.test.js — Server parity for the broadened overdue rules.
//
// The scheduled hygiene monitor must reach the same verdict as the client Hygiene view, so the two
// changes made there are pinned here: a due date is a commitment on every delivery work item (not
// only Features), and a Feature past Target End is flagged until it actually reaches testing.

'use strict';

const { evaluateHygieneRules } = require('../../src/services/hygieneRules');

const LONG_PAST_DATE = '2020-01-01';
const FIELD_CONFIG = { targetEndFieldIds: ['customfield_10102'] };

function buildIssue(issueTypeName, statusName, statusCategoryKey, extraFields) {
  return {
    key: 'TBX-1',
    fields: {
      summary: 'A delivery item',
      issuetype: { name: issueTypeName },
      status: { name: statusName, statusCategory: { key: statusCategoryKey } },
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
      ...extraFields,
    },
  };
}

function flagIdsFor(issue) {
  return evaluateHygieneRules(issue, FIELD_CONFIG).map((flag) => flag.checkId);
}

describe('server hygiene — due date overdue applies to every delivery work item', () => {
  // Epic is here as a regression guard: it was already covered by the old Feature/Epic gate.
  for (const issueTypeName of ['Story', 'Task', 'Defect', 'Feature', 'Epic']) {
    test(`flags an overdue ${issueTypeName}`, () => {
      const issue = buildIssue(issueTypeName, 'In Progress', 'indeterminate', { duedate: LONG_PAST_DATE });
      expect(flagIdsFor(issue)).toContain('due-date-overdue');
    });
  }

  test('leaves a Sub-task alone, because it inherits the dates on its parent', () => {
    const issue = buildIssue('Sub-task', 'In Progress', 'indeterminate', { duedate: LONG_PAST_DATE });
    expect(flagIdsFor(issue)).not.toContain('due-date-overdue');
  });

  test('says nothing once the issue is Done', () => {
    const issue = buildIssue('Story', 'Done', 'done', { duedate: LONG_PAST_DATE });
    expect(flagIdsFor(issue)).not.toContain('due-date-overdue');
  });

  test('DOES ask a Story for a due date, now that one is derived from the fix version', () => {
    // A deliberate reversal, in lockstep with the client: the due date follows from the release, so
    // a missing one is fixable in a single action rather than a hundred manual edits.
    const issue = buildIssue('Story', 'In Progress', 'indeterminate', { duedate: null });
    expect(flagIdsFor(issue)).toContain('missing-due-date');
  });
});

describe('server hygiene — target end overdue until the Feature reaches testing', () => {
  const pastTargetEnd = { customfield_10102: LONG_PAST_DATE };

  for (const [statusName, statusCategoryKey] of [
    ['To Do', 'new'],
    ['Implementing', 'indeterminate'],
    ['In Progress', 'indeterminate'],
    ['In Review', 'indeterminate'],
    ['Blocked', 'indeterminate'],
  ]) {
    test(`flags a Feature sitting in ${statusName}`, () => {
      const issue = buildIssue('Feature', statusName, statusCategoryKey, pastTargetEnd);
      expect(flagIdsFor(issue)).toContain('target-end-overdue');
    });
  }

  for (const [statusName, statusCategoryKey] of [
    ['Integrated Test', 'indeterminate'],
    ['Ready for QA', 'indeterminate'],
    ['Ready to Accept', 'indeterminate'],
    ['Done', 'done'],
  ]) {
    test(`stays quiet once the Feature reaches ${statusName}`, () => {
      const issue = buildIssue('Feature', statusName, statusCategoryKey, pastTargetEnd);
      expect(flagIdsFor(issue)).not.toContain('target-end-overdue');
    });
  }
});
