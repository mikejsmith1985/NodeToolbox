// EnrollmentDashboardKitPanel.tsx — Admin Hub panel that lists the Enrollment dashboard's Rich Filters clauses (GH #511).
//
// After a Jira migration the Enrollment Master Dashboard has to be rebuilt by hand. It runs on ONE saved filter
// the owner already wrote ("All of Enrollment Query"), and every gadget narrows it with a Rich Filters clause.
// This panel finds that filter, works out the live pieces each clause needs (Product Owner field, each team's
// PO, done statuses), then counts every clause INSIDE the base filter so each number matches what the gadget
// will show. It only ever reads: the clauses are copied into Rich Filters by hand, which has no public API.

import React, { useState } from 'react';

import { jiraGet, searchUsers } from '../../services/jiraApi.ts';
import {
  FIELD_MAPPING_ENTRIES, readFieldMappingOverrides, resolveFieldMapping,
} from '../../services/jiraFieldMapping.ts';
import type { JiraField, JiraUser } from '../../types/jira.ts';
import styles from './AdminHubView.module.css';
import {
  BASE_FILTER_NAME, KIT_TEAMS, buildFieldJqlReference, buildRichFilterClauses, combineClauses, pickBaseFilterId,
  readDoneStatusNames, readReadyStatusName, scopeClauseToBase, stripOrderBy,
  type KitInputs, type KitTeam, type ProjectIssueTypeStatuses, type RichFilterClause, type SavedFilter,
} from './enrollmentDashboardKit.ts';
import { computeReadySupply, type ReadySupply } from './dashboardStory.ts';
import { DashboardStorySheet } from './DashboardStorySheet.tsx';
import { describeJiraFailure } from './subtaskStoryPromotion.ts';

// ── Types ──

type TeamLabel = KitTeam['label'];

/** What one read-only discovery pass found on the live instance. */
interface Discovery {
  productOwnerFieldReference: string | null;
  candidatesByTeam: Record<TeamLabel, JiraUser[]>;
  doneStatusNames: string[];
  readyStatusName: string | null;
  storyPointsFieldReference: string | null;
  favouriteFilters: SavedFilter[];
}

/** One live count: how many issues a JQL matches, or why Jira refused it. */
interface CountResult {
  issueCount: number | null;
  jqlError: string | null;
}

/** One clause plus its count inside the base filter. */
type CheckedClause = RichFilterClause & CountResult;

// ── Small helpers ──

/** Jira's "you are not signed in" status — after a Jira move, the server's stored token is the usual cause. */
const UNAUTHORIZED_SUFFIX = ': 401';
const UNAUTHORIZED_FIX_HINT = ' — Jira did not accept the sign-in. Click the Toolbox Relay bookmark in a signed-in Jira tab, then try again.';

/** Reads a human-actionable message off an unknown thrown value. */
function toMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const hint = rawMessage.trim().endsWith(UNAUTHORIZED_SUFFIX) ? UNAUTHORIZED_FIX_HINT : '';
  return describeJiraFailure(rawMessage) + hint;
}

/** The identifier JQL uses for a user: username on Data Center, accountId on Cloud. */
function readUserIdentifier(user: JiraUser): string {
  return user.name || user.accountId;
}

/** Pre-selects the candidate whose display name contains every expected word, else nobody. */
function pickExpectedUser(candidates: readonly JiraUser[], nameWords: readonly string[]): string {
  const match = candidates.find((user) => {
    const displayName = String(user.displayName || '').toLowerCase();
    return nameWords.every((word) => displayName.includes(word));
  });
  return match ? readUserIdentifier(match) : '';
}

/** Resolves a mapped field (Product Owner, Story Points) the same way every other Toolbox surface does (Field Mapping). */
function resolveMappedFieldId(availableFields: readonly JiraField[], settingsKey: 'productOwnerFieldId' | 'spFieldId'): string {
  const entry = FIELD_MAPPING_ENTRIES.find((candidate) => candidate.settingsKey === settingsKey);
  if (!entry) return '';
  return resolveFieldMapping(entry, availableFields, readFieldMappingOverrides(window.localStorage)).effectiveFieldId || '';
}

// ── Jira reads (the panel never writes) ──

/** Reads every live input the clauses need. */
async function discoverInstance(): Promise<Discovery> {
  const fields = await jiraGet<JiraField[]>('/rest/api/2/field');
  const productOwnerFieldReference = buildFieldJqlReference(resolveMappedFieldId(fields, 'productOwnerFieldId'), fields);
  const storyPointsFieldReference = buildFieldJqlReference(resolveMappedFieldId(fields, 'spFieldId'), fields);
  const candidatesByTeam = {} as Record<TeamLabel, JiraUser[]>;
  const projectStatuses: ProjectIssueTypeStatuses[][] = [];
  for (const team of KIT_TEAMS) {
    candidatesByTeam[team.label] = await searchUsers(team.productOwnerSearch).catch(() => []);
    projectStatuses.push(await jiraGet<ProjectIssueTypeStatuses[]>(`/rest/api/2/project/${team.projectKey}/statuses`));
  }
  const favouriteFilters = await jiraGet<SavedFilter[]>('/rest/api/2/filter/favourite').catch(() => []);
  return {
    productOwnerFieldReference, candidatesByTeam, storyPointsFieldReference,
    doneStatusNames: readDoneStatusNames(projectStatuses), readyStatusName: readReadyStatusName(projectStatuses),
    favouriteFilters: favouriteFilters ?? [],
  };
}

/** Counts one JQL with zero results requested, so a typo or unsupported function shows before it is pasted. */
async function countJql(jql: string): Promise<CountResult> {
  try {
    const search = await jiraGet<{ total?: number }>(`/rest/api/2/search?maxResults=0&jql=${encodeURIComponent(jql)}`);
    return { issueCount: search.total ?? 0, jqlError: null };
  } catch (error) {
    return { issueCount: null, jqlError: toMessage(error) };
  }
}

/**
 * Counts Ready to Work and Done 30 Days inside Team Work (no Epics, no sub-tasks), then judges how many weeks the
 * queue lasts. Unknown when the instance lacks either clause.
 */
async function countReadySupply(baseJql: string, clauses: readonly RichFilterClause[]): Promise<ReadySupply> {
  const findClause = (name: string) => clauses.find((clause) => clause.name === name)?.clause;
  const teamWork = findClause('Team Work');
  const ready = findClause('Ready to Work');
  const doneRecently = findClause('Done 30 Days');
  if (!teamWork || !ready || !doneRecently) return computeReadySupply(null, null);
  const readyCount = await countJql(scopeClauseToBase(baseJql, combineClauses(teamWork, ready)));
  const doneCount = await countJql(scopeClauseToBase(baseJql, combineClauses(teamWork, doneRecently)));
  return computeReadySupply(readyCount.issueCount, doneCount.issueCount);
}

// ── The panel ──

/** Admin Hub panel: discover → check every Rich Filters clause inside the owner's base filter. Read-only. */
export function EnrollmentDashboardKitPanel(): React.ReactElement {
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [baseFilterId, setBaseFilterId] = useState('');
  const [selectedUserByTeam, setSelectedUserByTeam] = useState<Record<TeamLabel, string>>({ CUC: '', TRANSFORMERS: '' });
  const [baseCount, setBaseCount] = useState<CountResult | null>(null);
  const [checkedClauses, setCheckedClauses] = useState<CheckedClause[]>([]);
  const [readySupply, setReadySupply] = useState<ReadySupply | null>(null);
  const [status, setStatus] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const baseFilter = discovery?.favouriteFilters.find((filter) => filter.id === baseFilterId) ?? null;

  const runDiscover = async () => {
    setIsBusy(true); setStatus('Reading your favourite filters, the Product Owner field, team POs and statuses…');
    setCheckedClauses([]); setBaseCount(null);
    try {
      const found = await discoverInstance();
      setDiscovery(found);
      setBaseFilterId(pickBaseFilterId(found.favouriteFilters));
      setSelectedUserByTeam({
        CUC: pickExpectedUser(found.candidatesByTeam.CUC, KIT_TEAMS[0].productOwnerNameWords),
        TRANSFORMERS: pickExpectedUser(found.candidatesByTeam.TRANSFORMERS, KIT_TEAMS[1].productOwnerNameWords),
      });
      setStatus(found.productOwnerFieldReference
        ? 'Discovery complete — confirm the base filter and each team\'s Product Owner, then check the clauses.'
        : 'No Product Owner field found — map it in Admin Hub → Field Mapping, then discover again.');
    } catch (error) {
      setStatus(`Discovery failed: ${toMessage(error)}`);
    } finally { setIsBusy(false); }
  };

  const buildInputs = (): KitInputs | null => {
    if (!discovery?.productOwnerFieldReference || !baseFilter) return null;
    if (!selectedUserByTeam.CUC || !selectedUserByTeam.TRANSFORMERS) return null;
    return {
      productOwnerFieldReference: discovery.productOwnerFieldReference,
      productOwnerUserByTeam: selectedUserByTeam,
      doneStatusNames: discovery.doneStatusNames,
      readyStatusName: discovery.readyStatusName,
      storyPointsFieldReference: discovery.storyPointsFieldReference,
    };
  };

  const runCheck = async () => {
    const inputs = buildInputs();
    if (!inputs || !baseFilter) return;
    setIsBusy(true); setStatus('Counting every clause inside the base filter…');
    try {
      setBaseCount(await countJql(stripOrderBy(baseFilter.jql)));
      const results: CheckedClause[] = [];
      for (const clause of buildRichFilterClauses(inputs)) {
        results.push({ ...clause, ...(await countJql(scopeClauseToBase(baseFilter.jql, clause.clause))) });
      }
      setCheckedClauses(results);
      setReadySupply(await countReadySupply(baseFilter.jql, results));
      setStatus('Check complete — nothing was changed in Jira. Copy each clause into Rich Filters.');
    } finally { setIsBusy(false); }
  };

  const changeTeamUser = (teamLabel: TeamLabel, identifier: string) => {
    setSelectedUserByTeam((current) => ({ ...current, [teamLabel]: identifier }));
    setCheckedClauses([]);
  };

  const changeBaseFilter = (filterId: string) => {
    setBaseFilterId(filterId);
    setCheckedClauses([]); setBaseCount(null);
  };

  return (
    <section className={styles.panelCard}>
      <h3 className={styles.sectionTitle}>📊 Enrollment Dashboard Kit — #511</h3>
      <p className={styles.adminDescription}>
        The Enrollment Master Dashboard runs on one saved filter — your <strong>{BASE_FILTER_NAME}</strong> — and every
        gadget narrows it with a Rich Filters clause. This lists those clauses (CUC and Transformers team work, each
        team&apos;s Epics found by Product Owner, and the Kanban status slices) and counts each one inside the base
        filter, then lays the dashboard out as a story an SM or RTE reads top to bottom. It only reads; nothing is
        written to Jira.
      </p>

      <div className={styles.panelSection}>
        <button className={styles.actionButton} onClick={runDiscover} disabled={isBusy} type="button">1 · Discover</button>
        <button className={styles.actionButton} onClick={runCheck} disabled={isBusy || !buildInputs()} type="button">
          2 · 🔍 Check clauses
        </button>
      </div>

      {status && <p className={styles.panelStatusLine}>{status}</p>}

      {discovery && (
        <BaseFilterPicker
          filters={discovery.favouriteFilters}
          selectedId={baseFilterId}
          baseCount={baseCount}
          onChange={changeBaseFilter}
          isDisabled={isBusy}
        />
      )}
      {discovery && <ProductOwnerPickers discovery={discovery} selected={selectedUserByTeam} onChange={changeTeamUser} isDisabled={isBusy} />}
      {checkedClauses.length > 0 && <RichFilterClauseTable clauses={checkedClauses} />}
      {checkedClauses.length > 0 && (
        <DashboardStorySheet
          clauseCounts={new Map(checkedClauses.map((clause) => [clause.name, clause.issueCount]))}
          readySupply={readySupply}
        />
      )}
    </section>
  );
}

// ── Sub-views ──

/** The base filter dropdown, filled from the person's own favourite filters (pick, never type). */
function BaseFilterPicker(props: {
  filters: readonly SavedFilter[];
  selectedId: string;
  baseCount: CountResult | null;
  onChange: (filterId: string) => void;
  isDisabled: boolean;
}): React.ReactElement {
  const { filters, selectedId, baseCount, onChange, isDisabled } = props;
  const selected = filters.find((filter) => filter.id === selectedId);
  return (
    <div className={styles.panelSection}>
      <label className={styles.fieldLabel} htmlFor="kit-base-filter">Base filter (the rich filter&apos;s saved filter)</label>
      <select
        id="kit-base-filter"
        className={styles.inputField}
        value={selectedId}
        onChange={(event) => onChange(event.target.value)}
        disabled={isDisabled}
      >
        <option value="">— choose — (star the filter in Jira if it is missing)</option>
        {filters.map((filter) => <option key={filter.id} value={filter.id}>{filter.name} ({filter.id})</option>)}
      </select>
      {selected && <p className={styles.panelStatusLine}><code>{selected.jql}</code></p>}
      {baseCount && (
        <p className={styles.panelStatusLine}>
          {baseCount.jqlError ? `⚠️ ${baseCount.jqlError}` : `${baseCount.issueCount} issues in the base filter`}
        </p>
      )}
    </div>
  );
}

/** One Product Owner dropdown per team, filled from Jira's own user search (pick, never type). */
function ProductOwnerPickers(props: {
  discovery: Discovery;
  selected: Record<TeamLabel, string>;
  onChange: (teamLabel: TeamLabel, identifier: string) => void;
  isDisabled: boolean;
}): React.ReactElement {
  const { discovery, selected, onChange, isDisabled } = props;
  return (
    <div className={styles.panelSection}>
      <p className={styles.panelStatusLine}>
        Product Owner field: <strong>{discovery.productOwnerFieldReference ?? 'NOT FOUND'}</strong> · Done statuses:{' '}
        <strong>{discovery.doneStatusNames.join(', ') || 'none found'}</strong>
      </p>
      {KIT_TEAMS.map((team) => (
        <div key={team.label}>
          <label className={styles.fieldLabel} htmlFor={`kit-po-${team.label}`}>
            {team.displayName} Product Owner ({team.projectKey} Epics)
          </label>
          <select
            id={`kit-po-${team.label}`}
            className={styles.inputField}
            value={selected[team.label]}
            onChange={(event) => onChange(team.label, event.target.value)}
            disabled={isDisabled}
          >
            <option value="">— choose —</option>
            {discovery.candidatesByTeam[team.label].map((user) => (
              <option key={readUserIdentifier(user)} value={readUserIdentifier(user)}>
                {user.displayName} ({readUserIdentifier(user)})
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

/** Each clause with its count inside the base filter (or Jira's refusal), copyable for the Rich Filters tabs. */
function RichFilterClauseTable({ clauses }: { clauses: readonly CheckedClause[] }): React.ReactElement {
  const copyClause = (clause: string) => { void navigator.clipboard?.writeText(clause); };
  return (
    <div className={styles.panelSection}>
      <label className={styles.fieldLabel}>Rich filter clauses (paste into Rich Filters → Enrollment Master Dashboard)</label>
      <table className={styles.rulesTable}>
        <thead><tr><th>Tab</th><th>Name</th><th>Issues</th><th>Clause</th><th /></tr></thead>
        <tbody>
          {clauses.map((clause) => (
            <tr key={`${clause.tab}-${clause.name}`}>
              <td>{clause.tab}</td>
              <td>{clause.name}</td>
              <td>{clause.jqlError ? `⚠️ ${clause.jqlError}` : clause.issueCount}</td>
              <td><code>{clause.clause}</code></td>
              <td>
                <button className={styles.actionButton} type="button" onClick={() => copyClause(clause.clause)}>Copy</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
