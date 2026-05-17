// SprintDashboardView.tsx — Sprint Dashboard view with 11 tabs for sprint health, delivery tracking, and story pointing.
//
// Provides eleven tabs: Overview (sprint info + burn-down chart), By Assignee (swim lanes),
// Blockers (wall of blocked/stale issues), Defects (bug radar by priority),
// Standup (board walk + 15-min timer), Settings (project key + board picker + advanced config),
// Metrics (velocity/burn stats), Pipeline (kanban WIP by status), Planning (unestimated work),
// Pointing (embedded planning poker), and Releases (readiness by fix version).

import { useEffect, useState } from 'react';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import IssueDetailPanel from '../../components/IssueDetailPanel/index.tsx';
import JiraFieldPicker from '../../components/JiraFieldPicker/index.tsx';
import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs.tsx';
import type { JiraIssue } from '../../types/jira.ts';
import StoryPointingView from '../StoryPointing/StoryPointingView.tsx';
import BoardPicker from './BoardPicker.tsx';
import CapacityTab from './CapacityTab.tsx';
import MoveToSprintButton from './MoveToSprintButton.tsx';
import type { DashboardConfig } from './hooks/useDashboardConfig.ts';
import { useDashboardConfig } from './hooks/useDashboardConfig.ts';
import { useSprintData } from './hooks/useSprintData.ts';
import type { DashboardTab } from './hooks/useSprintData.ts';
import styles from './SprintDashboardView.module.css';

// ── Named constants ──

const VIEW_TITLE = 'Sprint Dashboard';
const VIEW_SUBTITLE = 'Monitor sprint health, team progress, and facilitate standup from one place.';

const TAB_OPTIONS: { key: DashboardTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'assignee', label: 'By Assignee' },
  { key: 'blockers', label: 'Blockers' },
  { key: 'defects', label: 'Defects' },
  { key: 'standup', label: 'Standup' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'planning', label: 'Planning' },
  { key: 'pointing', label: 'Pointing' },
  { key: 'releases', label: 'Releases' },
  { key: 'capacity', label: 'Capacity' },
  { key: 'settings', label: 'Settings' },
];

const BLOCKED_STATUSES = ['blocked', 'impeded', 'on hold'];
const MS_PER_DAY = 86_400_000;
const TIMER_WARNING_SECONDS = 300; // last 5 minutes
const TIMER_DANGER_SECONDS = 60;   // last 1 minute
const EXPAND_TOGGLE_COLLAPSED_ICON = '▼';
const EXPAND_TOGGLE_EXPANDED_ICON = '▲';
const BLOCKED_SECTION_KEY = 'blocked';
const STALE_SECTION_KEY = 'stale';
const IN_PROGRESS_SECTION_KEY = 'all-in-progress';

// Burn-down chart lines use these named identifiers in recharts data.
const BURN_IDEAL_KEY = 'ideal';
const BURN_REMAINING_KEY = 'remaining';

/** Statuses with more issues than this threshold are flagged as pipeline bottlenecks. */
const BOTTLENECK_THRESHOLD = 3;

/** Label shown for issues that have no fix version assigned to any release. */
const NO_VERSION_LABEL = 'No Version';

// Story-point size distribution boundaries follow the Fibonacci planning scale.
const STORY_POINTS_SMALL_UPPER = 1;   // 0–1 pts = Small
const STORY_POINTS_MEDIUM_UPPER = 3;  // 2–3 pts = Medium
const STORY_POINTS_LARGE_UPPER = 8;   // 5–8 pts = Large; 13+ = Extra Large

// ── Helper functions ──

/** Calculates days since a Jira date string. */
function calculateAgingDays(updatedDateString: string): number {
  return Math.floor((Date.now() - new Date(updatedDateString).getTime()) / MS_PER_DAY);
}

/** Returns true when the issue is in a blocked/impeded status. */
function isBlockedIssue(issue: JiraIssue): boolean {
  const lowerStatusName = issue.fields.status.name.toLowerCase();
  return BLOCKED_STATUSES.some((blockedStatus) => lowerStatusName.includes(blockedStatus));
}

/**
 * Returns true when the issue has been in progress for more than `staleDaysThreshold` days.
 * The threshold comes from user-configurable settings (default 5) rather than a hardcoded value.
 */
function isStaleIssue(issue: JiraIssue, staleDaysThreshold: number): boolean {
  const isInProgress = issue.fields.status.statusCategory.key === 'indeterminate';
  return isInProgress && calculateAgingDays(issue.fields.updated) >= staleDaysThreshold;
}

/** Groups issues by assignee display name, with unassigned issues bucketed under "Unassigned". */
function groupIssuesByAssignee(issues: JiraIssue[]): Map<string, JiraIssue[]> {
  const groupedIssues = new Map<string, JiraIssue[]>();

  for (const issue of issues) {
    const assigneeName = issue.fields.assignee?.displayName ?? 'Unassigned';
    const existingGroup = groupedIssues.get(assigneeName) ?? [];
    groupedIssues.set(assigneeName, [...existingGroup, issue]);
  }

  return groupedIssues;
}

/** Groups issues by their status name, producing one bucket per unique status for the Pipeline view. */
function groupIssuesByStatus(issues: JiraIssue[]): Map<string, JiraIssue[]> {
  const groupedIssues = new Map<string, JiraIssue[]>();

  for (const issue of issues) {
    const statusName = issue.fields.status.name;
    groupedIssues.set(statusName, [...(groupedIssues.get(statusName) ?? []), issue]);
  }

  return groupedIssues;
}

/**
 * Groups issues by fix version name for the Releases view.
 * Issues with no fixVersions fall under NO_VERSION_LABEL.
 * An issue assigned to multiple versions appears in each version's bucket.
 */
function groupIssuesByFixVersion(issues: JiraIssue[]): Map<string, JiraIssue[]> {
  const groupedIssues = new Map<string, JiraIssue[]>();

  for (const issue of issues) {
    const versionNames = issue.fields.fixVersions?.map((version) => version.name) ?? [];
    const targetVersions = versionNames.length > 0 ? versionNames : [NO_VERSION_LABEL];

    for (const versionName of targetVersions) {
      groupedIssues.set(versionName, [...(groupedIssues.get(versionName) ?? []), issue]);
    }
  }

  return groupedIssues;
}

/** Per-assignee velocity metrics derived from sprint issues. */
interface AssigneeMetrics {
  assigneeName: string;
  totalCount: number;
  doneCount: number;
  inProgressCount: number;
  toDoCount: number;
  /** Sum of story points for the assignee's issues, or null when none are estimated. */
  totalStoryPoints: number | null;
}

/** Derives velocity metrics for a single assignee from their slice of sprint issues. */
function computeAssigneeMetrics(assigneeName: string, assigneeIssues: JiraIssue[]): AssigneeMetrics {
  const doneCount = assigneeIssues.filter(
    (issue) => issue.fields.status.statusCategory.key === 'done',
  ).length;
  const inProgressCount = assigneeIssues.filter(
    (issue) => issue.fields.status.statusCategory.key === 'indeterminate',
  ).length;
  const toDoCount = assigneeIssues.filter(
    (issue) => issue.fields.status.statusCategory.key === 'new',
  ).length;
  const hasAnyPoints = assigneeIssues.some((issue) => issue.fields.customfield_10016 != null);
  const totalStoryPoints = hasAnyPoints
    ? assigneeIssues.reduce((sum, issue) => sum + (issue.fields.customfield_10016 ?? 0), 0)
    : null;

  return { assigneeName, totalCount: assigneeIssues.length, doneCount, inProgressCount, toDoCount, totalStoryPoints };
}

/** Story-point size distribution counts across a set of issues. */
interface SizeDistribution {
  smallCount: number;
  mediumCount: number;
  largeCount: number;
  extraLargeCount: number;
  unestimatedCount: number;
}

/**
 * Buckets issues into Fibonacci story-point size ranges.
 * Issues with no customfield_10016 value are counted as unestimated.
 */
function calculateSizeDistribution(issues: JiraIssue[]): SizeDistribution {
  let smallCount = 0;
  let mediumCount = 0;
  let largeCount = 0;
  let extraLargeCount = 0;
  let unestimatedCount = 0;

  for (const issue of issues) {
    const points = issue.fields.customfield_10016;

    if (points == null) {
      unestimatedCount++;
    } else if (points <= STORY_POINTS_SMALL_UPPER) {
      smallCount++;
    } else if (points <= STORY_POINTS_MEDIUM_UPPER) {
      mediumCount++;
    } else if (points <= STORY_POINTS_LARGE_UPPER) {
      largeCount++;
    } else {
      extraLargeCount++;
    }
  }

  return { smallCount, mediumCount, largeCount, extraLargeCount, unestimatedCount };
}

/** Calculates flow counts (total / in-progress / in-review / blocked / done) for the stats bar. */
function calculateFlowCounts(issues: JiraIssue[]) {
  let inProgressCount = 0;
  let inReviewCount = 0;
  let blockedCount = 0;
  let doneCount = 0;

  for (const issue of issues) {
    const statusCategory = issue.fields.status.statusCategory.key;
    const lowerStatusName = issue.fields.status.name.toLowerCase();

    if (isBlockedIssue(issue)) {
      blockedCount++;
    } else if (['in review', 'code review', 'pr review', 'testing'].includes(lowerStatusName)) {
      inReviewCount++;
    } else if (statusCategory === 'indeterminate') {
      inProgressCount++;
    } else if (statusCategory === 'done') {
      doneCount++;
    }
  }

  return { totalCount: issues.length, inProgressCount, inReviewCount, blockedCount, doneCount };
}

/**
 * Builds burn-down chart data points for the ideal and remaining lines.
 * Since we only have a snapshot, "remaining" is flat at (total - done).
 */
function buildBurnDownData(
  sprintStartDate: string,
  sprintEndDate: string,
  totalIssues: number,
  doneCount: number,
) {
  const startMs = new Date(sprintStartDate).getTime();
  const endMs = new Date(sprintEndDate).getTime();
  const totalDays = Math.max(1, Math.ceil((endMs - startMs) / MS_PER_DAY));
  const remainingCount = totalIssues - doneCount;

  return Array.from({ length: totalDays + 1 }, (_, dayIndex) => ({
    day: dayIndex,
    [BURN_IDEAL_KEY]: Math.round(totalIssues - (totalIssues / totalDays) * dayIndex),
    [BURN_REMAINING_KEY]: remainingCount,
  }));
}

/** Formats seconds as MM:SS for the standup timer display. */
function formatTimerDisplay(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ── Issue card with move-to-sprint action ──

/**
 * A single issue row that includes a MoveToSprintButton.
 * Used in both Overview and Assignee tabs to give team members a quick way to shuffle work.
 */
function IssueCardWithMove({
  issue,
  currentSprintId,
  availableSprints,
  isLoadingAvailableSprints,
  staleDaysThreshold,
  onFetchSprints,
  onMoveToSprint,
  onIssueUpdated,
}: {
  issue: JiraIssue;
  currentSprintId: number | null;
  availableSprints: ReturnType<typeof useSprintData>['state']['availableSprints'];
  isLoadingAvailableSprints: boolean;
  staleDaysThreshold: number;
  onFetchSprints: () => void;
  onMoveToSprint: (issueKey: string, targetSprintId: number) => Promise<void>;
  onIssueUpdated: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isStale = isStaleIssue(issue, staleDaysThreshold);
  const rowClassName = isStale
    ? `${styles.laneIssueRow} ${styles.staleIssueRow}`
    : styles.laneIssueRow;

  function handleRowClick() {
    setIsExpanded((previousIsExpanded) => !previousIsExpanded);
  }

  function stopRowToggle(clickEvent: React.MouseEvent) {
    // Prevent interactive children (link, move button) from also toggling the row.
    clickEvent.stopPropagation();
  }

  return (
    <div className={styles.issueCardWrapper} key={issue.key}>
      {/* Whole row is clickable — caret stays as a visual affordance hint. */}
      <div
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${issue.key}`}
        className={`${rowClassName} ${styles.clickableRow}`}
        onClick={handleRowClick}
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === 'Enter' || keyEvent.key === ' ') handleRowClick();
        }}
        role="button"
        tabIndex={0}
      >
        <a
          className={styles.issueKeyLink}
          href={`#${issue.key}`}
          onClick={stopRowToggle}
        >
          {issue.key}
        </a>
        <span>{issue.fields.summary}</span>
        <span>{issue.fields.status.name}</span>
        <span onClick={stopRowToggle}>
          <MoveToSprintButton
            availableSprints={availableSprints ?? []}
            currentSprintId={currentSprintId}
            isLoadingAvailableSprints={isLoadingAvailableSprints}
            issueKey={issue.key}
            onFetchSprints={onFetchSprints}
            onMoveToSprint={onMoveToSprint}
          />
        </span>
        <span
          aria-hidden="true"
          className={styles.expandToggleButton}
        >
          {isExpanded ? EXPAND_TOGGLE_EXPANDED_ICON : EXPAND_TOGGLE_COLLAPSED_ICON}
        </span>
      </div>
      {isExpanded && (
        <IssueDetailPanel isEmbedded issue={issue} onIssueUpdated={onIssueUpdated} />
      )}
    </div>
  );
}

// ── Sub-renderers ──

/** Renders the sprint info card with name, state, and dates. */
function SprintInfoCard({ sprintInfo }: { sprintInfo: NonNullable<ReturnType<typeof useSprintData>['state']['sprintInfo']> }) {
  return (
    <div className={styles.sprintInfoCard}>
      <h2 className={styles.sprintName}>{sprintInfo.name}</h2>
      <div className={styles.sprintMeta}>
        <span>State: {sprintInfo.state}</span>
        <span>Start: {sprintInfo.startDate.slice(0, 10)}</span>
        <span>End: {sprintInfo.endDate.slice(0, 10)}</span>
      </div>
    </div>
  );
}

/** Renders the 5-chip flow stats bar (Total / In Progress / In Review / Blocked / Done). */
function FlowStatsBar({ issues }: { issues: JiraIssue[] }) {
  const counts = calculateFlowCounts(issues);

  const chipData = [
    { label: 'Total', count: counts.totalCount },
    { label: 'In Progress', count: counts.inProgressCount },
    { label: 'In Review', count: counts.inReviewCount },
    { label: 'Blocked', count: counts.blockedCount },
    { label: 'Done', count: counts.doneCount },
  ];

  return (
    <div className={styles.flowStatsBar}>
      {chipData.map((chip) => (
        <div className={styles.flowStatChip} key={chip.label}>
          <span className={styles.flowStatCount}>{chip.count}</span>
          <span className={styles.flowStatLabel}>{chip.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Renders the health badge based on blocked issue count. */
function HealthBadge({ issues }: { issues: JiraIssue[] }) {
  const blockedCount = issues.filter(isBlockedIssue).length;

  if (blockedCount === 0) {
    return <span className={`${styles.healthBadge} ${styles.healthOnTrack}`}>🟢 On Track</span>;
  }

  if (blockedCount <= 2) {
    return <span className={`${styles.healthBadge} ${styles.healthWatch}`}>🟡 Watch</span>;
  }

  return <span className={`${styles.healthBadge} ${styles.healthAtRisk}`}>🔴 At Risk</span>;
}

/** Renders the burn-down chart using recharts. */
function BurnDownChart({
  sprintInfo,
  issues,
}: {
  sprintInfo: NonNullable<ReturnType<typeof useSprintData>['state']['sprintInfo']>;
  issues: JiraIssue[];
}) {
  const doneCount = issues.filter(
    (issue) => issue.fields.status.statusCategory.key === 'done',
  ).length;

  const burnDownData = buildBurnDownData(
    sprintInfo.startDate,
    sprintInfo.endDate,
    issues.length,
    doneCount,
  );

  return (
    <div className={styles.chartSection}>
      <p className={styles.chartTitle}>Burn-Down Chart</p>
      <ResponsiveContainer height={240} width="100%">
        <LineChart data={burnDownData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="day"
            label={{ value: 'Day', position: 'insideBottomRight', offset: -8 }}
            stroke="var(--color-text-secondary)"
            tick={{ fontSize: 12 }}
          />
          <YAxis
            label={{ value: 'Issues', angle: -90, position: 'insideLeft' }}
            stroke="var(--color-text-secondary)"
            tick={{ fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-border)',
            }}
          />
          <Line
            dataKey={BURN_IDEAL_KEY}
            dot={false}
            name="Ideal"
            stroke="var(--color-text-secondary)"
            strokeDasharray="4 4"
            type="monotone"
          />
          <Line
            dataKey={BURN_REMAINING_KEY}
            dot={false}
            name="Remaining"
            stroke="var(--color-accent)"
            type="monotone"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Renders the Overview tab: sprint info card, health badge, flow stats, burn-down, and full issue list. */
function OverviewTab({
  issues,
  sprintInfo,
  sprintState,
  configState,
  onFetchSprints,
  onMoveToSprint,
  onIssueUpdated,
}: {
  issues: JiraIssue[];
  sprintInfo: ReturnType<typeof useSprintData>['state']['sprintInfo'];
  sprintState: ReturnType<typeof useSprintData>['state'];
  configState: DashboardConfig;
  onFetchSprints: () => void;
  onMoveToSprint: (issueKey: string, targetSprintId: number) => Promise<void>;
  onIssueUpdated: () => void;
}) {
  return (
    <div>
      {sprintInfo ? (
        <>
          <SprintInfoCard sprintInfo={sprintInfo} />
          <HealthBadge issues={issues} />
          <FlowStatsBar issues={issues} />
          <BurnDownChart issues={issues} sprintInfo={sprintInfo} />
        </>
      ) : (
        <p style={{ color: 'var(--color-text-secondary)' }}>
          No sprint loaded. Go to Settings and enter a project key.
        </p>
      )}

      {issues.length > 0 && (
        <div className={styles.blockersSection}>
          <div className={styles.blockersSectionHeader}>
            <h3 className={styles.blockersSectionTitle}>All Issues</h3>
            <span className={styles.countBadge}>{issues.length}</span>
          </div>
          <div className={styles.laneIssueGrid}>
            {issues.map((issue) => (
              <IssueCardWithMove
                availableSprints={sprintState.availableSprints}
                currentSprintId={sprintState.sprintInfo?.id ?? null}
                isLoadingAvailableSprints={sprintState.isLoadingAvailableSprints}
                issue={issue}
                key={issue.key}
                onFetchSprints={onFetchSprints}
                onIssueUpdated={onIssueUpdated}
                onMoveToSprint={onMoveToSprint}
                staleDaysThreshold={configState.staleDaysThreshold}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Renders the By Assignee tab with swim lanes grouping issues per team member. */
function AssigneeTab({
  issues,
  sprintState,
  configState,
  onFetchSprints,
  onMoveToSprint,
  onIssueUpdated,
}: {
  issues: JiraIssue[];
  sprintState: ReturnType<typeof useSprintData>['state'];
  configState: DashboardConfig;
  onFetchSprints: () => void;
  onMoveToSprint: (issueKey: string, targetSprintId: number) => Promise<void>;
  onIssueUpdated: () => void;
}) {
  const groupedIssues = groupIssuesByAssignee(issues);

  return (
    <div>
      {Array.from(groupedIssues.entries()).map(([assigneeName, assigneeIssues]) => {
        const inProgressCount = assigneeIssues.filter(
          (issue) => issue.fields.status.statusCategory.key === 'indeterminate',
        ).length;
        const toDoCount = assigneeIssues.filter(
          (issue) => issue.fields.status.statusCategory.key === 'new',
        ).length;
        const doneCount = assigneeIssues.filter(
          (issue) => issue.fields.status.statusCategory.key === 'done',
        ).length;

        return (
          <div className={styles.assigneeLane} key={assigneeName}>
            <div className={styles.assigneeHeader}>
              <span className={styles.assigneeName}>{assigneeName}</span>
              <span className={styles.assigneeCountBadge}>🔵 {inProgressCount} in progress</span>
              <span className={styles.assigneeCountBadge}>⚪ {toDoCount} to do</span>
              <span className={styles.assigneeCountBadge}>✅ {doneCount} done</span>
            </div>
            <div className={styles.laneIssueGrid}>
              {assigneeIssues.map((issue) => (
                <IssueCardWithMove
                  availableSprints={sprintState.availableSprints}
                  currentSprintId={sprintState.sprintInfo?.id ?? null}
                  isLoadingAvailableSprints={sprintState.isLoadingAvailableSprints}
                  issue={issue}
                  key={issue.key}
                  onFetchSprints={onFetchSprints}
                  onIssueUpdated={onIssueUpdated}
                  onMoveToSprint={onMoveToSprint}
                  staleDaysThreshold={configState.staleDaysThreshold}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Renders the Blockers tab: Blocked issues, Stale in-progress, All in-progress. */
function BlockersTab({
  issues,
  staleDaysThreshold,
  onIssueUpdated,
}: {
  issues: JiraIssue[];
  staleDaysThreshold: number;
  onIssueUpdated: () => void;
}) {
  const [expandedIssueIdentifier, setExpandedIssueIdentifier] = useState<string | null>(null);
  const blockedIssues = issues.filter(isBlockedIssue);
  const staleIssues = issues.filter(
    (issue) => !isBlockedIssue(issue) && isStaleIssue(issue, staleDaysThreshold),
  );
  const allInProgressIssues = issues.filter(
    (issue) =>
      issue.fields.status.statusCategory.key === 'indeterminate' && !isBlockedIssue(issue),
  );

  function createExpandedIssueIdentifier(sectionKey: string, issueKey: string) {
    return `${sectionKey}:${issueKey}`;
  }

  function toggleExpandedIssue(sectionKey: string, issueKey: string) {
    const nextExpandedIssueIdentifier = createExpandedIssueIdentifier(sectionKey, issueKey);
    setExpandedIssueIdentifier((previousIssueIdentifier) =>
      previousIssueIdentifier === nextExpandedIssueIdentifier ? null : nextExpandedIssueIdentifier,
    );
  }

  function renderBlockerCard(issue: JiraIssue, cardClassName: string, sectionKey: string) {
    const issueIdentifier = createExpandedIssueIdentifier(sectionKey, issue.key);
    const isExpanded = expandedIssueIdentifier === issueIdentifier;
    const expandButtonLabel = `${isExpanded ? 'Collapse' : 'Expand'} details for ${issue.key}`;

    function handleCardClick() {
      toggleExpandedIssue(sectionKey, issue.key);
    }

    return (
      <div className={styles.issueCardWrapper} key={issue.key}>
        {/* Whole card is clickable — caret stays as a visual affordance hint. */}
        <div
          aria-expanded={isExpanded}
          aria-label={expandButtonLabel}
          className={`${cardClassName} ${styles.clickableRow}`}
          onClick={handleCardClick}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === 'Enter' || keyEvent.key === ' ') handleCardClick();
          }}
          role="button"
          tabIndex={0}
        >
          <div className={styles.issueCardHeaderRow}>
            <a
              className={styles.issueKeyLink}
              href={`#${issue.key}`}
              onClick={(clickEvent) => clickEvent.stopPropagation()}
            >
              {issue.key}
            </a>
            <span aria-hidden="true" className={styles.expandToggleButton}>
              {isExpanded ? EXPAND_TOGGLE_EXPANDED_ICON : EXPAND_TOGGLE_COLLAPSED_ICON}
            </span>
          </div>
          <span className={styles.issueSummaryText}>{issue.fields.summary}</span>
          <span className={styles.issueMetaText}>
            {issue.fields.assignee?.displayName ?? 'Unassigned'} · {calculateAgingDays(issue.fields.updated)}d ago
          </span>
        </div>
        {isExpanded && (
          <IssueDetailPanel isEmbedded issue={issue} onIssueUpdated={onIssueUpdated} />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.blockersSection}>
        <div className={styles.blockersSectionHeader}>
          <h3 className={styles.blockersSectionTitle}>Blocked</h3>
          <span className={styles.countBadge}>{blockedIssues.length}</span>
        </div>
        {blockedIssues.map((issue) => renderBlockerCard(issue, styles.blockerCard, BLOCKED_SECTION_KEY))}
        {blockedIssues.length === 0 && (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            No blocked issues. 🎉
          </p>
        )}
      </div>

      <div className={styles.blockersSection}>
        <div className={styles.blockersSectionHeader}>
          <h3 className={styles.blockersSectionTitle}>
            Stale (In Progress {staleDaysThreshold}+ days)
          </h3>
          <span className={styles.countBadge}>{staleIssues.length}</span>
        </div>
        {staleIssues.map((issue) => renderBlockerCard(issue, `${styles.blockerCard} ${styles.staleCard}`, STALE_SECTION_KEY))}
      </div>

      <div className={styles.blockersSection}>
        <div className={styles.blockersSectionHeader}>
          <h3 className={styles.blockersSectionTitle}>All In Progress</h3>
          <span className={styles.countBadge}>{allInProgressIssues.length}</span>
        </div>
        {allInProgressIssues.map((issue) => renderBlockerCard(issue, styles.blockerCard, IN_PROGRESS_SECTION_KEY))}
      </div>
    </div>
  );
}

/** Renders the Defects tab: bug issues grouped by priority. */
function DefectsTab({ issues, onIssueUpdated }: { issues: JiraIssue[]; onIssueUpdated: () => void }) {
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const bugIssues = issues.filter((issue) => issue.fields.issuetype.name === 'Bug');

  const PRIORITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'None'];

  const defectsByPriority = PRIORITY_ORDER.map((priorityName) => ({
    priorityName,
    defects: bugIssues.filter((bug) => (bug.fields.priority?.name ?? 'None') === priorityName),
  })).filter((priorityGroup) => priorityGroup.defects.length > 0);

  function toggleExpandedIssue(issueKey: string) {
    setExpandedIssueKey((previousIssueKey) => previousIssueKey === issueKey ? null : issueKey);
  }

  if (bugIssues.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-secondary)' }}>No bugs found in this sprint. 🎉</p>
    );
  }

  return (
    <div>
      {defectsByPriority.map(({ priorityName, defects }) => (
        <div className={styles.defectGroup} key={priorityName}>
          <div className={styles.defectGroupHeader}>
            <h3 className={styles.defectGroupTitle}>{priorityName}</h3>
            <span className={styles.countBadge}>{defects.length}</span>
          </div>
          {defects.map((defect) => {
            const isExpanded = expandedIssueKey === defect.key;
            const expandButtonLabel = `${isExpanded ? 'Collapse' : 'Expand'} details for ${defect.key}`;

            return (
              <div className={styles.issueCardWrapper} key={defect.key}>
                <div className={styles.defectCard}>
                  <a className={styles.issueKeyLink} href={`#${defect.key}`}>
                    {defect.key}
                  </a>
                  <span>{defect.fields.summary}</span>
                  <span className={styles.issueMetaText}>
                    {defect.fields.assignee?.displayName ?? 'Unassigned'}
                  </span>
                  <button
                    aria-expanded={isExpanded}
                    aria-label={expandButtonLabel}
                    className={styles.expandToggleButton}
                    onClick={() => toggleExpandedIssue(defect.key)}
                    type="button"
                  >
                    {isExpanded ? EXPAND_TOGGLE_EXPANDED_ICON : EXPAND_TOGGLE_COLLAPSED_ICON}
                  </button>
                </div>
                {isExpanded && (
                  <IssueDetailPanel isEmbedded issue={defect} onIssueUpdated={onIssueUpdated} />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Renders the Standup tab with the 15-minute countdown timer and board-walk columns. */
function StandupTab({
  issues,
  timerSecondsRemaining,
  isTimerRunning,
  staleDaysThreshold,
  onStart,
  onStop,
  onReset,
  onTick,
}: {
  issues: JiraIssue[];
  timerSecondsRemaining: number;
  isTimerRunning: boolean;
  staleDaysThreshold: number;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onTick: () => void;
}) {
  // Tick the timer every second while it is running.
  useEffect(() => {
    if (!isTimerRunning) {
      return;
    }

    const intervalId = setInterval(() => {
      onTick();
    }, 1000);

    return () => clearInterval(intervalId);
  }, [isTimerRunning, onTick]);

  const isTimerWarning =
    timerSecondsRemaining <= TIMER_WARNING_SECONDS && timerSecondsRemaining > TIMER_DANGER_SECONDS;
  const isTimerDanger = timerSecondsRemaining <= TIMER_DANGER_SECONDS;

  const timerDisplayClassName = isTimerDanger
    ? `${styles.timerDisplay} ${styles.timerDanger}`
    : isTimerWarning
      ? `${styles.timerDisplay} ${styles.timerWarning}`
      : styles.timerDisplay;

  // Board walk: show columns right-to-left (Done → In Review → In Progress → To Do)
  const BOARD_WALK_COLUMNS = [
    {
      label: 'Done',
      filter: (issue: JiraIssue) => issue.fields.status.statusCategory.key === 'done',
    },
    {
      label: 'In Review',
      filter: (issue: JiraIssue) => {
        const lowerStatus = issue.fields.status.name.toLowerCase();
        return ['in review', 'code review', 'pr review', 'testing'].includes(lowerStatus);
      },
    },
    {
      label: 'In Progress',
      filter: (issue: JiraIssue) => {
        const isInProgress = issue.fields.status.statusCategory.key === 'indeterminate';
        const lowerStatus = issue.fields.status.name.toLowerCase();
        const isInReview = ['in review', 'code review', 'pr review', 'testing'].includes(lowerStatus);
        return isInProgress && !isInReview && !isBlockedIssue(issue);
      },
    },
    {
      label: 'To Do',
      filter: (issue: JiraIssue) => issue.fields.status.statusCategory.key === 'new',
    },
  ];

  return (
    <div className={styles.standupLayout}>
      <div className={styles.timerBlock}>
        <span className={timerDisplayClassName}>
          {formatTimerDisplay(timerSecondsRemaining)}
        </span>
        <div className={styles.timerControls}>
          {isTimerRunning ? (
            <button className={styles.timerButton} onClick={onStop} type="button">
              Stop
            </button>
          ) : (
            <button className={styles.timerButton} onClick={onStart} type="button">
              Start
            </button>
          )}
          <button className={styles.timerButton} onClick={onReset} type="button">
            Reset
          </button>
        </div>
      </div>

      <div className={styles.boardWalk}>
        {BOARD_WALK_COLUMNS.map((boardColumn) => {
          const columnIssues = issues.filter(boardColumn.filter);

          return (
            <div className={styles.boardColumn} key={boardColumn.label}>
              <h3 className={styles.boardColumnTitle}>{boardColumn.label}</h3>
              {columnIssues.length === 0 ? (
                <p className={styles.emptyColumnText}>—</p>
              ) : (
                columnIssues.map((issue) => {
                  const agingDays = calculateAgingDays(issue.fields.updated);
                  const isAgedWarn = agingDays > 3 && agingDays <= staleDaysThreshold;
                  const isAgedStale = agingDays > staleDaysThreshold;

                  const cardClassName = isAgedStale
                    ? `${styles.boardIssueCard} ${styles.boardIssueCardStale}`
                    : isAgedWarn
                      ? `${styles.boardIssueCard} ${styles.boardIssueCardWarn}`
                      : `${styles.boardIssueCard} ${styles.boardIssueCardFresh}`;

                  return (
                    <div className={cardClassName} key={issue.key}>
                      <a className={styles.issueKeyLink} href={`#${issue.key}`}>
                        {issue.key}
                      </a>
                      <p style={{ margin: '2px 0', fontSize: 'var(--font-size-sm)' }}>
                        {issue.fields.summary}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Settings tab (project key + board picker + advanced config) ──

interface SettingsTabProps {
  projectKey: string;
  isLoadingSprint: boolean;
  loadError: string | null;
  boardId: number | null;
  availableBoards: ReturnType<typeof useSprintData>['state']['availableBoards'];
  boardSearchQuery: string;
  config: DashboardConfig;
  onProjectKeyChange: (key: string) => void;
  onLoadSprint: () => void;
  onBoardSearchChange: (query: string) => void;
  onSelectBoard: (boardId: number) => Promise<void>;
  onConfigChange: (partial: Partial<DashboardConfig>) => void;
}

/**
 * Renders the Settings tab: project key, board picker, and all eight advanced config fields.
 * All changes persist to localStorage immediately so they survive page reloads.
 */
function SettingsTab({
  projectKey,
  isLoadingSprint,
  loadError,
  boardId,
  availableBoards,
  boardSearchQuery,
  config,
  onProjectKeyChange,
  onLoadSprint,
  onBoardSearchChange,
  onSelectBoard,
  onConfigChange,
}: SettingsTabProps) {
  return (
    <div className={styles.settingsPanel}>
      <div>
        <h2 className={styles.settingsSectionTitle}>Sprint Settings</h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
          Enter your Jira project key to load the active sprint.
        </p>
      </div>
      <div>
        <label
          htmlFor="sprint-project-key-input"
          style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-md)' }}
        >
          Project Key
        </label>
        <input
          className={styles.settingsInput}
          id="sprint-project-key-input"
          onChange={(changeEvent) => onProjectKeyChange(changeEvent.target.value.toUpperCase())}
          placeholder="e.g. TBX"
          type="text"
          value={projectKey}
        />
      </div>
      <button
        className={styles.loadButton}
        disabled={isLoadingSprint || !projectKey}
        onClick={onLoadSprint}
        type="button"
      >
        {isLoadingSprint ? 'Loading…' : 'Load Sprint'}
      </button>
      {loadError && <p className={styles.errorMessage}>{loadError}</p>}

      {availableBoards.length > 0 && (
        <BoardPicker
          boards={availableBoards}
          isLoading={isLoadingSprint}
          onSearchChange={onBoardSearchChange}
          onSelectBoard={onSelectBoard}
          searchQuery={boardSearchQuery}
          selectedBoardId={boardId}
        />
      )}

      <div className={styles.settingsDivider} />

      <div>
        <h2 className={styles.settingsSectionTitle}>Advanced Settings</h2>
      </div>

      <AdvancedConfigFields config={config} onConfigChange={onConfigChange} />
    </div>
  );
}

/**
 * Renders the eight advanced config fields as labelled inputs.
 * Extracted into its own component so SettingsTab stays under 40 lines.
 */
function AdvancedConfigFields({
  config,
  onConfigChange,
}: {
  config: DashboardConfig;
  onConfigChange: (partial: Partial<DashboardConfig>) => void;
}) {
  return (
    <div className={styles.advancedConfigGrid}>
      <ConfigNumberField
        id="sd-cfg-stale-days"
        label="Stale threshold (days)"
        onChange={(value) => onConfigChange({ staleDaysThreshold: value })}
        value={config.staleDaysThreshold}
      />
      <ConfigTextField
        id="sd-cfg-pointing-scale"
        label="Story point scale (comma-separated)"
        onChange={(value) => onConfigChange({ storyPointScale: value })}
        value={config.storyPointScale}
      />
      <ConfigNumberField
        id="sd-cfg-sprint-window"
        label="Sprint window (past sprints for velocity)"
        onChange={(value) => onConfigChange({ sprintWindow: value })}
        value={config.sprintWindow}
      />
      <ConfigTextField
        id="sd-cfg-ct-start"
        label="Cycle-time start status (e.g. In Progress)"
        onChange={(value) => onConfigChange({ cycleTimeStartField: value })}
        value={config.cycleTimeStartField}
      />
      <ConfigTextField
        id="sd-cfg-ct-done"
        label="Cycle-time done status (e.g. Done)"
        onChange={(value) => onConfigChange({ cycleTimeDoneField: value })}
        value={config.cycleTimeDoneField}
      />
      <ConfigNumberField
        id="sd-cfg-kanban-period"
        label="Kanban period (days)"
        onChange={(value) => onConfigChange({ kanbanPeriodDays: value })}
        value={config.kanbanPeriodDays}
      />
      <JiraFieldPicker
        id="sd-cfg-sp-field"
        label="Story Points Field"
        onChange={(fieldId) => onConfigChange({ customStoryPointsFieldId: fieldId })}
        placeholder="Story Points field"
        value={config.customStoryPointsFieldId}
      />
      <JiraFieldPicker
        id="sd-cfg-epic-field"
        label="Epic Link Field"
        onChange={(fieldId) => onConfigChange({ customEpicLinkFieldId: fieldId })}
        placeholder="Epic Link field"
        value={config.customEpicLinkFieldId}
      />
    </div>
  );
}

/** Reusable labelled text input for a config field. */
function ConfigTextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)' }}
      >
        {label}
      </label>
      <input
        className={styles.settingsInput}
        id={id}
        onChange={(evt) => onChange(evt.target.value)}
        type="text"
        value={value}
      />
    </div>
  );
}

/** Reusable labelled number input for a config field. */
function ConfigNumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)' }}
      >
        {label}
      </label>
      <input
        className={styles.settingsInput}
        id={id}
        min={1}
        onChange={(evt) => onChange(Number(evt.target.value) || 1)}
        type="number"
        value={value}
      />
    </div>
  );
}

// ── Phase 3 tab components ──

/**
 * Renders the Metrics tab showing sprint completion percentage, issue status counts,
 * and per-assignee velocity (issues done/in-progress/to-do and story points).
 */
function MetricsTab({ issues }: { issues: JiraIssue[] }) {
  const totalCount = issues.length;
  const doneCount = issues.filter((issue) => issue.fields.status.statusCategory.key === 'done').length;
  const inProgressCount = issues.filter((issue) => issue.fields.status.statusCategory.key === 'indeterminate').length;
  const toDoCount = issues.filter((issue) => issue.fields.status.statusCategory.key === 'new').length;
  const completionPercentage = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);

  const assigneeGroups = groupIssuesByAssignee(issues);
  const assigneeMetricsRows = Array.from(assigneeGroups.entries()).map(([name, assigneeIssues]) =>
    computeAssigneeMetrics(name, assigneeIssues),
  );

  return (
    <div>
      <h2 className={styles.blockersSectionTitle}>Sprint Metrics</h2>
      <div className={styles.flowStatsBar}>
        {([
          { label: 'Total', value: totalCount },
          { label: 'Done', value: doneCount },
          { label: 'In Progress', value: inProgressCount },
          { label: 'To Do', value: toDoCount },
          { label: 'Completion', value: `${completionPercentage}%` },
        ] as const).map((chip) => (
          <div className={styles.flowStatChip} key={chip.label}>
            <span className={styles.flowStatCount}>{chip.value}</span>
            <span className={styles.flowStatLabel}>{chip.label}</span>
          </div>
        ))}
      </div>
      <h3 className={styles.blockersSectionTitle}>Per-Assignee Breakdown</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>Assignee</th>
            <th style={{ textAlign: 'center', padding: '4px 8px' }}>Done</th>
            <th style={{ textAlign: 'center', padding: '4px 8px' }}>In Progress</th>
            <th style={{ textAlign: 'center', padding: '4px 8px' }}>To Do</th>
            <th style={{ textAlign: 'center', padding: '4px 8px' }}>Story Points</th>
          </tr>
        </thead>
        <tbody>
          {assigneeMetricsRows.map((row) => (
            <tr key={row.assigneeName}>
              <td style={{ padding: '4px 8px' }}>{row.assigneeName}</td>
              <td style={{ textAlign: 'center', padding: '4px 8px' }}>{row.doneCount}</td>
              <td style={{ textAlign: 'center', padding: '4px 8px' }}>{row.inProgressCount}</td>
              <td style={{ textAlign: 'center', padding: '4px 8px' }}>{row.toDoCount}</td>
              <td style={{ textAlign: 'center', padding: '4px 8px' }}>{row.totalStoryPoints ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders the Pipeline tab as a kanban-style column-per-status layout.
 * Status lanes with more than BOTTLENECK_THRESHOLD issues are highlighted as bottlenecks.
 */
function PipelineTab({ issues }: { issues: JiraIssue[] }) {
  const statusGroups = groupIssuesByStatus(issues);
  const sortedStatusEntries = Array.from(statusGroups.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      <h2 className={styles.blockersSectionTitle}>Kanban Pipeline</h2>
      <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {sortedStatusEntries.map(([statusName, statusIssues]) => {
          const isBottleneck = statusIssues.length > BOTTLENECK_THRESHOLD;

          return (
            <div
              className={styles.boardColumn}
              key={statusName}
              style={{ border: isBottleneck ? '2px solid var(--color-danger, #e53e3e)' : undefined }}
            >
              <h3 className={styles.boardColumnTitle}>
                {statusName}
                {isBottleneck && ' ⚠️'}
              </h3>
              <span className={styles.countBadge}>{statusIssues.length}</span>
              <div style={{ maxHeight: '200px', overflowY: 'auto', marginTop: 'var(--spacing-xs)' }}>
                {statusIssues.map((issue) => (
                  <div key={issue.key} style={{ marginBottom: '4px' }}>
                    <a className={styles.issueKeyLink} href={`#${issue.key}`}>{issue.key}</a>
                    <span style={{ fontSize: 'var(--font-size-xs)', marginLeft: '6px' }}>
                      {issue.fields.summary}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Renders the Planning tab showing unestimated issues, backlog size,
 * and a story-point size distribution bar across the sprint.
 */
function PlanningTab({ issues }: { issues: JiraIssue[] }) {
  const unestimatedIssues = issues.filter((issue) => issue.fields.customfield_10016 == null);
  const backlogCount = issues.filter((issue) => issue.fields.status.statusCategory.key === 'new').length;
  const sizeDistribution = calculateSizeDistribution(issues);

  return (
    <div>
      <h2 className={styles.blockersSectionTitle}>Sprint Planning</h2>
      <div className={styles.flowStatsBar}>
        {([
          { label: 'Backlog', value: backlogCount },
          { label: 'Unestimated', value: unestimatedIssues.length },
          { label: '0–1 pts', value: sizeDistribution.smallCount },
          { label: '2–3 pts', value: sizeDistribution.mediumCount },
          { label: '5–8 pts', value: sizeDistribution.largeCount },
          { label: '13+ pts', value: sizeDistribution.extraLargeCount },
        ] as const).map((chip) => (
          <div className={styles.flowStatChip} key={chip.label}>
            <span className={styles.flowStatCount}>{chip.value}</span>
            <span className={styles.flowStatLabel}>{chip.label}</span>
          </div>
        ))}
      </div>
      <div className={styles.blockersSection}>
        <div className={styles.blockersSectionHeader}>
          <h3 className={styles.blockersSectionTitle}>Unestimated Issues</h3>
          <span className={styles.countBadge}>{unestimatedIssues.length}</span>
        </div>
        {unestimatedIssues.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            All issues are estimated. 🎉
          </p>
        ) : (
          unestimatedIssues.map((issue) => (
            <div className={styles.blockerCard} key={issue.key}>
              <a className={styles.issueKeyLink} href={`#${issue.key}`}>{issue.key}</a>
              <span className={styles.issueSummaryText}>{issue.fields.summary}</span>
              <span className={styles.issueMetaText}>
                {issue.fields.assignee?.displayName ?? 'Unassigned'}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Renders the Releases tab showing issues grouped by fix version with per-version
 * completion percentages to assess release readiness.
 */
function ReleasesTab({ issues }: { issues: JiraIssue[] }) {
  const versionGroups = groupIssuesByFixVersion(issues);

  // Sort alphabetically so the table is predictable; "No Version" sorts naturally to the end.
  const sortedVersionEntries = Array.from(versionGroups.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div>
      <h2 className={styles.blockersSectionTitle}>Release Readiness</h2>
      {sortedVersionEntries.map(([versionName, versionIssues]) => {
        const versionDoneCount = versionIssues.filter(
          (issue) => issue.fields.status.statusCategory.key === 'done',
        ).length;
        const versionCompletionPercentage = versionIssues.length === 0
          ? 0
          : Math.round((versionDoneCount / versionIssues.length) * 100);

        return (
          <div className={styles.defectGroup} key={versionName}>
            <div className={styles.defectGroupHeader}>
              <h3 className={styles.defectGroupTitle}>{versionName}</h3>
              <span className={styles.countBadge}>
                {versionDoneCount}/{versionIssues.length} done · {versionCompletionPercentage}%
              </span>
            </div>
            {versionIssues.map((issue) => (
              <div className={styles.defectCard} key={issue.key}>
                <a className={styles.issueKeyLink} href={`#${issue.key}`}>{issue.key}</a>
                <span>{issue.fields.summary}</span>
                <span className={styles.issueMetaText}>{issue.fields.status.name}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ──

/**
 * Renders the Sprint Dashboard view so teams can monitor sprint health,
 * review assignments, identify blockers, and run standup in one workspace.
 * Supports both scrum (active sprint) and kanban (board issues) boards.
 */
export default function SprintDashboardView() {
  const { state, actions } = useSprintData();
  const { config, actions: configActions } = useDashboardConfig();

  // Local state for the board picker search field — not persisted, just UI.
  const [boardSearchQuery, setBoardSearchQuery] = useState('');

  function handleIssueUpdated() {
    void actions.loadSprint();
  }

  function renderActiveTabPanel(activeTab: DashboardTab) {
    if (activeTab === 'overview') {
      return (
        <OverviewTab
          configState={config}
          issues={state.sprintIssues}
          onFetchSprints={actions.loadAvailableSprints}
          onIssueUpdated={handleIssueUpdated}
          onMoveToSprint={actions.moveIssueToSprint}
          sprintInfo={state.sprintInfo}
          sprintState={state}
        />
      );
    }

    if (activeTab === 'assignee') {
      return (
        <AssigneeTab
          configState={config}
          issues={state.sprintIssues}
          onFetchSprints={actions.loadAvailableSprints}
          onIssueUpdated={handleIssueUpdated}
          onMoveToSprint={actions.moveIssueToSprint}
          sprintState={state}
        />
      );
    }

    if (activeTab === 'blockers') {
      return (
        <BlockersTab
          issues={state.sprintIssues}
          onIssueUpdated={handleIssueUpdated}
          staleDaysThreshold={config.staleDaysThreshold}
        />
      );
    }

    if (activeTab === 'defects') {
      return <DefectsTab issues={state.sprintIssues} onIssueUpdated={handleIssueUpdated} />;
    }

    if (activeTab === 'standup') {
      return (
        <StandupTab
          isTimerRunning={state.isTimerRunning}
          issues={state.sprintIssues}
          onReset={actions.resetTimer}
          onStart={actions.startTimer}
          onStop={actions.stopTimer}
          onTick={actions.tickTimer}
          staleDaysThreshold={config.staleDaysThreshold}
          timerSecondsRemaining={state.timerSecondsRemaining}
        />
      );
    }

    if (activeTab === 'metrics') {
      return <MetricsTab issues={state.sprintIssues} />;
    }

    if (activeTab === 'pipeline') {
      return <PipelineTab issues={state.sprintIssues} />;
    }

    if (activeTab === 'planning') {
      return <PlanningTab issues={state.sprintIssues} />;
    }

    if (activeTab === 'pointing') {
      return (
        <div className={styles.embeddedTabContent}>
          <StoryPointingView />
        </div>
      );
    }

    if (activeTab === 'releases') {
      return <ReleasesTab issues={state.sprintIssues} />;
    }

    if (activeTab === 'capacity') {
      return <CapacityTab />;
    }

    return (
      <SettingsTab
        availableBoards={state.availableBoards}
        boardId={state.boardId}
        boardSearchQuery={boardSearchQuery}
        config={config}
        isLoadingSprint={state.isLoadingSprint}
        loadError={state.loadError}
        onBoardSearchChange={setBoardSearchQuery}
        onConfigChange={configActions.updateConfig}
        onLoadSprint={actions.loadSprint}
        onProjectKeyChange={actions.setProjectKey}
        onSelectBoard={actions.selectBoard}
        projectKey={state.projectKey}
      />
    );
  }

  return (
    <div className={styles.sprintDashboardView}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p>{VIEW_SUBTITLE}</p>
      </header>

      <PrimaryTabs
        ariaLabel="Sprint Dashboard tabs"
        idPrefix="sprint-dashboard"
        tabs={TAB_OPTIONS}
        activeTab={state.activeTab}
        onChange={actions.setActiveTab}
      />

      <section
        aria-labelledby={`sprint-dashboard-${state.activeTab}-tab`}
        id={`sprint-dashboard-${state.activeTab}-panel`}
        role="tabpanel"
      >
        {renderActiveTabPanel(state.activeTab)}
      </section>
    </div>
  );
}
