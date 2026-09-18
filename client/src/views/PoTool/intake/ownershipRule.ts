// ownershipRule.ts — Reads area sizes stated in the notes ("XL Enrollment", "Vendor size L") and decides, without
// any AI, which of Enrollment or Fulfillment owns an item's scope — falling back to an estimated share only when
// the notes state no size at all (spec 037, contracts/deterministic-rules.md §4).

import { FEATURE_SIZING_SCALE, type FeatureSizeName } from '../../ArtView/ai/piReviewSizing.ts';
import type { AreaSize, SourceLine } from './epicIntakeModel.ts';

// ── Ownership thresholds ──

/** An estimated Enrollment share at or above this percentage settles ownership to Enrollment. */
export const ENROLLMENT_OWNS_AT_SHARE = 60;

/** An estimated Enrollment share at or below this percentage settles ownership to Fulfillment. */
export const FULFILLMENT_OWNS_AT_SHARE = 40;

/** What deciding an owner produced: a settled owner, a PO close call (`null`), or "the rule does not apply". */
export type OwnerRuleResult =
  | { owner: 'enrollment' | 'fulfillment'; reason: string }
  | { owner: null; reason: string }
  | { owner: undefined; reason: string };

// ── Word classification ──

/** Size tokens the rubric defines, matched as a whole word only, case-insensitively. */
const SIZE_TOKEN_PATTERN = /^(XS|S|M|L|XL|XXL)$/i;

/** A stated cost such as "1.2M", "$1.2M" or "(500K)" — reported, never used to decide ownership. */
const COST_TOKEN_PATTERN = /\(?\$?(\d+(?:\.\d+)?[KMB])\)?/i;

/** A word that entirely is a cost token, so it can be told apart from an area word next to a size. */
const WHOLE_WORD_COST_PATTERN = /^\(?\$?\d+(?:\.\d+)?[KMB]\)?$/i;

/** Words that sit between a size and its area without being the area themselves. */
const FILLER_WORDS = new Set(['size', 'dev', 'effort', '-']);

const CANONICAL_AREA_NAMES: Record<string, 'enrollment' | 'fulfillment'> = {
  enrollment: 'enrollment',
  enrolment: 'enrollment',
  fulfillment: 'fulfillment',
  fulfilment: 'fulfillment',
};

/** Strips leading/trailing punctuation (parentheses, commas, …) so "Enrollment)" reads as "Enrollment". */
function stripEdgePunctuation(word: string): string {
  return word.replace(/^[^A-Za-z0-9.]+|[^A-Za-z0-9.]+$/g, '');
}

function isSizeWord(cleanedWord: string): boolean {
  return SIZE_TOKEN_PATTERN.test(cleanedWord);
}

/** The area a size word's canonical name resolves to, or null when it is not one of the two owning areas. */
function resolveCanonicalArea(areaWord: string): 'enrollment' | 'fulfillment' | null {
  return CANONICAL_AREA_NAMES[areaWord.toLowerCase()] ?? null;
}

/**
 * Looks outward from a size token's index for the nearest word that is neither filler, a cost token, nor another
 * size token — that word is the area it belongs to. Stops (returns null) at a blocking token or the line's edge.
 */
function findAreaWordInDirection(words: readonly string[], sizeWordIndex: number, step: 1 | -1): string | null {
  let scanIndex = sizeWordIndex + step;
  while (scanIndex >= 0 && scanIndex < words.length) {
    const rawWord = words[scanIndex];
    if (WHOLE_WORD_COST_PATTERN.test(rawWord)) {
      return null;
    }
    const cleanedWord = stripEdgePunctuation(rawWord);
    if (cleanedWord === '') {
      scanIndex += step;
      continue;
    }
    if (FILLER_WORDS.has(cleanedWord.toLowerCase())) {
      scanIndex += step;
      continue;
    }
    if (isSizeWord(cleanedWord)) {
      return null;
    }
    return cleanedWord;
  }
  return null;
}

/** The one stated cost on a line ("1.2M"), with any parentheses or currency sign removed, or null when none. */
function readStatedCost(lineText: string): string | null {
  const costMatch = lineText.match(COST_TOKEN_PATTERN);
  return costMatch ? costMatch[1] : null;
}

// ── Parsing ──

/**
 * Reads every area-size statement on one line of the notes ("XL Enrollment", "Vendor size L"). A line with no
 * size token, or whose only candidate word is prose like "Large" rather than the size token "L", parses to
 * nothing — that line is left for the PO or an AI estimate instead.
 */
export function parseAreaSizes(line: SourceLine): AreaSize[] {
  const words = line.text.split(/\s+/).filter((word) => word.length > 0);
  const statedCost = readStatedCost(line.text);
  const areaSizes: AreaSize[] = [];
  words.forEach((rawWord, wordIndex) => {
    const cleanedWord = stripEdgePunctuation(rawWord);
    if (!isSizeWord(cleanedWord)) {
      return;
    }
    const areaWord = findAreaWordInDirection(words, wordIndex, 1) ?? findAreaWordInDirection(words, wordIndex, -1);
    if (!areaWord) {
      return;
    }
    areaSizes.push({
      area: areaWord,
      canonicalArea: resolveCanonicalArea(areaWord),
      size: cleanedWord.toUpperCase() as FeatureSizeName,
      cost: statedCost,
      lineNumber: line.lineNumber,
    });
  });
  return areaSizes;
}

// ── Deciding from stated sizes ──

function compareSizeRank(leftSize: FeatureSizeName, rightSize: FeatureSizeName): number {
  const leftRank = FEATURE_SIZING_SCALE.findIndex((scaleEntry) => scaleEntry.size === leftSize);
  const rightRank = FEATURE_SIZING_SCALE.findIndex((scaleEntry) => scaleEntry.size === rightSize);
  return leftRank - rightRank;
}

/** The largest size stated for one owning area, or null when that area has no stated size at all. */
function readLargestSizeForArea(
  areaSizes: readonly AreaSize[],
  canonicalArea: 'enrollment' | 'fulfillment',
): FeatureSizeName | null {
  const statedSizes = areaSizes
    .filter((areaSize) => areaSize.canonicalArea === canonicalArea)
    .map((areaSize) => areaSize.size);
  if (statedSizes.length === 0) {
    return null;
  }
  return statedSizes.reduce((largestSize, candidateSize) =>
    compareSizeRank(candidateSize, largestSize) > 0 ? candidateSize : largestSize);
}

/**
 * Decides ownership purely from sizes the notes already state for Enrollment and/or Fulfillment — the larger
 * stated size owns, a tie is a PO call, and stating only one area settles it outright. Returns `owner: undefined`
 * when neither area has a stated size, so the caller falls back to an estimated share instead.
 */
export function decideOwnerFromSizes(areaSizes: readonly AreaSize[]): OwnerRuleResult {
  const enrollmentSize = readLargestSizeForArea(areaSizes, 'enrollment');
  const fulfillmentSize = readLargestSizeForArea(areaSizes, 'fulfillment');
  if (enrollmentSize && fulfillmentSize) {
    const sizeComparison = compareSizeRank(enrollmentSize, fulfillmentSize);
    if (sizeComparison === 0) {
      return { owner: null, reason: `Stated sizes are equal: Enrollment ${enrollmentSize} vs Fulfillment ${fulfillmentSize}` };
    }
    const largerOwner = sizeComparison > 0 ? 'enrollment' : 'fulfillment';
    return { owner: largerOwner, reason: `Stated sizes: Enrollment ${enrollmentSize} vs Fulfillment ${fulfillmentSize}` };
  }
  if (enrollmentSize) {
    return { owner: 'enrollment', reason: `Stated sizes: only Enrollment ${enrollmentSize}` };
  }
  if (fulfillmentSize) {
    return { owner: 'fulfillment', reason: `Stated sizes: only Fulfillment ${fulfillmentSize}` };
  }
  return { owner: undefined, reason: 'No Enrollment or Fulfillment size stated' };
}

// ── Deciding from an estimated share ──

/** True only for a whole number from 0 to 100 — anything else is an AI reply Toolbox refuses to act on. */
function isValidSharePercentage(candidateShare: unknown): candidateShare is number {
  return typeof candidateShare === 'number' && Number.isInteger(candidateShare) && candidateShare >= 0 && candidateShare <= 100;
}

/**
 * Decides ownership from an estimated Enrollment share of the scope (0–100), used only when the notes state no
 * size at all. A share of 60% or more owns Enrollment, 40% or less owns Fulfillment, and anything in between is a
 * PO close call. A value that is not a whole 0–100 number is rejected outright (`owner: undefined`) — the caller
 * treats that exactly like an AI reply it must ask for again.
 */
export function decideOwnerFromShare(enrollmentShare: unknown): OwnerRuleResult {
  if (!isValidSharePercentage(enrollmentShare)) {
    return {
      owner: undefined,
      reason: `Estimated Enrollment share must be a whole number from 0 to 100, not ${JSON.stringify(enrollmentShare)}`,
    };
  }
  if (enrollmentShare >= ENROLLMENT_OWNS_AT_SHARE) {
    return { owner: 'enrollment', reason: `Estimated Enrollment share ${enrollmentShare}% (≥ ${ENROLLMENT_OWNS_AT_SHARE}%)` };
  }
  if (enrollmentShare <= FULFILLMENT_OWNS_AT_SHARE) {
    return { owner: 'fulfillment', reason: `Estimated Enrollment share ${enrollmentShare}% (≤ ${FULFILLMENT_OWNS_AT_SHARE}%)` };
  }
  return { owner: null, reason: `Estimated Enrollment share ${enrollmentShare}% is a close call` };
}
