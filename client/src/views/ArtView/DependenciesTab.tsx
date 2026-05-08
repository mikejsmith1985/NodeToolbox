// DependenciesTab.tsx — Tabular cross-team dependency viewer, replacing the legacy SVG map.

import { useState } from 'react';
import { jiraGet } from '../../services/jiraApi.ts';
import type { ArtTeam } from './hooks/useArtData.ts';
import styles from './DependenciesTab.module.css';

// ── Types ──

/** A Jira issue link object as returned by the Jira REST API. */
interface JiraIssueLinkObject {
  id: string;
  type: {
    name: string;
    inward: string;
    outward: string;
  };
  inwardIssue?: LinkedIssueRef;
  outwardIssue?: LinkedIssueRef;
}

/** Minimal representation of a linked issue reference inside a Jira issue link. */
interface LinkedIssueRef {
  key: string;
  fields?: {
    summary?: string;
    status?: { name: string; statusCategory?: { key: string } };
    issuetype?: { name: string };
    assignee?: { displayName: string } | null;
  };
}

/** A Jira issue enriched with issue links (not in the base JiraIssue type). */
interface IssueWithLinks {
  id: string;
  key: string;
  fields: {
    summary?: string;
    status?: { name: string; statusCategory?: { key: string } };
    issuetype?: { name: string };
    assignee?: { displayName: string } | null;
    issuelinks?: JiraIssueLinkObject[];
  };
}

/** A single resolved cross-team dependency row ready for table rendering. */
interface DependencyRow {
  id: string;
  fromTeamName: string;
  fromTeamProjectKey: string;
  fromIssueKey: string;
  fromIssueSummary: string;
  fromIssueStatus: string;
  linkTypeName: string;
  linkDirection: 'outward' | 'inward';
  toTeamName: string;
  toTeamProjectKey: string;
  toIssueKey: string;
  toIssueSummary: string;
  toIssueStatus: string;
}

// ── Constants ──

const FIELDS_WITH_LINKS = 'summary,status,issuetype,assignee,issuelinks';
const MAX_RESULTS_PER_BOARD = 200;
const ALL_TEAMS_FILTER_VALUE = 'ALL';

// ── Helper functions ──

/** Extracts the Jira project key from an issue key (e.g. "ALPHA-5" → "ALPHA"). */
function extractProjectKey(issueKey: string): string {
  return issueKey.split('-')[0].toUpperCase();
}

/** Builds a map of project key → team name from the ART team list. */
function buildProjectKeyToTeamMap(teams: ArtTeam[]): Map<string, string> {
  const projectKeyToTeamName = new Map<string, string>();
  for (const team of teams) {
    if (team.projectKey) {
      projectKeyToTeamName.set(team.projectKey.toUpperCase(), team.name);
    }
  }
  return projectKeyToTeamName;
}

/** Resolves a linked issue's team name from the project key map. */
function resolveTeamName(issueKey: string, projectKeyToTeamName: Map<string, string>): string {
  const projectKey = extractProjectKey(issueKey);
  return projectKeyToTeamName.get(projectKey) ?? projectKey;
}

/**
 * Builds dependency rows from a single issue's outward links.
 * Only includes links where the linked issue belongs to a different team.
 */
function extractOutwardDependencies(
  sourceIssue: IssueWithLinks,
  projectKeyToTeamName: Map<string, string>,
): DependencyRow[] {
  const issueLinks = sourceIssue.fields.issuelinks ?? [];
  const sourceProjectKey = extractProjectKey(sourceIssue.key);
  const sourceTeamName = resolveTeamName(sourceIssue.key, projectKeyToTeamName);
  const rows: DependencyRow[] = [];

  for (const link of issueLinks) {
    const linkedIssue = link.outwardIssue;
    if (!linkedIssue) continue;
    const linkedProjectKey = extractProjectKey(linkedIssue.key);
    // Only surface cross-team dependencies
    if (linkedProjectKey === sourceProjectKey) continue;
    if (!projectKeyToTeamName.has(linkedProjectKey)) continue;

    rows.push({
      id: `${sourceIssue.key}-${link.id}-out`,
      fromTeamName: sourceTeamName,
      fromTeamProjectKey: sourceProjectKey,
      fromIssueKey: sourceIssue.key,
      fromIssueSummary: sourceIssue.fields.summary ?? sourceIssue.key,
      fromIssueStatus: sourceIssue.fields.status?.name ?? 'Unknown',
      linkTypeName: link.type.name,
      linkDirection: 'outward',
      toTeamName: resolveTeamName(linkedIssue.key, projectKeyToTeamName),
      toTeamProjectKey: linkedProjectKey,
      toIssueKey: linkedIssue.key,
      toIssueSummary: linkedIssue.fields?.summary ?? linkedIssue.key,
      toIssueStatus: linkedIssue.fields?.status?.name ?? 'Unknown',
    });
  }
  return rows;
}

/** Fetches sprint issues with issue links for all team boards and builds cross-team dependency rows. */
async function fetchDependencyRows(teams: ArtTeam[]): Promise<DependencyRow[]> {
  const projectKeyToTeamName = buildProjectKeyToTeamMap(teams);

  const allIssuesWithLinks: IssueWithLinks[] = [];
  for (const team of teams) {
    const jql = `board = ${team.boardId} AND sprint in openSprints()`;
    const result = await jiraGet<{ issues: IssueWithLinks[] }>(
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(FIELDS_WITH_LINKS)}&maxResults=${MAX_RESULTS_PER_BOARD}`,
    );
    allIssuesWithLinks.push(...(result.issues ?? []));
  }

  // Deduplicate rows by tracking seen row IDs (outward links will appear once per source issue)
  const seenRowIds = new Set<string>();
  const dependencyRows: DependencyRow[] = [];
  for (const sourceIssue of allIssuesWithLinks) {
    const rows = extractOutwardDependencies(sourceIssue, projectKeyToTeamName);
    for (const row of rows) {
      if (!seenRowIds.has(row.id)) {
        seenRowIds.add(row.id);
        dependencyRows.push(row);
      }
    }
  }
  return dependencyRows;
}

/** Filters dependency rows by team project key (source or destination). */
function filterRowsByTeam(rows: DependencyRow[], teamProjectKey: string): DependencyRow[] {
  if (teamProjectKey === ALL_TEAMS_FILTER_VALUE) return rows;
  return rows.filter(
    (row) =>
      row.fromTeamProjectKey === teamProjectKey || row.toTeamProjectKey === teamProjectKey,
  );
}

/** Filters dependency rows by link type name. */
function filterRowsByLinkType(rows: DependencyRow[], linkTypeName: string): DependencyRow[] {
  if (linkTypeName === ALL_TEAMS_FILTER_VALUE) return rows;
  return rows.filter((row) => row.linkTypeName === linkTypeName);
}

/** Extracts the unique set of link type names from all dependency rows. */
function extractLinkTypeNames(rows: DependencyRow[]): string[] {
  return Array.from(new Set(rows.map((row) => row.linkTypeName))).sort();
}

// ── Sub-components ──

interface DependencyTableProps {
  rows: DependencyRow[];
}

/** Renders the cross-team dependency table. No SVG involved — purely tabular. */
function DependencyTable({ rows }: DependencyTableProps) {
  if (rows.length === 0) {
    return <p className={styles.emptyState}>No cross-team dependencies found for the current filter.</p>;
  }

  return (
    <table className={styles.depTable} role="table">
      <thead>
        <tr>
          <th scope="col" className={styles.depTh}>From Team</th>
          <th scope="col" className={styles.depTh}>From Issue</th>
          <th scope="col" className={styles.depTh}>Status</th>
          <th scope="col" className={styles.depTh}>Link Type</th>
          <th scope="col" className={styles.depTh}>To Issue</th>
          <th scope="col" className={styles.depTh}>Status</th>
          <th scope="col" className={styles.depTh}>To Team</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={styles.depRow}>
            <td className={styles.depTd}>{row.fromTeamName}</td>
            <td className={styles.depTd}>
              <span className={styles.issueKey}>{row.fromIssueKey}</span>
              <span className={styles.issueSummary}>{row.fromIssueSummary}</span>
            </td>
            <td className={styles.depTd}>
              <span className={styles.statusPill}>{row.fromIssueStatus}</span>
            </td>
            <td className={styles.depTd}>
              <span className={styles.linkTypePill}>{row.linkTypeName}</span>
            </td>
            <td className={styles.depTd}>
              <span className={styles.issueKey}>{row.toIssueKey}</span>
              <span className={styles.issueSummary}>{row.toIssueSummary}</span>
            </td>
            <td className={styles.depTd}>
              <span className={styles.statusPill}>{row.toIssueStatus}</span>
            </td>
            <td className={styles.depTd}>{row.toTeamName}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main component ──

interface DependenciesTabProps {
  teams: ArtTeam[];
}

/** Replaces the SVG dependency map with a searchable, filterable cross-team dependency table. */
export default function DependenciesTab({ teams }: DependenciesTabProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [allRows, setAllRows] = useState<DependencyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS_FILTER_VALUE);
  const [linkTypeFilter, setLinkTypeFilter] = useState(ALL_TEAMS_FILTER_VALUE);

  const hasLoadedData = allRows !== null;
  const availableLinkTypes = allRows ? extractLinkTypeNames(allRows) : [];

  // Build the filtered view by applying both active filters
  const rowsAfterTeamFilter = filterRowsByTeam(allRows ?? [], teamFilter);
  const visibleRows = filterRowsByLinkType(rowsAfterTeamFilter, linkTypeFilter);

  async function handleLoadDependencies() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const rows = await fetchDependencyRows(teams);
      setAllRows(rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load dependencies';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }

  // Build team options for the team filter dropdown
  const teamFilterOptions = [
    { value: ALL_TEAMS_FILTER_VALUE, label: 'All Teams' },
    ...teams
      .filter((team) => team.projectKey)
      .map((team) => ({ value: team.projectKey!.toUpperCase(), label: team.name })),
  ];

  const linkTypeFilterOptions = [
    { value: ALL_TEAMS_FILTER_VALUE, label: 'All Link Types' },
    ...availableLinkTypes.map((typeName) => ({ value: typeName, label: typeName })),
  ];

  return (
    <div className={styles.dependenciesTab}>
      <div className={styles.toolbar}>
        <button className={styles.loadBtn} onClick={handleLoadDependencies} disabled={isLoading}>
          {isLoading ? 'Loading…' : hasLoadedData ? 'Reload Dependencies' : 'Load Dependencies'}
        </button>

        <label className={styles.filterLabel} htmlFor="dep-team-filter">
          Filter by team
        </label>
        <select
          id="dep-team-filter"
          aria-label="Filter by team"
          className={styles.filterSelect}
          value={teamFilter}
          onChange={(event) => setTeamFilter(event.target.value)}
        >
          {teamFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        <label className={styles.filterLabel} htmlFor="dep-link-type-filter">
          Filter by link type
        </label>
        <select
          id="dep-link-type-filter"
          aria-label="Filter by link type"
          className={styles.filterSelect}
          value={linkTypeFilter}
          onChange={(event) => setLinkTypeFilter(event.target.value)}
          disabled={availableLinkTypes.length === 0}
        >
          {linkTypeFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      {loadError && <p className={styles.errorText}>{loadError}</p>}

      {isLoading && <p className={styles.loadingText}>Loading cross-team dependencies…</p>}

      {!isLoading && !hasLoadedData && !loadError && (
        <p className={styles.emptyState}>
          Click "Load Dependencies" to fetch sprint issues with issue links and build the cross-team dependency table.
        </p>
      )}

      {!isLoading && hasLoadedData && allRows!.length === 0 && (
        <p className={styles.emptyState}>No cross-team dependencies found. All sprint issues appear to be self-contained within each team.</p>
      )}

      {!isLoading && hasLoadedData && allRows!.length > 0 && (
        <div className={styles.tableWrapper}>
          <p className={styles.rowCount}>{visibleRows.length} of {allRows!.length} dependencies shown</p>
          <DependencyTable rows={visibleRows} />
        </div>
      )}
    </div>
  );
}
