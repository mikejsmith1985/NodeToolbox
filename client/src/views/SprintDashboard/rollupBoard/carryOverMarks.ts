// carryOverMarks.ts — Reads which Features were TICKED as carry-over on the PI Review page.
//
// Deriving carry-over as "every unfinished Feature from the previous PI" is close, and close is the
// problem: it also drags in Features that were abandoned, deprioritised, or simply never closed, and
// a list that includes things the team is not working on stops being read.
//
// The team already records the real answer. Each PI Review page has a Carry-Over column, ticked on the
// Features that genuinely arrived from the prior PI, and that tick is a decision somebody made rather
// than a heuristic. Reading it means the board and the PI Review cannot disagree, and nobody has to
// maintain the same fact twice — which is exactly what a Jira "Carryover" label would have required,
// and what would have drifted the first time one was updated without the other.

import type { PiReviewRow } from '../../ArtView/piReviewTable.ts';

/** The value the PI Review table writes into a ticked checkbox column. */
const CHECKBOX_MARKED_VALUE = 'yes';

/** One configured PI Review page, as the team profile stores it. */
export interface PiReviewPageReference {
  piName: string;
  pageUrl: string;
}

/**
 * Finds the PI Review page for one PI.
 *
 * The page wanted is the CURRENT PI's — its Carry-Over column marks what arrived from the PI before,
 * which is precisely the set the board needs. Reaching for the previous PI's page instead would find
 * that PI's own arrivals, one increment too far back.
 */
export function findPiReviewPageForPi(
  piReviewPages: readonly PiReviewPageReference[],
  piName: string,
): string | null {
  const wantedPiName = piName.trim();
  if (wantedPiName === '') return null;

  const matchedPage = (piReviewPages ?? []).find(
    (page) => page.piName.trim() === wantedPiName && page.pageUrl.trim() !== '',
  );
  return matchedPage ? matchedPage.pageUrl.trim() : null;
}

/**
 * The Feature keys ticked as carry-over on a parsed PI Review table.
 *
 * The Feature cell holds "KEY — summary" rather than a bare key, because that is what reads well on
 * the page, so only the leading key is taken.
 */
export function readCarryOverFeatureKeys(rows: readonly PiReviewRow[]): string[] {
  const featureKeys = new Set<string>();

  for (const row of rows ?? []) {
    if (String(row.carryOver ?? '').trim().toLowerCase() !== CHECKBOX_MARKED_VALUE) continue;

    // Split on whitespace and em dashes ONLY — a hyphen is part of the key itself, and splitting on
    // it turned "DENP-1371 — Enhance IPM" into "DENP".
    const featureKey = String(row.feature ?? '').trim().split(/[\s—]+/)[0].trim().toUpperCase();
    if (/^[A-Z][A-Z0-9]*-\d+$/.test(featureKey)) featureKeys.add(featureKey);
  }

  return [...featureKeys];
}

/** One sentence naming what the page said, so an empty result is never mistaken for a failure. */
export function describeCarryOverMarks(featureKeys: readonly string[], piName: string): string {
  if (featureKeys.length === 0) {
    return `No Features are ticked as Carry-Over on the ${piName} PI Review page.`;
  }
  const featureWord = featureKeys.length === 1 ? 'Feature' : 'Features';
  return `${featureKeys.length} ${featureWord} ticked as Carry-Over on the ${piName} PI Review page:`
    + ` ${featureKeys.join(', ')}.`;
}
