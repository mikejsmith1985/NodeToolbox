// piReviewPullFeatures.ts — Populates a PI Review table with a team's Program Increment Features.
//
// Discovery is a single, direct Jira query: every `issuetype = Feature` in the page's PI that is
// assigned to the team's Product Owner (taken from the roster). This deliberately replaces the older
// Blueprint bottom-up discovery + label/assignee filter combination — the PI plus the PO uniquely
// scope a team's Features, so no extra filters are needed. Notably the query does NOT constrain by
// project: a team's Features often live in a different (portfolio/program) project than the team's
// delivery board, so adding a project clause silently excludes them. The PO assignee is the scope.
// Discovered Features are de-duplicated against the rows already in the table so a pull only ever
// appends genuinely new Features.

import { jiraGet } from '../../services/jiraApi.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { extractPiReviewFeatureKey } from './piReviewJira.ts';
import { createEmptyPiReviewRow, type PiReviewRow } from './piReviewTable.ts';

const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';
const DIRECT_FEATURE_SEARCH_MAX_RESULTS = 200;
// Only the fields needed to build a row; reconciliation fills priority/estimate/etc. afterwards.
const DIRECT_FEATURE_FIELD_IDS = ['summary', 'status', 'assignee'];

/** ART settings needed to scope the Feature query; resolved from localStorage by default. */
export interface PiReviewPullSettings {
  piFieldId: string;
}

/** Outcome of a pull: the new rows to append plus counts for user feedback. */
export interface PullPiReviewFeaturesResult {
  /** New rows to append to the table (already de-duplicated against existing rows). */
  rows: PiReviewRow[];
  /** Total distinct Features discovered by the query (before de-duplication vs the table). */
  discoveredCount: number;
  /** How many of the discovered Features were genuinely new and became rows. */
  addedCount: number;
}

interface DiscoveredFeature {
  key: string;
  summary: string;
}

/** Reads the PI field id from ART settings, falling back to the safe default. */
export function readPiReviewPullSettings(): PiReviewPullSettings {
  try {
    const storedSettings = JSON.parse(localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as {
      piFieldId?: unknown;
    };
    const piFieldId = typeof storedSettings.piFieldId === 'string' && storedSettings.piFieldId.trim() !== ''
      ? storedSettings.piFieldId.trim()
      : DEFAULT_PI_FIELD_ID;
    return { piFieldId };
  } catch {
    return { piFieldId: DEFAULT_PI_FIELD_ID };
  }
}

/** Wraps a JQL value in quotes, escaping embedded quotes the same way the roster clause builder does. */
function quoteJqlValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Builds the assignee clause for the Product Owner(s): `assignee = "x"` for a single PO, or
 * `assignee in ("x", "y")` when a team lists more than one. Returns null when no PO is supplied.
 */
function buildProductOwnerAssigneeClause(poAssigneeQueryValues: readonly string[]): string | null {
  const assigneeValues = poAssigneeQueryValues.map((assignee) => assignee.trim()).filter(Boolean);
  if (assigneeValues.length === 0) {
    return null;
  }
  if (assigneeValues.length === 1) {
    return `assignee = ${quoteJqlValue(assigneeValues[0])}`;
  }
  return `assignee in (${assigneeValues.map(quoteJqlValue).join(', ')})`;
}

/**
 * Builds the direct `issuetype = Feature` JQL for a PI + Product Owner(s), mirroring the query a
 * user would run by hand. Returns null when the query cannot be meaningfully scoped — a missing PI
 * or PO would broaden the pull to every Feature the assignee owns (or every Feature in the PI),
 * which is never what the user wants. Deliberately unscoped by project (see file header).
 */
export function buildDirectFeatureJql(
  piName: string,
  poAssigneeQueryValues: readonly string[],
  piFieldId: string,
): string | null {
  const trimmedPiName = piName.trim();
  const assigneeClause = buildProductOwnerAssigneeClause(poAssigneeQueryValues);
  if (trimmedPiName === '' || assigneeClause === null) {
    return null;
  }

  const piFieldNumber = piFieldId.replace('customfield_', '');
  return [
    'issuetype = Feature',
    assigneeClause,
    `cf[${piFieldNumber}] = ${quoteJqlValue(trimmedPiName)}`,
  ].join(' AND ');
}

/** Runs the direct Feature query and normalizes the issues into discovered Features. */
async function fetchDirectFeatures(
  piName: string,
  poAssigneeQueryValues: readonly string[],
  piFieldId: string,
): Promise<DiscoveredFeature[]> {
  const directFeatureJql = buildDirectFeatureJql(piName, poAssigneeQueryValues, piFieldId);
  if (directFeatureJql === null) {
    return [];
  }

  const searchPath = `/rest/api/2/search?jql=${encodeURIComponent(directFeatureJql)}`
    + `&fields=${encodeURIComponent(DIRECT_FEATURE_FIELD_IDS.join(','))}`
    + `&maxResults=${DIRECT_FEATURE_SEARCH_MAX_RESULTS}`;
  const searchResponse = await jiraGet<{ issues?: JiraIssue[] }>(searchPath);
  return (searchResponse.issues ?? []).map((issue) => ({
    key: issue.key,
    summary: typeof issue.fields?.summary === 'string' ? issue.fields.summary : '',
  }));
}

/** Turns a discovered Feature into a blank PI Review row whose feature cell carries the key + summary. */
function createFeatureRow(feature: DiscoveredFeature): PiReviewRow {
  const newRow = createEmptyPiReviewRow();
  const trimmedSummary = feature.summary.trim();
  newRow.feature = trimmedSummary === '' ? feature.key : `${feature.key} - ${trimmedSummary}`;
  return newRow;
}

/**
 * Pulls a team's Features for the given PI + Product Owner(s) via a single direct Jira query,
 * returning the rows that are not already in the table. When the query cannot be scoped (no PO or
 * no PI) it resolves to an empty result without contacting Jira.
 */
export async function pullPiReviewFeatures(
  piName: string,
  poAssigneeQueryValues: readonly string[],
  existingRows: readonly PiReviewRow[],
  settings: PiReviewPullSettings = readPiReviewPullSettings(),
): Promise<PullPiReviewFeaturesResult> {
  const discoveredFeatures = await fetchDirectFeatures(piName, poAssigneeQueryValues, settings.piFieldId);

  // De-duplicate discovered Features by upper-cased key (Jira can, in theory, echo a key twice).
  const discoveredFeaturesByKey = new Map<string, DiscoveredFeature>();
  for (const discoveredFeature of discoveredFeatures) {
    discoveredFeaturesByKey.set(discoveredFeature.key.toUpperCase(), discoveredFeature);
  }

  const existingFeatureKeys = new Set(
    existingRows
      .map((row) => extractPiReviewFeatureKey(row.feature))
      .filter((featureKey): featureKey is string => featureKey !== null),
  );

  const newRows = [...discoveredFeaturesByKey.values()]
    .filter((feature) => !existingFeatureKeys.has(feature.key.toUpperCase()))
    .sort((leftFeature, rightFeature) => leftFeature.key.localeCompare(rightFeature.key))
    .map(createFeatureRow);

  return {
    rows: newRows,
    discoveredCount: discoveredFeaturesByKey.size,
    addedCount: newRows.length,
  };
}
