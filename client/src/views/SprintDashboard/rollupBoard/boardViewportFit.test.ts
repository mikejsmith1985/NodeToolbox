// boardViewportFit.test.ts — Proves the board claims exactly the screen it has, so nothing above it
// can scroll away.

import { describe, expect, it } from 'vitest';

import {
  BOARD_SCROLLER_BOTTOM_GUTTER_PX,
  BOARD_SCROLLER_MINIMUM_HEIGHT_PX,
  computeBoardScrollerMaxHeight,
  readDocumentTop,
} from './boardViewportFit.ts';

describe('readDocumentTop', () => {
  it('adds back however far the page has already scrolled', () => {
    // A rect is measured against the window, so the same element reads a smaller top once the page
    // has scrolled. Adding the scroll offset back gives a figure that does not move.
    expect(readDocumentTop(400, 0)).toBe(400);
    expect(readDocumentTop(120, 280)).toBe(400);
    expect(readDocumentTop(-160, 560)).toBe(400);
  });

  it('treats a missing scroll offset as the top of the page', () => {
    expect(readDocumentTop(400, undefined)).toBe(400);
    expect(readDocumentTop(400, Number.NaN)).toBe(400);
  });
});

describe('computeBoardScrollerMaxHeight', () => {
  it('gives the board every pixel below the chrome above it', () => {
    const maxHeight = computeBoardScrollerMaxHeight({
      scrollerDocumentTopPx: 340,
      viewportHeightPx: 1000,
      bottomGutterPx: 16,
    });

    expect(maxHeight).toBe(644);
  });

  it('shrinks as the chrome above it grows, which a fixed guess never could', () => {
    // The real defect: the height was a hard-coded 340px of chrome. At the app's largest text size
    // the toolbar wraps, the board starts lower, and the extra height made the PAGE scroll — taking
    // the board and its sticky column headers up behind the tab strip.
    const atDefaultTextSize = computeBoardScrollerMaxHeight({
      scrollerDocumentTopPx: 340, viewportHeightPx: 1000, bottomGutterPx: 16,
    });
    const atLargestTextSize = computeBoardScrollerMaxHeight({
      scrollerDocumentTopPx: 470, viewportHeightPx: 1000, bottomGutterPx: 16,
    });

    expect(atLargestTextSize).toBeLessThan(atDefaultTextSize);
    expect(atLargestTextSize).toBe(514);
  });

  it('never returns a height too small to show a lane, however little room is left', () => {
    const maxHeight = computeBoardScrollerMaxHeight({
      scrollerDocumentTopPx: 900,
      viewportHeightPx: 800,
      bottomGutterPx: 16,
      minimumHeightPx: 300,
    });

    expect(maxHeight).toBe(300);
  });

  it('falls back to the minimum when the page has not been laid out yet', () => {
    // Before first paint every measurement reads zero; a height of zero would collapse the board.
    expect(computeBoardScrollerMaxHeight({
      scrollerDocumentTopPx: 0, viewportHeightPx: 0, bottomGutterPx: 16, minimumHeightPx: 300,
    })).toBe(300);
  });

  it('uses its own defaults when a caller states only what it measured', () => {
    expect(computeBoardScrollerMaxHeight({ scrollerDocumentTopPx: 340, viewportHeightPx: 1000 }))
      .toBe(1000 - 340 - BOARD_SCROLLER_BOTTOM_GUTTER_PX);
    expect(computeBoardScrollerMaxHeight({ scrollerDocumentTopPx: 5000, viewportHeightPx: 1000 }))
      .toBe(BOARD_SCROLLER_MINIMUM_HEIGHT_PX);
  });

  it('rounds down, because a fractional pixel of overflow still makes the page scroll', () => {
    expect(computeBoardScrollerMaxHeight({
      scrollerDocumentTopPx: 340.6, viewportHeightPx: 1000, bottomGutterPx: 0,
    })).toBe(659);
  });
});
