// columnDensity.ts — How wide a board column is, and why it stopped being a browser-zoom problem.
//
// The board used to size its columns from `--layout-control-min-width`, a token meant for FORM
// CONTROLS — a text box, a dropdown. At `clamp(144px, 18vw, 192px)` that is a sensible width for one
// input and a terrible one for twelve columns: 12 × 192px is 2,304px of board, which no 1920px screen
// can show. The only way to see the whole board was to zoom the browser out to 80%, which is the
// board asking the user to fix a layout bug on its behalf.
//
// So the board sizes its own columns now, from widths chosen against the real question — how many
// columns fit at 100% zoom — and the team picks the density that suits their column count. Compact
// puts fourteen columns on a 1920px screen; Roomy trades that for cards that are easier to read.

/** How tightly the board packs its columns. */
export type ColumnDensity = 'compact' | 'standard' | 'roomy';

/** The default: twelve columns fit a 1920px screen at 100% browser zoom with room to spare. */
export const DEFAULT_COLUMN_DENSITY: ColumnDensity = 'standard';

/**
 * The narrowest each column may be, per density.
 *
 * Fixed pixels rather than a viewport clamp on purpose: a `vw` unit makes the column count that fits
 * depend on the window size, which is exactly the surprise that sent the user to the zoom control.
 */
export const COLUMN_MIN_WIDTH_BY_DENSITY: Record<ColumnDensity, string> = {
  compact: '108px',
  standard: '136px',
  roomy: '184px',
};

/** The same widths as numbers, for working out what will fit before anything is drawn. */
const COLUMN_MIN_PIXELS_BY_DENSITY: Record<ColumnDensity, number> = {
  compact: 108,
  standard: 136,
  roomy: 184,
};

/** The gap between columns, matching `--spacing-xs` in the board's own stylesheet. */
const COLUMN_GAP_PIXELS = 4;

/** What the team calls each density, and what it is for. */
export const COLUMN_DENSITY_LABELS: Record<ColumnDensity, string> = {
  compact: 'Compact — most columns on screen',
  standard: 'Standard',
  roomy: 'Roomy — easiest to read',
};

/** The CSS width for a density, falling back to Standard for a value stored by an older version. */
export function readColumnMinWidth(density: ColumnDensity | undefined): string {
  return COLUMN_MIN_WIDTH_BY_DENSITY[density ?? DEFAULT_COLUMN_DENSITY]
    ?? COLUMN_MIN_WIDTH_BY_DENSITY[DEFAULT_COLUMN_DENSITY];
}

/** How wide the board needs to be before its columns start being squeezed. */
export function measureBoardWidth(columnCount: number, density: ColumnDensity | undefined): number {
  const columnWidth = COLUMN_MIN_PIXELS_BY_DENSITY[density ?? DEFAULT_COLUMN_DENSITY]
    ?? COLUMN_MIN_PIXELS_BY_DENSITY[DEFAULT_COLUMN_DENSITY];
  return columnCount * columnWidth + Math.max(columnCount - 1, 0) * COLUMN_GAP_PIXELS;
}

/**
 * The densest setting that shows every column without sideways scrolling.
 *
 * Offered as a suggestion rather than applied automatically: a team that has deliberately chosen Roomy
 * and accepted the scroll should not have that undone every time they open a narrower window.
 */
export function suggestDensityForWidth(columnCount: number, availableWidth: number): ColumnDensity | null {
  const densitiesWidestFirst: ColumnDensity[] = ['roomy', 'standard', 'compact'];
  const fittingDensity = densitiesWidestFirst.find(
    (density) => measureBoardWidth(columnCount, density) <= availableWidth,
  );
  return fittingDensity ?? null;
}

/** One sentence on whether the board currently fits, so the density control explains itself. */
export function describeColumnFit(
  columnCount: number,
  density: ColumnDensity | undefined,
  availableWidth: number,
): string {
  const neededWidth = measureBoardWidth(columnCount, density);
  const columnWord = columnCount === 1 ? 'column' : 'columns';

  if (neededWidth <= availableWidth) {
    return `All ${columnCount} ${columnWord} fit without scrolling.`;
  }

  const fittingDensity = suggestDensityForWidth(columnCount, availableWidth);
  const advice = fittingDensity === null
    ? 'Even Compact will not fit them all — consider retiring a column.'
    : `Switch to ${fittingDensity} to fit them all.`;
  return `${columnCount} ${columnWord} need about ${neededWidth}px and there is ${availableWidth}px. ${advice}`;
}
