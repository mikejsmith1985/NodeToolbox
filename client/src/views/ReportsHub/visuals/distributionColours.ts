// distributionColours.ts — The palette a distribution bar's segments cycle through.
//
// Its own file because a component module that also exports a function breaks fast refresh, and
// because the palette is the one part of the visuals worth changing without touching a component.

/**
 * The palette distribution segments cycle through.
 *
 * Ordered so the first two — the ones a reader looks at — are furthest apart in hue, and chosen to
 * stay legible on both the light and the dark ground rather than assuming either.
 */
const DISTRIBUTION_COLOURS = ['#38bdf8', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#94a3b8'];

/** Picks the colour for one segment, wrapping when a report has more categories than colours. */
export function readDistributionColour(index: number): string {
  return DISTRIBUTION_COLOURS[index % DISTRIBUTION_COLOURS.length];
}
