// dropPlaceholder.test.ts — Proves the gap opens where the card would actually land.

import { describe, expect, it } from 'vitest';

import { resolveCellPlaceholder, resolvePlaceholderIndex, shouldHideDraggedEntry } from './dropPlaceholder.ts';

const CELL = 'FEAT-1::col-todo';
const ENTRIES = [{ itemKey: 'DEV-1' }, { itemKey: null }, { itemKey: 'DEV-2' }];

describe('resolvePlaceholderIndex', () => {
  it('opens the gap above the card the pointer is in the top half of', () => {
    expect(resolvePlaceholderIndex({ cellId: CELL, anchorKey: 'DEV-2', edge: 'before' }, CELL, ENTRIES)).toBe(2);
  });

  it('opens it below when the pointer is in the bottom half', () => {
    expect(resolvePlaceholderIndex({ cellId: CELL, anchorKey: 'DEV-1', edge: 'after' }, CELL, ENTRIES)).toBe(1);
  });

  it('opens it at the very top of the cell when there is no card to anchor to', () => {
    // Dropping into the space above the first card, which is not a card and so has no anchor.
    expect(resolvePlaceholderIndex({ cellId: CELL, anchorKey: null, edge: 'before' }, CELL, ENTRIES)).toBe(0);
  });

  it('opens it at the very bottom for the lower half of an empty stretch', () => {
    expect(resolvePlaceholderIndex({ cellId: CELL, anchorKey: null, edge: 'after' }, CELL, ENTRIES)).toBe(3);
  });

  it('draws NO gap in a cell that is not the one being hovered', () => {
    // Every cell but one, on a board of twelve columns and twenty lanes — so exactly one gap opens.
    expect(resolvePlaceholderIndex({ cellId: CELL, anchorKey: 'DEV-1', edge: 'before' }, 'FEAT-2::col-dev', ENTRIES))
      .toBeNull();
  });

  it('draws no gap at all when nothing is being dragged', () => {
    expect(resolvePlaceholderIndex(null, CELL, ENTRIES)).toBeNull();
  });

  it('falls back to the end when the anchor has left the cell mid-drag', () => {
    // Honest: the gap stays visible rather than vanishing and leaving nothing to aim at.
    expect(resolvePlaceholderIndex({ cellId: CELL, anchorKey: 'GONE-1', edge: 'before' }, CELL, ENTRIES)).toBe(3);
  });

  it('never anchors to a container, which is not a card the gap can sit beside', () => {
    const containerOnly = [{ itemKey: null }];

    expect(resolvePlaceholderIndex({ cellId: CELL, anchorKey: 'DEV-9', edge: 'before' }, CELL, containerOnly)).toBe(1);
  });
});

describe('shouldHideDraggedEntry', () => {
  it('takes the dragged card out of the cell it came from', () => {
    // Otherwise the cell shows the gap it left AND the gap it might land in — two openings for one
    // card, which reads as though it is about to be copied.
    expect(shouldHideDraggedEntry('DEV-1', 'DEV-1')).toBe(true);
  });

  it('leaves every other card where it is', () => {
    expect(shouldHideDraggedEntry('DEV-1', 'DEV-2')).toBe(false);
    expect(shouldHideDraggedEntry(null, 'DEV-1')).toBe(false);
    expect(shouldHideDraggedEntry('DEV-1', null)).toBe(false);
  });
});

describe('resolveCellPlaceholder', () => {
  const CONTAINERS = [{ parentKey: 'DEV-9', itemKeys: ['SUB-1', 'SUB-2'] }];
  const CELL_ENTRIES = [{ itemKey: null }, { itemKey: 'DEV-1' }];

  it('opens the gap INSIDE the container when the anchor is one of its cards', () => {
    // The case that made a container impossible to reorder: its cards are not in the cell's own list.
    expect(resolveCellPlaceholder(
      { cellId: CELL, anchorKey: 'SUB-2', edge: 'before' }, CELL, CELL_ENTRIES, CONTAINERS,
    )).toEqual({ target: 'container', parentKey: 'DEV-9', index: 1 });
  });

  it('opens it after the last card of a container when the pointer is below it', () => {
    expect(resolveCellPlaceholder(
      { cellId: CELL, anchorKey: 'SUB-2', edge: 'after' }, CELL, CELL_ENTRIES, CONTAINERS,
    )).toEqual({ target: 'container', parentKey: 'DEV-9', index: 2 });
  });

  it('opens it in the cell when the anchor is a loose card', () => {
    expect(resolveCellPlaceholder(
      { cellId: CELL, anchorKey: 'DEV-1', edge: 'after' }, CELL, CELL_ENTRIES, CONTAINERS,
    )).toEqual({ target: 'cell', index: 2 });
  });

  it('opens it in the cell when no card is the anchor at all', () => {
    expect(resolveCellPlaceholder(
      { cellId: CELL, anchorKey: null, edge: 'before' }, CELL, CELL_ENTRIES, CONTAINERS,
    )).toEqual({ target: 'cell', index: 0 });
  });

  it('draws exactly one gap — never both in the cell and in a container', () => {
    // The invariant the whole function exists for.
    const placement = resolveCellPlaceholder(
      { cellId: CELL, anchorKey: 'SUB-1', edge: 'before' }, CELL, CELL_ENTRIES, CONTAINERS,
    );

    expect(placement?.target).toBe('container');
  });

  it('draws nothing in a cell that is not being hovered', () => {
    expect(resolveCellPlaceholder(
      { cellId: CELL, anchorKey: 'SUB-1', edge: 'before' }, 'OTHER::col', CELL_ENTRIES, CONTAINERS,
    )).toBeNull();
  });
});
