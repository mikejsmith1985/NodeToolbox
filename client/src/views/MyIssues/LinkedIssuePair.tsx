// LinkedIssuePair.tsx — Renders a linked Jira issue + SNow Problem pair with
// a health badge indicating how well the two records are in sync.
//
// The Jira row acts as a collapsible header. Clicking it reveals the nested
// SNow Problem details and the field-match summary beneath it.
//
// Health colors:
//   🟢 Green  = all mapped fields match (statuses are in sync)
//   🟡 Yellow = some fields match (partial mismatch)
//   🔴 Red    = no mapped fields match (completely out of sync)

import React, { useState } from 'react';

import styles from './LinkedIssuePair.module.css';
import type { LinkedIssuePair as LinkedIssuePairType } from '../../types/issueLinking.ts';
import type { HealthStatus } from '../../types/issueLinking.ts';

// ── Constants ──

const HEALTH_BADGE_LABELS: Record<HealthStatus, string> = {
  green:  '✓ In Sync',
  yellow: '⚠ Partial',
  red:    '✗ Out of Sync',
};

const HEALTH_BADGE_CLASS_NAMES: Record<HealthStatus, string> = {
  green:  styles.healthGreen,
  yellow: styles.healthYellow,
  red:    styles.healthRed,
};

// ── Jira status badge colors (reused from MyIssuesView patterns) ──

function resolveJiraStatusClassName(statusName: string): string {
  const normalizedStatus = statusName.toLowerCase();
  // These inline styles mirror the badge token pattern from MyIssuesView.module.css.
  // We apply them via a data attribute so the CSS file handles the colors.
  return normalizedStatus;
}

// ── Component ──

interface LinkedIssuePairProps {
  /** The matched Jira + SNow pair with computed health status. */
  pair: LinkedIssuePairType;
}

/**
 * Displays a Jira issue and its linked SNow Problem as a collapsible nested card.
 *
 * The left border color signals health at a glance even when the SNow panel is
 * collapsed — users can scan the list quickly without expanding each pair.
 */
export function LinkedIssuePair({ pair }: LinkedIssuePairProps): React.ReactElement {
  const [isSnowPanelExpanded, setIsSnowPanelExpanded] = useState(false);

  const { jiraIssue, snowProblem, healthStatus, matchingFieldCount, totalMappedFieldCount } = pair;

  const healthBadgeLabel = HEALTH_BADGE_LABELS[healthStatus];
  const healthBadgeClassName = `${styles.healthBadge} ${HEALTH_BADGE_CLASS_NAMES[healthStatus]}`;
  const chevronClassName = `${styles.chevron} ${isSnowPanelExpanded ? styles.chevronOpen : ''}`;

  function handleJiraRowClick(): void {
    setIsSnowPanelExpanded((previouslyExpanded) => !previouslyExpanded);
  }

  function handleJiraRowKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsSnowPanelExpanded((previouslyExpanded) => !previouslyExpanded);
    }
  }

  const matchSummaryText =
    `${matchingFieldCount} of ${totalMappedFieldCount} mapped field${totalMappedFieldCount !== 1 ? 's' : ''} match`;

  return (
    <div
      className={styles.pairWrapper}
      data-health={healthStatus}
      data-testid="linked-issue-pair"
    >
      {/* ── Jira row (clickable) ── */}
      <div
        className={styles.jiraRow}
        role="button"
        tabIndex={0}
        aria-expanded={isSnowPanelExpanded}
        aria-label={`Linked pair: ${jiraIssue.key} ↔ ${snowProblem.number}. Health: ${healthBadgeLabel}`}
        onClick={handleJiraRowClick}
        onKeyDown={handleJiraRowKeyDown}
      >
        <span className={chevronClassName}>▶</span>

        <img
          className={styles.issueTypeIcon}
          src={jiraIssue.fields.issuetype.iconUrl}
          alt={jiraIssue.fields.issuetype.name}
        />

        <span className={styles.jiraKey}>{jiraIssue.key}</span>

        <span className={styles.summary} title={jiraIssue.fields.summary}>
          {jiraIssue.fields.summary}
        </span>

        <span
          className={styles.statusBadge}
          data-status={resolveJiraStatusClassName(jiraIssue.fields.status.name)}
        >
          {jiraIssue.fields.status.name}
        </span>

        <span className={styles.priorityBadge}>
          {jiraIssue.fields.priority?.name ?? '—'}
        </span>

        <span className={healthBadgeClassName} title={matchSummaryText}>
          {healthBadgeLabel}
        </span>
      </div>

      {/* ── SNow Problem detail panel (shown when expanded) ── */}
      {isSnowPanelExpanded && (
        <div className={styles.snowPanel} role="region" aria-label={`ServiceNow details for ${snowProblem.number}`}>
          <span className={styles.snowLabel}>ServiceNow</span>
          <span className={styles.snowNumber}>{snowProblem.number}</span>
          <span className={styles.snowSummary} title={snowProblem.short_description}>
            {snowProblem.short_description}
          </span>
          <span className={styles.snowStateBadge}>{snowProblem.state}</span>
          <span className={styles.matchSummary}>{matchSummaryText}</span>
        </div>
      )}
    </div>
  );
}
