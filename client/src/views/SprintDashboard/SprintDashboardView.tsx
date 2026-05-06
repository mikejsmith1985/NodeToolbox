// SprintDashboardView.tsx — Sprint Dashboard view with 6 tabs for sprint health, team overview, and standup facilitation.
//
// Provides six tabs: Overview (sprint info + burn-down chart), By Assignee (swim lanes),
// Blockers (wall of blocked/stale issues), Defects (bug radar by priority),
// Standup (board walk + 15-min timer), and Settings (project key configuration).

import { useEffect } from 'react';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { JiraIssue } from '../../types/jira.ts';
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
  { key: 'settings', label: 'Settings' },
];

const BLOCKED_STATUSES = ['blocked', 'impeded', 'on hold'];
const STALE_THRESHOLD_DAYS = 5;
const MS_PER_DAY = 86_400_000;
const TIMER_WARNING_SECONDS = 300; // last 5 minutes
const TIMER_DANGER_SECONDS = 60;   // last 1 minute

// Burn-down chart lines use these named identifiers in recharts data.
const BURN_IDEAL_KEY = 'ideal';
const BURN_REMAINING_KEY = 'remaining';

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

/** Returns true when the issue has been in progress for more than STALE_THRESHOLD_DAYS days. */
function isStaleIssue(issue: JiraIssue): boolean {
  const isInProgress = issue.fields.status.statusCategory.key === 'indeterminate';
  return isInProgress && calculateAgingDays(issue.fields.updated) >= STALE_THRESHOLD_DAYS;
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

/** Renders the Overview tab with sprint info, flow stats, health badge, and burn-down chart. */
function OverviewTab({ issues, sprintInfo }: { issues: JiraIssue[]; sprintInfo: ReturnType<typeof useSprintData>['state']['sprintInfo'] }) {
  if (!sprintInfo) {
    return (
      <p style={{ color: 'var(--color-text-secondary)' }}>
        No sprint loaded. Go to Settings and enter a project key.
      </p>
    );
  }

  return (
    <div>
      <SprintInfoCard sprintInfo={sprintInfo} />
      <HealthBadge issues={issues} />
      <FlowStatsBar issues={issues} />
      <BurnDownChart issues={issues} sprintInfo={sprintInfo} />
    </div>
  );
}

/** Renders the By Assignee tab with swim lanes grouping issues per team member. */
function AssigneeTab({ issues }: { issues: JiraIssue[] }) {
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
                <div className={styles.laneIssueRow} key={issue.key}>
                  <a className={styles.issueKeyLink} href={`#${issue.key}`}>
                    {issue.key}
                  </a>
                  <span>{issue.fields.summary}</span>
                  <span>{issue.fields.status.name}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Renders the Blockers tab: Blocked issues, Stale in-progress, All in-progress. */
function BlockersTab({ issues }: { issues: JiraIssue[] }) {
  const blockedIssues = issues.filter(isBlockedIssue);
  const staleIssues = issues.filter((issue) => !isBlockedIssue(issue) && isStaleIssue(issue));
  const allInProgressIssues = issues.filter(
    (issue) =>
      issue.fields.status.statusCategory.key === 'indeterminate' && !isBlockedIssue(issue),
  );

  return (
    <div>
      <div className={styles.blockersSection}>
        <div className={styles.blockersSectionHeader}>
          <h3 className={styles.blockersSectionTitle}>Blocked</h3>
          <span className={styles.countBadge}>{blockedIssues.length}</span>
        </div>
        {blockedIssues.map((issue) => (
          <div className={styles.blockerCard} key={issue.key}>
            <a className={styles.issueKeyLink} href={`#${issue.key}`}>
              {issue.key}
            </a>
            <span className={styles.issueSummaryText}>{issue.fields.summary}</span>
            <span className={styles.issueMetaText}>
              {issue.fields.assignee?.displayName ?? 'Unassigned'} ·{' '}
              {calculateAgingDays(issue.fields.updated)}d ago
            </span>
          </div>
        ))}
        {blockedIssues.length === 0 && (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            No blocked issues. 🎉
          </p>
        )}
      </div>

      <div className={styles.blockersSection}>
        <div className={styles.blockersSectionHeader}>
          <h3 className={styles.blockersSectionTitle}>
            Stale (In Progress {STALE_THRESHOLD_DAYS}+ days)
          </h3>
          <span className={styles.countBadge}>{staleIssues.length}</span>
        </div>
        {staleIssues.map((issue) => (
          <div className={`${styles.blockerCard} ${styles.staleCard}`} key={issue.key}>
            <a className={styles.issueKeyLink} href={`#${issue.key}`}>
              {issue.key}
            </a>
            <span className={styles.issueSummaryText}>{issue.fields.summary}</span>
            <span className={styles.issueMetaText}>
              {issue.fields.assignee?.displayName ?? 'Unassigned'} ·{' '}
              {calculateAgingDays(issue.fields.updated)}d ago
            </span>
          </div>
        ))}
      </div>

      <div className={styles.blockersSection}>
        <div className={styles.blockersSectionHeader}>
          <h3 className={styles.blockersSectionTitle}>All In Progress</h3>
          <span className={styles.countBadge}>{allInProgressIssues.length}</span>
        </div>
        {allInProgressIssues.map((issue) => (
          <div className={styles.blockerCard} key={issue.key}>
            <a className={styles.issueKeyLink} href={`#${issue.key}`}>
              {issue.key}
            </a>
            <span className={styles.issueSummaryText}>{issue.fields.summary}</span>
            <span className={styles.issueMetaText}>
              {issue.fields.assignee?.displayName ?? 'Unassigned'} ·{' '}
              {calculateAgingDays(issue.fields.updated)}d ago
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Renders the Defects tab: bug issues grouped by priority. */
function DefectsTab({ issues }: { issues: JiraIssue[] }) {
  const bugIssues = issues.filter((issue) => issue.fields.issuetype.name === 'Bug');

  const PRIORITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'None'];

  const defectsByPriority = PRIORITY_ORDER.map((priorityName) => ({
    priorityName,
    defects: bugIssues.filter((bug) => (bug.fields.priority?.name ?? 'None') === priorityName),
  })).filter((priorityGroup) => priorityGroup.defects.length > 0);

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
          {defects.map((defect) => (
            <div className={styles.defectCard} key={defect.key}>
              <a className={styles.issueKeyLink} href={`#${defect.key}`}>
                {defect.key}
              </a>
              <span>{defect.fields.summary}</span>
              <span className={styles.issueMetaText}>
                {defect.fields.assignee?.displayName ?? 'Unassigned'}
              </span>
            </div>
          ))}
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
  onStart,
  onStop,
  onReset,
  onTick,
}: {
  issues: JiraIssue[];
  timerSecondsRemaining: number;
  isTimerRunning: boolean;
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
                  const isAgedWarn = agingDays > 3 && agingDays <= STALE_THRESHOLD_DAYS;
                  const isAgedStale = agingDays > STALE_THRESHOLD_DAYS;

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

/** Renders the Settings tab for entering the project key and loading the sprint. */
function SettingsTab({
  projectKey,
  isLoadingSprint,
  loadError,
  onProjectKeyChange,
  onLoadSprint,
}: {
  projectKey: string;
  isLoadingSprint: boolean;
  loadError: string | null;
  onProjectKeyChange: (key: string) => void;
  onLoadSprint: () => void;
}) {
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
    </div>
  );
}

// ── Main component ──

/**
 * Renders the Sprint Dashboard view so teams can monitor sprint health,
 * review assignments, identify blockers, and run standup in one workspace.
 */
export default function SprintDashboardView() {
  const { state, actions } = useSprintData();

  function renderActiveTabPanel(activeTab: DashboardTab) {
    if (activeTab === 'overview') {
      return <OverviewTab issues={state.sprintIssues} sprintInfo={state.sprintInfo} />;
    }

    if (activeTab === 'assignee') {
      return <AssigneeTab issues={state.sprintIssues} />;
    }

    if (activeTab === 'blockers') {
      return <BlockersTab issues={state.sprintIssues} />;
    }

    if (activeTab === 'defects') {
      return <DefectsTab issues={state.sprintIssues} />;
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
          timerSecondsRemaining={state.timerSecondsRemaining}
        />
      );
    }

    return (
      <SettingsTab
        isLoadingSprint={state.isLoadingSprint}
        loadError={state.loadError}
        onLoadSprint={actions.loadSprint}
        onProjectKeyChange={actions.setProjectKey}
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

      <div aria-label="Sprint Dashboard tabs" className={styles.tabList} role="tablist">
        {TAB_OPTIONS.map((tabOption) => {
          const isActiveTab = tabOption.key === state.activeTab;
          return (
            <button
              aria-controls={`${tabOption.key}-panel`}
              aria-selected={isActiveTab}
              className={`${styles.tabButton} ${isActiveTab ? styles.activeTab : ''}`}
              id={`${tabOption.key}-tab`}
              key={tabOption.key}
              onClick={() => actions.setActiveTab(tabOption.key)}
              role="tab"
              type="button"
            >
              {tabOption.label}
            </button>
          );
        })}
      </div>

      <section
        aria-labelledby={`${state.activeTab}-tab`}
        id={`${state.activeTab}-panel`}
        role="tabpanel"
      >
        {renderActiveTabPanel(state.activeTab)}
      </section>
    </div>
  );
}
