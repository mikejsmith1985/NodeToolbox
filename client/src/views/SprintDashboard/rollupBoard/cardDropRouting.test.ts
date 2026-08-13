// cardDropRouting.test.ts — Proves a drop is understood correctly before anything is written to Jira.
//
// The distinction that matters is between a non-event (dropped nowhere, dropped where it already was)
// and a real attempt at something the board cannot do. The first writes nothing and says nothing; the
// second writes nothing and says why.

import { describe, expect, it } from 'vitest';

import {
  buildCardTargetId,
  buildDropTargetId,
  parseCardTargetId,
  parseDropTargetId,
  resolveCardDrop,
  resolveCardDropZone,
} from './cardDropRouting.ts';
import { UNMAPPED_COLUMN_ID, type RenderedColumn, type RollupBoardItem } from './rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

function buildItem(key: string, featureKey: string | null, columnId: string): RollupBoardItem {
  return {
    issue: { id: key, key, fields: { summary: key } } as unknown as JiraIssue,
    key,
    summary: key,
    typeBucket: 'story',
    typeName: 'Story',
    parentKey: null,
    route: { steps: [], featureKey, precedenceRank: null, unchosenCandidates: [], notes: [] },
    featureKey,
    columnId,
    statusName: 'To Do',
    subStatusValue: null,
    assigneeAccountId: null,
    assigneeDisplayName: null,
    fixVersionNames: [],
    storyPoints: null,
    checklistCompletion: null,
    checklistItems: [],
  };
}

const COLUMNS = new Map<string, RenderedColumn>([
  ['col-todo', { id: 'col-todo', name: 'Not started', order: 0, mappings: [{ jiraStatusName: 'To Do', subStatusValue: null }], isUnmappedColumn: false }],
  ['col-dev', { id: 'col-dev', name: 'Being coded', order: 1, mappings: [{ jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' }], isUnmappedColumn: false }],
  ['col-new', { id: 'col-new', name: 'Somewhere new', order: 2, mappings: [], isUnmappedColumn: false }],
  [UNMAPPED_COLUMN_ID, { id: UNMAPPED_COLUMN_ID, name: 'Unmapped', order: 3, mappings: [], isUnmappedColumn: true }],
]);

const ITEMS = new Map([['DEV-1', buildItem('DEV-1', 'FEAT-1', 'col-todo')]]);

describe('drop target ids', () => {
  it('round-trips a lane and column through one id', () => {
    expect(parseDropTargetId(buildDropTargetId('FEAT-1', 'col-dev'))).toEqual({ featureKey: 'FEAT-1', columnId: 'col-dev' });
  });

  it('survives a column id containing the separator characters used by the Unmapped column', () => {
    expect(parseDropTargetId(buildDropTargetId('FEAT-1', UNMAPPED_COLUMN_ID))?.columnId).toBe(UNMAPPED_COLUMN_ID);
  });

  it('returns null for something that is not a drop target id', () => {
    expect(parseDropTargetId('nonsense')).toBeNull();
  });
});

describe('resolveCardDrop — non-events write nothing and say nothing', () => {
  it('ignores a card dropped outside any column', () => {
    expect(resolveCardDrop({ draggedItemKey: 'DEV-1', dropTargetId: null, itemsByKey: ITEMS, columnsById: COLUMNS }))
      .toEqual({ kind: 'ignore' });
  });

  it('ignores a card dropped back into the column it came from', () => {
    expect(resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildDropTargetId('FEAT-1', 'col-todo'),
      itemsByKey: ITEMS,
      columnsById: COLUMNS,
    })).toEqual({ kind: 'ignore' });
  });

  it('ignores a drag whose card is no longer on the board', () => {
    expect(resolveCardDrop({
      draggedItemKey: 'GONE-1',
      dropTargetId: buildDropTargetId('FEAT-1', 'col-dev'),
      itemsByKey: ITEMS,
      columnsById: COLUMNS,
    })).toEqual({ kind: 'ignore' });
  });

  it('ignores a drop onto a column the vocabulary no longer defines', () => {
    expect(resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildDropTargetId('FEAT-1', 'col-deleted'),
      itemsByKey: ITEMS,
      columnsById: COLUMNS,
    })).toEqual({ kind: 'ignore' });
  });
});

describe('resolveCardDrop — real attempts the board cannot honour', () => {
  it('refuses a drop into a column nobody has mapped yet, since there is nothing to write', () => {
    const decision = resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildDropTargetId('FEAT-1', 'col-new'),
      itemsByKey: ITEMS,
      columnsById: COLUMNS,
    });

    expect(decision.kind).toBe('refused');
    expect(decision.kind === 'refused' && decision.reason).toContain('Somewhere new');
  });

  it('refuses a drop into Unmapped, which describes a state rather than setting one', () => {
    const decision = resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildDropTargetId('FEAT-1', UNMAPPED_COLUMN_ID),
      itemsByKey: ITEMS,
      columnsById: COLUMNS,
    });

    expect(decision.kind).toBe('refused');
  });
});

describe('resolveCardDrop — a real move', () => {
  it('returns the card and the column it should be written to', () => {
    const decision = resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildDropTargetId('FEAT-1', 'col-dev'),
      itemsByKey: ITEMS,
      columnsById: COLUMNS,
    });

    expect(decision.kind).toBe('move');
    expect(decision.kind === 'move' && decision.targetColumn.id).toBe('col-dev');
    expect(decision.kind === 'move' && decision.item.key).toBe('DEV-1');
  });

  it('allows a move within the No Feature lane, since unattributed work still has a status', () => {
    const unattributedItems = new Map([['DEV-9', buildItem('DEV-9', null, 'col-todo')]]);

    const decision = resolveCardDrop({
      draggedItemKey: 'DEV-9',
      dropTargetId: buildDropTargetId('__no_feature__', 'col-dev'),
      itemsByKey: unattributedItems,
      columnsById: COLUMNS,
    });

    expect(decision.kind).toBe('move');
  });
});

describe('resolveCardDrop — dropping a card onto another card', () => {
  const SAME_COLUMN_ITEMS = new Map([
    ['DEV-1', buildItem('DEV-1', 'FEAT-1', 'col-todo')],
    ['DEV-2', buildItem('DEV-2', 'FEAT-1', 'col-todo')],
    ['DEV-9', buildItem('DEV-9', 'FEAT-1', 'col-dev')],
  ]);

  it('sequences the work when both cards are in the same column', () => {
    const decision = resolveCardDrop({
      draggedItemKey: 'DEV-2',
      dropTargetId: buildCardTargetId('DEV-1'),
      itemsByKey: SAME_COLUMN_ITEMS,
      columnsById: COLUMNS,
    });

    expect(decision.kind).toBe('reorder');
    expect(decision.kind === 'reorder' && decision.targetIssueKey).toBe('DEV-1');
  });

  it('treats a drop onto a card in ANOTHER column as a state change, not a reorder', () => {
    const decision = resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildCardTargetId('DEV-9'),
      itemsByKey: SAME_COLUMN_ITEMS,
      columnsById: COLUMNS,
    });

    expect(decision.kind).toBe('move');
    expect(decision.kind === 'move' && decision.targetColumn.id).toBe('col-dev');
  });

  it('ignores a card dropped on itself', () => {
    expect(resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildCardTargetId('DEV-1'),
      itemsByKey: SAME_COLUMN_ITEMS,
      columnsById: COLUMNS,
    })).toEqual({ kind: 'ignore' });
  });

  it('ignores a drop onto a card that is no longer on the board', () => {
    expect(resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildCardTargetId('GONE-1'),
      itemsByKey: SAME_COLUMN_ITEMS,
      columnsById: COLUMNS,
    })).toEqual({ kind: 'ignore' });
  });

  it('round-trips a card target id', () => {
    expect(parseCardTargetId(buildCardTargetId('DEV-1'))).toBe('DEV-1');
    expect(parseCardTargetId('FEAT-1::col-todo')).toBeNull();
  });
});

describe('resolveCardDrop — dropping into another Feature lane', () => {
  it('re-points the issue at the Feature whose lane it was dropped in', () => {
    const decision = resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildDropTargetId('FEAT-OTHER', 'col-dev'),
      itemsByKey: ITEMS,
      columnsById: COLUMNS,
    });

    expect(decision).toEqual({
      kind: 'relink',
      item: ITEMS.get('DEV-1'),
      targetFeatureKey: 'FEAT-OTHER',
    });
  });

  it('re-links even when the target column differs, since the lane is the instruction', () => {
    const decision = resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildDropTargetId('FEAT-OTHER', 'col-qa'),
      itemsByKey: ITEMS,
      columnsById: COLUMNS,
    });

    expect(decision.kind).toBe('relink');
  });
});

describe('resolveCardDropZone — the middle means inside, the edges mean near', () => {
  it('treats the upper edge as sequencing before the card', () => {
    expect(resolveCardDropZone(10, 0, 100)).toBe('before');
  });

  it('treats the lower edge as sequencing after the card', () => {
    expect(resolveCardDropZone(90, 0, 100)).toBe('after');
  });

  it('treats the middle as putting the card inside', () => {
    expect(resolveCardDropZone(50, 0, 100)).toBe('nest');
  });

  it('reads positions relative to where the target actually sits', () => {
    expect(resolveCardDropZone(450, 400, 100)).toBe('nest');
    expect(resolveCardDropZone(410, 400, 100)).toBe('before');
  });

  it('does not divide by a zero height', () => {
    expect(resolveCardDropZone(10, 0, 0)).toBe('nest');
  });
});

/** DEV-1 plus a sibling in the same column, which is the only place nesting is offered. */
const ITEMS_WITH_SIBLING = new Map([
  ['DEV-1', buildItem('DEV-1', 'FEAT-1', 'col-todo')],
  ['DEV-2', buildItem('DEV-2', 'FEAT-1', 'col-todo')],
]);

describe('resolveCardDrop — dropping one card onto another', () => {
  it('nests when the drop landed on the card body', () => {
    const decision = resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildCardTargetId('DEV-2'),
      itemsByKey: ITEMS_WITH_SIBLING,
      columnsById: COLUMNS,
      cardDropZone: 'nest',
    });

    expect(decision).toEqual({
      kind: 'nest',
      item: ITEMS_WITH_SIBLING.get('DEV-1'),
      containerIssueKey: 'DEV-2',
    });
  });

  it('still sequences when the drop landed on an edge', () => {
    const decision = resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildCardTargetId('DEV-2'),
      itemsByKey: ITEMS_WITH_SIBLING,
      columnsById: COLUMNS,
      cardDropZone: 'before',
    });

    expect(decision.kind).toBe('reorder');
  });

  it('sequences by default, so an unknown zone can never write to Jira', () => {
    const decision = resolveCardDrop({
      draggedItemKey: 'DEV-1',
      dropTargetId: buildCardTargetId('DEV-2'),
      itemsByKey: ITEMS_WITH_SIBLING,
      columnsById: COLUMNS,
    });

    expect(decision.kind).toBe('reorder');
  });
});
