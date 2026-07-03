// sizing.ts — Relative-sizing helpers that translate t-shirt sizes into story points.
//
// A team that has never pointed work can size features fast with S/M/L/XL. Those sizes must
// resolve to a numeric weight so container capacity math works. The mapping lives on the
// overlay so it is editable, but every consumer goes through these pure helpers.

import { DEFAULT_SIZE_MAPPING, type TshirtSize } from '../overlay/overlayModel.ts';

/** The four t-shirt sizes in ascending order, for building size pickers. */
export const TSHIRT_SIZES: readonly TshirtSize[] = ['S', 'M', 'L', 'XL'];

/** Returns the story-point weight for a t-shirt size using the overlay mapping (falling back to defaults). */
export function pointsForSize(size: TshirtSize, sizeMapping: Record<TshirtSize, number> = DEFAULT_SIZE_MAPPING): number {
  const mappedPoints = sizeMapping[size];
  return typeof mappedPoints === 'number' && Number.isFinite(mappedPoints) ? mappedPoints : DEFAULT_SIZE_MAPPING[size];
}

/**
 * Resolves the capacity weight a node contributes: the overlay size (mapped to points) when the
 * user has sized it, otherwise the live Jira story points, otherwise zero.
 */
export function resolveEffectivePoints(
  overlaySize: TshirtSize | null,
  liveStoryPoints: number | null,
  sizeMapping: Record<TshirtSize, number> = DEFAULT_SIZE_MAPPING,
): number {
  if (overlaySize !== null) {
    return pointsForSize(overlaySize, sizeMapping);
  }
  return typeof liveStoryPoints === 'number' && Number.isFinite(liveStoryPoints) ? liveStoryPoints : 0;
}
