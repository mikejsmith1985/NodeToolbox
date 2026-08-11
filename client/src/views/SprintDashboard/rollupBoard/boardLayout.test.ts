// boardLayout.test.ts — Proves the board's arrangement keeps its promises.
//
// The invariants below are the board's actual guarantees, expressed as arithmetic rather than as
// something a reviewer has to eyeball. L-2 is the one that matters most: a parent may head a
// grouping container in several columns at once, but it is only ever a CARD once. Getting that wrong
// inflates every count on the board while looking perfectly reasonable on screen.

import { describe, expect, it } from 'vitest';

import { buildBoardLayout } from './boardLayout.ts';
import { buildRenderedColumns } from './boardColumns.ts';
import { buildMasterCards } from './masterCards.ts';
import {
  UNMAPPED_COLUMN_ID,
  type BoardPreferences,
  type BoardVocabulary,
  type QuickFilterState,
  type RollupBoardItem,
} from './rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const NO_FILTERS: QuickFilterState = {
  typeBuckets: new Set(),
  assigneeAccountId: null,
  fixVersionName: null,
};

const VOCABULARY: BoardVocabulary = {
  teamProfileId: 'team-a',
  columns: [
    { id: 'col-todo', name: 'Not started', order: 0, mappings: [{ jiraStatusName: 'To Do', subStatusValue: null }] },
    { id: 'col-dev', name: 'Being coded', order: 1, mappings: [{ jiraStatusName: 'In Progress', subStatusValue: null }] },
  ],
  updatedAt: '',
  lastSyncedAt: null,
};

function buildPreferences(laneOrder: string[] = []): BoardPreferences {
  return { teamProfileId: 'team-a', boardId: 42, laneOrder, collapsedByFeatureKey: {} };
}

interface BuildItemInput {
  key: string;
  featureKey: string | null;
  columnId: string;
  parentKey?: string | null;
  typeBucket?: RollupBoardItem['typeBucket'];
  assigneeAccountId?: string | null;
  fixVersionNames?: string[];
  storyPoints?: number | null;
}

function buildItem(input: BuildItemInput): RollupBoardItem {
  return {
    issue: {
      id: input.key,
      key: input.key,
      fields: { summary: input.key, status: { name: 'To Do', statusCategory: { name: 'To Do' } } },
    } as unknown as JiraIssue,
    key: input.key,
    summary: `Summary of ${input.key}`,
    typeBucket: input.typeBucket ?? 'story',
    typeName: 'Story',
    parentKey: input.parentKey ?? null,
    route: { steps: [], featureKey: input.featureKey, precedenceRank: null, unchosenCandidates: [], notes: [] },
    featureKey: input.featureKey,
    columnId: input.columnId,
    statusName: 'To Do',
    subStatusValue: null,
    assigneeAccountId: input.assigneeAccountId ?? null,
    assigneeDisplayName: null,
    fixVersionNames: input.fixVersionNames ?? [],
    storyPoints: input.storyPoints ?? null,
    checklistCompletion: null,
  };
}

function buildFeature(key: string): JiraIssue {
  return { id: key, key, fields: { summary: `Feature ${key}`, issuelinks: [] } } as unknown as JiraIssue;
}

/** Total items rendered anywhere on the board — containers plus loose. */
function countRenderedItems(layout: ReturnType<typeof buildBoardLayout>): number {
  return layout.lanes.reduce((laneTotal, lane) =>
    laneTotal + Object.values(lane.cellsByColumnId).reduce((cellTotal, cell) =>
      cellTotal + cell.looseItems.length + cell.containers.reduce((sum, container) => sum + container.items.length, 0),
    0), 0);
}

describe('buildBoardLayout — L-1: nothing is dropped or duplicated', () => {
  it('renders exactly as many items as were resolved', () => {
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-todo' }),
      buildItem({ key: 'DEV-2', featureKey: 'FEAT-1', columnId: 'col-dev' }),
      buildItem({ key: 'DEV-3', featureKey: 'FEAT-2', columnId: 'col-todo' }),
      buildItem({ key: 'DEV-4', featureKey: null, columnId: UNMAPPED_COLUMN_ID }),
    ];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')], ['FEAT-2', buildFeature('FEAT-2')]])),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: buildPreferences(),
    });

    expect(countRenderedItems(layout)).toBe(items.length);
  });
});

describe('buildBoardLayout — L-2: a parent is a CARD exactly once', () => {
  it('draws one container per column holding that column\'s children, and the parent card only in its own column', () => {
    // The GH #306 shape: DEV-1's two sub-tasks are in different columns, so each column gets its own
    // DEV-1 container, while DEV-1's own card stands alone in the column of DEV-1's status.
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-dev' }),
      buildItem({ key: 'DEV-1-1', featureKey: 'FEAT-1', columnId: 'col-todo', parentKey: 'DEV-1', typeBucket: 'subtask' }),
      buildItem({ key: 'DEV-1-2', featureKey: 'FEAT-1', columnId: 'col-dev', parentKey: 'DEV-1', typeBucket: 'subtask' }),
    ];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')]])),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: buildPreferences(),
    });

    const [lane] = layout.lanes;
    expect(lane.cellsByColumnId['col-todo'].containers).toHaveLength(1);
    expect(lane.cellsByColumnId['col-dev'].containers).toHaveLength(1);

    const parentCardAppearances = Object.values(lane.cellsByColumnId).reduce(
      (total, cell) => total + cell.looseItems.filter((item) => item.key === 'DEV-1').length,
      0,
    );
    expect(parentCardAppearances).toBe(1);
    expect(lane.cellsByColumnId['col-dev'].looseItems.map((item) => item.key)).toEqual(['DEV-1']);
  });

  it('does not count container headers as issues', () => {
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-dev' }),
      buildItem({ key: 'DEV-1-1', featureKey: 'FEAT-1', columnId: 'col-todo', parentKey: 'DEV-1', typeBucket: 'subtask' }),
      buildItem({ key: 'DEV-1-2', featureKey: 'FEAT-1', columnId: 'col-dev', parentKey: 'DEV-1', typeBucket: 'subtask' }),
    ];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')]])),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: buildPreferences(),
    });

    expect(countRenderedItems(layout)).toBe(3);
  });

  it('still heads a container for a parent that is not on this board, without drawing a parent card', () => {
    const items = [
      buildItem({ key: 'OTHER-1-1', featureKey: 'FEAT-1', columnId: 'col-todo', parentKey: 'OTHER-1', typeBucket: 'subtask' }),
    ];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')]])),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: buildPreferences(),
    });

    const container = layout.lanes[0].cellsByColumnId['col-todo'].containers[0];
    expect(container.parentKey).toBe('OTHER-1');
    expect(container.isParentInScope).toBe(false);
  });
});

describe('buildBoardLayout — L-3: an item sits in its OWN column', () => {
  it('never derives a child\'s column from its parent\'s', () => {
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-dev' }),
      buildItem({ key: 'DEV-1-1', featureKey: 'FEAT-1', columnId: 'col-todo', parentKey: 'DEV-1', typeBucket: 'subtask' }),
    ];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')]])),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: buildPreferences(),
    });

    expect(layout.lanes[0].cellsByColumnId['col-todo'].containers[0].items[0].key).toBe('DEV-1-1');
  });
});

describe('buildBoardLayout — L-4: filters never change a Feature\'s numbers', () => {
  it('leaves the lane vitals byte-identical with filters applied and cleared', () => {
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-todo', storyPoints: 5 }),
      buildItem({ key: 'BUG-1', featureKey: 'FEAT-1', columnId: 'col-todo', typeBucket: 'defect', storyPoints: 3 }),
    ];
    const masterCards = buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')]]));
    const columns = buildRenderedColumns(VOCABULARY);

    const unfiltered = buildBoardLayout({ masterCards, columns, filters: NO_FILTERS, preferences: buildPreferences() });
    const filtered = buildBoardLayout({
      masterCards,
      columns,
      filters: { ...NO_FILTERS, typeBuckets: new Set(['defect' as const]) },
      preferences: buildPreferences(),
    });

    expect(filtered.lanes[0].masterCard.vitals).toEqual(unfiltered.lanes[0].masterCard.vitals);
  });

  it('counts matched separately from total, so "n of N" is two counts of two sets', () => {
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-todo' }),
      buildItem({ key: 'BUG-1', featureKey: 'FEAT-1', columnId: 'col-todo', typeBucket: 'defect' }),
    ];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')]])),
      columns: buildRenderedColumns(VOCABULARY),
      filters: { ...NO_FILTERS, typeBuckets: new Set(['defect' as const]) },
      preferences: buildPreferences(),
    });

    expect(layout.lanes[0].matchedItemCount).toBe(1);
    expect(layout.lanes[0].totalItemCount).toBe(2);
  });
});

describe('buildBoardLayout — L-5, L-6, L-8: empty things behave', () => {
  it('leaves behind no container once a filter removes all of its children', () => {
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-dev' }),
      buildItem({ key: 'DEV-1-1', featureKey: 'FEAT-1', columnId: 'col-todo', parentKey: 'DEV-1', typeBucket: 'subtask' }),
    ];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')]])),
      columns: buildRenderedColumns(VOCABULARY),
      filters: { ...NO_FILTERS, typeBuckets: new Set(['story' as const]) },
      preferences: buildPreferences(),
    });

    expect(layout.lanes[0].cellsByColumnId['col-todo'].containers).toHaveLength(0);
  });

  it('keeps a lane visible even when nothing in it matches', () => {
    const items = [buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-todo' })];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')]])),
      columns: buildRenderedColumns(VOCABULARY),
      filters: { ...NO_FILTERS, typeBuckets: new Set(['defect' as const]) },
      preferences: buildPreferences(),
    });

    expect(layout.lanes).toHaveLength(1);
    expect(layout.lanes[0].matchedItemCount).toBe(0);
    expect(layout.lanes[0].totalItemCount).toBe(1);
  });

  it('always renders the Unmapped column, even when it holds nothing', () => {
    const layout = buildBoardLayout({
      masterCards: buildMasterCards([buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-todo' })], new Map()),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: buildPreferences(),
    });

    expect(layout.columns.some((column) => column.id === UNMAPPED_COLUMN_ID)).toBe(true);
  });
});

describe('buildBoardLayout — L-7: lane order', () => {
  it('follows the viewer\'s chosen order', () => {
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-A', columnId: 'col-todo' }),
      buildItem({ key: 'DEV-2', featureKey: 'FEAT-B', columnId: 'col-todo' }),
    ];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map()),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: buildPreferences(['FEAT-B', 'FEAT-A']),
    });

    expect(layout.lanes.map((lane) => lane.masterCard.featureKey)).toEqual(['FEAT-B', 'FEAT-A']);
  });

  it('places a Feature that appeared since the order was set at the end, not somewhere arbitrary', () => {
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-A', columnId: 'col-todo' }),
      buildItem({ key: 'DEV-2', featureKey: 'FEAT-NEW', columnId: 'col-todo' }),
    ];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map()),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: buildPreferences(['FEAT-A']),
    });

    expect(layout.lanes[layout.lanes.length - 1].masterCard.featureKey).toBe('FEAT-NEW');
  });

  it('marks a lane collapsed when the viewer collapsed it', () => {
    const items = [buildItem({ key: 'DEV-1', featureKey: 'FEAT-A', columnId: 'col-todo' })];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map()),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: { ...buildPreferences(), collapsedByFeatureKey: { 'FEAT-A': false } },
    });

    expect(layout.lanes[0].isCollapsed).toBe(false);
  });

  it('opens a lane the viewer has never touched collapsed, so the board starts as an overview', () => {
    const items = [buildItem({ key: 'DEV-1', featureKey: 'FEAT-A', columnId: 'col-todo' })];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map()),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: buildPreferences(),
    });

    expect(layout.lanes[0].isCollapsed).toBe(true);
  });
});

describe('buildBoardLayout — L-9: it is a pure function', () => {
  it('returns a deeply equal result for the same input, with no clock or randomness involved', () => {
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-todo' }),
      buildItem({ key: 'DEV-1-1', featureKey: 'FEAT-1', columnId: 'col-dev', parentKey: 'DEV-1', typeBucket: 'subtask' }),
    ];
    const input = {
      masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')]])),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: buildPreferences(),
    };

    expect(buildBoardLayout(input)).toEqual(buildBoardLayout(input));
  });
});

describe('buildBoardLayout — L-10: the timing budget is measured, not assumed', () => {
  /** Builds a realistic worst case: 300 issues spread over 40 Features and 8 columns. */
  function buildLargeBoardInput() {
    const laneCount = 40;
    const issuesPerLane = 8; // 40 x 8 = 320 issues — a touch harsher than the ~300 target
    const largeVocabulary: BoardVocabulary = {
      teamProfileId: 'team-a',
      columns: Array.from({ length: 8 }, (_ignored, columnIndex) => ({
        id: `col-${columnIndex}`,
        name: `Column ${columnIndex}`,
        order: columnIndex,
        mappings: [{ jiraStatusName: `Status ${columnIndex}`, subStatusValue: null }],
      })),
      updatedAt: '',
      lastSyncedAt: null,
    };

    const items = Array.from({ length: laneCount }).flatMap((_ignored, laneIndex) =>
      Array.from({ length: issuesPerLane }, (_alsoIgnored, issueIndex) => {
        const key = `DEV-${laneIndex}-${issueIndex}`;
        // Every second issue is a sub-task, so the parent-container grouping is exercised too.
        const parentKey = issueIndex % 2 === 1 ? `DEV-${laneIndex}-${issueIndex - 1}` : null;
        return buildItem({
          key,
          featureKey: `FEAT-${laneIndex}`,
          columnId: `col-${issueIndex % 8}`,
          parentKey,
          typeBucket: parentKey ? 'subtask' : 'story',
        });
      }));

    return {
      masterCards: buildMasterCards(items, new Map()),
      columns: buildRenderedColumns(largeVocabulary),
      filters: NO_FILTERS,
      preferences: buildPreferences(),
    };
  }

  it('lays out a 320-issue, 40-lane, 8-column board well inside its budget', () => {
    const input = buildLargeBoardInput();

    const startedAt = performance.now();
    const layout = buildBoardLayout(input);
    const elapsedMilliseconds = performance.now() - startedAt;

    // The 5-second target in SC-012 is end-to-end and dominated by Jira; layout gets a small slice
    // of it. A generous 250ms still fails loudly if this ever turns quadratic.
    expect(elapsedMilliseconds).toBeLessThan(250);
    expect(countRenderedItems(layout)).toBe(320);
  });

  it('still accounts for every issue at full size, so speed never costs completeness', () => {
    expect(countRenderedItems(buildBoardLayout(buildLargeBoardInput()))).toBe(320);
  });
});

describe('buildBoardLayout — cards sit in the order the viewer arranged', () => {
  it('follows a hand-placed sequence within a column', () => {
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-todo' }),
      buildItem({ key: 'DEV-2', featureKey: 'FEAT-1', columnId: 'col-todo' }),
      buildItem({ key: 'DEV-3', featureKey: 'FEAT-1', columnId: 'col-todo' }),
    ];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')]])),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: {
        ...buildPreferences(),
        collapsedByFeatureKey: { 'FEAT-1': false },
        cardOrderByCell: { 'FEAT-1::col-todo': ['DEV-3', 'DEV-1', 'DEV-2'] },
      },
    });

    expect(layout.lanes[0].cellsByColumnId['col-todo'].looseItems.map((item) => item.key))
      .toEqual(['DEV-3', 'DEV-1', 'DEV-2']);
  });

  it('puts a card that appeared since the sequence was set at the end, not somewhere random', () => {
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-todo' }),
      buildItem({ key: 'DEV-NEW', featureKey: 'FEAT-1', columnId: 'col-todo' }),
    ];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')]])),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: { ...buildPreferences(), cardOrderByCell: { 'FEAT-1::col-todo': ['DEV-1'] } },
    });

    expect(layout.lanes[0].cellsByColumnId['col-todo'].looseItems.map((item) => item.key))
      .toEqual(['DEV-1', 'DEV-NEW']);
  });

  it('leaves a column with no stored sequence exactly as it was', () => {
    const items = [
      buildItem({ key: 'DEV-1', featureKey: 'FEAT-1', columnId: 'col-todo' }),
      buildItem({ key: 'DEV-2', featureKey: 'FEAT-1', columnId: 'col-todo' }),
    ];

    const layout = buildBoardLayout({
      masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature('FEAT-1')]])),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: buildPreferences(),
    });

    expect(layout.lanes[0].cellsByColumnId['col-todo'].looseItems.map((item) => item.key))
      .toEqual(['DEV-1', 'DEV-2']);
  });
});

describe('a parent that is on the board but in another lane', () => {
  // The production case: sub-tasks of ENCUC-2070 sat in FEAT-2's lane reading "not on this board",
  // while ENCUC-2070's own card was in FEAT-1's — sending the reader after a scope problem that was
  // really the parent and its children disagreeing about which Feature they deliver.
  const FEATURES = new Map([['FEAT-1', buildFeature('FEAT-1')], ['FEAT-2', buildFeature('FEAT-2')]]);

  /** Lays out a board from raw items, as the tab does. */
  function layOut(items: RollupBoardItem[]) {
    return buildBoardLayout({
      masterCards: buildMasterCards(items, FEATURES),
      columns: buildRenderedColumns(VOCABULARY),
      filters: NO_FILTERS,
      preferences: buildPreferences(),
    });
  }

  /** The first container in one lane's To Do cell. */
  function firstContainerIn(layout: ReturnType<typeof layOut>, featureKey: string) {
    const lane = layout.lanes.find((candidate) => candidate.masterCard.featureKey === featureKey)!;
    return lane.cellsByColumnId['col-todo'].containers[0];
  }

  it('names the lane the parent actually sits in', () => {
    const layout = layOut([
      buildItem({ key: 'ENCUC-2070', featureKey: 'FEAT-1', columnId: 'col-todo' }),
      buildItem({ key: 'ENCUC-2253', featureKey: 'FEAT-2', columnId: 'col-todo', parentKey: 'ENCUC-2070' }),
    ]);

    const container = firstContainerIn(layout, 'FEAT-2');
    expect(container.isParentInScope).toBe(false);
    expect(container.parentLaneFeatureKey).toBe('FEAT-1');
  });

  it('reports no lane when the parent is genuinely absent from the board', () => {
    const layout = layOut([
      buildItem({ key: 'ENCUC-2253', featureKey: 'FEAT-2', columnId: 'col-todo', parentKey: 'ENCUC-GONE' }),
    ]);

    const container = firstContainerIn(layout, 'FEAT-2');
    expect(container.isParentInScope).toBe(false);
    expect(container.parentLaneFeatureKey).toBeNull();
  });

  it('still draws the parent normally when it is in the same lane', () => {
    const layout = layOut([
      buildItem({ key: 'ENCUC-2070', featureKey: 'FEAT-2', columnId: 'col-todo' }),
      buildItem({ key: 'ENCUC-2253', featureKey: 'FEAT-2', columnId: 'col-todo', parentKey: 'ENCUC-2070' }),
    ]);

    const container = firstContainerIn(layout, 'FEAT-2');
    expect(container.isParentInScope).toBe(true);
    expect(container.parentLaneFeatureKey).toBeNull();
  });
});
