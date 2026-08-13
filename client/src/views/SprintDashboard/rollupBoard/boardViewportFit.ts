// boardViewportFit.ts — Working out how tall the board's scroll region may be.
//
// The board's column headers stay put by sticking to the top of their own scroll region. That only
// works while the scroll region is the ONLY thing that scrolls: if the region is taller than the
// space left on screen, the page scrolls too, and the whole board — sticky headers and all — slides
// up behind the tab strip. The headers then look half-hidden, which is exactly what was reported.
//
// The height used to be a guess: "roughly 340px of chrome above the board". A guess is wrong the
// moment anything above changes size, and at the app's largest text setting the toolbar wraps onto a
// second line, so the board really did start about 130px lower than the guess allowed for.
//
// So it is measured instead. These functions hold the arithmetic — no DOM, no React — so the rule
// can be tested rather than eyeballed at one text size on one screen.

/** A little air beneath the board, so its last lane does not sit flush against the window edge. */
export const BOARD_SCROLLER_BOTTOM_GUTTER_PX = 16;

/** Never shrink past this: a board too short to show one lane is useless however cramped the page. */
export const BOARD_SCROLLER_MINIMUM_HEIGHT_PX = 300;

/** What a caller measured about where the board sits and how much window there is. */
export interface BoardScrollerFitInput {
  /** The board's distance from the TOP OF THE DOCUMENT — see readDocumentTop. */
  scrollerDocumentTopPx: number;
  /** The height of the visible window. */
  viewportHeightPx: number;
  bottomGutterPx?: number;
  minimumHeightPx?: number;
}

/**
 * Converts a measurement taken against the window into one taken against the document.
 *
 * An element's measured top shrinks as the page scrolls, so using it directly would make the board
 * grow every time someone scrolled — which is what caused the page to be scrollable in the first
 * place. Adding the page's scroll offset back gives a figure that does not move.
 */
export function readDocumentTop(viewportTopPx: number, pageScrollOffsetPx: number | undefined): number {
  const scrollOffset = Number.isFinite(pageScrollOffsetPx) ? Number(pageScrollOffsetPx) : 0;
  return viewportTopPx + scrollOffset;
}

/**
 * The tallest the board's scroll region may be while still leaving the page itself unscrollable.
 *
 * Rounded DOWN because a fractional pixel of overflow is enough to make the page scroll, which is
 * the whole problem being solved.
 */
export function computeBoardScrollerMaxHeight({
  scrollerDocumentTopPx,
  viewportHeightPx,
  bottomGutterPx = BOARD_SCROLLER_BOTTOM_GUTTER_PX,
  minimumHeightPx = BOARD_SCROLLER_MINIMUM_HEIGHT_PX,
}: BoardScrollerFitInput): number {
  const availableHeight = Math.floor(viewportHeightPx - scrollerDocumentTopPx - bottomGutterPx);
  return Math.max(minimumHeightPx, availableHeight);
}
