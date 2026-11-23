// EnrollmentDashboardKitPanel.tsx — Admin Hub panel that rebuilds the Enrollment dashboard's saved filters (GH #511).
//
// After a Jira migration the Enrollment Master Dashboard has to be rebuilt by hand. This panel does the part
// Jira lets us automate: it discovers the live pieces (Product Owner field, each team's PO, done statuses),
// builds every saved filter the dashboard needs, checks each one's JQL against Jira with an issue count,
// previews create / update / unchanged, and only on Apply writes the filters and shares them with both team
// projects. It also lists the clause-only JQL to paste into the Rich Filters tabs, which have no public API.

import React, { useState } from 'react';

import { jiraGet, jiraPost, jiraPut, searchUsers } from '../../services/jiraApi.ts';
import {
  FIELD_MAPPING_ENTRIES, readFieldMappingOverrides, resolveFieldMapping,
} from '../../services/jiraFieldMapping.ts';
import type { JiraField, JiraUser } from '../../types/jira.ts';
import styles from './AdminHubView.module.css';
import {
  KIT_TEAMS, buildKitFilters, buildRichFilterClauses, buildFieldJqlReference, planFilterActions,
  planMissingProjectShares, readDoneStatusNames,
  type ExistingFilter, type FilterPlanRow, type KitInputs, type KitTeam, type ProjectIssueTypeStatuses,
  type RichFilterClause, type SharePermission,
} from './enrollmentDashboardKit.ts';
import { describeJiraFailure } from './subtaskStoryPromotion.ts';

// ── Types ──

type TeamLabel = KitTeam['label'];

/** What one read-only discovery pass found on the live instance. */
interface Discovery {
  productOwnerFieldReference: string | null;
  candidatesByTeam: Record<TeamLabel, JiraUser[]>;
  projectIdByKey: Record<string, string>;
  doneStatusNames: string[];
  existingFilters: ExistingFilter[];
}

/** One previewed filter: the plan row plus what Jira said when its JQL was test-run. */
interface PreviewRow extends FilterPlanRow {
  issueCount: number | null;
  jqlError: string | null;
}

// ── Small helpers ──

/** Reads a human-actionable message off an unknown thrown value. */
function toMessage(error: unknown): string {
  return describeJiraFailure(error instanceof Error ? error.message : String(error));
}

/** The identifier JQL and filters use for a user: username on Data Center, accountId on Cloud. */
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

/** Resolves the Product Owner field the same way every other Toolbox surface does (Field Mapping). */
function resolveProductOwnerFieldId(availableFields: readonly JiraField[]): string {
  const entry = FIELD_MAPPING_ENTRIES.find((candidate) => candidate.settingsKey === 'productOwnerFieldId');
  if (!entry) return '';
  return resolveFieldMapping(entry, availableFields, readFieldMappingOverrides(window.localStorage)).effectiveFieldId || '';
}

// ── Jira reads ──

/** Reads every live input the kit needs. Read-only: GET requests only. */
async function discoverInstance(): Promise<Discovery> {
  const fields = await jiraGet<JiraField[]>('/rest/api/2/field');
  const productOwnerFieldReference = buildFieldJqlReference(resolveProductOwnerFieldId(fields), fields);
  const candidatesByTeam = {} as Record<TeamLabel, JiraUser[]>;
  const projectIdByKey: Record<string, string> = {};
  const projectStatuses: ProjectIssueTypeStatuses[][] = [];
  for (const team of KIT_TEAMS) {
    candidatesByTeam[team.label] = await searchUsers(team.productOwnerSearch).catch(() => []);
    const project = await jiraGet<{ id: string }>(`/rest/api/2/project/${team.projectKey}`);
    projectIdByKey[team.projectKey] = project.id;
    projectStatuses.push(await jiraGet<ProjectIssueTypeStatuses[]>(`/rest/api/2/project/${team.projectKey}/statuses`));
  }
  const existingFilters = await jiraGet<ExistingFilter[]>('/rest/api/2/filter/favourite').catch(() => []);
  return {
    productOwnerFieldReference, candidatesByTeam, projectIdByKey,
    doneStatusNames: readDoneStatusNames(projectStatuses), existingFilters: existingFilters ?? [],
  };
}

/** Test-runs one JQL with zero results requested, so a typo or unsupported function shows before any write. */
async function countJql(jql: string): Promise<{ issueCount: number | null; jqlError: string | null }> {
  try {
    const search = await jiraGet<{ total?: number }>(`/rest/api/2/search?maxResults=0&jql=${encodeURIComponent(jql)}`);
    return { issueCount: search.total ?? 0, jqlError: null };
  } catch (error) {
    return { issueCount: null, jqlError: toMessage(error) };
  }
}

// ── Jira writes (Apply only) ──

/** Creates or updates one filter and returns its id; unchanged filters are returned as-is. */
async function writeFilter(row: PreviewRow): Promise<string> {
  const body = { name: row.name, description: row.description, jql: row.jql };
  if (row.action === 'create') {
    const created = await jiraPost<{ id: string }>('/rest/api/2/filter', { ...body, favourite: true });
    return created.id;
  }
  if (row.action === 'update' && row.existingId) await jiraPut(`/rest/api/2/filter/${row.existingId}`, body);
  return row.existingId ?? '';
}

/** Shares a filter with each team project it is not yet shared with (anyone who can browse that project). */
async function shareFilter(filterId: string, projectIds: readonly string[]): Promise<number> {
  const existing = await jiraGet<SharePermission[]>(`/rest/api/2/filter/${filterId}/permission`).catch(() => []);
  const missing = planMissingProjectShares(existing ?? [], projectIds);
  for (const projectId of missing) {
    await jiraPost(`/rest/api/2/filter/${filterId}/permission`, { type: 'project', projectId });
  }
  return missing.length;
}

// ── The panel ──

/** Admin Hub panel: discover → dry run (JQL test-run) → apply the Enrollment dashboard's saved filters. */
export function EnrollmentDashboardKitPanel(): React.ReactElement {
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [selectedUserByTeam, setSelectedUserByTeam] = useState<Record<TeamLabel, string>>({ CUC: '', TRANSFORMERS: '' });
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [clauses, setClauses] = useState<RichFilterClause[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const runDiscover = async () => {
    setIsBusy(true); setStatus('Reading the Product Owner field, team POs, projects and statuses…');
    setPreview(null); setLog([]);
    try {
      const found = await discoverInstance();
      setDiscovery(found);
      setSelectedUserByTeam({
        CUC: pickExpectedUser(found.candidatesByTeam.CUC, KIT_TEAMS[0].productOwnerNameWords),
        TRANSFORMERS: pickExpectedUser(found.candidatesByTeam.TRANSFORMERS, KIT_TEAMS[1].productOwnerNameWords),
      });
      setStatus(found.productOwnerFieldReference
        ? 'Discovery complete — confirm each team\'s Product Owner, then run the dry run.'
        : 'No Product Owner field found — map it in Admin Hub → Field Mapping, then discover again.');
    } catch (error) {
      setStatus(`Discovery failed: ${toMessage(error)}`);
    } finally { setIsBusy(false); }
  };

  const buildInputs = (): KitInputs | null => {
    if (!discovery?.productOwnerFieldReference) return null;
    if (!selectedUserByTeam.CUC || !selectedUserByTeam.TRANSFORMERS) return null;
    return {
      productOwnerFieldReference: discovery.productOwnerFieldReference,
      productOwnerUserByTeam: selectedUserByTeam,
      doneStatusNames: discovery.doneStatusNames,
    };
  };

  const runDryRun = async () => {
    const inputs = buildInputs();
    if (!inputs || !discovery) return;
    setIsBusy(true); setStatus('Test-running every filter\'s JQL against Jira…'); setLog([]);
    try {
      const plan = planFilterActions(buildKitFilters(inputs), discovery.existingFilters);
      const rows: PreviewRow[] = [];
      for (const row of plan) rows.push({ ...row, ...(await countJql(row.jql)) });
      setPreview(rows);
      setClauses(buildRichFilterClauses(inputs));
      setStatus('Dry run complete — nothing was changed.');
    } finally { setIsBusy(false); }
  };

  const runApply = async () => {
    if (!preview || !discovery) return;
    if (!window.confirm('Create / update these saved filters in Jira and share them with ENCUC and ENFCT?')) return;
    setIsBusy(true); setStatus('Applying…');
    const lines: string[] = [];
    const appendLog = (line: string) => { lines.push(line); setLog([...lines]); };
    const projectIds = Object.values(discovery.projectIdByKey);
    try {
      for (const row of preview) {
        if (row.jqlError) { appendLog(`${row.name}: skipped — JQL rejected (${row.jqlError})`); continue; }
        try {
          const filterId = await writeFilter(row);
          const sharedCount = await shareFilter(filterId, projectIds);
          appendLog(`${row.name}: ${row.action} (id ${filterId})${sharedCount ? ` · shared with ${sharedCount} project(s)` : ''}`);
        } catch (error) { appendLog(`${row.name}: ERROR — ${toMessage(error)}`); }
      }
      setStatus('Apply finished — filters are in Jira under Filters → My filters / Favourites.');
    } finally { setIsBusy(false); }
  };

  const changeTeamUser = (teamLabel: TeamLabel, identifier: string) => {
    setSelectedUserByTeam((current) => ({ ...current, [teamLabel]: identifier }));
    setPreview(null);
  };

  return (
    <section className={styles.panelCard}>
      <h3 className={styles.sectionTitle}>📊 Enrollment Dashboard Kit — #511</h3>
      <p className={styles.adminDescription}>
        Rebuilds the saved Jira filters behind the Enrollment Master Dashboard: CUC (ENCUC) and Transformers (ENFCT)
        team work, plus each team&apos;s Epics found by Product Owner. Every filter&apos;s JQL is test-run before anything
        is written, and filters are shared with both team projects.
      </p>

      <div className={styles.panelSection}>
        <button className={styles.actionButton} onClick={runDiscover} disabled={isBusy} type="button">1 · Discover</button>
        <button className={styles.actionButton} onClick={runDryRun} disabled={isBusy || !buildInputs()} type="button">
          2 · 🔍 Dry run (preview)
        </button>
        <button className={styles.dangerButton} onClick={runApply} disabled={isBusy || !preview} type="button">
          3 · ⚠️ Apply to Jira
        </button>
      </div>

      {status && <p className={styles.panelStatusLine}>{status}</p>}

      {discovery && <ProductOwnerPickers discovery={discovery} selected={selectedUserByTeam} onChange={changeTeamUser} isDisabled={isBusy} />}
      {preview && <FilterPreviewTable rows={preview} />}
      {preview && clauses.length > 0 && <RichFilterClauseTable clauses={clauses} />}

      {log.length > 0 && (
        <div className={styles.panelSection}>
          <label className={styles.fieldLabel}>Apply log</label>
          <pre className={styles.diagnosticsResultPre}>{log.join('\n')}</pre>
        </div>
      )}
    </section>
  );
}

// ── Sub-views ──

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

/** The dry-run table: each filter's planned action, its live issue count (or the JQL error), and its JQL. */
function FilterPreviewTable({ rows }: { rows: readonly PreviewRow[] }): React.ReactElement {
  return (
    <div className={styles.panelSection}>
      <label className={styles.fieldLabel}>Saved filters</label>
      <table className={styles.rulesTable}>
        <thead><tr><th>Filter</th><th>Action</th><th>Issues</th><th>JQL</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.jqlError ? 'skip' : row.action}</td>
              <td>{row.jqlError ? `⚠️ ${row.jqlError}` : row.issueCount}</td>
              <td><code>{row.jql}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Clause-only JQL for the Rich Filters tabs, each copyable, because that app offers no public API. */
function RichFilterClauseTable({ clauses }: { clauses: readonly RichFilterClause[] }): React.ReactElement {
  const copyClause = (clause: string) => { void navigator.clipboard?.writeText(clause); };
  return (
    <div className={styles.panelSection}>
      <label className={styles.fieldLabel}>Rich filter clauses (paste into Rich Filters → Enrollment Master Dashboard)</label>
      <table className={styles.rulesTable}>
        <thead><tr><th>Tab</th><th>Name</th><th>Clause</th><th /></tr></thead>
        <tbody>
          {clauses.map((clause) => (
            <tr key={`${clause.tab}-${clause.name}`}>
              <td>{clause.tab}</td>
              <td>{clause.name}</td>
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
