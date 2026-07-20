// hygieneRulesFixVersion.test.js — Server parity for the GH #200 fix-version scope fix.
//
// The server hygiene monitor must flag the SAME delivery types (Story/Task/Defect/Feature/Epic) as the
// client Hygiene view, so the scheduled monitor and the in-app tile agree.

'use strict';

const { evaluateHygieneRules } = require('../../src/services/hygieneRules');

function buildIssue(issueTypeName, fixVersions) {
  return {
    key: 'TBX-1',
    fields: {
      summary: 'A delivery item',
      issuetype: { name: issueTypeName },
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
      fixVersions,
    },
  };
}

function hasMissingFixVersion(issueTypeName, fixVersions) {
  return evaluateHygieneRules(buildIssue(issueTypeName, fixVersions), {})
    .some((flag) => flag.checkId === 'missing-fix-version');
}

describe('server hygiene — missing fix version scope (GH #200)', () => {
  // "Epic" excluded — this instance's hierarchy tops out at Feature (GH #200 follow-up).
  for (const issueTypeName of ['Story', 'Task', 'Defect', 'Feature']) {
    test(`flags ${issueTypeName} with no fix version`, () => {
      expect(hasMissingFixVersion(issueTypeName, [])).toBe(true);
    });
  }

  test('does not flag Sub-tasks (they inherit the parent release)', () => {
    expect(hasMissingFixVersion('Sub-task', [])).toBe(false);
  });

  test('does not flag an issue that already has a fix version', () => {
    expect(hasMissingFixVersion('Story', [{ name: 'R1' }])).toBe(false);
  });
});
