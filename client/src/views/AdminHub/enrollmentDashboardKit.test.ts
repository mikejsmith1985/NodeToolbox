// enrollmentDashboardKit.test.ts — Proves the Enrollment Dashboard Kit builds the right per-gadget clauses.
//
// The dashboard runs on ONE saved filter the owner already wrote ("All of Enrollment Query"); every gadget narrows
// it with a Rich Filters clause. These tests pin that the kit finds that filter by name, scopes each clause inside
// it for a live count, and builds each team's clause exactly (team project + that team's PO-owned Epics).

import { describe, expect, it } from 'vitest';

import {
  BASE_FILTER_NAME,
  KIT_TEAMS,
  buildRichFilterClauses,
  buildFieldJqlReference,
  pickBaseFilterId,
  quoteJqlValue,
  readDoneStatusNames,
  scopeClauseToBase,
  type KitInputs,
} from './enrollmentDashboardKit.ts';

const INPUTS: KitInputs = {
  productOwnerFieldReference: '"Product Owner"',
  productOwnerUserByTeam: { CUC: 'U581996', TRANSFORMERS: 'U586310' },
  doneStatusNames: ['Done', 'Cancelled'],
};

/** Finds one clause by its name so each test reads like the dashboard gadget it feeds. */
function findClause(name: string) {
  const clause = buildRichFilterClauses(INPUTS).find((candidate) => candidate.name === name);
  if (!clause) throw new Error(`no clause named "${name}"`);
  return clause;
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

describe('buildRichFilterClauses', () => {
  it('scopes each team to its own project plus only its own PO Epics — no PM clause', () => {
    expect(findClause('CUC')).toMatchObject({
      tab: 'Smart filter "Team"', clause: 'project = ENCUC OR (issuetype = Epic AND "Product Owner" = "U581996")',
    });
    expect(findClause('TRANSFORMERS').clause).toBe('project = ENFCT OR (issuetype = Epic AND "Product Owner" = "U586310")');
    expect(findClause('CUC').clause).not.toMatch(/Project Manager/i);
  });

  it('keeps Epics out of team-level work so Epic sizes never inflate WIP or points', () => {
    const teamWork = findClause('Team Work').clause;
    expect(teamWork).toContain('issuetype != Epic');
    expect(teamWork).toContain('issuetype not in subTaskIssueTypes()');
  });

  it('builds the Epics view from PO ownership outside the team projects', () => {
    expect(findClause('Epics').clause).toBe(
      'issuetype = Epic AND "Product Owner" in ("U581996", "U586310") AND project not in (ENCUC, ENFCT)',
    );
  });

  it('defines "done recently" from the instance own done statuses, not a hard-coded list', () => {
    expect(findClause('Done 30 Days').clause).toContain('status CHANGED TO ("Done", "Cancelled") AFTER -30d');
  });

  it('gives the status slices as static filters', () => {
    expect(findClause('In Progress')).toMatchObject({ tab: 'Static filter', clause: 'statusCategory = "In Progress"' });
  });

  it('omits the done-recently clause when the instance reports no done statuses', () => {
    const clauses = buildRichFilterClauses({ ...INPUTS, doneStatusNames: [] });
    expect(clauses.some((clause) => clause.name === 'Done 30 Days')).toBe(false);
  });
});

describe('pickBaseFilterId', () => {
  it('finds the existing base filter by its exact name', () => {
    expect(BASE_FILTER_NAME).toBe('All of Enrollment Query');
    const filters = [{ id: '1', name: 'Other', jql: 'x' }, { id: '266430', name: 'All of Enrollment Query', jql: 'y' }];
    expect(pickBaseFilterId(filters)).toBe('266430');
  });

  it('picks nothing when that filter is not among the favourites', () => {
    expect(pickBaseFilterId([{ id: '1', name: 'Other', jql: 'x' }])).toBe('');
  });
});

describe('scopeClauseToBase', () => {
  it('runs a clause inside the base filter, so its count is what the gadget will show', () => {
    expect(scopeClauseToBase('project in (ENCUC, ENFCT)', 'statusCategory = Done'))
      .toBe('(project in (ENCUC, ENFCT)) AND (statusCategory = Done)');
  });

  it('drops the base filter ORDER BY, which is not allowed inside parentheses', () => {
    expect(scopeClauseToBase('project = ENCUC ORDER BY Rank ASC', 'Flagged is not EMPTY'))
      .toBe('(project = ENCUC) AND (Flagged is not EMPTY)');
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
