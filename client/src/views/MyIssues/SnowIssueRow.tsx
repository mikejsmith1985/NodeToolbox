// SnowIssueRow.tsx — Renders a single unlinked ServiceNow work item as a table row
// inside the My Issues view.
//
// Only unlinked SNow issues appear here. Linked Jira↔SNow Problem pairs are
// rendered by the LinkedIssuePair component instead.

import React from 'react';

import styles from './SnowIssueRow.module.css';
import type { SnowMyIssue, SnowIssueType } from '../../types/snow.ts';

// ── Type-label map ──

/** Human-readable short labels for each SNow record type, shown in the type icon cell. */
const SNOW_TYPE_LABELS: Record<SnowIssueType, string> = {
  incident: 'INC',
  problem: 'PRB',
  sc_task: 'TASK',
  change_request: 'CHG',
};

// ── Status badge helpers ──

/** Maps a SNow state display label to the matching CSS module class name. */
function resolveStatusBadgeClassName(state: string): string {
  const normalizedState = state.trim().toLowerCase();
  if (normalizedState === 'new')         return styles.statusNew;
  if (normalizedState === 'in progress') return styles.statusProgress;
  if (normalizedState === 'on hold')     return styles.statusOnHold;
  if (normalizedState === 'resolved')    return styles.statusResolved;
  if (normalizedState === 'closed' || normalizedState === 'cancelled') return styles.statusClosed;
  return styles.statusDefault;
}

// ── Priority badge helpers ──

/**
 * Maps a SNow priority string (e.g. "1 - Critical") to the correct CSS class.
 * SNow encodes priority as "[number] - [label]", so we extract the leading digit.
 */
function resolvePriorityBadgeClassName(priority: string): string {
  const leadingDigit = priority.trim().charAt(0);
  if (leadingDigit === '1') return styles.priorityCritical;
  if (leadingDigit === '2') return styles.priorityHigh;
  if (leadingDigit === '3') return styles.priorityModerate;
  if (leadingDigit === '4') return styles.priorityLow;
  return styles.priorityDefault;
}

/** Extracts the human-readable label from a SNow priority string. */
function extractPriorityLabel(priority: string): string {
  const dashIndex = priority.indexOf('-');
  return dashIndex !== -1 ? priority.slice(dashIndex + 1).trim() : priority;
}

// ── Date formatting ──

/** Formats an ISO 8601 timestamp to a short locale date string for display. */
function formatOpenedDate(isoTimestamp: string): string {
  try {
    return new Date(isoTimestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoTimestamp;
  }
}

// ── Component ──

interface SnowIssueRowProps {
  /** The SNow issue to render. */
  issue: SnowMyIssue;
}

/**
 * A single ServiceNow work item row for the My Issues table.
 *
 * The cyan left border visually distinguishes SNow rows from Jira rows,
 * which use the accent color. This makes it immediately clear which system
 * each issue originates from at a glance.
 */
export function SnowIssueRow({ issue }: SnowIssueRowProps): React.ReactElement {
  const typeLabel = SNOW_TYPE_LABELS[issue.sys_class_name] ?? 'SNow';
  const statusClassName = `${styles.statusBadge} ${resolveStatusBadgeClassName(issue.state)}`;
  const priorityClassName = `${styles.priorityBadge} ${resolvePriorityBadgeClassName(issue.priority)}`;

  return (
    <div className={styles.snowRow} role="row" aria-label={`SNow ${issue.number}: ${issue.short_description}`}>
      <span className={styles.typeIcon} title={issue.sys_class_name}>
        {typeLabel}
      </span>

      <span className={styles.recordNumber} title={issue.number}>
        {issue.number}
      </span>

      <span className={styles.summary} title={issue.short_description}>
        {issue.short_description}
      </span>

      <span className={statusClassName}>
        {issue.state}
      </span>

      <span className={priorityClassName}>
        {extractPriorityLabel(issue.priority)}
      </span>

      <span className={styles.openedDate}>
        {formatOpenedDate(issue.opened_at)}
      </span>
    </div>
  );
}
