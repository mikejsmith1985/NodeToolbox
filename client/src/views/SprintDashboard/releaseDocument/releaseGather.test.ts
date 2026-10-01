// releaseGather.test.ts — Gathering one release from Jira across the projects a team's Epics live in (GH #395).

import { describe, expect, it, vi } from 'vitest';

import { gatherRelease, type GatherIssue, type ReleaseGatherDeps } from './releaseGather.ts';

const FEATURE_LINK_FIELD = 'customfield_90001';
const EPIC_LINK_FIELD = 'customfield_90002';

/** A Jira issue as the gather step receives it. */
function buildIssue(key: string, overrides: Record<string, unknown> = {}): GatherIssue {
  return {
    key,
    fields: {
      summary: `${key} summary`,
      issuetype: { name: key.startsWith('ENCUC') ? 'Story' : 'Epic' },
      status: { name: 'In Progress' },
      assignee: { displayName: 'Smith, Mike' },
      fixVersions: [{ name: '10/14/2026' }],
      project: { key: key.split('-')[0] },
      ...overrides,
    },
  };
}

const childUnderDasp = buildIssue('ENCUC-1', { parent: { key: 'DASP-10' } });
const childUnderDenp = buildIssue('ENCUC-2', { [FEATURE_LINK_FIELD]: 'DENP-20' });
const orphanChild = buildIssue('ENCUC-3');
const daspEpic = buildIssue('DASP-10');
const denpEpic = buildIssue('DENP-20');
// An Epic carrying the release whose only team child sits in a different release.
const sameNameDenpEpic = buildIssue('DENP-30');
const childOfSameNameEpic = buildIssue('ENCUC-9', { parent: { key: 'DENP-30' }, fixVersions: [{ name: '11/11/2026' }] });
// Another team's Epic with the same version name and no ENCUC child.
const otherTeamEpic = buildIssue('DENP-40');

/** A fake Jira answering each search by what its JQL asks for. */
function buildDeps(options: { failingProject?: string } = {}): ReleaseGatherDeps {
  return {
    searchAll: vi.fn(async (jql: string) => {
      if (jql.startsWith('project = "ENCUC" AND fixVersion')) {
        return [childUnderDasp, childUnderDenp, orphanChild];
      }
      if (options.failingProject && jql.includes(`project = "${options.failingProject}"`)) {
        throw new Error('400: version does not exist in this project');
      }
      if (jql.startsWith('project = "DASP" AND fixVersion')) {
        return [daspEpic];
      }
      if (jql.startsWith('project = "DENP" AND fixVersion')) {
        return [denpEpic, sameNameDenpEpic, otherTeamEpic];
      }
      if (jql.startsWith('project = "ENCUC" AND (')) {
        return [childUnderDasp, childUnderDenp, childOfSameNameEpic];
      }
      return [];
    }),
    fetchByKeys: vi.fn(async (keys: readonly string[]) => [daspEpic, denpEpic].filter((epic) => keys.includes(epic.key))),
  };
}

const BASE_INPUT = {
  teamProjectKey: 'ENCUC',
  versionName: '10/14/2026',
  featureLinkField: FEATURE_LINK_FIELD,
  epicLinkFieldId: EPIC_LINK_FIELD,
  extraEpicProjectKeys: [],
};

describe('gatherRelease', () => {
  it('lists each child under its Epic, wherever the Epic lives', async () => {
    const { groups } = await gatherRelease(BASE_INPUT, buildDeps());

    const daspGroup = groups.find((group) => group.epicKey === 'DASP-10');
    const denpGroup = groups.find((group) => group.epicKey === 'DENP-20');
    expect(daspGroup?.items.map((item) => item.key)).toEqual(['ENCUC-1']);
    expect(denpGroup?.items.map((item) => item.key)).toEqual(['ENCUC-2']);
    expect(daspGroup?.epic?.statusName).toBe('In Progress');
  });

  it('keeps children with no Epic in a last "No Epic" group', async () => {
    const { groups } = await gatherRelease(BASE_INPUT, buildDeps());

    expect(groups.at(-1)).toEqual(expect.objectContaining({ epicKey: null, epic: null }));
    expect(groups.at(-1)?.items.map((item) => item.key)).toEqual(['ENCUC-3']);
  });

  it('adds an Epic carrying the release by name when it has a team child, and records that child as outside', async () => {
    const { groups } = await gatherRelease(BASE_INPUT, buildDeps());

    const sameNameGroup = groups.find((group) => group.epicKey === 'DENP-30');
    expect(sameNameGroup?.items).toEqual([]);
    expect(sameNameGroup?.outsideItems).toEqual([{ key: 'ENCUC-9', fixVersionNames: ['11/11/2026'] }]);
  });

  it('leaves out another team\'s Epic that merely shares the version name', async () => {
    const { groups } = await gatherRelease(BASE_INPUT, buildDeps());

    expect(groups.some((group) => group.epicKey === 'DENP-40')).toBe(false);
  });

  it('keeps the children of an Epic it cannot read, under that Epic\'s key', async () => {
    const deps = buildDeps();
    deps.fetchByKeys = vi.fn(async () => [daspEpic]);

    const { groups } = await gatherRelease(BASE_INPUT, deps);

    const unreadableGroup = groups.find((group) => group.epicKey === 'DENP-20');
    expect(unreadableGroup?.epic).toBeNull();
    expect(unreadableGroup?.items.map((item) => item.key)).toEqual(['ENCUC-2']);
  });

  it('treats one project\'s failed search as a warning, not a failed release', async () => {
    const { groups, warnings } = await gatherRelease(BASE_INPUT, buildDeps({ failingProject: 'DENP' }));

    expect(groups.find((group) => group.epicKey === 'DASP-10')).toBeDefined();
    expect(warnings).toEqual([expect.stringContaining('DENP')]);
  });

  it('also searches the team\'s feature projects, but never the team project for Epics', async () => {
    const deps = buildDeps();

    await gatherRelease({ ...BASE_INPUT, extraEpicProjectKeys: ['DFEAT', 'ENCUC'] }, deps);

    const searchedJql = vi.mocked(deps.searchAll).mock.calls.map(([jql]) => jql);
    expect(searchedJql).toContain('project = "DFEAT" AND fixVersion = "10/14/2026"');
    expect(searchedJql.filter((jql) => jql === 'project = "ENCUC" AND fixVersion = "10/14/2026"')).toHaveLength(0);
  });

  it('looks up Epic children by parent and by the Epic Link field id it is given', async () => {
    const deps = buildDeps();

    await gatherRelease(BASE_INPUT, deps);

    const childLookup = vi.mocked(deps.searchAll).mock.calls.map(([jql]) => jql).find((jql) => jql.startsWith('project = "ENCUC" AND ('));
    expect(childLookup).toContain('parent in (');
    expect(childLookup).toContain('cf[90002] in (');
  });

  it('flags misalignments on each group it gathers', async () => {
    const deps = buildDeps();
    deps.fetchByKeys = vi.fn(async () => [daspEpic, { ...denpEpic, fields: { ...denpEpic.fields, fixVersions: [{ name: '12/1/2026' }] } }]);

    const { groups } = await gatherRelease(BASE_INPUT, deps);

    expect(groups.find((group) => group.epicKey === 'DENP-20')?.misalignments.map((misalignment) => misalignment.kind))
      .toEqual(['epic-in-other-version']);
    expect(groups.find((group) => group.epicKey === 'DENP-30')?.misalignments.map((misalignment) => misalignment.message))
      .toEqual(['ENCUC-9 is in 11/11/2026, not this release.']);
    expect(groups.find((group) => group.epicKey === 'DASP-10')?.misalignments).toEqual([]);
  });

  it('orders Epic groups by key', async () => {
    const { groups } = await gatherRelease(BASE_INPUT, buildDeps());

    expect(groups.map((group) => group.epicKey)).toEqual(['DASP-10', 'DENP-20', 'DENP-30', null]);
  });
});
