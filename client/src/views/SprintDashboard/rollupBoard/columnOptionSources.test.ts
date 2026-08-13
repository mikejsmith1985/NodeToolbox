// columnOptionSources.test.ts — Proves the mapping editor can only offer values Jira will accept.
//
// A free-text mapping would fail at the moment someone drags a card, which is the worst possible
// time to find out. So when nothing can be offered, the editor must say so rather than guess.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchTransitions, mockFetchEditMeta } = vi.hoisted(() => ({
  mockFetchTransitions: vi.fn(),
  mockFetchEditMeta: vi.fn(),
}));

vi.mock('../featureReviewFixes.ts', () => ({
  fetchFeatureReviewTransitions: mockFetchTransitions,
  fetchFeatureReviewEditMeta: mockFetchEditMeta,
}));

import {
  collectObservedBoardStates,
  collectUnmappedBoardStates,
  countIssuesMatchingMappings,
  loadColumnOptionSources,
} from './columnOptionSources.ts';
import type { RollupBoardItem } from './rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const SUB_STATUS_FIELD = 'customfield_10201';

function buildItem(key: string, statusName: string, subStatusValue: string | null = null): RollupBoardItem {
  return {
    issue: { id: key, key, fields: { summary: key } } as unknown as JiraIssue,
    key,
    summary: key,
    typeBucket: 'story',
    typeName: 'Story',
    parentKey: null,
    route: { steps: [], featureKey: 'FEAT-1', precedenceRank: null, unchosenCandidates: [], notes: [] },
    featureKey: 'FEAT-1',
    columnId: '__unmapped__',
    statusName,
    subStatusValue,
    assigneeAccountId: null,
    assigneeDisplayName: null,
    fixVersionNames: [],
    storyPoints: null,
    checklistCompletion: null,
    checklistItems: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchTransitions.mockResolvedValue([]);
  mockFetchEditMeta.mockResolvedValue({});
});

describe('loadColumnOptionSources — statuses', () => {
  it('offers the statuses the board\'s issues are actually sitting in', async () => {
    const sources = await loadColumnOptionSources(
      [buildItem('DEV-1', 'To Do'), buildItem('DEV-2', 'In Progress')],
      SUB_STATUS_FIELD,
    );

    expect(sources.statusNames).toEqual(['In Progress', 'To Do']);
  });

  it('also offers statuses the workflow can reach but nothing is in yet', async () => {
    mockFetchTransitions.mockResolvedValue([{ id: '31', name: 'Accept', to: { name: 'Accepted' }, requiredFields: [], screenFieldIds: [] }]);

    const sources = await loadColumnOptionSources([buildItem('DEV-1', 'To Do')], SUB_STATUS_FIELD);

    expect(sources.statusNames).toContain('Accepted');
  });

  it('lists each status once, however many issues are in it', async () => {
    const sources = await loadColumnOptionSources(
      [buildItem('DEV-1', 'To Do'), buildItem('DEV-2', 'To Do'), buildItem('DEV-3', 'To Do')],
      SUB_STATUS_FIELD,
    );

    expect(sources.statusNames).toEqual(['To Do']);
  });

  it('samples one issue per status rather than every issue on the board', async () => {
    await loadColumnOptionSources(
      [buildItem('DEV-1', 'To Do'), buildItem('DEV-2', 'To Do'), buildItem('DEV-3', 'In Progress')],
      SUB_STATUS_FIELD,
    );

    expect(mockFetchTransitions).toHaveBeenCalledTimes(2);
  });

  it('still returns the statuses it knows when a metadata call fails', async () => {
    mockFetchTransitions.mockRejectedValue(new Error('transitions unavailable'));

    const sources = await loadColumnOptionSources([buildItem('DEV-1', 'To Do')], SUB_STATUS_FIELD);

    expect(sources.statusNames).toEqual(['To Do']);
  });
});

describe('loadColumnOptionSources — sub-statuses', () => {
  it('offers the values Jira says the sub-status field accepts', async () => {
    mockFetchEditMeta.mockResolvedValue({
      [SUB_STATUS_FIELD]: { allowedValues: [{ id: '1', value: 'Dev In Progress' }, { id: '2', value: 'Dev Complete' }] },
    });

    const sources = await loadColumnOptionSources([buildItem('DEV-1', 'In Progress')], SUB_STATUS_FIELD);

    expect(sources.subStatusValues).toEqual(['Dev Complete', 'Dev In Progress']);
    expect(sources.isSubStatusUnavailable).toBe(false);
  });

  it('counts a value already sitting on an issue as one Jira accepts', async () => {
    const sources = await loadColumnOptionSources(
      [buildItem('DEV-1', 'In Progress', 'Code Review')],
      SUB_STATUS_FIELD,
    );

    expect(sources.subStatusValues).toContain('Code Review');
  });

  it('reports the field as unavailable when this instance has none, rather than offering free text', async () => {
    const sources = await loadColumnOptionSources([buildItem('DEV-1', 'To Do')], '');

    expect(sources.isSubStatusUnavailable).toBe(true);
    expect(sources.subStatusValues).toEqual([]);
    // No point asking Jira about a field that does not exist here.
    expect(mockFetchEditMeta).not.toHaveBeenCalled();
  });

  it('reports the field as unavailable when no in-scope issue exposes it', async () => {
    const sources = await loadColumnOptionSources([buildItem('DEV-1', 'To Do')], SUB_STATUS_FIELD);

    expect(sources.isSubStatusUnavailable).toBe(true);
  });

  it('survives a failed edit-meta call without losing the statuses it already has', async () => {
    mockFetchEditMeta.mockRejectedValue(new Error('edit meta unavailable'));

    const sources = await loadColumnOptionSources([buildItem('DEV-1', 'To Do')], SUB_STATUS_FIELD);

    expect(sources.statusNames).toEqual(['To Do']);
    expect(sources.isSubStatusUnavailable).toBe(true);
  });
});

describe('collectObservedBoardStates — turning a blank page into a rename', () => {
  it('lists each state combination the board is actually in, with its issue count', () => {
    const states = collectObservedBoardStates([
      buildItem('DEV-1', 'In Progress', 'Dev Complete'),
      buildItem('DEV-2', 'In Progress', 'Dev Complete'),
      buildItem('DEV-3', 'To Do', null),
    ]);

    expect(states).toHaveLength(2);
    expect(states[0]).toMatchObject({ jiraStatusName: 'In Progress', subStatusValue: 'Dev Complete', issueCount: 2 });
  });

  it('puts the busiest states first, so the most useful columns get named first', () => {
    const states = collectObservedBoardStates([
      buildItem('DEV-1', 'To Do', null),
      buildItem('DEV-2', 'In Progress', 'Dev Complete'),
      buildItem('DEV-3', 'In Progress', 'Dev Complete'),
      buildItem('DEV-4', 'In Progress', 'Dev Complete'),
    ]);

    expect(states.map((state) => state.issueCount)).toEqual([3, 1]);
  });

  it('separates two sub-statuses that share a Jira status', () => {
    const states = collectObservedBoardStates([
      buildItem('DEV-1', 'In Progress', 'Dev In Progress'),
      buildItem('DEV-2', 'In Progress', 'Dev Complete'),
    ]);

    expect(states).toHaveLength(2);
  });

  it('suggests a name that reads like the state, for the viewer to replace with their own', () => {
    const [state] = collectObservedBoardStates([buildItem('DEV-1', 'In Progress', 'Dev Complete')]);

    expect(state.suggestedColumnName).toBe('In Progress — Dev Complete');
  });

  it('suggests the bare status when there is no sub-status', () => {
    const [state] = collectObservedBoardStates([buildItem('DEV-1', 'To Do', null)]);

    expect(state.suggestedColumnName).toBe('To Do');
  });

  it('only ever offers states that hold at least one issue, so no column can match nothing', () => {
    const states = collectObservedBoardStates([buildItem('DEV-1', 'To Do', null)]);

    expect(states.every((state) => state.issueCount > 0)).toBe(true);
  });

  it('ignores an issue with no status rather than offering a nameless column', () => {
    expect(collectObservedBoardStates([buildItem('DEV-1', '', null)])).toEqual([]);
  });

  it('returns nothing for an empty board', () => {
    expect(collectObservedBoardStates([])).toEqual([]);
  });
});

describe('countIssuesMatchingMapping — live feedback while mapping', () => {
  const ITEMS = [
    buildItem('DEV-1', 'In Progress', 'Dev Complete'),
    buildItem('DEV-2', 'In Progress', 'Dev In Progress'),
    buildItem('DEV-3', 'To Do', null),
  ];

  it('counts what a mapping would catch', () => {
    expect(countIssuesMatchingMappings(ITEMS, [{ jiraStatusName: 'In Progress', subStatusValue: 'Dev Complete' }], true)).toBe(1);
  });

  it('returns zero for a column that claims no status yet', () => {
    expect(countIssuesMatchingMappings(ITEMS, [], true)).toBe(0);
  });

  it('shows zero for a mapping that catches nothing, which is the point of showing it', () => {
    expect(countIssuesMatchingMappings(ITEMS, [{ jiraStatusName: 'Accepted', subStatusValue: null }], true)).toBe(0);
  });

  it('counts on status alone when this instance has no sub-status field', () => {
    expect(countIssuesMatchingMappings(ITEMS, [{ jiraStatusName: 'In Progress', subStatusValue: null }], false)).toBe(2);
  });
});

describe('collectUnmappedBoardStates — finding the statuses that fell out', () => {
  it('lists only the states currently sitting in Unmapped, commonest first', () => {
    const items = [
      { ...buildItem('DEV-1', 'In Progress', 'Code Review'), columnId: '__unmapped__' },
      { ...buildItem('DEV-2', 'In Progress', 'Code Review'), columnId: '__unmapped__' },
      { ...buildItem('DEV-3', 'Blocked', null), columnId: '__unmapped__' },
      { ...buildItem('DEV-4', 'To Do', null), columnId: 'col-todo' },
    ];

    const unmapped = collectUnmappedBoardStates(items, '__unmapped__');

    expect(unmapped.map((state) => state.suggestedColumnName)).toEqual(['In Progress — Code Review', 'Blocked']);
    expect(unmapped[0].issueCount).toBe(2);
  });

  it('returns nothing when every status already belongs to a column', () => {
    const items = [{ ...buildItem('DEV-1', 'To Do', null), columnId: 'col-todo' }];

    expect(collectUnmappedBoardStates(items, '__unmapped__')).toEqual([]);
  });
});
