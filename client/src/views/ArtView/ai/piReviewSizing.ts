// piReviewSizing.ts — The organisation's T-shirt sizing rubric for PI Review Features.
//
// This is the single definition of the scale. Two things read it: the AI prompt builder (so the model
// sizes against the same rubric a human would) and the in-app sizing card (so someone sizing by hand
// can see it without leaving the tab). Because they share this constant they can never disagree.
//
// Source of truth: GitHub issue #147 and the linked Confluence guidance page.

/** The Confluence page that owns this rubric; the in-app card links out to it. */
export const SIZING_GUIDANCE_URL =
  'https://zilverton.atlassian.net/wiki/spaces/MAGrowthDelivery/pages/222039893/Feature+Template+for+Jira+Feature+Sizing+Guidance'

/** The T-shirt sizes the rubric defines, largest last. */
export type FeatureSizeName = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL'

/** One rung of the rubric: a size, the points it maps to, and how that maps is written for humans. */
export interface FeatureSizingScaleEntry {
  size: FeatureSizeName
  /**
   * The story points this size maps to, or null when the rubric gives no single number.
   * Only XXL is null: the rubric says "100+", which is a floor, not a value.
   */
  points: number | null
  /** What to show a human — "40" for a sized rung, "100+" for XXL. */
  pointsLabel: string
}

/**
 * The scale, exactly as the organisation defines it.
 *
 * XXL deliberately carries no number. "100+" is where the rubric stops being arithmetic and starts
 * needing a person: an XXL Feature is the case where the estimate matters most, so the app asks the
 * user for the number rather than inventing one.
 */
export const FEATURE_SIZING_SCALE: readonly FeatureSizingScaleEntry[] = Object.freeze([
  { size: 'XS', points: 10, pointsLabel: '10' },
  { size: 'S', points: 20, pointsLabel: '20' },
  { size: 'M', points: 40, pointsLabel: '40' },
  { size: 'L', points: 60, pointsLabel: '60' },
  { size: 'XL', points: 80, pointsLabel: '80' },
  { size: 'XXL', points: null, pointsLabel: '100+' },
] as const)

/**
 * True when the given value is a size the rubric defines. Tolerates the casing and padding a model
 * might emit, but nothing else — a size outside the scale is reported, never coerced to a neighbour.
 */
export function isFeatureSizeName(candidateSize: unknown): candidateSize is FeatureSizeName {
  if (typeof candidateSize !== 'string') {
    return false
  }
  const normalizedSize = candidateSize.trim().toUpperCase()
  return FEATURE_SIZING_SCALE.some((entry) => entry.size === normalizedSize)
}

/**
 * The points a size maps to, or null when the rubric supplies no number (XXL only).
 *
 * Points are always derived here, never read from an AI reply — that is what stops a model
 * contradicting the rubric: it has no channel through which to send a number.
 */
export function readPointsForSize(size: FeatureSizeName): number | null {
  const normalizedSize = size.trim().toUpperCase()
  return FEATURE_SIZING_SCALE.find((entry) => entry.size === normalizedSize)?.points ?? null
}
