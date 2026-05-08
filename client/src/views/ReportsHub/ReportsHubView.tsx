// ReportsHubView.tsx — Director & RTE-level PI reporting dashboard across all ART teams.
//
// Nine tabs: Feature Report, Defect Tracker, Risk Board, Flow, Impact, Individual, Quality,
// Sprint Health, and Throughput. Hero KPI grid provides at-a-glance counts. All data
// loaded via useReportsHubState. Each tab also includes an "About this report" explainer
// card, a per-tab copy-to-clipboard button, and a "Last generated" relative timestamp.

import { useCallback, useEffect, useState } from 'react'

import type {
  IndividualEntry,
  JiraFeatureIssue,
  QualityMetrics,
  ReportsHubTab,
  SprintHealthEntry,
  SprintIssue,
  ThroughputEntry,
} from './hooks/useReportsHubState.ts'
import { formatRelativeTime, useLastGenerated } from './hooks/useLastGenerated.ts'
import { useReportExplainer } from './hooks/useReportExplainer.ts'
import { useReportsHubState } from './hooks/useReportsHubState.ts'
import styles from './ReportsHubView.module.css'

// ── Named constants ──

const VIEW_TITLE = '📈 Reports Hub'
const VIEW_SUBTITLE = 'Director & RTE reporting dashboard for PI planning.'

const TAB_OPTIONS: { key: ReportsHubTab; label: string }[] = [
  { key: 'features', label: '🏛️ Feature Report' },
  { key: 'defects', label: '🔴 Defect Tracker' },
  { key: 'risks', label: '⚠️ Risk Board' },
  { key: 'flow', label: '🌊 Flow' },
  { key: 'impact', label: '💥 Impact' },
  { key: 'individual', label: '👤 Individual' },
  { key: 'quality', label: '🔬 Quality' },
  { key: 'sprintHealth', label: '💚 Sprint Health' },
  { key: 'throughput', label: '📊 Throughput' },
]

const ALL_PIS_LABEL = 'All PIs'
const ALL_TEAMS_LABEL = 'All Teams'

const HIGH_RISK_PRIORITIES = new Set(['Highest', 'High'])

// Threshold below which a team's sprint health score is flagged as at-risk
const HEALTH_AT_RISK_THRESHOLD = 70
// Issues with these priorities appear in the Impact tab
const HIGH_PRIORITY_VALUES = new Set(['Highest', 'High', 'Critical'])
// Defects with these priorities are counted as critical in the Quality tab
const CRITICAL_PRIORITY_VALUES = new Set(['Highest', 'Critical'])

// Rolling window for throughput benchmark: last N sprints are averaged to produce the baseline
const BENCHMARK_WINDOW_SPRINTS = 6
const COPY_FEEDBACK_DURATION_MS = 2000

// Per-tab explainer bullet texts sourced from legacy rhReportPitch() in 20-reports-hub.js
const TAB_DESCRIPTIONS: Record<ReportsHubTab, string[]> = {
  features: [
    'All Features and Epics across the ART — PI, status, due dates, and dependencies in one view.',
    'Replaces manual PI board updates and deck-building for stakeholder reviews.',
    'Dependency chains and risk flags surfaced inline — no Jira board-hopping required.',
    'Use for: PI execution reviews, cross-team dependency calls, stakeholder briefings.',
  ],
  defects: [
    'Full inventory of open bugs across all ART teams — breakdown by team, priority, and status.',
    'Identifies which teams carry the most quality debt and where critical blockers live.',
    'Drill down to specific defects blocking a release or PI boundary.',
    'Use for: triage ownership, pre-release audits, quality trend conversations.',
  ],
  risks: [
    'Every open risk-type issue and "risk"-labeled item across all ART teams in one place.',
    'Critical risks flagged immediately — a clean board means your ART is operating safely.',
    'Risk tracking is a core RTE responsibility in SAFe PI execution — this automates it.',
    'Use for: ART sync, Scrum of Scrums, executive risk briefings.',
  ],
  flow: [
    'Two metrics in one: Flow (what actually closed) and Aging (what\'s stuck in-progress).',
    'Flow = issues completed in the last 30 days. Aging = current WIP sorted by age.',
    'WIP that never closes is invisible in sprint metrics — Aging surfaces it early.',
    'Use for: impediment identification, ART sync, PI retrospectives.',
  ],
  impact: [
    'Tracks team throughput vs targets and delivery quality trends over rolling time periods.',
    'Connects completed Jira work to business outcomes and cross-team benchmarks.',
    'Data sourced from the Impact Dashboard cache — refresh there first if numbers appear stale.',
    'Use for: Quarterly Business Reviews, PI retrospectives, executive delivery briefings.',
  ],
  individual: [
    'All open work for a specific person: Features, Epics, Stories, Bugs, and Tasks in one view.',
    'Automatically flags over-commitment — Features and Stories and Bugs in flight simultaneously.',
    'Enter any Jira display name or account ID to pull anyone\'s current workload instantly.',
    'Use for: 1:1 prep, sprint review, capacity rebalancing decisions.',
  ],
  quality: [
    'Open defect count by priority (Critical → Low) for every ART team — aggregated in one view.',
    '⚠️ Any Critical defect is a stop-ship concern; surfaced immediately at the top.',
    'Aggregate quality visibility is impossible in native Jira without switching boards.',
    'Use for: release gating, sprint reviews, executive risk briefings.',
  ],
  sprintHealth: [
    'Real-time pulse: how far through their sprint goal is each team right now?',
    '🔴 <30% done | 🟡 30–50% | 🟢 >50% — health triaged in seconds.',
    'Identify at-risk teams before the sprint ends — not after the retrospective.',
    'Use for: Scrum of Scrums prep, mid-sprint steering, escalation decisions.',
  ],
  throughput: [
    'Compares completed issues across all ART teams for the last 6+ months — in one table.',
    'Native Jira locks throughput reports to a single board; Toolbox aggregates all boards.',
    'Spot teams accelerating, plateauing, or declining before it becomes a PI-level conversation.',
    'Use for: PI capacity planning, velocity benchmarking, quarterly exec reporting.',
  ],
}

// ── Helper: status badge ──

/** Returns the appropriate CSS class for a Jira status category. */
function resolveStatusBadgeClass(statusCategory: string): string {
  if (statusCategory === 'done') return styles.statusDone
  if (statusCategory === 'indeterminate') return styles.statusInProgress
  return styles.statusTodo
}

interface StatusBadgeProps {
  statusName: string
  statusCategory: string
}

/** Coloured pill badge showing a Jira issue status. */
function StatusBadge({ statusName, statusCategory }: StatusBadgeProps) {
  const badgeClass = resolveStatusBadgeClass(statusCategory)
  return (
    <span className={`${styles.statusBadge} ${badgeClass}`}>
      {statusName}
    </span>
  )
}

// ── About Report Card ──

interface AboutReportCardProps {
  tabKey: ReportsHubTab
  isCollapsed: boolean
  onToggle(): void
}

/** Collapsible explainer card shown above each tab's content. Explains what the report shows. */
function AboutReportCard({ tabKey, isCollapsed, onToggle }: AboutReportCardProps) {
  const descriptions = TAB_DESCRIPTIONS[tabKey]
  const chevronSymbol = isCollapsed ? '▶' : '▼'

  return (
    <div className={styles.explainerCard}>
      <button
        className={styles.explainerToggle}
        onClick={onToggle}
        aria-expanded={!isCollapsed}
        aria-label="Toggle about this report"
      >
        <span className={styles.explainerChevron}>{chevronSymbol}</span>
        About this report
      </button>
      {!isCollapsed && (
        <ul className={styles.explainerContent}>
          {descriptions.map((bulletText) => (
            <li key={bulletText}>{bulletText}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Copy Report Button ──

interface CopyReportButtonProps {
  textToCopy: string
}

/** Button that writes the given text to the clipboard and briefly shows a "Copied!" confirmation. */
function CopyReportButton({ textToCopy }: CopyReportButtonProps) {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopyClick = useCallback((): void => {
    void navigator.clipboard.writeText(textToCopy).then(() => {
      setIsCopied(true)
      setTimeout(() => { setIsCopied(false) }, COPY_FEEDBACK_DURATION_MS)
    })
  }, [textToCopy])

  return (
    <button className={styles.actionButton} onClick={handleCopyClick}>
      {isCopied ? '✓ Copied!' : '📋 Copy Report'}
    </button>
  )
}

// ── Tab Preamble ──

interface TabPreambleProps {
  tabKey: ReportsHubTab
  isCollapsed: boolean
  onToggleExplainer(): void
  lastGeneratedAt: string | null
  reportText: string
}

/** Wraps every tab with an "About" card, last-generated timestamp, and a copy button. */
function TabPreamble({
  tabKey,
  isCollapsed,
  onToggleExplainer,
  lastGeneratedAt,
  reportText,
}: TabPreambleProps) {
  return (
    <div className={styles.tabPreamble}>
      <div className={styles.preambleActions}>
        {lastGeneratedAt !== null && (
          <span className={styles.lastGeneratedText}>
            Last generated: {formatRelativeTime(lastGeneratedAt)}
          </span>
        )}
        <CopyReportButton textToCopy={reportText} />
      </div>
      <AboutReportCard tabKey={tabKey} isCollapsed={isCollapsed} onToggle={onToggleExplainer} />
    </div>
  )
}

// ── Feature Report tab ──

interface FeatureReportTabProps {
  features: JiraFeatureIssue[]
  artTeamCount: number
  piFilter: string
  teamFilter: string
  onPiFilterChange(value: string): void
  onTeamFilterChange(value: string): void
}

/** Extracts unique non-null PI names from the features list. */
function extractUniquePiNames(featureList: JiraFeatureIssue[]): string[] {
  const piNameSet = new Set<string>()
  for (const feature of featureList) {
    if (feature.piName !== null) piNameSet.add(feature.piName)
  }
  return Array.from(piNameSet).sort()
}

/** Extracts unique team names from the features list. */
function extractUniqueTeamNames(featureList: JiraFeatureIssue[]): string[] {
  const teamNameSet = new Set<string>()
  for (const feature of featureList) {
    teamNameSet.add(feature.teamName)
  }
  return Array.from(teamNameSet).sort()
}

/** Feature Report with PI + team filters and a sortable table. */
function FeatureReportTab({
  features,
  artTeamCount,
  piFilter,
  teamFilter,
  onPiFilterChange,
  onTeamFilterChange,
}: FeatureReportTabProps) {
  if (artTeamCount === 0) {
    return (
      <p className={styles.emptyState}>
        No ART teams configured — add them in ART View Settings or run a Refresh.
      </p>
    )
  }

  const uniquePiNames = extractUniquePiNames(features)
  const uniqueTeamNames = extractUniqueTeamNames(features)

  const filteredFeatures = features.filter((feature) => {
    const matchesPi = piFilter === '' || feature.piName === piFilter
    const matchesTeam = teamFilter === '' || feature.teamName === teamFilter
    return matchesPi && matchesTeam
  })

  return (
    <div>
      <div className={styles.filterBar}>
        <select
          className={styles.filterSelect}
          value={piFilter}
          onChange={(changeEvent) => onPiFilterChange(changeEvent.target.value)}
          aria-label="PI filter"
        >
          <option value="">{ALL_PIS_LABEL}</option>
          {uniquePiNames.map((piName) => (
            <option key={piName} value={piName}>
              {piName}
            </option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={teamFilter}
          onChange={(changeEvent) => onTeamFilterChange(changeEvent.target.value)}
          aria-label="Team filter"
        >
          <option value="">{ALL_TEAMS_LABEL}</option>
          {uniqueTeamNames.map((teamName) => (
            <option key={teamName} value={teamName}>
              {teamName}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Team</th>
              <th>Fix Version</th>
              <th>PI</th>
              <th>Assignee</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredFeatures.map((feature) => (
              <tr key={feature.key}>
                <td>{feature.key}</td>
                <td>{feature.summary}</td>
                <td>{feature.teamName}</td>
                <td>{feature.fixVersions.join(', ') || '—'}</td>
                <td>{feature.piName ?? '—'}</td>
                <td>{feature.assigneeName ?? 'Unassigned'}</td>
                <td>
                  <StatusBadge
                    statusName={feature.statusName}
                    statusCategory={feature.statusCategory}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredFeatures.length === 0 && (
          <p className={styles.emptyState}>No features match the selected filters.</p>
        )}
      </div>
    </div>
  )
}

// ── Defect Tracker tab ──

interface DefectTrackerTabProps {
  defects: JiraFeatureIssue[]
}

/** Defect Tracker with a summary bar and full issue table. */
function DefectTrackerTab({ defects }: DefectTrackerTabProps) {
  const openDefectCount = defects.filter((defect) => defect.statusCategory !== 'done').length
  const closedDefectCount = defects.filter((defect) => defect.statusCategory === 'done').length

  return (
    <div>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>Total: {defects.length}</span>
        <span className={styles.summaryBarItem}>Open: {openDefectCount}</span>
        <span className={styles.summaryBarItem}>Closed: {closedDefectCount}</span>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Team</th>
              <th>Assignee</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {defects.map((defect) => (
              <tr key={defect.key}>
                <td>{defect.key}</td>
                <td>{defect.summary}</td>
                <td>{defect.teamName}</td>
                <td>{defect.assigneeName ?? 'Unassigned'}</td>
                <td>
                  <StatusBadge
                    statusName={defect.statusName}
                    statusCategory={defect.statusCategory}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {defects.length === 0 && (
          <p className={styles.emptyState}>No defects found. 🎉</p>
        )}
      </div>
    </div>
  )
}

// ── Risk Board tab ──

interface RiskBoardTabProps {
  risks: JiraFeatureIssue[]
}

/** Risk Board table — high priority risks get a red row accent. */
function RiskBoardTab({ risks }: RiskBoardTabProps) {
  return (
    <div>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Team</th>
              <th>Assignee</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {risks.map((risk) => {
              // Determine row class based on statusCategory to indicate severity
              const isHighPriorityRisk = HIGH_RISK_PRIORITIES.has(risk.statusCategory)
              const rowClass = isHighPriorityRisk ? styles.highRiskRow : ''
              return (
                <tr key={risk.key} className={rowClass}>
                  <td>{risk.key}</td>
                  <td>{risk.summary}</td>
                  <td>{risk.teamName}</td>
                  <td>{risk.assigneeName ?? 'Unassigned'}</td>
                  <td>
                    <StatusBadge
                      statusName={risk.statusName}
                      statusCategory={risk.statusCategory}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {risks.length === 0 && (
          <p className={styles.emptyState}>No risks found.</p>
        )}
      </div>
    </div>
  )
}

// ── Flow tab ──

interface FlowTabProps {
  sprintIssues: SprintIssue[]
  isLoading: boolean
  error: string | null
}

/** Flow tab — shows WIP by status lane and highlights bottlenecks in the sprint pipeline. */
function FlowTab({ sprintIssues, isLoading, error }: FlowTabProps) {
  if (isLoading) return <p className={styles.emptyState}>Loading sprint data…</p>
  if (error !== null) return <p className={styles.emptyState}>{error}</p>

  // Group issues by status name to show WIP per lane
  const wipByStatus = new Map<string, number>()
  for (const issue of sprintIssues) {
    wipByStatus.set(issue.statusName, (wipByStatus.get(issue.statusName) ?? 0) + 1)
  }
  // The bottleneck is the status lane with the most in-progress issues
  const maxWip = Math.max(0, ...Array.from(wipByStatus.values()))

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>WIP Pipeline</h3>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>Total in sprint: {sprintIssues.length}</span>
        <span className={styles.summaryBarItem}>
          Blocked: {sprintIssues.filter((issue) => issue.isBlocked).length}
        </span>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Status</th>
              <th>WIP Count</th>
              <th>Bottleneck?</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(wipByStatus.entries()).map(([statusName, wipCount]) => (
              <tr key={statusName}>
                <td>{statusName}</td>
                <td>{wipCount}</td>
                <td>{wipCount === maxWip && maxWip > 1 ? '⚠️ Yes' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sprintIssues.length === 0 && (
          <p className={styles.emptyState}>No active sprint issues found.</p>
        )}
      </div>
    </div>
  )
}

// ── Impact tab ──

interface ImpactTabProps {
  sprintIssues: SprintIssue[]
  isLoading: boolean
  error: string | null
}

/** Impact tab — surfaces high-priority and blocked issues that need immediate attention. */
function ImpactTab({ sprintIssues, isLoading, error }: ImpactTabProps) {
  if (isLoading) return <p className={styles.emptyState}>Loading sprint data…</p>
  if (error !== null) return <p className={styles.emptyState}>{error}</p>

  const highPriorityIssues = sprintIssues.filter(
    (issue) => HIGH_PRIORITY_VALUES.has(issue.priority) || issue.isBlocked,
  )
  const blockedCount = sprintIssues.filter((issue) => issue.isBlocked).length
  const blockedPercent =
    sprintIssues.length > 0 ? Math.round((blockedCount / sprintIssues.length) * 100) : 0

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>High Priority &amp; Blocked</h3>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>High Impact: {highPriorityIssues.length}</span>
        <span className={styles.summaryBarItem}>Blocked: {blockedCount} ({blockedPercent}%)</span>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Team</th>
              <th>Priority</th>
              <th>Blocked?</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {highPriorityIssues.map((issue) => (
              <tr key={issue.key}>
                <td>{issue.key}</td>
                <td>{issue.summary}</td>
                <td>{issue.teamName}</td>
                <td>{issue.priority}</td>
                <td>{issue.isBlocked ? '🚫 Yes' : '—'}</td>
                <td>
                  <StatusBadge statusName={issue.statusName} statusCategory={issue.statusCategory} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {highPriorityIssues.length === 0 && (
          <p className={styles.emptyState}>No high-priority or blocked issues. 🎉</p>
        )}
      </div>
    </div>
  )
}

// ── Individual tab ──

interface IndividualTabProps {
  sprintIssues: SprintIssue[]
  isLoading: boolean
  error: string | null
}

/**
 * Builds a per-assignee workload summary from the sprint issues array.
 * People with no assignee are grouped under "Unassigned".
 */
function buildIndividualEntries(sprintIssues: SprintIssue[]): IndividualEntry[] {
  const entryMap = new Map<string, IndividualEntry>()
  for (const issue of sprintIssues) {
    const assigneeName = issue.assigneeName ?? 'Unassigned'
    const existingEntry = entryMap.get(assigneeName) ?? {
      assigneeName,
      totalCount: 0,
      inProgressCount: 0,
      doneCount: 0,
      blockedCount: 0,
    }
    existingEntry.totalCount += 1
    if (issue.statusCategory === 'indeterminate') existingEntry.inProgressCount += 1
    if (issue.statusCategory === 'done') existingEntry.doneCount += 1
    if (issue.isBlocked) existingEntry.blockedCount += 1
    entryMap.set(assigneeName, existingEntry)
  }
  return Array.from(entryMap.values()).sort((a, b) => b.totalCount - a.totalCount)
}

/** Individual tab — per-assignee workload breakdown for the current sprint. */
function IndividualTab({ sprintIssues, isLoading, error }: IndividualTabProps) {
  if (isLoading) return <p className={styles.emptyState}>Loading sprint data…</p>
  if (error !== null) return <p className={styles.emptyState}>{error}</p>

  const individualEntries = buildIndividualEntries(sprintIssues)

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Workload by Person</h3>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Assignee</th>
              <th>Total</th>
              <th>In Progress</th>
              <th>Done</th>
              <th>Blocked</th>
            </tr>
          </thead>
          <tbody>
            {individualEntries.map((entry) => (
              <tr key={entry.assigneeName}>
                <td>{entry.assigneeName}</td>
                <td>{entry.totalCount}</td>
                <td>{entry.inProgressCount}</td>
                <td>{entry.doneCount}</td>
                <td>{entry.blockedCount > 0 ? `⚠️ ${entry.blockedCount}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {individualEntries.length === 0 && (
          <p className={styles.emptyState}>No sprint issues found.</p>
        )}
      </div>
    </div>
  )
}

// ── Quality tab ──

interface QualityTabProps {
  defects: JiraFeatureIssue[]
  storyCount: number
  isLoading: boolean
  error: string | null
}

/** Derives quality metrics from the loaded defects list and story count. */
function computeQualityMetrics(defects: JiraFeatureIssue[], storyCount: number): QualityMetrics {
  const openDefects = defects.filter((defect) => defect.statusCategory !== 'done')
  const criticalDefectCount = openDefects.filter(
    (defect) => defect.priority !== null && CRITICAL_PRIORITY_VALUES.has(defect.priority),
  ).length
  const defectDensity = storyCount > 0 ? Math.round((defects.length / storyCount) * 100) / 100 : 0
  return {
    totalDefects: defects.length,
    criticalDefectCount,
    totalStories: storyCount,
    defectDensity,
  }
}

/** Quality tab — defect density metrics and critical bug count. */
function QualityTab({ defects, storyCount, isLoading, error }: QualityTabProps) {
  if (isLoading) return <p className={styles.emptyState}>Loading quality data…</p>
  if (error !== null) return <p className={styles.emptyState}>{error}</p>

  const metrics = computeQualityMetrics(defects, storyCount)

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Defect Metrics</h3>
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Total Defects</span>
          <span className={`${styles.kpiValue} ${metrics.totalDefects > 0 ? styles.kpiValueRed : ''}`}>
            {metrics.totalDefects}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Critical</span>
          <span className={`${styles.kpiValue} ${metrics.criticalDefectCount > 0 ? styles.kpiValueRed : ''}`}>
            {metrics.criticalDefectCount}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Stories</span>
          <span className={styles.kpiValue}>{metrics.totalStories}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Defect Density</span>
          <span className={`${styles.kpiValue} ${metrics.defectDensity > 0.1 ? styles.kpiValueAmber : ''}`}>
            {metrics.defectDensity.toFixed(2)}
          </span>
        </div>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Team</th>
              <th>Priority</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {defects.map((defect) => (
              <tr key={defect.key}>
                <td>{defect.key}</td>
                <td>{defect.summary}</td>
                <td>{defect.teamName}</td>
                <td>{defect.priority ?? '—'}</td>
                <td>
                  <StatusBadge
                    statusName={defect.statusName}
                    statusCategory={defect.statusCategory}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {defects.length === 0 && <p className={styles.emptyState}>No defects found. 🎉</p>}
      </div>
    </div>
  )
}

// ── Sprint Health tab ──

interface SprintHealthTabProps {
  sprintIssues: SprintIssue[]
  isLoading: boolean
  error: string | null
}

/** Derives per-team sprint health from the active sprint issues. */
function buildSprintHealthEntries(sprintIssues: SprintIssue[]): SprintHealthEntry[] {
  const teamMap = new Map<string, { committed: number; completed: number }>()
  for (const issue of sprintIssues) {
    const existing = teamMap.get(issue.teamName) ?? { committed: 0, completed: 0 }
    existing.committed += 1
    if (issue.statusCategory === 'done') existing.completed += 1
    teamMap.set(issue.teamName, existing)
  }
  return Array.from(teamMap.entries())
    .map(([teamName, { committed, completed }]) => {
      const healthScore = committed > 0 ? Math.round((completed / committed) * 100) : 0
      return {
        teamName,
        committedCount: committed,
        completedCount: completed,
        healthScore,
        isAtRisk: healthScore < HEALTH_AT_RISK_THRESHOLD,
      }
    })
    .sort((a, b) => a.healthScore - b.healthScore)  // most at-risk first
}

/** Sprint Health tab — per-team health score based on committed vs. completed work. */
function SprintHealthTab({ sprintIssues, isLoading, error }: SprintHealthTabProps) {
  if (isLoading) return <p className={styles.emptyState}>Loading sprint data…</p>
  if (error !== null) return <p className={styles.emptyState}>{error}</p>

  const healthEntries = buildSprintHealthEntries(sprintIssues)
  const atRiskCount = healthEntries.filter((entry) => entry.isAtRisk).length

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Team Health</h3>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>Teams: {healthEntries.length}</span>
        <span className={`${styles.summaryBarItem} ${atRiskCount > 0 ? styles.warningText : ''}`}>
          At Risk: {atRiskCount}
        </span>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Committed</th>
              <th>Completed</th>
              <th>Health Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {healthEntries.map((entry) => (
              <tr key={entry.teamName}>
                <td>{entry.teamName}</td>
                <td>{entry.committedCount}</td>
                <td>{entry.completedCount}</td>
                <td>{entry.healthScore}%</td>
                <td>{entry.isAtRisk ? '🔴 At Risk' : '🟢 On Track'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {healthEntries.length === 0 && (
          <p className={styles.emptyState}>No sprint data found.</p>
        )}
      </div>
    </div>
  )
}

// ── Throughput tab ──

interface ThroughputTabProps {
  throughputData: ThroughputEntry[]
  isLoading: boolean
  error: string | null
}

/** Computes the rolling average resolved count over the last N sprints. */
function computeThroughputBenchmark(entries: ThroughputEntry[]): number {
  if (entries.length === 0) return 0
  const windowEntries = entries.slice(-BENCHMARK_WINDOW_SPRINTS)
  const windowTotal = windowEntries.reduce((sum, entry) => sum + entry.resolvedCount, 0)
  return Math.round(windowTotal / windowEntries.length)
}

/** Returns the CSS class and symbol for a throughput delta vs the benchmark. */
function resolveDeltaDisplay(resolvedCount: number, benchmarkAvg: number): { label: string; className: string } {
  if (benchmarkAvg === 0) return { label: '—', className: '' }
  const delta = resolvedCount - benchmarkAvg
  if (delta > 0) return { label: `+${delta}`, className: styles.deltaPositive }
  if (delta < 0) return { label: `${delta}`, className: styles.deltaNegative }
  return { label: '±0', className: '' }
}

/** Throughput tab — rolling resolved-issue counts per sprint with 6-sprint benchmark. */
function ThroughputTab({ throughputData, isLoading, error }: ThroughputTabProps) {
  if (isLoading) return <p className={styles.emptyState}>Loading throughput data…</p>
  if (error !== null) return <p className={styles.emptyState}>{error}</p>

  const totalResolved = throughputData.reduce((sum, entry) => sum + entry.resolvedCount, 0)
  const avgThroughput =
    throughputData.length > 0 ? Math.round(totalResolved / throughputData.length) : 0
  const benchmarkAvg = computeThroughputBenchmark(throughputData)

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Throughput (Last {throughputData.length} Sprints)</h3>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>Total Resolved: {totalResolved}</span>
        <span className={styles.summaryBarItem}>Avg / Sprint: {avgThroughput}</span>
        {throughputData.length >= BENCHMARK_WINDOW_SPRINTS && (
          <span className={styles.summaryBarItem}>
            {BENCHMARK_WINDOW_SPRINTS}-Sprint Benchmark: {benchmarkAvg}
          </span>
        )}
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Sprint</th>
              <th>Resolved</th>
              {throughputData.length >= BENCHMARK_WINDOW_SPRINTS && <th>vs Benchmark</th>}
            </tr>
          </thead>
          <tbody>
            {throughputData.map((entry) => {
              const { label: deltaLabel, className: deltaClass } = resolveDeltaDisplay(entry.resolvedCount, benchmarkAvg)
              return (
                <tr key={entry.sprintName}>
                  <td>{entry.sprintName}</td>
                  <td>{entry.resolvedCount}</td>
                  {throughputData.length >= BENCHMARK_WINDOW_SPRINTS && (
                    <td className={deltaClass}>{deltaLabel}</td>
                  )}
                </tr>
              )
            })}
            {throughputData.length >= BENCHMARK_WINDOW_SPRINTS && (
              <tr className={styles.benchmarkRow}>
                <td>Benchmark ({BENCHMARK_WINDOW_SPRINTS}-sprint avg)</td>
                <td>{benchmarkAvg}</td>
                <td>—</td>
              </tr>
            )}
          </tbody>
        </table>
        {throughputData.length === 0 && (
          <p className={styles.emptyState}>No closed sprint data found.</p>
        )}
      </div>
    </div>
  )
}

/** Builds a plain-text copy of the active tab's data for clipboard export. */
function buildTabReportText(tabKey: ReportsHubTab, state: ReturnType<typeof useReportsHubState>['state']): string {
  const timestamp = new Date().toLocaleString()
  const lines: string[] = [`Reports Hub — ${tabKey} — ${timestamp}`]
  if (tabKey === 'features') {
    lines.push('', 'Features:')
    for (const feature of state.features) {
      lines.push(`  ${feature.key}  ${feature.summary}  [${feature.statusName}]`)
    }
  } else if (tabKey === 'defects') {
    lines.push('', 'Defects:')
    for (const defect of state.defects) {
      lines.push(`  ${defect.key}  ${defect.summary}  [${defect.statusName}]`)
    }
  } else if (tabKey === 'risks') {
    lines.push('', 'Risks:')
    for (const risk of state.risks) {
      lines.push(`  ${risk.key}  ${risk.summary}  [${risk.statusName}]`)
    }
  } else if (tabKey === 'throughput') {
    lines.push('', 'Throughput:')
    for (const entry of state.throughputData) {
      lines.push(`  ${entry.sprintName}: ${entry.resolvedCount} resolved`)
    }
  }
  return lines.join('\n')
}

// ── Root component ──

/** Reports Hub — director-level PI reporting dashboard across all ART teams. */
export default function ReportsHubView() {
  const { state, actions } = useReportsHubState()
  const { isTabExplainerCollapsed, toggleTabExplainer } = useReportExplainer()
  const { markGenerated, getTabTimestamp } = useLastGenerated()

  const hasNoArtTeams = state.artTeams.length === 0

  // Record the last-generated timestamp whenever data is refreshed
  useEffect(() => {
    if (state.lastGeneratedAt !== null) {
      markGenerated(state.activeTab)
    }
  }, [state.lastGeneratedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeTabTimestamp = getTabTimestamp(state.activeTab)
  const activeTabReportText = buildTabReportText(state.activeTab, state)

  function renderActiveTab() {
    switch (state.activeTab) {
      case 'features':
        return (
          <FeatureReportTab
            features={state.features}
            artTeamCount={state.artTeams.length}
            piFilter={state.piFilter}
            teamFilter={state.teamFilter}
            onPiFilterChange={actions.setPiFilter}
            onTeamFilterChange={actions.setTeamFilter}
          />
        )
      case 'defects':
        return <DefectTrackerTab defects={state.defects} />
      case 'risks':
        return <RiskBoardTab risks={state.risks} />
      case 'flow':
        return (
          <FlowTab
            sprintIssues={state.sprintIssues}
            isLoading={state.isLoadingSprintData}
            error={state.sprintDataError}
          />
        )
      case 'impact':
        return (
          <ImpactTab
            sprintIssues={state.sprintIssues}
            isLoading={state.isLoadingSprintData}
            error={state.sprintDataError}
          />
        )
      case 'individual':
        return (
          <IndividualTab
            sprintIssues={state.sprintIssues}
            isLoading={state.isLoadingSprintData}
            error={state.sprintDataError}
          />
        )
      case 'quality':
        return (
          <QualityTab
            defects={state.defects}
            storyCount={state.storyCount}
            isLoading={state.isLoadingQuality}
            error={state.qualityError}
          />
        )
      case 'sprintHealth':
        return (
          <SprintHealthTab
            sprintIssues={state.sprintIssues}
            isLoading={state.isLoadingSprintData}
            error={state.sprintDataError}
          />
        )
      case 'throughput':
        return (
          <ThroughputTab
            throughputData={state.throughputData}
            isLoading={state.isLoadingThroughput}
            error={state.throughputError}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className={styles.reportsHubView}>
      {/* Page header */}
      <header className={styles.pageHeader}>
        <div className={styles.headerText}>
          <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
          <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
        </div>
        <div className={styles.headerActions}>
          {state.lastGeneratedAt !== null && (
            <span className={styles.lastGeneratedLabel}>
              Last refreshed: {new Date(state.lastGeneratedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            className={`${styles.actionButton} ${styles.primaryButton}`}
            onClick={() => { void actions.loadAllReports() }}
          >
            🔄 Refresh
          </button>
        </div>
      </header>

      {/* Hero KPI grid */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>ART Teams</span>
          <span className={styles.kpiValue}>
            {state.artTeams.length > 0 ? state.artTeams.length : '—'}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Features</span>
          <span className={styles.kpiValue}>{state.features.length}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Defects</span>
          <span
            className={`${styles.kpiValue} ${state.defects.length > 0 ? styles.kpiValueRed : ''}`}
          >
            {state.defects.length}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Risks</span>
          <span
            className={`${styles.kpiValue} ${state.risks.length > 0 ? styles.kpiValueAmber : ''}`}
          >
            {state.risks.length}
          </span>
        </div>
      </div>

      {/* Tab strip */}
      <div role="tablist" className={styles.tabList}>
        {TAB_OPTIONS.map((tabOption) => (
          <button
            key={tabOption.key}
            role="tab"
            aria-selected={state.activeTab === tabOption.key}
            className={`${styles.tabButton} ${state.activeTab === tabOption.key ? styles.activeTab : ''}`}
            onClick={() => actions.setActiveTab(tabOption.key)}
          >
            {tabOption.label}
          </button>
        ))}
      </div>

      {/* Tab preamble (explainer card + timestamp + copy button) */}
      <TabPreamble
        tabKey={state.activeTab}
        isCollapsed={isTabExplainerCollapsed(state.activeTab)}
        onToggleExplainer={() => { toggleTabExplainer(state.activeTab) }}
        lastGeneratedAt={activeTabTimestamp}
        reportText={activeTabReportText}
      />

      {/* Tab content — show empty state if no teams configured on features tab */}
      {hasNoArtTeams && state.activeTab === 'features' ? (
        <p className={styles.emptyState}>
          No ART teams configured — add them in ART View Settings or run a Refresh.
        </p>
      ) : (
        renderActiveTab()
      )}
    </div>
  )
}
