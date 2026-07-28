// importPiReviewFeatures.ts — Seeds the Bulk Re-write intake from the PI Review PAGE (spec 030, GH #220).
//
// The PI Review page is a Confluence-backed table that IS the curated list of a team's Features for a PI:
// it holds Features that were pulled, plus any added by hand or carried over from a prior PI, across ANY
// project (PI Review is deliberately not project-scoped). So "Import from PI Review" reads that page's rows
// directly rather than re-running a Jira Feature query — a re-query would re-introduce the pull's
// PO-assignee + PI-field scoping and silently drop Features that are sitting right there on the page (for
// example Features in a second project). This only READS the page; it never writes anything.

import { fetchConfluencePageByReference } from '../../../services/confluenceApi.ts';
import { parsePiReviewTable, type PiReviewRow, type PiReviewTableParseResult } from '../../ArtView/piReviewTable.ts';
import { extractPiReviewFeatureKey } from '../../ArtView/piReviewJira.ts';
import type { ArtTeam } from '../../ArtView/hooks/useArtData.ts';

/** Cell values in the "Committed to PI?" column that mean NOT committed (blank or an explicit negative). */
const NOT_COMMITTED_MARKERS = new Set([
  '', 'no', 'n', 'false', '0', 'not committed', '-', '–', '—', '☐', '[ ]', '[]', 'unchecked', '✗', '✘',
]);

/**
 * True when a PI Review row's "Committed to PI?" column is marked committed (a positive, non-blank value).
 */
export function isCommittedRow(row: PiReviewRow): boolean {
  return !NOT_COMMITTED_MARKERS.has(row.committed.trim().toLowerCase());
}

/**
 * The Feature keys of the COMMITTED rows on a parsed PI Review table. Commitment is signalled two ways on PI
 * Review pages, so this checks them in order of authority:
 *   1. the **commitment boundary** ("Hard commits above / Stretch Goals below") — every row above it is
 *      committed; this is the PI Review UI's own explicit line, so it wins when present;
 *   2. failing a boundary, the **"Committed to PI?" column** (rows with a positive value);
 *   3. failing both signals, the **whole page** — a PI Review page IS the curated committed list.
 * This is why filtering on the column alone under-counted (a page that commits via the boundary leaves the
 * column blank), so the boundary is preferred.
 */
export function committedFeatureKeys(parsedTable: PiReviewTableParseResult): string[] {
  const { rows, commitmentBoundaryIndex } = parsedTable;
  let committedRows: PiReviewRow[];
  if (commitmentBoundaryIndex !== null && commitmentBoundaryIndex > 0) {
    committedRows = rows.filter((_row, index) => index < commitmentBoundaryIndex);
  } else if (rows.some(isCommittedRow)) {
    committedRows = rows.filter(isCommittedRow);
  } else {
    committedRows = rows;
  }
  return [
    ...new Set(
      committedRows
        .map((row) => extractPiReviewFeatureKey(row.feature))
        .filter((featureKey): featureKey is string => featureKey !== null),
    ),
  ];
}

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
 * Reads the Feature keys off the team's PI Review page for the selected PI, keeping only rows the given
 * filter accepts. Resolves to a blocked result (no network call) when there is no PI selected or the team
 * has no PI Review page configured for it. Only READS the page.
 */
async function importFeatureKeysFrom(
  team: ArtTeam,
  selectedPiName: string,
  selectKeys: (parsedTable: PiReviewTableParseResult) => string[],
): Promise<ImportPiFeaturesResult> {
  if (selectedPiName.trim() === '') {
    return { keys: [], discoveredCount: 0, blockedReason: 'no-pi' };
  }
  const pageReference = selectPiReviewPageUrl(team, selectedPiName);
  if (pageReference === null) {
    return { keys: [], discoveredCount: 0, blockedReason: 'no-page' };
  }

  // Read and parse the same Confluence page the PI Review tab loads, then select the Feature keys.
  const confluencePage = await fetchConfluencePageByReference(pageReference);
  const parsedTable = parsePiReviewTable(confluencePage.body.storage.value);
  const keys = selectKeys(parsedTable);
  return { keys, discoveredCount: keys.length, blockedReason: null };
}

/** Reads EVERY Feature key off the team's PI Review page for the selected PI (committed or not). */
export function importPiReviewFeatureKeys(team: ArtTeam, selectedPiName: string): Promise<ImportPiFeaturesResult> {
  return importFeatureKeysFrom(team, selectedPiName, (parsedTable) => [
    ...new Set(
      parsedTable.rows
        .map((featureRow) => extractPiReviewFeatureKey(featureRow.feature))
        .filter((featureKey): featureKey is string => featureKey !== null),
    ),
  ]);
}

/** Reads only the COMMITTED Feature keys off the team's PI Review page — the authoritative delivery set. */
export function importCommittedPiReviewFeatureKeys(team: ArtTeam, selectedPiName: string): Promise<ImportPiFeaturesResult> {
  return importFeatureKeysFrom(team, selectedPiName, committedFeatureKeys);
}
