// subLaneLayout.test.ts — Proves a discipline's band is built in the DEV team's columns, that a
// clone which could not be read still gets a band, and that a Feature with no clones is untouched.

import { describe, expect, it } from 'vitest';

import { buildSubLanes, readSubLaneItemLists } from './subLaneLayout.ts';
import { buildRenderedColumns } from './boardColumns.ts';
import { EMPTY_QUICK_FILTER_STATE } from './boardFilters.ts';
import { UNMAPPED_COLUMN_ID, type BoardPreferences, type BoardVocabulary, type CloneClassification, type DisciplineProjects, type RollupBoardItem } from './rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const VOCABULARY: BoardVocabulary = {
  teamProfileId: 'team-a',
  columns: [
    { id: 'col-working', name: 'Working', order: 0, mappings: [{ jiraStatusName: 'Working', subStatusValue: null }] },
    { id: 'col-qa', name: 'SL Testing', order: 1, mappings: [{ jiraStatusName: 'Ready for Testing', subStatusValue: null }] },
  ],
  updatedAt: '',
  lastSyncedAt: null,
};

const COLUMNS = buildRenderedColumns(VOCABULARY);

const QE: DisciplineProjects = { name: 'QE', featureProjectKey: 'QEINT', storyProjectKeys: ['QEINT'] };
const BT: DisciplineProjects = { name: 'BT', featureProjectKey: 'BTINT', storyProjectKeys: ['BTINT'] };

const PREFERENCES: BoardPreferences = {
  teamProfileId: 'team-a',
  boardId: 1,
  laneOrder: [],
  collapsedByFeatureKey: {},
};

/** Builds an item already resolved into one of the dev team's columns. */
function buildItem(key: string, columnId: string, parentKey: string | null = null): RollupBoardItem {
  return {
    key,
    columnId,
    parentKey,
    summary: `${key} summary`,
    storyPoints: null,
    typeBucket: 'story',
    typeName: 'Story',
    assigneeDisplayName: null,
    fixVersionNames: [],
    statusName: 'Working',
    subStatusValue: null,
    featureKey: null,
    checklistCompletion: null,
    checklistItems: [],
    isFlagged: false,
    route: { steps: [], featureKey: null, precedenceRank: null, unchosenCandidates: [], notes: [] },
    issue: { key, fields: { status: { statusCategory: { name: 'In Progress' } } } },
  } as unknown as RollupBoardItem;
}

const QE_CLONE: CloneClassification = {
  kind: 'discipline', discipline: QE, cloneIssueKey: 'QEINT-610', evidence: 'cloners-link',
};

function buildInput(overrides: Partial<Parameters<typeof buildSubLanes>[0]> = {}) {
  return {
    classifications: [QE_CLONE] as CloneClassification[],
    cloneFeatureIssuesByKey: new Map<string, JiraIssue>([
      ['QEINT-610', { id: 'QEINT-610', key: 'QEINT-610', fields: { summary: 'QE copy' } } as unknown as JiraIssue],
    ]),
    itemsByCloneFeatureKey: new Map<string, RollupBoardItem[]>([['QEINT-610', [buildItem('QEINT-700', 'col-qa')]]]),
    columns: COLUMNS,
    filters: EMPTY_QUICK_FILTER_STATE,
    preferences: PREFERENCES,
    disciplineProjects: [QE, BT],
    ...overrides,
  };
}

describe('buildSubLanes', () => {
  it('builds nothing for a Feature with no clones', () => {
    // L-01: the normal case, and it must leave the lane exactly as it was before sub-lanes existed.
    expect(buildSubLanes(buildInput({ classifications: [] }))).toEqual([]);
  });

  it('builds nothing for a peer clone in the dev team\'s own project', () => {
    const peer: CloneClassification = { kind: 'peer', cloneIssueKey: 'DENP-1359' };

    expect(buildSubLanes(buildInput({ classifications: [peer] }))).toEqual([]);
  });

  it('builds nothing for a clone in a project nobody configured', () => {
    const unconfigured: CloneClassification = { kind: 'unconfigured', cloneIssueKey: 'X-1', projectKey: 'X' };

    expect(buildSubLanes(buildInput({ classifications: [unconfigured] }))).toEqual([]);
  });

  it('places the discipline\'s work in the DEV team\'s columns', () => {
    // L-02 / FR-007: one board with one set of columns, not three boards stacked.
    const [subLane] = buildSubLanes(buildInput());

    expect(subLane.cellsByColumnId['col-qa'].looseItems.map((item) => item.key)).toEqual(['QEINT-700']);
  });

  it('sends a clone status no column claims to Unmapped rather than dropping it', () => {
    // L-03 / FR-007a: another team's workflow will contain statuses this vocabulary never claimed,
    // and that is the normal case here, not an error.
    const subLanes = buildSubLanes(buildInput({
      itemsByCloneFeatureKey: new Map([['QEINT-610', [buildItem('QEINT-701', 'a-column-this-board-lacks')]]]),
    }));

    expect(subLanes[0].cellsByColumnId[UNMAPPED_COLUMN_ID].looseItems.map((item) => item.key))
      .toEqual(['QEINT-701']);
  });

  it('still builds a band for a clone that could not be read', () => {
    // L-04 / FR-010: an absent sub-lane must always mean "no clone", never "a clone we failed to read".
    const [subLane] = buildSubLanes(buildInput({ cloneFeatureIssuesByKey: new Map() }));

    expect(subLane).toBeDefined();
    expect(subLane.cloneFeatureIssue).toBeNull();
  });

  it('marks a clone found by name as an inference', () => {
    const [subLane] = buildSubLanes(buildInput({
      classifications: [{ ...QE_CLONE, evidence: 'feature-name-match' }],
    }));

    expect(subLane.isInferredMatch).toBe(true);
  });

  it('marks a clone found by link as a fact', () => {
    expect(buildSubLanes(buildInput())[0].isInferredMatch).toBe(false);
  });

  it('gives each discipline its own stable tone', () => {
    const btClone: CloneClassification = {
      kind: 'discipline', discipline: BT, cloneIssueKey: 'BTINT-90', evidence: 'cloners-link',
    };
    const subLanes = buildSubLanes(buildInput({ classifications: [QE_CLONE, btClone] }));

    expect(subLanes[0].toneIndex).not.toBe(subLanes[1].toneIndex);
  });

  it('starts collapsed, so three disciplines do not treble the board height', () => {
    expect(buildSubLanes(buildInput())[0].isCollapsed).toBe(true);
  });

  it('honours a viewer who has opened this band before', () => {
    const opened = { ...PREFERENCES, collapsedByFeatureKey: { 'QEINT-610': false } };

    expect(buildSubLanes(buildInput({ preferences: opened }))[0].isCollapsed).toBe(false);
  });

  it('applies the quick filters to sub-lane cards on the same terms as primary cards', () => {
    // L-07 / FR-012.
    const filters = { ...EMPTY_QUICK_FILTER_STATE, typeBuckets: new Set(['defect']) };
    const [subLane] = buildSubLanes(buildInput({ filters: filters as never }));

    expect(subLane.matchedItemCount).toBe(0);
    // Still counts everything: "0 of 1 match" is two counts of two sets, not one count reused.
    expect(subLane.totalItemCount).toBe(1);
  });

  it('resolves a parent within the sub-lane, never against a dev issue of the same key', () => {
    const subLanes = buildSubLanes(buildInput({
      itemsByCloneFeatureKey: new Map([['QEINT-610', [
        buildItem('QEINT-700', 'col-qa'),
        buildItem('QEINT-701', 'col-qa', 'QEINT-700'),
      ]]]),
    }));

    const container = subLanes[0].cellsByColumnId['col-qa'].containers[0];
    expect(container.parentKey).toBe('QEINT-700');
    expect(container.isParentInScope).toBe(true);
  });
});

describe('readSubLaneItemLists', () => {
  it('hands the family figure one list per discipline', () => {
    expect(readSubLaneItemLists(buildSubLanes(buildInput()))).toEqual([[expect.objectContaining({ key: 'QEINT-700' })]]);
  });

  it('reads nothing from a Feature with no bands', () => {
    expect(readSubLaneItemLists([])).toEqual([]);
  });
});
