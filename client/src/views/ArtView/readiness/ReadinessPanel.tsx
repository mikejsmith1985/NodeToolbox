// ReadinessPanel.tsx — The ART View Readiness tab (021).
//
// Three PI lenses (Carryover / Current / Upcoming) over ONE scan, a state-grouped summary, and a
// feature listing where every alert carries an inline fix. Counts and the listing are the same
// scan's arrays — they cannot disagree (FR-010). Empty scope and unconfigured field families render
// honest states, never a healthy-looking zero (GH #167).

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { AgeBadge } from '../../../components/IssueMeta/AgeBadge.tsx';
import { AssigneeAvatar } from '../../../components/IssueMeta/AssigneeAvatar.tsx';
import { IssueTypeIcon } from '../../../components/IssueMeta/IssueTypeIcon.tsx';
import { StatusChip } from '../../../components/IssueMeta/StatusChip.tsx';
import IssueDetailPanel from '../../../components/IssueDetailPanel/index.tsx';
import type { JiraIssue as RealJiraIssue } from '../../../types/jira.ts';
import { ReadinessFixControl } from './ReadinessFixControl.tsx';
import { ReadinessAiPanel } from './ai/ReadinessAiPanel.tsx';
import {
  READINESS_ALERT_IDS,
  type ReadinessAlertFamilyState,
  type ReadinessAlertId,
  type ReadinessFeature,
  type ReadinessLens,
  type ReadinessWriteFieldIds,
} from './readinessScan.ts';
import {
  useReadinessData,
  type ReadinessRosterTeam,
} from './useReadinessData.ts';
import styles from './ReadinessPanel.module.css';

const LENS_QUERY_PARAM = 'readinessLens';
const FILTER_QUERY_PARAM = 'readinessFilter';
const DEFAULT_STALE_DAYS_THRESHOLD = 14;

/** Human labels for each lens tab. */
const LENS_LABELS: Record<ReadinessLens['id'], string> = {
  current: 'Current PI',
  upcoming: 'Upcoming PI',
  carryover: 'Carryover',
};

/** Human labels for each alert flag. */
const ALERT_LABELS: Record<ReadinessAlertId, string> = {
  'missing-ownership': 'Missing Owner',
  'missing-estimate': 'Missing Estimate',
  'missing-pcode': 'Missing PCode',
  'target-end-missing-or-past': 'Target End',
  'due-date-missing-or-past': 'Due Date',
};

const NOT_CONFIGURED_LABEL = 'not checked — no matching field';

export interface ReadinessPanelProps {
  selectedPiName: string;
  availablePiNames: readonly string[];
  rosterTeams: readonly ReadinessRosterTeam[];
  /** Stale threshold feeding the age heat badge; defaults when the caller omits it. */
  staleDaysThreshold?: number;
}

/** Narrows a raw query value to a valid lens id. */
function isLensId(value: string | null): value is ReadinessLens['id'] {
  return value === 'current' || value === 'upcoming' || value === 'carryover';
}

/** Renders the ART Readiness workspace. */
export default function ReadinessPanel({
  selectedPiName,
  availablePiNames,
  rosterTeams,
  staleDaysThreshold = DEFAULT_STALE_DAYS_THRESHOLD,
}: ReadinessPanelProps) {
  const { scanResult, isLoading, reload } = useReadinessData({ selectedPiName, availablePiNames, rosterTeams });
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedLens = searchParams.get(LENS_QUERY_PARAM);
  const activeLensId: ReadinessLens['id'] = isLensId(requestedLens) ? requestedLens : 'current';
  const activeFilter = searchParams.get(FILTER_QUERY_PARAM);

  function selectLens(lensId: ReadinessLens['id']): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(LENS_QUERY_PARAM, lensId);
      next.delete(FILTER_QUERY_PARAM); // a new lens starts unfiltered
      return next;
    }, { replace: true });
  }

  function toggleFilter(token: string): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (next.get(FILTER_QUERY_PARAM) === token) {
        next.delete(FILTER_QUERY_PARAM);
      } else {
        next.set(FILTER_QUERY_PARAM, token);
      }
      return next;
    }, { replace: true });
  }

  const activeLens = scanResult?.lenses[activeLensId] ?? null;
  const visibleFeatures = useMemo(
    () => filterFeatures(activeLens?.features ?? [], activeFilter),
    [activeLens, activeFilter],
  );

  if (isLoading) {
    return <div className={styles.readinessPanel}><p className={styles.stateMessage}>Loading readiness…</p></div>;
  }
  if (!scanResult) {
    return (
      <div className={styles.readinessPanel}>
        <p className={styles.stateMessage}>Select a PI to see feature status and readiness.</p>
      </div>
    );
  }
  if (scanResult.loadError) {
    return (
      <div className={styles.readinessPanel}>
        <p className={styles.errorMessage} role="alert">⚠ {scanResult.loadError}</p>
      </div>
    );
  }

  const isEmptyScope = scanResult.scannedFeatureCount === 0;

  return (
    <div className={styles.readinessPanel}>
      <nav aria-label="Readiness lenses" className={styles.lensStrip}>
        {(['current', 'upcoming', 'carryover'] as const).map((lensId) => {
          const lens = scanResult.lenses[lensId];
          const total = lens.features.length;
          return (
            <button
              key={lensId}
              type="button"
              aria-pressed={activeLensId === lensId}
              className={activeLensId === lensId ? styles.lensButtonActive : styles.lensButton}
              onClick={() => selectLens(lensId)}
            >
              <span className={styles.lensLabel}>{LENS_LABELS[lensId]}</span>
              <span className={styles.lensCount}>{total}</span>
            </button>
          );
        })}
        <span className={styles.scanScope}>{scanResult.scannedFeatureCount} features scanned · {scanResult.scopeDescription}</span>
      </nav>

      {isEmptyScope && (
        <div className={styles.emptyScope} role="status">
          ⚠ This scope matched no Features — check the PI, feature project keys, and roster labels.
          No readiness score is shown for an empty scope.
        </div>
      )}

      {activeLens && !isEmptyScope && (
        <>
          {renderLensSummary(activeLens, activeFilter, toggleFilter)}
          {renderAlertLegend(scanResult.alertFamilyStates)}
          <div className={styles.findingsList} aria-label="Readiness features">
            {visibleFeatures.length === 0 ? (
              <p className={styles.stateMessage}>No Features match the current filter.</p>
            ) : (
              visibleFeatures.map((feature) => (
                <ReadinessFeatureRow
                  key={feature.key}
                  feature={feature}
                  alertFamilyStates={scanResult.alertFamilyStates}
                  writeFieldIds={scanResult.writeFieldIds}
                  staleDaysThreshold={staleDaysThreshold}
                  onFixed={reload}
                />
              ))
            )}
          </div>
          <ReadinessAiPanel lens={activeLens} writeFieldIds={scanResult.writeFieldIds} onProposalWritten={reload} />
        </>
      )}
    </div>
  );
}

/** Keeps features matching the active filter token (a status bucket, a status name, or an alert id). */
function filterFeatures(features: readonly ReadinessFeature[], filterToken: string | null): ReadinessFeature[] {
  if (!filterToken) return [...features];
  if (READINESS_ALERT_IDS.includes(filterToken as ReadinessAlertId)) {
    return features.filter((feature) => feature.alerts.includes(filterToken as ReadinessAlertId));
  }
  if (filterToken === 'todo' || filterToken === 'inProgress' || filterToken === 'done') {
    return features.filter((feature) => feature.statusBucket === filterToken);
  }
  return features.filter((feature) => feature.statusName === filterToken);
}

/** Renders the state/refinement summary tiles for a lens; each tile toggles a listing filter. */
function renderLensSummary(
  lens: ReadinessLens,
  activeFilter: string | null,
  onToggleFilter: (token: string) => void,
) {
  if (lens.id === 'upcoming') {
    return (
      <div className={styles.summaryTiles} aria-label="Upcoming readiness summary">
        <SummaryTile label="Refined" count={lens.refinedCount} token="inProgress" activeFilter={activeFilter} onToggle={onToggleFilter} />
        <SummaryTile label="Unrefined" count={lens.unrefinedCount} token="todo" activeFilter={activeFilter} onToggle={onToggleFilter} />
        {!lens.isPiConfigured && <span className={styles.tileNote}>No upcoming PI is configured.</span>}
      </div>
    );
  }
  return (
    <div className={styles.summaryTiles} aria-label={`${LENS_LABELS[lens.id]} status summary`}>
      <SummaryTile label="To Do" count={lens.countsByBucket.todo} token="todo" activeFilter={activeFilter} onToggle={onToggleFilter} />
      <SummaryTile label="In Progress" count={lens.countsByBucket.inProgress} token="inProgress" activeFilter={activeFilter} onToggle={onToggleFilter} />
      <SummaryTile label="Done" count={lens.countsByBucket.done} token="done" activeFilter={activeFilter} onToggle={onToggleFilter} />
      {lens.isCoverageCapped && <span className={styles.tileNote}>Carryover history capped at the 4 most recent PIs.</span>}
    </div>
  );
}

/** One clickable summary tile that filters the listing to its group. */
function SummaryTile({
  label,
  count,
  token,
  activeFilter,
  onToggle,
}: {
  label: string;
  count: number;
  token: string;
  activeFilter: string | null;
  onToggle: (token: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={activeFilter === token}
      className={activeFilter === token ? styles.summaryTileActive : styles.summaryTile}
      onClick={() => onToggle(token)}
    >
      <strong>{count}</strong>
      <span>{label}</span>
    </button>
  );
}

/** Lists any alert families that are not configured on this instance, so a zero is never mistaken for clean. */
function renderAlertLegend(alertFamilyStates: Record<ReadinessAlertId, ReadinessAlertFamilyState>) {
  const notConfigured = READINESS_ALERT_IDS.filter((alertId) => alertFamilyStates[alertId] === 'notConfigured');
  if (notConfigured.length === 0) return null;
  return (
    <p className={styles.legendNote}>
      {notConfigured.map((alertId) => `${ALERT_LABELS[alertId]}: ${NOT_CONFIGURED_LABEL}`).join(' · ')}
    </p>
  );
}

/** One feature row: identity, chips, alert flags, and per-alert inline fixes. */
function ReadinessFeatureRow({
  feature,
  alertFamilyStates,
  writeFieldIds,
  staleDaysThreshold,
  onFixed,
}: {
  feature: ReadinessFeature;
  alertFamilyStates: Record<ReadinessAlertId, ReadinessAlertFamilyState>;
  writeFieldIds: ReadinessWriteFieldIds;
  staleDaysThreshold: number;
  onFixed: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <div className={styles.featureRow}>
      <div className={styles.featureMain}>
        <a
          className={styles.featureKey}
          href={`/browse/${encodeURIComponent(feature.key)}`}
          target="_blank"
          rel="noreferrer"
        >
          {feature.key}
        </a>
        <span className={styles.featureSummary}>{feature.summary}</span>
        {/* Expand for full context — comments, description, and status transitions (which collect
            any required screen fields via the shared IssueDetailPanel). */}
        <button
          type="button"
          className={styles.expandButton}
          aria-expanded={isExpanded}
          aria-label={`Toggle details for ${feature.key}`}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? '▲ Less' : '▼ Details'}
        </button>
      </div>
      <dl className={styles.featureMeta}>
        <div><dt>Type</dt><dd><IssueTypeIcon issueTypeName={feature.issue.fields.issuetype?.name ?? 'Feature'} /></dd></div>
        <div><dt>Status</dt><dd><StatusChip statusName={feature.statusName} statusCategoryKey={feature.issue.fields.status.statusCategory?.key} /></dd></div>
        <div><dt>Owner</dt><dd><AssigneeAvatar displayName={feature.assigneeDisplayName ?? feature.productOwnerDisplayName} /></dd></div>
        <div><dt>Age</dt><dd>{feature.ageDays === null ? '—' : <AgeBadge ageDays={feature.ageDays} staleDaysThreshold={staleDaysThreshold} />}</dd></div>
      </dl>
      {feature.alerts.length > 0 && (
        <div className={styles.alertList}>
          {feature.alerts.map((alertId) => (
            <div key={alertId} className={styles.alertRow}>
              <span className={styles.alertFlag}>{ALERT_LABELS[alertId]}</span>
              <ReadinessFixControl
                feature={feature}
                alertId={alertId}
                writeFieldIds={writeFieldIds}
                alertFamilyStates={alertFamilyStates}
                onFixed={onFixed}
              />
            </div>
          ))}
        </div>
      )}
      {isExpanded && (
        <div className={styles.detailCell}>
          <IssueDetailPanel
            isEmbedded
            issue={feature.issue as unknown as RealJiraIssue}
            onIssueUpdated={onFixed}
            ageDays={feature.ageDays ?? undefined}
            staleDaysThreshold={staleDaysThreshold}
          />
        </div>
      )}
    </div>
  );
}
