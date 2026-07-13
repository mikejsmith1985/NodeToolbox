// AgingTriageActionTable.tsx — The actionable roll-up of ingested AI triage verdicts.
//
// Renders the recommendation → feature → issue model so a reviewer can act on the AI's cleanup verdicts
// without leaving the app: each issue expands to the shared IssueDetailPanel (status, description,
// acceptance criteria, comments, transition), and each cancel-safe feature group offers a bulk "close the
// feature and its supporting items" action. Read-side only — the actual Jira writes live in the detail
// panel (per issue) and the bulk close panel (per feature group).

import { useState } from 'react';

import IssueDetailPanel from '../../components/IssueDetailPanel/index.tsx';
import type { JiraIssue } from '../../types/jira.ts';
import { readAcceptanceCriteriaText } from '../../utils/acceptanceCriteria.ts';
import { AgingBulkClosePanel } from './AgingBulkClosePanel.tsx';
import type { AgingTriageVerdict } from './agingTriage.ts';
import type { TriageActionModel, TriageFeatureGroup, TriageVerdictGroup } from './agingTriageActionModel.ts';
import styles from './ReportsHubView.module.css';

/** Props: the grouped model, the full issue objects (for inline detail), and the resolved AC field ids. */
export interface AgingTriageActionTableProps {
  model: TriageActionModel;
  issuesByKey: ReadonlyMap<string, JiraIssue>;
  acceptanceCriteriaFieldIds: readonly string[];
  /** Called after a bulk close with the keys that actually transitioned, so a host can record them. Optional. */
  onItemsCanceled?: (issueKeys: string[]) => void;
}

/** Human label + badge class per verdict, matched to the summary badges used elsewhere in the tab. */
const VERDICT_META: Record<AgingTriageVerdict, { label: string; badgeClass: string }> = {
  'cancel-safe': { label: 'Cancel-safe', badgeClass: styles.verdictCancelSafe },
  review: { label: 'Review', badgeClass: styles.verdictReview },
  'must-remain': { label: 'Must remain', badgeClass: styles.verdictMustRemain },
};

/** Stable id for a feature group within a verdict, used to track which group's bulk panel is open. */
function featureGroupId(verdict: AgingTriageVerdict, featureKey: string | null): string {
  return `${verdict}:${featureKey ?? '__none__'}`;
}

/** The full actionable table: one collapsible section per recommendation. */
export function AgingTriageActionTable({ model, issuesByKey, acceptanceCriteriaFieldIds, onItemsCanceled }: AgingTriageActionTableProps): React.JSX.Element {
  // Which issue rows are expanded to show inline detail, and which feature group's bulk panel is open.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [openBulkId, setOpenBulkId] = useState<string | null>(null);
  const [collapsedVerdicts, setCollapsedVerdicts] = useState<Set<AgingTriageVerdict>>(new Set());

  const toggleExpanded = (issueKey: string): void => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(issueKey)) {
        next.delete(issueKey);
      } else {
        next.add(issueKey);
      }
      return next;
    });
  };

  const toggleVerdict = (verdict: AgingTriageVerdict): void => {
    setCollapsedVerdicts((current) => {
      const next = new Set(current);
      if (next.has(verdict)) {
        next.delete(verdict);
      } else {
        next.add(verdict);
      }
      return next;
    });
  };

  return (
    <div className={styles.actionTable}>
      {model.verdictGroups.map((verdictGroup) => (
        <VerdictSection
          key={verdictGroup.verdict}
          verdictGroup={verdictGroup}
          isCollapsed={collapsedVerdicts.has(verdictGroup.verdict)}
          onToggle={() => toggleVerdict(verdictGroup.verdict)}
          expandedKeys={expandedKeys}
          onToggleExpanded={toggleExpanded}
          openBulkId={openBulkId}
          onToggleBulk={setOpenBulkId}
          issuesByKey={issuesByKey}
          acceptanceCriteriaFieldIds={acceptanceCriteriaFieldIds}
          onItemsCanceled={onItemsCanceled}
        />
      ))}
    </div>
  );
}

/** One recommendation section: a collapsible header over its feature groups. */
function VerdictSection({
  verdictGroup,
  isCollapsed,
  onToggle,
  expandedKeys,
  onToggleExpanded,
  openBulkId,
  onToggleBulk,
  issuesByKey,
  acceptanceCriteriaFieldIds,
  onItemsCanceled,
}: {
  verdictGroup: TriageVerdictGroup;
  isCollapsed: boolean;
  onToggle: () => void;
  expandedKeys: ReadonlySet<string>;
  onToggleExpanded: (issueKey: string) => void;
  openBulkId: string | null;
  onToggleBulk: (id: string | null) => void;
  issuesByKey: ReadonlyMap<string, JiraIssue>;
  acceptanceCriteriaFieldIds: readonly string[];
  onItemsCanceled?: (issueKeys: string[]) => void;
}): React.JSX.Element {
  const meta = VERDICT_META[verdictGroup.verdict];
  return (
    <section className={styles.verdictSection}>
      <button type="button" className={styles.verdictSectionHeader} onClick={onToggle}>
        <span className={`${styles.verdictBadge} ${meta.badgeClass}`}>{meta.label}</span>
        <span className={styles.verdictSectionCount}>{verdictGroup.issueCount} issue(s)</span>
        <span className={styles.featureGroupSpacer} />
        <span>{isCollapsed ? '▸' : '▾'}</span>
      </button>
      {!isCollapsed && verdictGroup.featureGroups.map((featureGroup) => (
        <FeatureGroupBlock
          key={featureGroupId(verdictGroup.verdict, featureGroup.featureKey)}
          verdict={verdictGroup.verdict}
          featureGroup={featureGroup}
          expandedKeys={expandedKeys}
          onToggleExpanded={onToggleExpanded}
          openBulkId={openBulkId}
          onToggleBulk={onToggleBulk}
          issuesByKey={issuesByKey}
          acceptanceCriteriaFieldIds={acceptanceCriteriaFieldIds}
          onItemsCanceled={onItemsCanceled}
        />
      ))}
    </section>
  );
}

/** One feature bucket: its header (with the cancel-safe bulk action) and its expandable issue rows. */
function FeatureGroupBlock({
  verdict,
  featureGroup,
  expandedKeys,
  onToggleExpanded,
  openBulkId,
  onToggleBulk,
  issuesByKey,
  acceptanceCriteriaFieldIds,
  onItemsCanceled,
}: {
  verdict: AgingTriageVerdict;
  featureGroup: TriageFeatureGroup;
  expandedKeys: ReadonlySet<string>;
  onToggleExpanded: (issueKey: string) => void;
  openBulkId: string | null;
  onToggleBulk: (id: string | null) => void;
  issuesByKey: ReadonlyMap<string, JiraIssue>;
  acceptanceCriteriaFieldIds: readonly string[];
  onItemsCanceled?: (issueKeys: string[]) => void;
}): React.JSX.Element {
  const groupId = featureGroupId(verdict, featureGroup.featureKey);
  const isBulkOpen = openBulkId === groupId;
  // The bulk close action is offered only on cancel-safe groups — the recommendation that means "safe to
  // cancel". Review is per-issue; must-remain is read-only.
  const canBulkClose = verdict === 'cancel-safe';
  const featureLabel = featureGroup.featureKey !== null
    ? `${featureGroup.featureKey} · ${featureGroup.featureSummary ?? ''}`
    : 'No linked feature';
  const bulkButtonLabel = featureGroup.featureKey !== null
    ? `Close feature + ${featureGroup.issues.length} item(s)`
    : `Close ${featureGroup.issues.length} item(s)`;

  return (
    <div className={styles.featureGroup}>
      <div className={styles.featureGroupHeader}>
        <span className={styles.featureGroupTitle}>{featureLabel}</span>
        {featureGroup.featureStatus !== null && <span className={styles.bulkRowStatus}>{featureGroup.featureStatus}</span>}
        <span className={styles.featureGroupSpacer} />
        {canBulkClose && (
          <button
            type="button"
            className={`${styles.actionButton} ${styles.primaryButton}`}
            onClick={() => onToggleBulk(isBulkOpen ? null : groupId)}
          >
            {isBulkOpen ? 'Cancel' : bulkButtonLabel}
          </button>
        )}
      </div>

      {isBulkOpen && <AgingBulkClosePanel featureGroup={featureGroup} onClose={() => onToggleBulk(null)} onItemsClosed={onItemsCanceled} />}

      {featureGroup.issues.map((issue) => {
        const isExpanded = expandedKeys.has(issue.issueKey);
        const fullIssue = issuesByKey.get(issue.issueKey);
        return (
          <div key={issue.issueKey} className={styles.issueRow}>
            <button type="button" className={styles.issueRowSummary} onClick={() => onToggleExpanded(issue.issueKey)}>
              <span>{isExpanded ? '▾' : '▸'}</span>
              <span className={styles.issueRowKey}>{issue.issueKey}</span>
              <span className={styles.issueRowText}>{issue.summary}</span>
              <span className={styles.bulkRowStatus}>{issue.status}</span>
              <span className={styles.bulkRowStatus}>{Math.round(issue.ageDays)}d</span>
              {issue.rationale !== '' && <span className={styles.issueRowRationale}>{issue.rationale}</span>}
            </button>
            {isExpanded && (
              <div className={styles.issueRowDetail}>
                {fullIssue
                  ? (
                    <IssueDetailPanel
                      issue={fullIssue}
                      isEmbedded
                      acceptanceCriteria={readAcceptanceCriteriaText(fullIssue, acceptanceCriteriaFieldIds)}
                    />
                  )
                  : <p className={styles.captionText}>Full detail unavailable — re-run the report.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
