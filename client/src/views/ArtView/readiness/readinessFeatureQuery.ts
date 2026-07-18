// readinessFeatureQuery.ts — Builds and runs the Feature-discovery JQL for the Readiness tab.
//
// Follows the portfolio-project rule the PI Review pull established: Features live in a program
// project, not the team's delivery board, so we scope by PI + (project keys OR roster labels) and
// NEVER by a team projectKey. Each lens (current / upcoming / carryover) runs one query, capped at
// the same 200-result ceiling the feature pull uses. This module only fetches; readinessScan.ts
// grades the results.

import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';

/** Same ceiling as the PI Review feature pull; hitting it is surfaced as a truncation note upstream. */
export const READINESS_FEATURE_MAX_RESULTS = 200;

// Every field the scan reads must be requested here so no per-row follow-up fetch is needed.
const READINESS_FEATURE_FIELD_IDS = [
  'summary',
  'status',
  'assignee',
  'labels',
  'issuelinks',
  'duedate',
  'updated',
  'created',
  'customfield_10021',
];

/** The resolved scope clause plus a human description of which precedence tier applied. */
export interface ReadinessScopeClause {
  clause: string;
  description: string;
}

/** Wraps a JQL value in quotes, escaping embedded quotes. */
function quoteJqlValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Resolves the scope clause by precedence: configured feature project keys first, then the roster's
 * Jira labels, then nothing (with a description so the UI can note the unscoped breadth).
 */
export function resolveReadinessScopeClause(
  featureProjectKeys: readonly string[],
  rosterLabels: readonly string[],
): ReadinessScopeClause {
  const projectKeys = featureProjectKeys.map((key) => key.trim()).filter(Boolean);
  if (projectKeys.length > 0) {
    const clause = `project in (${projectKeys.join(', ')})`;
    return { clause, description: clause };
  }
  const labels = rosterLabels.map((label) => label.trim()).filter(Boolean);
  if (labels.length > 0) {
    const clause = `labels in (${labels.map(quoteJqlValue).join(', ')})`;
    return { clause, description: clause };
  }
  return { clause: '', description: 'no project or label scope — searching every Feature in the PI' };
}

/**
 * Builds the Feature-discovery JQL for one or more PI names. A single PI uses `=`; multiple PIs (the
 * carryover history) use `in (...)`. The scope clause is appended when non-empty. Returns an empty
 * string when there are no PI names to query.
 */
export function buildReadinessFeatureJql(
  piNames: readonly string[],
  piFieldId: string,
  scopeClause: string,
): string {
  const cleanPiNames = piNames.map((name) => name.trim()).filter(Boolean);
  if (cleanPiNames.length === 0) return '';

  const piFieldNumber = piFieldId.replace('customfield_', '');
  const piClause = cleanPiNames.length === 1
    ? `cf[${piFieldNumber}] = ${quoteJqlValue(cleanPiNames[0])}`
    : `cf[${piFieldNumber}] in (${cleanPiNames.map(quoteJqlValue).join(', ')})`;

  return ['issuetype = Feature', piClause, scopeClause].filter(Boolean).join(' AND ');
}

/** How deep the carryover history reaches — enough for realistic carryover without unbounded JQL. */
export const READINESS_CARRYOVER_PI_DEPTH = 4;

/** The three lens PI scopes derived from the selected PI and the sorted (newest-first) PI list. */
export interface ReadinessPiContext {
  currentPiName: string;
  upcomingPiName: string | null;
  carryoverPiNames: string[];
  isCarryoverCapped: boolean;
}

/**
 * Derives the lens PI scopes. `availablePiNames` is sorted newest-first (the ArtView convention),
 * so the entry BEFORE the selected PI is the upcoming one and the entries AFTER it are carryover
 * history (capped at READINESS_CARRYOVER_PI_DEPTH). An unknown selected PI yields no neighbours.
 */
export function deriveReadinessPiContext(
  selectedPiName: string,
  availablePiNames: readonly string[],
): ReadinessPiContext {
  const selectedIndex = availablePiNames.indexOf(selectedPiName);
  if (selectedIndex === -1) {
    return { currentPiName: selectedPiName, upcomingPiName: null, carryoverPiNames: [], isCarryoverCapped: false };
  }
  const upcomingPiName = selectedIndex > 0 ? availablePiNames[selectedIndex - 1] : null;
  const olderPiNames = availablePiNames.slice(selectedIndex + 1);
  const carryoverPiNames = olderPiNames.slice(0, READINESS_CARRYOVER_PI_DEPTH);
  return {
    currentPiName: selectedPiName,
    upcomingPiName,
    carryoverPiNames,
    isCarryoverCapped: olderPiNames.length > READINESS_CARRYOVER_PI_DEPTH,
  };
}

/** One scope's fetch outcome: the issues and whether the 200-result ceiling was hit. */
export interface ReadinessFetchResult {
  issues: JiraIssue[];
  isTruncated: boolean;
}

/** Runs one readiness Feature query; an empty JQL resolves to no issues without contacting Jira. */
export async function fetchReadinessFeatures(jql: string): Promise<ReadinessFetchResult> {
  if (jql.trim() === '') return { issues: [], isTruncated: false };

  const searchPath = `/rest/api/2/search?jql=${encodeURIComponent(jql)}`
    + `&fields=${encodeURIComponent(READINESS_FEATURE_FIELD_IDS.join(','))}`
    + `&maxResults=${READINESS_FEATURE_MAX_RESULTS}`;
  const response = await jiraGet<{ issues?: JiraIssue[]; total?: number }>(searchPath);
  const issues = response.issues ?? [];
  const isTruncated = (response.total ?? issues.length) > READINESS_FEATURE_MAX_RESULTS;
  return { issues, isTruncated };
}
