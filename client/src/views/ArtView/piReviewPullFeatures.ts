// piReviewPullFeatures.ts — Populates a PI Review table with a team's Program Increment Features.
//
// It combines two discovery paths so no Feature is missed:
//   1. Blueprint's bottom-up discovery (Features that already have child work) — parity with the
//      Blueprint tab, reusing fetchScopedTeamFeatures.
//   2. A direct `issuetype = Feature` Jira query filtered by the selected PI plus user-chosen labels
//      and/or assignees — this catches Features that have no child work yet (which the bottom-up
//      path cannot see).
// The two sets are merged and de-duplicated by Feature key, then de-duplicated against the rows
// already in the table so a pull only ever appends genuinely new Features.

import { jiraGet } from '../../services/jiraApi.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { fetchScopedTeamFeatures } from '../SprintDashboard/scopedTeamFeatures.ts';
import type { ArtTeam } from './hooks/useArtData.ts';
import { extractPiReviewFeatureKey } from './piReviewJira.ts';
import { createEmptyPiReviewRow, type PiReviewRow } from './piReviewTable.ts';

const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';
const DIRECT_FEATURE_SEARCH_MAX_RESULTS = 200;
// Only the fields needed to build a row; reconciliation fills priority/estimate/etc. afterwards.
const DIRECT_FEATURE_FIELD_IDS = ['summary', 'status', 'labels', 'assignee'];

/** The label and assignee filters a user picked for the direct Feature query. */
export interface PiReviewFeatureFilter {
  /** Jira labels to match via `labels in (...)`; empty means no label constraint. */
  labels: readonly string[];
  /** Roster assignee query values to match via `assignee in (...)`; empty means no assignee constraint. */
  assigneeQueryValues: readonly string[];
}

/** ART settings needed to scope the Feature queries; resolved from localStorage by default. */
export interface PiReviewPullSettings {
  piFieldId: string;
  featureProjectKeys: readonly string[];
}

/** Outcome of a pull: the new rows to append plus counts for user feedback. */
export interface PullPiReviewFeaturesResult {
  /** New rows to append to the table (already de-duplicated against existing rows). */
  rows: PiReviewRow[];
  /** Total distinct Features discovered across both sources (before de-duplication vs the table). */
  discoveredCount: number;
  /** How many of the discovered Features were genuinely new and became rows. */
  addedCount: number;
}

interface DiscoveredFeature {
  key: string;
  summary: string;
}

/** Reads the PI field id and feature project keys from ART settings, falling back to safe defaults. */
export function readPiReviewPullSettings(): PiReviewPullSettings {
  try {
    const storedSettings = JSON.parse(localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as {
      piFieldId?: unknown;
      featureProjectKeys?: unknown;
    };
    const piFieldId = typeof storedSettings.piFieldId === 'string' && storedSettings.piFieldId.trim() !== ''
      ? storedSettings.piFieldId.trim()
      : DEFAULT_PI_FIELD_ID;
    const featureProjectKeys = Array.isArray(storedSettings.featureProjectKeys)
      ? storedSettings.featureProjectKeys.filter((projectKey): projectKey is string => typeof projectKey === 'string')
      : [];
    return { piFieldId, featureProjectKeys };
  } catch {
    return { piFieldId: DEFAULT_PI_FIELD_ID, featureProjectKeys: [] };
  }
}

/** Wraps a JQL value in quotes, escaping embedded quotes the same way the roster clause builder does. */
function quoteJqlValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Builds the direct `issuetype = Feature` JQL for a team + PI + filters.
 * Returns null when the query cannot be meaningfully scoped — no project key, or no PI and no
 * filters (which would pull every Feature in the project).
 */
export function buildDirectFeatureJql(
  team: ArtTeam,
  piName: string,
  filter: PiReviewFeatureFilter,
  piFieldId: string,
): string | null {
  const projectKey = (team.projectKey ?? '').trim();
  if (projectKey === '') {
    return null;
  }

  const trimmedPiName = piName.trim();
  const labelValues = filter.labels.map((label) => label.trim()).filter(Boolean);
  const assigneeValues = filter.assigneeQueryValues.map((assignee) => assignee.trim()).filter(Boolean);

  // Guard against an unbounded "every Feature in the project" pull.
  if (trimmedPiName === '' && labelValues.length === 0 && assigneeValues.length === 0) {
    return null;
  }

  const jqlClauses = [`project = ${quoteJqlValue(projectKey)}`, 'issuetype = Feature'];
  if (trimmedPiName !== '') {
    const piFieldNumber = piFieldId.replace('customfield_', '');
    jqlClauses.push(`cf[${piFieldNumber}] = ${quoteJqlValue(trimmedPiName)}`);
  }

  const filterClauses: string[] = [];
  if (labelValues.length > 0) {
    filterClauses.push(`labels in (${labelValues.map(quoteJqlValue).join(', ')})`);
  }
  if (assigneeValues.length > 0) {
    filterClauses.push(`assignee in (${assigneeValues.map(quoteJqlValue).join(', ')})`);
  }
  // Label OR assignee: broadest capture so a Feature matching either is pulled in.
  if (filterClauses.length === 1) {
    jqlClauses.push(filterClauses[0]);
  } else if (filterClauses.length === 2) {
    jqlClauses.push(`(${filterClauses[0]} OR ${filterClauses[1]})`);
  }

  return jqlClauses.join(' AND ');
}

/** Runs the direct Feature query and normalizes the issues into discovered Features. */
async function fetchDirectFeatures(
  team: ArtTeam,
  piName: string,
  filter: PiReviewFeatureFilter,
  piFieldId: string,
): Promise<DiscoveredFeature[]> {
  const directFeatureJql = buildDirectFeatureJql(team, piName, filter, piFieldId);
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
 * Pulls all of a team's Features for the given PI (Blueprint bottom-up ∪ direct filtered query),
 * returning the rows that are not already in the table. Errors from one source do not sink the
 * whole pull; only if BOTH sources fail is an error thrown.
 */
export async function pullPiReviewFeatures(
  team: ArtTeam,
  piName: string,
  filter: PiReviewFeatureFilter,
  existingRows: readonly PiReviewRow[],
  settings: PiReviewPullSettings = readPiReviewPullSettings(),
): Promise<PullPiReviewFeaturesResult> {
  const [blueprintOutcome, directOutcome] = await Promise.allSettled([
    fetchScopedTeamFeatures(team, piName, {
      piFieldId: settings.piFieldId,
      featureProjectKeys: settings.featureProjectKeys,
    }),
    fetchDirectFeatures(team, piName, filter, settings.piFieldId),
  ]);

  if (blueprintOutcome.status === 'rejected' && directOutcome.status === 'rejected') {
    throw blueprintOutcome.reason instanceof Error
      ? blueprintOutcome.reason
      : new Error('Failed to fetch Features from Jira.');
  }

  // Merge both sources, de-duplicating by upper-cased Feature key (Blueprint summaries win on ties).
  const discoveredFeaturesByKey = new Map<string, DiscoveredFeature>();
  if (directOutcome.status === 'fulfilled') {
    for (const directFeature of directOutcome.value) {
      discoveredFeaturesByKey.set(directFeature.key.toUpperCase(), directFeature);
    }
  }
  if (blueprintOutcome.status === 'fulfilled') {
    for (const scopedRecord of blueprintOutcome.value) {
      discoveredFeaturesByKey.set(scopedRecord.feature.key.toUpperCase(), {
        key: scopedRecord.feature.key,
        summary: scopedRecord.feature.summary,
      });
    }
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
