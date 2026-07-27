// importPiReviewFeatures.ts — Seeds the Bulk Re-write intake from the PI Review PAGE (spec 030, GH #220).
//
// The PI Review page is a Confluence-backed table that IS the curated list of a team's Features for a PI:
// it holds Features that were pulled, plus any added by hand or carried over from a prior PI, across ANY
// project (PI Review is deliberately not project-scoped). So "Import from PI Review" reads that page's rows
// directly rather than re-running a Jira Feature query — a re-query would re-introduce the pull's
// PO-assignee + PI-field scoping and silently drop Features that are sitting right there on the page (for
// example Features in a second project). This only READS the page; it never writes anything.

import { fetchConfluencePageByReference } from '../../../services/confluenceApi.ts';
import { parsePiReviewTable } from '../../ArtView/piReviewTable.ts';
import { extractPiReviewFeatureKey } from '../../ArtView/piReviewJira.ts';
import type { ArtTeam } from '../../ArtView/hooks/useArtData.ts';

/** Why an import produced no keys — lets the caller show the honest reason instead of a blank result. */
export type ImportPiFeaturesBlockedReason = 'no-pi' | 'no-page';

export interface ImportPiFeaturesResult {
  /** The Feature keys read off the PI Review page, de-duplicated and in page order. */
  keys: string[];
  /** How many keys the page yielded (for an honest "found N" message). */
  discoveredCount: number;
  /** Set when the import could not be scoped; null when the page was actually read. */
  blockedReason: ImportPiFeaturesBlockedReason | null;
}

/**
 * Finds the team's configured PI Review Confluence page for a Program Increment. An exact PI match wins;
 * failing that a legacy page with no PI of its own adopts the selected PI (the same rule PI Review uses).
 */
export function selectPiReviewPageUrl(team: ArtTeam, selectedPiName: string): string | null {
  const trimmedPiName = selectedPiName.trim();
  const configuredPages = (team.piReviewPages ?? []).filter((page) => page.pageUrl.trim() !== '');
  const exactMatch = configuredPages.find((page) => page.piName.trim() === trimmedPiName);
  if (exactMatch) {
    return exactMatch.pageUrl.trim();
  }
  const legacyPage = configuredPages.find((page) => page.piName.trim() === '');
  return legacyPage ? legacyPage.pageUrl.trim() : null;
}

/**
 * Reads every Feature key off the team's PI Review page for the selected PI. Resolves to a blocked result
 * (no network call) when there is no PI selected or the team has no PI Review page configured for it.
 */
export async function importPiReviewFeatureKeys(
  team: ArtTeam,
  selectedPiName: string,
): Promise<ImportPiFeaturesResult> {
  if (selectedPiName.trim() === '') {
    return { keys: [], discoveredCount: 0, blockedReason: 'no-pi' };
  }
  const pageReference = selectPiReviewPageUrl(team, selectedPiName);
  if (pageReference === null) {
    return { keys: [], discoveredCount: 0, blockedReason: 'no-page' };
  }

  // Read and parse the same Confluence page the PI Review tab loads, then take the Feature key from each
  // row. Rows without a key (grouping lines) yield null and drop out; duplicates are collapsed.
  const confluencePage = await fetchConfluencePageByReference(pageReference);
  const parsedTable = parsePiReviewTable(confluencePage.body.storage.value);
  const keys = [
    ...new Set(
      parsedTable.rows
        .map((featureRow) => extractPiReviewFeatureKey(featureRow.feature))
        .filter((featureKey): featureKey is string => featureKey !== null),
    ),
  ];
  return { keys, discoveredCount: keys.length, blockedReason: null };
}
