// SwimlaneCardView.tsx — Card view with labeled, collapsible swimlane groups.
//
// Groups issues into five zones (Needs Attention, In Progress, In Review,
// To Do, Done) and renders each as a collapsible swimlane of issue cards.
// Cards in "Needs Attention" show badge chips explaining why they need attention.
// Cards show aging labels when they haven't been updated recently.

import {
  AGING_STALE_THRESHOLD_DAYS,
  AGING_WARN_THRESHOLD_DAYS,
  classifyIssueZone,
  computeAttentionReasons,
} from './myIssuesExtendedTypes.ts';
import type { AttentionReason, ExtendedJiraIssue } from './myIssuesExtendedTypes.ts';
import styles from './SwimlaneCardView.module.css';

// ── Constants ──

const MS_PER_DAY = 86_400_000;

/** Ordered swimlane definitions. */
const SWIMLANE_DEFS = [
  { key: 'attn',   emoji: '🔴', label: 'Needs Attention' },
  { key: 'inprog', emoji: '🔵', label: 'In Progress' },
  { key: 'inrev',  emoji: '🟣', label: 'In Review' },
  { key: 'todo',   emoji: '⚫', label: 'To Do' },
  { key: 'done',   emoji: '✅', label: 'Done' },
] as const;

type SwimlaneKey = (typeof SWIMLANE_DEFS)[number]['key'];

// ── Props ──

export interface SwimlaneCardViewProps {
  issues: ExtendedJiraIssue[];
  isBulkModeActive: boolean;
  /** Map of issue key → true for selected issues. */
  bulkSelectedKeys: Record<string, boolean>;
  /** Map of lane key → true when that lane is collapsed. */
  collapsedSwimlanes: Record<string, boolean>;
  /** Map of quick-filter id → true for active quick filters (used to derive board JQL). */
  activeQuickFilterIds: Record<number, boolean>;
  onIssueClick: (issue: ExtendedJiraIssue) => void;
  onToggleBulkKey: (issueKey: string) => void;
  onToggleSwimlane: (laneKey: string) => void;
}

// ── Helper functions ──

/** Calculates the number of full days since the given ISO date string. */
function calculateAgingDays(updatedIsoString: string): number {
  const updatedMs = new Date(updatedIsoString).getTime();
  return Math.floor((Date.now() - updatedMs) / MS_PER_DAY);
}

/** Returns the CSS class for an aging label based on day count. */
function resolveAgingClassName(agingDays: number): string {
  if (agingDays > AGING_STALE_THRESHOLD_DAYS) return styles.agingStale;
  if (agingDays > AGING_WARN_THRESHOLD_DAYS) return styles.agingWarn;
  return '';
}

// ── Sub-components ──

interface AttentionBadgesProps {
  reasons: AttentionReason[];
}

/** Renders the "why this needs attention" badge row for a card. */
function AttentionBadges({ reasons }: AttentionBadgesProps) {
  if (reasons.length === 0) return null;
  return (
    <div className={styles.attentionReasons}>
      {reasons.map((reason) => (
        <span className={styles.attentionBadge} key={reason} title={`Needs Attention: ${reason}`}>
          ⚠️ {reason}
        </span>
      ))}
    </div>
  );
}

interface IssueCardProps {
  issue: ExtendedJiraIssue;
  isBulkModeActive: boolean;
  isSelected: boolean;
  onIssueClick: (issue: ExtendedJiraIssue) => void;
  onToggleBulkKey: (issueKey: string) => void;
}

/** Renders a single issue card with optional bulk checkbox and attention badges. */
function IssueCard({
  issue,
  isBulkModeActive,
  isSelected,
  onIssueClick,
  onToggleBulkKey,
}: IssueCardProps) {
  const { fields, key } = issue;
  const agingDays = calculateAgingDays(fields.updated);
  const agingClassName = resolveAgingClassName(agingDays);
  const attentionReasons = computeAttentionReasons(issue);
  const cardClassName = [
    styles.issueCard,
    isSelected ? styles.bulkSelectedCard : '',
  ]
    .filter(Boolean)
    .join(' ');

  function handleClick() {
    if (isBulkModeActive) {
      onToggleBulkKey(key);
    } else {
      onIssueClick(issue);
    }
  }

  function handleKeyDown(keyboardEvent: React.KeyboardEvent) {
    if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
      handleClick();
    }
  }

  return (
    <div
      className={cardClassName}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      {isBulkModeActive && (
        <input
          aria-label={`Select ${key}`}
          checked={isSelected}
          className={styles.bulkCheckbox}
          onChange={() => onToggleBulkKey(key)}
          onClick={(clickEvent) => clickEvent.stopPropagation()}
          type="checkbox"
        />
      )}

      <div className={styles.cardTop} style={isBulkModeActive ? { paddingLeft: '24px' } : undefined}>
        <span className={styles.cardKey}>{key}</span>
        {fields.priority && (
          <span className={styles.priorityBadge}>{fields.priority.name}</span>
        )}
      </div>

      <p className={styles.cardSummary}>{fields.summary}</p>

      <AttentionBadges reasons={attentionReasons} />

      <div className={styles.cardMeta}>
        <span>{fields.issuetype.name}</span>
        {agingDays > 0 && agingClassName && (
          <span className={`${styles.agingLabel} ${agingClassName}`}>{agingDays}d ago</span>
        )}
        {agingDays > 0 && !agingClassName && (
          <span className={styles.agingLabel}>{agingDays}d ago</span>
        )}
      </div>
    </div>
  );
}

interface SwimlaneProps {
  laneKey: SwimlaneKey;
  emoji: string;
  label: string;
  issues: ExtendedJiraIssue[];
  isCollapsed: boolean;
  isBulkModeActive: boolean;
  bulkSelectedKeys: Record<string, boolean>;
  onIssueClick: (issue: ExtendedJiraIssue) => void;
  onToggleBulkKey: (issueKey: string) => void;
  onToggle: (laneKey: string) => void;
}

/** Renders a single collapsible swimlane section. */
function Swimlane({
  laneKey,
  emoji,
  label,
  issues,
  isCollapsed,
  isBulkModeActive,
  bulkSelectedKeys,
  onIssueClick,
  onToggleBulkKey,
  onToggle,
}: SwimlaneProps) {
  const chevronClassName = isCollapsed
    ? `${styles.swimlaneChevron} ${styles.swimlaneChevronCollapsed}`
    : styles.swimlaneChevron;

  return (
    <div className={styles.swimlane}>
      <button
        aria-expanded={!isCollapsed}
        className={styles.swimlaneHeader}
        onClick={() => onToggle(laneKey)}
        type="button"
      >
        <span aria-hidden="true">{emoji}</span>
        <span>{label}</span>
        <span className={styles.swimlaneCount}>({issues.length})</span>
        <span aria-hidden="true" className={chevronClassName}>▼</span>
      </button>

      {!isCollapsed && (
        <div className={styles.swimlaneBody}>
          {issues.map((issue) => (
            <IssueCard
              isBulkModeActive={isBulkModeActive}
              isSelected={!!bulkSelectedKeys[issue.key]}
              issue={issue}
              key={issue.key}
              onIssueClick={onIssueClick}
              onToggleBulkKey={onToggleBulkKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ──

/**
 * Renders issues in a swimlane layout grouped by status zone.
 * Each lane is collapsible and shows an issue count in its header.
 * Cards in the Needs Attention lane display attention-reason badges.
 */
export default function SwimlaneCardView({
  issues,
  isBulkModeActive,
  bulkSelectedKeys,
  collapsedSwimlanes,
  onIssueClick,
  onToggleBulkKey,
  onToggleSwimlane,
}: SwimlaneCardViewProps) {
  if (issues.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span>🔍</span>
        <span>No issues to display.</span>
      </div>
    );
  }

  // Classify issues into lanes
  const laneGroups: Record<SwimlaneKey, ExtendedJiraIssue[]> = {
    attn: [],
    inprog: [],
    inrev: [],
    todo: [],
    done: [],
  };

  for (const issue of issues) {
    laneGroups[classifyIssueZone(issue)].push(issue);
  }

  return (
    <div className={styles.swimlaneList}>
      {SWIMLANE_DEFS.map((lane) => {
        const laneIssues = laneGroups[lane.key];
        if (laneIssues.length === 0) return null;

        return (
          <Swimlane
            bulkSelectedKeys={bulkSelectedKeys}
            emoji={lane.emoji}
            isBulkModeActive={isBulkModeActive}
            isCollapsed={!!collapsedSwimlanes[lane.key]}
            issues={laneIssues}
            key={lane.key}
            label={lane.label}
            laneKey={lane.key}
            onIssueClick={onIssueClick}
            onToggle={onToggleSwimlane}
            onToggleBulkKey={onToggleBulkKey}
          />
        );
      })}
    </div>
  );
}
