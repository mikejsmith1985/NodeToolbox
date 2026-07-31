// piReviewSchedulerImport.test.ts — Unit tests for turning configured team PI Review pages into
// scheduler entries (the Admin Hub sync panel's picker).

import { describe, expect, it } from 'vitest';

import {
  buildImportableTeamPages,
  findSchedulerTeamIndexByName,
  mergeImportedTeamPages,
} from './piReviewSchedulerImport.ts';
import type { ImportableTeamPages, SchedulerTeamEntry } from './piReviewSchedulerImport.ts';
import type { SprintDashboardTeamProfile } from '../../store/settingsStore.ts';

function profile(overrides: Partial<SprintDashboardTeamProfile>): SprintDashboardTeamProfile {
  return {
    id: 'profile-1',
    name: 'Transformers',
    projectKey: 'TRF',
    boardId: '77',
    boardName: 'TRF board',
    boardType: 'scrum',
    scopeMode: 'sprint',
    selectedSprintId: '',
    selectedFixVersion: '',
    selectedPiValue: '',
    piReviewPages: [{ piName: 'PI 26.4', pageUrl: 'https://wiki/pages/12345' }],
    ...overrides,
  };
}

function schedulerTeam(overrides: Partial<SchedulerTeamEntry>): SchedulerTeamEntry {
  return {
    teamName: 'Transformers',
    isEnabled: true,
    scheduleTime: '06:30',
    intervalMin: 0,
    productOwnerAssignee: 'C73130',
    piFieldId: 'customfield_10301',
    dependencyLinkTypes: [],
    pages: [{ pageUrlOrId: 'https://wiki/pages/12345', piName: 'PI 26.4' }],
    ...overrides,
  };
}

function importable(overrides: Partial<ImportableTeamPages>): ImportableTeamPages {
  return {
    profileId: 'profile-1',
    teamName: 'Transformers',
    suggestedProductOwner: 'C73130',
    pages: [{ pageUrlOrId: 'https://wiki/pages/12345', piName: 'PI 26.4' }],
    ...overrides,
  };
}

describe('buildImportableTeamPages', () => {
  it('collects pages per profile and suggests the roster Product Owner', () => {
    const importableTeams = buildImportableTeamPages(
      [profile({})],
      () => [
        { assigneeQueryValue: 'DEV1', roleCapabilities: { canProductOwner: false } },
        { assigneeQueryValue: 'C73130', roleCapabilities: { canProductOwner: true } },
      ],
    );

    expect(importableTeams).toHaveLength(1);
    expect(importableTeams[0].teamName).toBe('Transformers');
    expect(importableTeams[0].suggestedProductOwner).toBe('C73130');
    expect(importableTeams[0].pages).toEqual([{ pageUrlOrId: 'https://wiki/pages/12345', piName: 'PI 26.4' }]);
  });

  it('skips profiles with no configured pages and pages without a URL', () => {
    const importableTeams = buildImportableTeamPages(
      [
        profile({ id: 'p-empty', name: 'No Pages', piReviewPages: [] }),
        profile({ id: 'p-blank', name: 'Blank Url', piReviewPages: [{ piName: 'PI 26.4', pageUrl: '  ' }] }),
        profile({}),
      ],
      () => [],
    );

    expect(importableTeams.map((team) => team.teamName)).toEqual(['Transformers']);
  });

  it('suggests a blank Product Owner when the roster has none flagged', () => {
    const importableTeams = buildImportableTeamPages([profile({})], () => []);
    expect(importableTeams[0].suggestedProductOwner).toBe('');
  });
});

describe('findSchedulerTeamIndexByName', () => {
  it('matches team names case-insensitively', () => {
    expect(findSchedulerTeamIndexByName([schedulerTeam({})], '  transformers ')).toBe(0);
    expect(findSchedulerTeamIndexByName([schedulerTeam({})], 'Autobots')).toBe(-1);
  });
});

describe('mergeImportedTeamPages', () => {
  it('appends a new (disabled) team with defaults and the PO suggestion prefilled', () => {
    const merged = mergeImportedTeamPages([], importable({}), importable({}).pages);

    expect(merged).toHaveLength(1);
    expect(merged[0].teamName).toBe('Transformers');
    expect(merged[0].isEnabled).toBe(false); // operator explicitly enables scheduling
    expect(merged[0].intervalMin).toBe(0);
    expect(merged[0].productOwnerAssignee).toBe('C73130');
    expect(merged[0].pages).toEqual(importable({}).pages);
  });

  it('adds only the missing pages to an existing team and keeps operator-set fields', () => {
    const existingTeams = [schedulerTeam({ intervalMin: 30, productOwnerAssignee: 'KEEP-ME' })];
    const merged = mergeImportedTeamPages(
      existingTeams,
      importable({
        suggestedProductOwner: 'IGNORED',
        pages: [
          { pageUrlOrId: 'https://wiki/pages/12345', piName: 'PI 26.4' }, // already present
          { pageUrlOrId: 'https://wiki/pages/67890', piName: 'PI 26.5' }, // new
        ],
      }),
      [
        { pageUrlOrId: 'https://wiki/pages/12345', piName: 'PI 26.4' },
        { pageUrlOrId: 'https://wiki/pages/67890', piName: 'PI 26.5' },
      ],
    );

    expect(merged[0].pages).toHaveLength(2);
    expect(merged[0].productOwnerAssignee).toBe('KEEP-ME');
    expect(merged[0].intervalMin).toBe(30);
  });

  it('fills a blank Product Owner on an existing team from the roster suggestion', () => {
    const merged = mergeImportedTeamPages(
      [schedulerTeam({ productOwnerAssignee: '' })],
      importable({ suggestedProductOwner: 'C73130' }),
      importable({}).pages,
    );
    expect(merged[0].productOwnerAssignee).toBe('C73130');
  });

  it('returns the config unchanged when no pages are selected', () => {
    const existingTeams = [schedulerTeam({})];
    expect(mergeImportedTeamPages(existingTeams, importable({}), [])).toBe(existingTeams);
  });
});
