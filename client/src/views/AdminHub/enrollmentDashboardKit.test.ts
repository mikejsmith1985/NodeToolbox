// enrollmentDashboardKit.test.ts — Proves the Enrollment Dashboard Kit builds the right JQL and plans safe writes.
//
// The kit writes saved filters to production Jira, so these tests pin the two things that matter:
// the JQL scopes each team exactly (team project + that team's PO-owned Epics, nothing else), and the
// planner only creates what is missing, updates what drifted, and leaves matching filters alone.

import { describe, expect, it } from 'vitest';

import {
  KIT_TEAMS,
  buildKitFilters,
  buildRichFilterClauses,
  buildFieldJqlReference,
  quoteJqlValue,
  planFilterActions,
  planMissingProjectShares,
  readDoneStatusNames,
  type KitInputs,
} from './enrollmentDashboardKit.ts';

const INPUTS: KitInputs = {
  productOwnerFieldReference: '"Product Owner"',
  productOwnerUserByTeam: { CUC: 'U581996', TRANSFORMERS: 'U586310' },
  doneStatusNames: ['Done', 'Cancelled'],
};

/** Finds one built filter by its name suffix so each test reads like the dashboard it feeds. */
function findFilter(suffix: string) {
  const filter = buildKitFilters(INPUTS).find((candidate) => candidate.name.endsWith(suffix));
  if (!filter) throw new Error(`no filter ending "${suffix}"`);
  return filter;
}

describe('KIT_TEAMS', () => {
  it('defines the two Enrollment teams with their own team-level projects', () => {
    expect(KIT_TEAMS.map((team) => [team.label, team.projectKey])).toEqual([
      ['CUC', 'ENCUC'],
      ['TRANSFORMERS', 'ENFCT'],
    ]);
  });
});

describe('quoteJqlValue', () => {
  it('wraps a value in double quotes and escapes embedded quotes and backslashes', () => {
    expect(quoteJqlValue('U581996')).toBe('"U581996"');
    expect(quoteJqlValue('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe('buildFieldJqlReference', () => {
  const fields = [
    { id: 'field_1', name: 'Product Owner' },
    { id: 'field_2', name: 'Story Points' },
  ];

  it('uses the quoted display name when exactly one field carries it', () => {
    expect(buildFieldJqlReference('field_1', fields)).toBe('"Product Owner"');
  });

  it('falls back to cf[id] when two fields share the display name (JQL by name would be ambiguous)', () => {
    const duplicated = [...fields, { id: 'field_3', name: 'Product Owner' }];
    expect(buildFieldJqlReference('field_3', duplicated)).toBe('cf[3]');
  });

  it('returns null when the field id is unknown', () => {
    expect(buildFieldJqlReference('field_9', fields)).toBeNull();
    expect(buildFieldJqlReference('', fields)).toBeNull();
  });
});

describe('buildKitFilters', () => {
  it('scopes the base filter to both team projects plus Epics owned by either PO — no PM clause', () => {
    const base = findFilter('All Work');
    expect(base.jql).toBe(
      'project in (ENCUC, ENFCT) OR (issuetype = Epic AND "Product Owner" in ("U581996", "U586310"))',
    );
    expect(base.jql).not.toMatch(/Project Manager/i);
  });

  it('scopes each team to its own project plus only its own PO\'s Epics', () => {
    expect(findFilter('Team CUC').jql).toBe('project = ENCUC OR (issuetype = Epic AND "Product Owner" = "U581996")');
    expect(findFilter('Team Transformers').jql).toBe(
      'project = ENFCT OR (issuetype = Epic AND "Product Owner" = "U586310")',
    );
  });

  it('keeps Epics out of team-level work so Epic sizes never inflate WIP or points', () => {
    const teamWork = findFilter('Team Work');
    expect(teamWork.jql).toContain('project in (ENCUC, ENFCT)');
    expect(teamWork.jql).toContain('issuetype != Epic');
    expect(teamWork.jql).toContain('issuetype not in subTaskIssueTypes()');
  });

  it('builds the Epics filter from PO ownership outside the team projects', () => {
    expect(findFilter('Epics').jql).toBe(
      'issuetype = Epic AND "Product Owner" in ("U581996", "U586310") AND project not in (ENCUC, ENFCT)',
    );
  });

  it('defines "done recently" from the instance\'s own done statuses, not a hard-coded list', () => {
    expect(findFilter('Done 30 Days').jql).toContain('status CHANGED TO ("Done", "Cancelled") AFTER -30d');
  });

  it('scopes every slice filter to team-level work', () => {
    for (const suffix of ['In Progress', 'Done 30 Days', 'Upcoming', 'Flagged', 'Stuck 10 Days']) {
      expect(findFilter(suffix).jql.startsWith('(project in (ENCUC, ENFCT) AND issuetype != Epic')).toBe(true);
    }
  });

  it('gives every filter a unique, prefixed name so re-runs find and update rather than duplicate', () => {
    const names = buildKitFilters(INPUTS).map((filter) => filter.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith('Enrollment Kit — '))).toBe(true);
  });

  it('omits the done-recently filter when the instance reports no done statuses', () => {
    const filters = buildKitFilters({ ...INPUTS, doneStatusNames: [] });
    expect(filters.some((filter) => filter.name.endsWith('Done 30 Days'))).toBe(false);
  });
});

describe('buildRichFilterClauses', () => {
  it('returns clause-only JQL for the rich filter tabs (the base filter already scopes the data)', () => {
    const clauses = buildRichFilterClauses(INPUTS);
    const smartCuc = clauses.find((clause) => clause.name === 'CUC');
    expect(smartCuc?.tab).toBe('Smart filter "Team"');
    expect(smartCuc?.clause).toBe('project = ENCUC OR (issuetype = Epic AND "Product Owner" = "U581996")');
    const inProgress = clauses.find((clause) => clause.name === 'In Progress');
    expect(inProgress?.clause).toBe('statusCategory = "In Progress"');
  });
});

describe('readDoneStatusNames', () => {
  it('collects unique done-category status names across every issue type of every project', () => {
    const projectStatuses = [
      [
        { name: 'Story', statuses: [{ name: 'Done', statusCategory: { key: 'done' } }, { name: 'Working', statusCategory: { key: 'indeterminate' } }] },
        { name: 'Defect', statuses: [{ name: 'Done', statusCategory: { key: 'done' } }, { name: 'Cancelled', statusCategory: { key: 'done' } }] },
      ],
      [{ name: 'Story', statuses: [{ name: 'Closed', statusCategory: { key: 'done' } }] }],
    ];
    expect(readDoneStatusNames(projectStatuses)).toEqual(['Cancelled', 'Closed', 'Done']);
  });
});

describe('planFilterActions', () => {
  const desired = [
    { name: 'Enrollment Kit — A', jql: 'project = ENCUC', description: 'a' },
    { name: 'Enrollment Kit — B', jql: 'project = ENFCT', description: 'b' },
    { name: 'Enrollment Kit — C', jql: 'issuetype = Epic', description: 'c' },
  ];

  it('creates missing filters, updates drifted ones, and leaves matching ones unchanged', () => {
    const existing = [
      { id: '10', name: 'Enrollment Kit — A', jql: 'project  =  ENCUC' },
      { id: '11', name: 'Enrollment Kit — B', jql: 'project = OLD' },
      { id: '12', name: 'Someone else\'s filter', jql: 'x' },
    ];
    const plan = planFilterActions(desired, existing);
    expect(plan.map((row) => [row.name, row.action, row.existingId])).toEqual([
      ['Enrollment Kit — A', 'unchanged', '10'],
      ['Enrollment Kit — B', 'update', '11'],
      ['Enrollment Kit — C', 'create', null],
    ]);
  });
});

describe('planMissingProjectShares', () => {
  it('returns only the project ids the filter is not already shared with', () => {
    const existing = [{ type: 'project', project: { id: '100' } }, { type: 'group', group: { name: 'x' } }];
    expect(planMissingProjectShares(existing, ['100', '200'])).toEqual(['200']);
  });
});
