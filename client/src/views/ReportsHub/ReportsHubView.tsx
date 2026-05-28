// ReportsHubView.tsx — Director & RTE-level PI reporting dashboard across all ART teams.
//
// Ten tabs: Defect Dashboard, Feature Report, Defect Tracker, Risk Board, Flow, Impact, Individual,
// Quality, Sprint Health, and Throughput. Hero KPI grid provides at-a-glance counts. All data
// loaded via useReportsHubState. Each tab also includes an "About this report" explainer
// card, a per-tab copy-to-clipboard button, and a "Last generated" relative timestamp.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Cell, Pie, PieChart, Tooltip } from 'recharts'

import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs.tsx'
import { copyElementImageToClipboard } from '../../utils/downloadElementImage.ts'
import { findPiNameForDate } from '../ArtView/hooks/artHelpers.ts'
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
  { key: 'dashboard', label: '🧭 Defect Dashboard' },
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
const PI_FILTER_KEY_PATTERN = /\bPI\s+\d+(?:\.\d+)?\b/i

const CRITICAL_RISK_PRIORITIES = new Set(['Highest', 'High', 'Critical', 'Blocker'])

// Threshold below which a team's sprint health score is flagged as at-risk
const HEALTH_AT_RISK_THRESHOLD = 70
// Issues with these priorities appear in the Impact tab
const HIGH_PRIORITY_VALUES = new Set(['Highest', 'High', 'Critical'])
// Defects with these priorities are counted as critical in the Quality tab
const CRITICAL_PRIORITY_VALUES = new Set(['Highest', 'Critical'])
const FLOW_LOOKBACK_DAYS = 30
const AGING_STALE_DAYS = 10
const OVERCOMMITTED_WORK_IN_PROGRESS_THRESHOLD = 4
const SPRINT_HEALTH_RED_THRESHOLD = 30
const SPRINT_HEALTH_WATCH_THRESHOLD = 50

// Rolling window for throughput benchmark: last N sprints are averaged to produce the baseline
const BENCHMARK_WINDOW_SPRINTS = 6
const COPY_FEEDBACK_DURATION_MS = 2000
const DASHBOARD_WIDGET_LIMIT = 6
const DASHBOARD_PIE_WIDTH = 240
const DASHBOARD_PIE_HEIGHT = 220
const DASHBOARD_PIE_OUTER_RADIUS = 72
const DASHBOARD_PIE_INNER_RADIUS = 42
const DASHBOARD_CHART_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#38bdf8']
const THROUGHPUT_MONTH_WINDOW = 6

// Per-tab explainer bullet texts sourced from legacy rhReportPitch() in 20-reports-hub.js
const TAB_DESCRIPTIONS: Record<ReportsHubTab, string[]> = {
  dashboard: [
    'Recreates a Jira-style dashboard view with saved-filter widgets on the left and summary charts on the right.',
    'Pulls together critical defects, blocked sprint work, open risks, and unassigned work without switching tabs.',
    'Donut charts summarize the same issue pool by team, priority, status, and source so hot spots are obvious at a glance.',
    'Use for: operational reviews, Scrum of Scrums prep, and quick stakeholder snapshots.',
  ],
  features: [
    'Highlights at-risk Feature and Epic delivery across the ART — overdue work, ownership gaps, dependency load, and risk signals in one scorecard.',
    'Shows which teams carry the most Feature delivery risk instead of only listing inventory.',
    'Keeps the detailed inventory available, but leads with rollups and priority cues that a raw Jira table does not provide.',
    'Use for: PI execution reviews, cross-team dependency calls, stakeholder briefings.',
  ],
  defects: [
    'Quality-debt report across the ART — team backlog, severity mix, aged defects, and critical blockers in one place.',
    'Highlights where quality risk is rising instead of forcing leaders to infer it from a flat issue table.',
    'Surfaces critical and stale defects first, with the full backlog retained as supporting detail.',
    'Use for: triage ownership, pre-release audits, quality trend conversations.',
  ],
  risks: [
    'Risk exposure report across all ART teams, combining formal Risk issues with risk-labeled work.',
    'Ranks stale, ownerless, and high-severity risks so leaders can focus on what needs action now.',
    'Pairs a team-level exposure summary with a drilldown of the risks most likely to derail delivery.',
    'Use for: ART sync, Scrum of Scrums, executive risk briefings.',
  ],
  flow: [
    'Flow and aging in one report: recent completions over the last 30 days plus current WIP age and stale-work hotspots.',
    'Shows where work is getting stuck before missed sprint goals make the problem obvious.',
    'Balances completed work against aging WIP so leaders can see both output and congestion at the same time.',
    'Use for: impediment identification, ART sync, PI retrospectives.',
  ],
  impact: [
    'Delivery impact scorecard that ranks teams by execution pressure using blocked work, defect load, open risks, unassigned work, and recent completions.',
    'Answers which teams need leadership attention first when delivery pressure is rising.',
    'Designed for steering conversations, not raw issue review — the scorecard turns several signals into one prioritised view.',
    'Use for: Quarterly Business Reviews, PI retrospectives, executive delivery briefings.',
  ],
  individual: [
    'Ownership load report for active sprint work, grouped by person and sorted by who needs rebalancing first.',
    'Flags over-commitment, blocked work, and stale in-progress work so leaders can rebalance capacity before a sprint slips.',
    'Turns per-person issue totals into an actionable workload report rather than a simple counts table.',
    'Use for: 1:1 prep, sprint review, capacity rebalancing decisions.',
  ],
  quality: [
    'Team quality scorecard with open defect load, critical defects, recent defect intake, and defect density.',
    'Brings per-team quality benchmarking into one report so release risk is obvious before a readiness review.',
    'Critical defects still surface immediately, but the report now shows which teams carry the heaviest quality burden.',
    'Use for: release gating, sprint reviews, executive risk briefings.',
  ],
  sprintHealth: [
    'Real-time sprint health scorecard showing completion %, blocked load, and traffic-light status for every team.',
    '🔴 <30% done | 🟡 30–50% | 🟢 >50% — health triaged in seconds.',
    'Highlights which teams are at risk or slipping into watch status before the sprint ends.',
    'Use for: Scrum of Scrums prep, mid-sprint steering, escalation decisions.',
  ],
  throughput: [
    'Six-month throughput comparison with monthly ART totals, side-by-side team counts, and trend direction.',
    'Native Jira locks throughput views to a single board; this report compares the entire ART in one place.',
    'Makes it easy to see whether the ART is accelerating, flattening, or sliding before it becomes a PI-level problem.',
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
  onCopyReport(): Promise<void>
}

/** Button that copies the active report panel as a PNG image and briefly shows status feedback. */
function CopyReportButton({ onCopyReport }: CopyReportButtonProps) {
  const [isCopying, setIsCopying] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [hasCopyFailed, setHasCopyFailed] = useState(false)

  const handleCopyClick = useCallback((): void => {
    setIsCopying(true)
    setHasCopyFailed(false)
    void onCopyReport().then(() => {
      setIsCopied(true)
      setTimeout(() => { setIsCopied(false) }, COPY_FEEDBACK_DURATION_MS)
    }).catch(() => {
      setHasCopyFailed(true)
    }).finally(() => {
      setIsCopying(false)
    })
  }, [onCopyReport])

  let buttonLabel = '📋 Copy Report PNG'
  if (isCopying) buttonLabel = 'Copying…'
  else if (isCopied) buttonLabel = '✓ Copied PNG'
  else if (hasCopyFailed) buttonLabel = '⚠ Copy failed'

  return (
    <button
      className={styles.actionButton}
      onClick={handleCopyClick}
      data-export-exclude="true"
      disabled={isCopying}
    >
      {buttonLabel}
    </button>
  )
}

// ── Tab Preamble ──

interface TabPreambleProps {
  tabKey: ReportsHubTab
  isCollapsed: boolean
  onToggleExplainer(): void
  lastGeneratedAt: string | null
  onCopyReport(): Promise<void>
}

/** Wraps every tab with an "About" card, last-generated timestamp, and a copy button. */
function TabPreamble({
  tabKey,
  isCollapsed,
  onToggleExplainer,
  lastGeneratedAt,
  onCopyReport,
}: TabPreambleProps) {
  return (
    <div className={styles.tabPreamble}>
      <div className={styles.preambleActions}>
        {lastGeneratedAt !== null && (
          <span className={styles.lastGeneratedText}>
            Last generated: {formatRelativeTime(lastGeneratedAt)}
          </span>
        )}
        <CopyReportButton onCopyReport={onCopyReport} />
      </div>
      <AboutReportCard tabKey={tabKey} isCollapsed={isCollapsed} onToggle={onToggleExplainer} />
    </div>
  )
}

interface GlobalReportFiltersProps {
  piFilter: string
  teamFilter: string
  piOptions: string[]
  teamOptions: string[]
  onPiFilterChange(value: string): void
  onTeamFilterChange(value: string): void
}

/** Ensures all option values are valid strings; filters out non-strings to prevent render crashes. */
function sanitizeFilterOptions(options: unknown[]): string[] {
  return options
    .filter((opt): opt is string => typeof opt === 'string' && opt.trim().length > 0)
    .sort()
}

/** Global PI + Team parameters shown for every report tab. */
function GlobalReportFilters({
  piFilter,
  teamFilter,
  piOptions,
  teamOptions,
  onPiFilterChange,
  onTeamFilterChange,
}: GlobalReportFiltersProps) {
  const sanitizedPiOptions = sanitizeFilterOptions(piOptions)
  const sanitizedTeamOptions = sanitizeFilterOptions(teamOptions)

  return (
    <div className={styles.filterBar}>
      <select
        className={styles.filterSelect}
        value={piFilter}
        onChange={(changeEvent) => onPiFilterChange(changeEvent.target.value)}
        aria-label="PI filter"
      >
        <option value="">{ALL_PIS_LABEL}</option>
        {sanitizedPiOptions.map((piName) => (
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
        {sanitizedTeamOptions.map((teamName) => (
          <option key={teamName} value={teamName}>
            {teamName}
          </option>
        ))}
      </select>
    </div>
  )
}

// ── Dashboard tab ──

interface DashboardIssueEntry {
  key: string
  summary: string
  teamName: string
  assigneeName: string | null
  priorityLabel: string
  statusName: string
  statusCategory: string
  sourceLabel: string
}

interface DashboardChartSlice {
  name: string
  value: number
}

interface DashboardWidgetCardProps {
  title: string
  subtitle: string
  totalCount: number
  issues: DashboardIssueEntry[]
}

interface DashboardChartCardProps {
  title: string
  slices: DashboardChartSlice[]
}

interface DashboardTabProps {
  defects: JiraFeatureIssue[]
  risks: JiraFeatureIssue[]
  sprintIssues: SprintIssue[]
  isLoading: boolean
  error: string | null
}

function resolveDashboardPriorityLabel(priorityLabel: string | null): string {
  return priorityLabel ?? 'None'
}

function resolveDashboardStatusLabel(statusCategory: string): string {
  if (statusCategory === 'done') return 'Done'
  if (statusCategory === 'indeterminate') return 'In Progress'
  return 'To Do'
}

function buildDashboardChartSlices(groupLabels: string[]): DashboardChartSlice[] {
  const labelCounts = new Map<string, number>()
  for (const groupLabel of groupLabels) {
    labelCounts.set(groupLabel, (labelCounts.get(groupLabel) ?? 0) + 1)
  }
  return Array.from(labelCounts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((firstSlice, secondSlice) => secondSlice.value - firstSlice.value)
}

function buildDashboardIssueFromFeature(
  issue: JiraFeatureIssue,
  sourceLabel: string,
): DashboardIssueEntry {
  return {
    key: issue.key,
    summary: issue.summary,
    teamName: issue.teamName,
    assigneeName: issue.assigneeName,
    priorityLabel: resolveDashboardPriorityLabel(issue.priority),
    statusName: issue.statusName,
    statusCategory: issue.statusCategory,
    sourceLabel,
  }
}

function buildDashboardIssueFromSprint(issue: SprintIssue): DashboardIssueEntry {
  return {
    key: issue.key,
    summary: issue.summary,
    teamName: issue.teamName,
    assigneeName: issue.assigneeName,
    priorityLabel: resolveDashboardPriorityLabel(issue.priority),
    statusName: issue.statusName,
    statusCategory: issue.statusCategory,
    sourceLabel: 'Sprint Work',
  }
}

function DashboardWidgetCard({ title, subtitle, totalCount, issues }: DashboardWidgetCardProps) {
  return (
    <section className={styles.dashboardCard}>
      <div className={styles.dashboardCardHeader}>
        <div>
          <h3 className={styles.dashboardCardTitle}>{title}</h3>
          <p className={styles.dashboardCardSubtitle}>{subtitle}</p>
        </div>
        <span className={styles.dashboardCardCount}>{totalCount}</span>
      </div>
      {issues.length === 0 ? (
        <p className={styles.emptyState}>No issues matched this widget.</p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.reportTable}>
            <thead>
              <tr>
                <th>Key</th>
                <th>Summary</th>
                <th>Team</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.key}>
                  <td>{issue.key}</td>
                  <td>{issue.summary}</td>
                  <td>{issue.teamName}</td>
                  <td>
                    <StatusBadge statusName={issue.statusName} statusCategory={issue.statusCategory} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function DashboardChartCard({ title, slices }: DashboardChartCardProps) {
  return (
    <section className={styles.dashboardCard}>
      <div className={styles.dashboardCardHeader}>
        <div>
          <h3 className={styles.dashboardCardTitle}>{title}</h3>
          <p className={styles.dashboardCardSubtitle}>Summary of the current dashboard issue pool.</p>
        </div>
      </div>
      {slices.length === 0 ? (
        <p className={styles.emptyState}>No issues available for charting.</p>
      ) : (
        <div className={styles.dashboardChartSection}>
          <PieChart height={DASHBOARD_PIE_HEIGHT} width={DASHBOARD_PIE_WIDTH}>
            <Pie
              data={slices}
              dataKey="value"
              innerRadius={DASHBOARD_PIE_INNER_RADIUS}
              nameKey="name"
              outerRadius={DASHBOARD_PIE_OUTER_RADIUS}
            >
              {slices.map((slice, sliceIndex) => (
                <Cell
                  key={`${title}-${slice.name}`}
                  fill={DASHBOARD_CHART_COLORS[sliceIndex % DASHBOARD_CHART_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
          <ul className={styles.dashboardLegendList}>
            {slices.map((slice, sliceIndex) => (
              <li className={styles.dashboardLegendItem} key={`${title}-${slice.name}-legend`}>
                <span
                  className={styles.dashboardLegendSwatch}
                  style={{ backgroundColor: DASHBOARD_CHART_COLORS[sliceIndex % DASHBOARD_CHART_COLORS.length] }}
                />
                <span>{slice.name}</span>
                <strong>{slice.value}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** Jira-style dashboard tab with filter widgets on the left and summary charts on the right. */
function DashboardTab({
  defects,
  risks,
  sprintIssues,
  isLoading,
  error,
}: DashboardTabProps) {
  if (isLoading) return <p className={styles.emptyState}>Loading dashboard data…</p>
  if (error !== null) return <p className={styles.emptyState}>{error}</p>

  const openDefects = defects.filter((defect) => defect.statusCategory !== 'done')
  const openRisks = risks.filter((risk) => risk.statusCategory !== 'done')
  const activeSprintIssues = sprintIssues.filter((issue) => issue.statusCategory !== 'done')
  const dashboardIssuePool = [
    ...openDefects.map((defect) => buildDashboardIssueFromFeature(defect, 'Defect')),
    ...openRisks.map((risk) => buildDashboardIssueFromFeature(risk, 'Risk')),
    ...activeSprintIssues.map((issue) => buildDashboardIssueFromSprint(issue)),
  ]
  const criticalDefects = openDefects
    .filter((defect) => HIGH_PRIORITY_VALUES.has(resolveDashboardPriorityLabel(defect.priority)))
  const criticalDefectItems = criticalDefects
    .slice(0, DASHBOARD_WIDGET_LIMIT)
    .map((defect) => buildDashboardIssueFromFeature(defect, 'Defect'))
  const blockedSprintIssues = activeSprintIssues.filter((issue) => issue.isBlocked)
  const blockedWorkItems = blockedSprintIssues
    .slice(0, DASHBOARD_WIDGET_LIMIT)
    .map((issue) => buildDashboardIssueFromSprint(issue))
  const openRiskItems = openRisks
    .slice(0, DASHBOARD_WIDGET_LIMIT)
    .map((risk) => buildDashboardIssueFromFeature(risk, 'Risk'))
  const unassignedIssues = dashboardIssuePool
    .filter((issue) => issue.assigneeName === null)
  const unassignedWorkItems = unassignedIssues.slice(0, DASHBOARD_WIDGET_LIMIT)
  const issuesByTeam = buildDashboardChartSlices(dashboardIssuePool.map((issue) => issue.teamName))
  const issuesByPriority = buildDashboardChartSlices(dashboardIssuePool.map((issue) => issue.priorityLabel))
  const issuesByStatus = buildDashboardChartSlices(
    dashboardIssuePool.map((issue) => resolveDashboardStatusLabel(issue.statusCategory)),
  )
  const issuesBySource = buildDashboardChartSlices(dashboardIssuePool.map((issue) => issue.sourceLabel))

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Dashboard Snapshot</h3>
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Open Defects</span>
          <span className={`${styles.kpiValue} ${openDefects.length > 0 ? styles.kpiValueRed : ''}`}>
            {openDefects.length}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Blocked Work</span>
          <span className={`${styles.kpiValue} ${blockedSprintIssues.length > 0 ? styles.kpiValueAmber : ''}`}>
            {blockedSprintIssues.length}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Open Risks</span>
          <span className={`${styles.kpiValue} ${openRisks.length > 0 ? styles.kpiValueAmber : ''}`}>
            {openRisks.length}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Unassigned Work</span>
          <span className={`${styles.kpiValue} ${unassignedIssues.length > 0 ? styles.kpiValueRed : ''}`}>
            {unassignedIssues.length}
          </span>
        </div>
      </div>
      <div className={styles.dashboardLayout}>
        <div className={styles.dashboardColumn}>
          <DashboardWidgetCard title="Critical Defects" subtitle="Highest-priority open defects that need immediate attention." totalCount={criticalDefects.length} issues={criticalDefectItems} />
          <DashboardWidgetCard title="Blocked Work" subtitle="Current sprint issues marked blocked or impeded." totalCount={blockedSprintIssues.length} issues={blockedWorkItems} />
          <DashboardWidgetCard title="Open Risks" subtitle="Active risk items across configured ART teams." totalCount={openRisks.length} issues={openRiskItems} />
          <DashboardWidgetCard title="Unassigned Work" subtitle="Open items that still do not have a named owner." totalCount={unassignedIssues.length} issues={unassignedWorkItems} />
        </div>
        <div className={styles.dashboardColumn}>
          <DashboardChartCard title="Issues by Team" slices={issuesByTeam} />
          <DashboardChartCard title="Issues by Priority" slices={issuesByPriority} />
          <DashboardChartCard title="Issues by Status" slices={issuesByStatus} />
          <DashboardChartCard title="Issues by Source" slices={issuesBySource} />
        </div>
      </div>
    </div>
  )
}

// ── Feature Report tab ──

interface FeatureReportTabProps {
  features: JiraFeatureIssue[]
  artTeamCount: number
  isLoadingFeatures: boolean
}

/** Feature Report table filtered by the global report parameters. */
function FeatureReportTab({
  features,
  artTeamCount,
  isLoadingFeatures,
}: FeatureReportTabProps) {
  if (artTeamCount === 0) {
    return (
      <p className={styles.emptyState}>
        No ART teams configured — add them in ART View Settings or run a Refresh.
      </p>
    )
  }

  if (isLoadingFeatures && features.length === 0) {
    return (
      <p className={styles.emptyState}>
        Loading feature report…
      </p>
    )
  }

  const atRiskFeatures = features.filter((feature) =>
    isPastDue(feature.dueDate) ||
    !feature.assigneeName ||
    (feature.dependencyCount ?? 0) > 0 ||
    feature.isRiskTagged === true,
  )
  const unassignedFeatureCount = features.filter((feature) => !feature.assigneeName).length
  const overdueFeatureCount = features.filter((feature) => isPastDue(feature.dueDate)).length
  const dependencyHeavyFeatureCount = features.filter((feature) => (feature.dependencyCount ?? 0) > 0).length
  const featureHealthByTeam = Array.from(
    features.reduce((featureMap, feature) => {
      const existingEntry = featureMap.get(feature.teamName) ?? {
        teamName: feature.teamName,
        totalCount: 0,
        inProgressCount: 0,
        atRiskCount: 0,
      }

      existingEntry.totalCount += 1
      if (feature.statusCategory === 'indeterminate') {
        existingEntry.inProgressCount += 1
      }
      if (
        isPastDue(feature.dueDate) ||
        !feature.assigneeName ||
        (feature.dependencyCount ?? 0) > 0 ||
        feature.isRiskTagged === true
      ) {
        existingEntry.atRiskCount += 1
      }

      featureMap.set(feature.teamName, existingEntry)
      return featureMap
    }, new Map<string, { teamName: string; totalCount: number; inProgressCount: number; atRiskCount: number }>()).values(),
  ).sort((firstEntry, secondEntry) => secondEntry.atRiskCount - firstEntry.atRiskCount)

  return (
    <div>
      {isLoadingFeatures && (
        <p className={styles.emptyState}>Refreshing feature report…</p>
      )}
      <h3 className={styles.tabSectionHeading}>Feature Execution Summary</h3>
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Features</span>
          <span className={styles.kpiValue}>{features.length}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>At Risk</span>
          <span className={`${styles.kpiValue} ${atRiskFeatures.length > 0 ? styles.kpiValueAmber : ''}`}>
            {atRiskFeatures.length}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Past Due</span>
          <span className={`${styles.kpiValue} ${overdueFeatureCount > 0 ? styles.kpiValueRed : ''}`}>
            {overdueFeatureCount}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Unassigned</span>
          <span className={`${styles.kpiValue} ${unassignedFeatureCount > 0 ? styles.kpiValueRed : ''}`}>
            {unassignedFeatureCount}
          </span>
        </div>
      </div>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>Dependency Load: {dependencyHeavyFeatureCount}</span>
        <span className={styles.summaryBarItem}>ART Teams in View: {artTeamCount}</span>
      </div>
      <h3 className={styles.tabSectionHeading}>At-Risk Features</h3>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Team</th>
              <th>Due</th>
              <th>Dependencies</th>
              <th>Signals</th>
            </tr>
          </thead>
          <tbody>
            {atRiskFeatures.map((feature) => {
              const featureSignals = [
                isPastDue(feature.dueDate) ? 'Past Due' : null,
                !feature.assigneeName ? 'Unassigned' : null,
                (feature.dependencyCount ?? 0) > 0 ? `${feature.dependencyCount} Dependencies` : null,
                feature.isRiskTagged ? 'Risk Tagged' : null,
              ].filter((featureSignal): featureSignal is string => featureSignal !== null)

              return (
                <tr key={feature.key}>
                  <td>{feature.key}</td>
                  <td>{feature.summary}</td>
                  <td>{feature.teamName}</td>
                  <td>{formatDisplayDate(feature.dueDate)}</td>
                  <td>{feature.dependencyCount ?? 0}</td>
                  <td>{featureSignals.join(' • ')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {atRiskFeatures.length === 0 && (
          <p className={styles.emptyState}>No at-risk features match the selected parameters.</p>
        )}
      </div>
      <h3 className={styles.tabSectionHeading}>Team Feature Health</h3>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Total</th>
              <th>In Progress</th>
              <th>At Risk</th>
            </tr>
          </thead>
          <tbody>
            {featureHealthByTeam.map((teamEntry) => (
              <tr key={teamEntry.teamName}>
                <td>{teamEntry.teamName}</td>
                <td>{teamEntry.totalCount}</td>
                <td>{teamEntry.inProgressCount}</td>
                <td>{teamEntry.atRiskCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className={styles.tabSectionHeading}>Feature Inventory</h3>
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
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {features.map((feature) => (
              <tr key={feature.key}>
                <td>{feature.key}</td>
                <td>{feature.summary}</td>
                <td>{feature.teamName}</td>
                <td>{feature.fixVersions.join(', ') || '—'}</td>
                <td>{feature.piName ?? '—'}</td>
                <td>{feature.assigneeName ?? 'Unassigned'}</td>
                <td>{formatDisplayDate(feature.dueDate)}</td>
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
        {features.length === 0 && (
          <p className={styles.emptyState}>No features match the selected parameters.</p>
        )}
      </div>
    </div>
  )
}

function matchesSharedIssueFilters(
  issue: { piName: string | null; teamName: string },
  piFilter: string,
  teamFilter: string,
): boolean {
  const normalizedPiFilter = createPiFilterKey(piFilter)
  const matchesPi =
    normalizedPiFilter === null || createPiFilterKey(issue.piName) === normalizedPiFilter
  const matchesTeam = teamFilter === '' || issue.teamName === teamFilter
  return matchesPi && matchesTeam
}

function matchesFeatureIssueFilters(
  issue: { piName: string | null; teamName: string; isBottomUpScoped?: boolean },
  piFilter: string,
  teamFilter: string,
): boolean {
  const normalizedPiFilter = createPiFilterKey(piFilter)
  const issuePiFilterKey = createPiFilterKey(issue.piName)
  const shouldBypassPiFilterForBottomUpIssue = issue.isBottomUpScoped === true && normalizedPiFilter !== null
  // Mirror Team Dashboard bottom-up behavior: when a PI is selected, keep
  // features that do not have a PI value on the feature issue itself.
  const matchesPi =
    shouldBypassPiFilterForBottomUpIssue
    || normalizedPiFilter === null
    || issuePiFilterKey === null
    || issuePiFilterKey === normalizedPiFilter
  const matchesTeam = teamFilter === '' || issue.teamName === teamFilter
  return matchesPi && matchesTeam
}

function createPiFilterKey(piName: string | null): string | null {
  if (typeof piName !== 'string') {
    return null
  }

  const trimmedPiName = piName.trim()
  if (trimmedPiName === '') {
    return null
  }

  const matchedPiKey = trimmedPiName.match(PI_FILTER_KEY_PATTERN)?.[0]
  return (matchedPiKey ?? trimmedPiName).replace(/\s+/g, ' ').trim().toUpperCase()
}

function resolvePreferredPiOptionLabel(currentLabel: string, candidateLabel: string): string {
  if (candidateLabel.length > currentLabel.length) {
    return candidateLabel
  }

  if (candidateLabel.length < currentLabel.length) {
    return currentLabel
  }

  return candidateLabel.localeCompare(currentLabel) < 0 ? candidateLabel : currentLabel
}

function filterFeatureIssuesByParameters(
  issueList: JiraFeatureIssue[],
  piFilter: string,
  teamFilter: string,
): JiraFeatureIssue[] {
  return issueList.filter((issue) => matchesFeatureIssueFilters(issue, piFilter, teamFilter))
}

function filterSprintIssuesByParameters(
  issueList: SprintIssue[],
  piFilter: string,
  teamFilter: string,
): SprintIssue[] {
  return issueList.filter((issue) => matchesSharedIssueFilters(issue, piFilter, teamFilter))
}

function extractPiFilterOptions(
  features: JiraFeatureIssue[],
  defects: JiraFeatureIssue[],
  risks: JiraFeatureIssue[],
  storyIssues: JiraFeatureIssue[],
  sprintIssues: SprintIssue[],
  throughputIssues: SprintIssue[],
): string[] {
  const piLabelByKey = new Map<string, string>()
  const allIssuesWithPi = [...features, ...defects, ...risks, ...storyIssues, ...sprintIssues, ...throughputIssues]
  for (const issue of allIssuesWithPi) {
    const trimmedPiName = issue.piName?.trim()
    const piFilterKey = createPiFilterKey(trimmedPiName ?? null)
    if (!trimmedPiName || piFilterKey === null) continue

    const currentPiLabel = piLabelByKey.get(piFilterKey)
    piLabelByKey.set(
      piFilterKey,
      currentPiLabel ? resolvePreferredPiOptionLabel(currentPiLabel, trimmedPiName) : trimmedPiName,
    )
  }
  return Array.from(piLabelByKey.values()).sort()
}

function extractTeamFilterOptions(
  artTeams: ReturnType<typeof useReportsHubState>['state']['artTeams'],
  features: JiraFeatureIssue[],
  defects: JiraFeatureIssue[],
  risks: JiraFeatureIssue[],
  sprintIssues: SprintIssue[],
  throughputIssues: SprintIssue[],
): string[] {
  const teamNameSet = new Set<string>()
  for (const artTeam of artTeams) {
    teamNameSet.add(artTeam.name)
  }
  for (const issue of [...features, ...defects, ...risks, ...sprintIssues, ...throughputIssues]) {
    teamNameSet.add(issue.teamName)
  }
  return Array.from(teamNameSet).sort()
}

function aggregateFilteredThroughputData(throughputIssues: SprintIssue[]): ThroughputEntry[] {
  // Use YYYY-MM period keys (not display labels) so entries sort chronologically
  // before slicing. Matching the hook's approach ensures the most recent months
  // are shown, not just the last-inserted labels.
  const countByPeriodKey = new Map<string, number>()
  for (const issue of throughputIssues) {
    if (issue.resolutionDate) {
      const resolutionTimestamp = new Date(issue.resolutionDate)
      if (!Number.isNaN(resolutionTimestamp.getTime())) {
        const periodKey = `${resolutionTimestamp.getUTCFullYear()}-${String(resolutionTimestamp.getUTCMonth() + 1).padStart(2, '0')}`
        countByPeriodKey.set(periodKey, (countByPeriodKey.get(periodKey) ?? 0) + 1)
      }
    }
  }

  return Array.from(countByPeriodKey.entries())
    .sort(([firstPeriodKey], [secondPeriodKey]) => firstPeriodKey.localeCompare(secondPeriodKey))
    .slice(-THROUGHPUT_MONTH_WINDOW)
    .map(([periodKey, resolvedCount]) => ({
      periodLabel: new Date(
        Date.UTC(Number(periodKey.slice(0, 4)), Number(periodKey.slice(5, 7)) - 1, 1),
      ).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      resolvedCount,
    }))
}

function formatDisplayDate(dateValue: string | null | undefined): string {
  if (!dateValue) {
    return '—'
  }

  const parsedDate = new Date(dateValue)
  if (Number.isNaN(parsedDate.getTime())) {
    return '—'
  }

  return parsedDate.toLocaleDateString()
}

function calculateIssueAgeDays(dateValue: string | null | undefined): number {
  if (!dateValue) {
    return 0
  }

  const parsedTimestamp = new Date(dateValue).getTime()
  if (!Number.isFinite(parsedTimestamp)) {
    return 0
  }

  return Math.max(0, Math.floor((Date.now() - parsedTimestamp) / (24 * 60 * 60 * 1000)))
}

function isPastDue(dateValue: string | null | undefined): boolean {
  if (!dateValue) {
    return false
  }

  // Jira returns date-only strings like "2026-05-27" which new Date() parses as
  // midnight UTC. In negative UTC offsets, midnight UTC falls on the previous
  // calendar day locally, so comparing timestamps incorrectly marks items due
  // today as overdue. Instead, compare the due date's YYYY-MM-DD portion against
  // today's local date so that items due today are never considered past due.
  const dueDatePart = dateValue.slice(0, 10)
  if (Number.isNaN(new Date(dueDatePart).getTime())) {
    return false
  }

  const localNow = new Date()
  const todayDatePart = [
    localNow.getFullYear(),
    String(localNow.getMonth() + 1).padStart(2, '0'),
    String(localNow.getDate()).padStart(2, '0'),
  ].join('-')

  // An item is past due only when its due date is strictly before today.
  return dueDatePart < todayDatePart
}

function isWithinRecentDays(dateValue: string | null | undefined, dayCount: number): boolean {
  const ageInDays = calculateIssueAgeDays(dateValue)
  return ageInDays > 0 && ageInDays <= dayCount
}

// ── Defect Tracker tab ──

interface DefectTrackerTabProps {
  defects: JiraFeatureIssue[]
}

/** Defect Tracker with a summary bar and full issue table. */
function DefectTrackerTab({ defects }: DefectTrackerTabProps) {
  const openDefects = defects.filter((defect) => defect.statusCategory !== 'done')
  const openDefectCount = openDefects.length
  const closedDefectCount = defects.filter((defect) => defect.statusCategory === 'done').length
  const criticalOpenDefects = openDefects.filter(
    (defect) => defect.priority !== null && CRITICAL_PRIORITY_VALUES.has(defect.priority),
  )
  const agedOpenDefects = openDefects.filter((defect) => calculateIssueAgeDays(defect.updatedDate) > AGING_STALE_DAYS)
  const recentDefectCount = defects.filter((defect) => isWithinRecentDays(defect.createdDate, FLOW_LOOKBACK_DAYS)).length
  const qualityDebtByTeam = Array.from(
    defects.reduce((teamMap, defect) => {
      const existingEntry = teamMap.get(defect.teamName) ?? {
        teamName: defect.teamName,
        openCount: 0,
        criticalCount: 0,
        agedCount: 0,
        recentCount: 0,
      }

      if (defect.statusCategory !== 'done') {
        existingEntry.openCount += 1
      }
      if (defect.priority !== null && CRITICAL_PRIORITY_VALUES.has(defect.priority)) {
        existingEntry.criticalCount += 1
      }
      if (calculateIssueAgeDays(defect.updatedDate) > AGING_STALE_DAYS) {
        existingEntry.agedCount += 1
      }
      if (isWithinRecentDays(defect.createdDate, FLOW_LOOKBACK_DAYS)) {
        existingEntry.recentCount += 1
      }

      teamMap.set(defect.teamName, existingEntry)
      return teamMap
    }, new Map<string, { teamName: string; openCount: number; criticalCount: number; agedCount: number; recentCount: number }>()).values(),
  ).sort((firstEntry, secondEntry) => secondEntry.openCount - firstEntry.openCount)

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Quality Debt Summary</h3>
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Open Defects</span>
          <span className={`${styles.kpiValue} ${openDefectCount > 0 ? styles.kpiValueRed : ''}`}>{openDefectCount}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Critical Open</span>
          <span className={`${styles.kpiValue} ${criticalOpenDefects.length > 0 ? styles.kpiValueRed : ''}`}>
            {criticalOpenDefects.length}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Aged &gt; 10d</span>
          <span className={`${styles.kpiValue} ${agedOpenDefects.length > 0 ? styles.kpiValueAmber : ''}`}>
            {agedOpenDefects.length}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Opened 30d</span>
          <span className={styles.kpiValue}>{recentDefectCount}</span>
        </div>
      </div>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>Total: {defects.length}</span>
        <span className={styles.summaryBarItem}>Open: {openDefectCount}</span>
        <span className={styles.summaryBarItem}>Closed: {closedDefectCount}</span>
      </div>
      <h3 className={styles.tabSectionHeading}>Team Quality Debt</h3>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Open</th>
              <th>Critical</th>
              <th>Aged &gt; 10d</th>
              <th>Opened 30d</th>
            </tr>
          </thead>
          <tbody>
            {qualityDebtByTeam.map((teamEntry) => (
              <tr key={teamEntry.teamName}>
                <td>{teamEntry.teamName}</td>
                <td>{teamEntry.openCount}</td>
                <td>{teamEntry.criticalCount}</td>
                <td>{teamEntry.agedCount}</td>
                <td>{teamEntry.recentCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className={styles.tabSectionHeading}>Critical and Aged Defects</h3>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Team</th>
              <th>Priority</th>
              <th>Age</th>
              <th>Assignee</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {openDefects
              .filter((defect) =>
                (defect.priority !== null && CRITICAL_PRIORITY_VALUES.has(defect.priority)) ||
                calculateIssueAgeDays(defect.updatedDate) > AGING_STALE_DAYS,
              )
              .map((defect) => (
              <tr key={defect.key}>
                <td>{defect.key}</td>
                <td>{defect.summary}</td>
                <td>{defect.teamName}</td>
                <td>{defect.priority ?? '—'}</td>
                <td>{calculateIssueAgeDays(defect.updatedDate)}d</td>
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
        {openDefects.length === 0 && (
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
  const openRisks = risks.filter((risk) => risk.statusCategory !== 'done')
  const criticalRiskCount = openRisks.filter(
    (risk) => risk.priority !== null && CRITICAL_RISK_PRIORITIES.has(risk.priority),
  ).length
  const staleRiskCount = openRisks.filter((risk) => calculateIssueAgeDays(risk.updatedDate) > AGING_STALE_DAYS).length
  const ownerlessRiskCount = openRisks.filter((risk) => !risk.assigneeName).length
  const teamRiskExposure = Array.from(
    openRisks.reduce((riskMap, risk) => {
      const existingEntry = riskMap.get(risk.teamName) ?? {
        teamName: risk.teamName,
        openCount: 0,
        criticalCount: 0,
        staleCount: 0,
        ownerlessCount: 0,
      }

      existingEntry.openCount += 1
      if (risk.priority !== null && CRITICAL_RISK_PRIORITIES.has(risk.priority)) {
        existingEntry.criticalCount += 1
      }
      if (calculateIssueAgeDays(risk.updatedDate) > AGING_STALE_DAYS) {
        existingEntry.staleCount += 1
      }
      if (!risk.assigneeName) {
        existingEntry.ownerlessCount += 1
      }

      riskMap.set(risk.teamName, existingEntry)
      return riskMap
    }, new Map<string, { teamName: string; openCount: number; criticalCount: number; staleCount: number; ownerlessCount: number }>()).values(),
  ).sort((firstEntry, secondEntry) => secondEntry.criticalCount - firstEntry.criticalCount)

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Risk Exposure Summary</h3>
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Open Risks</span>
          <span className={`${styles.kpiValue} ${openRisks.length > 0 ? styles.kpiValueAmber : ''}`}>{openRisks.length}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Critical</span>
          <span className={`${styles.kpiValue} ${criticalRiskCount > 0 ? styles.kpiValueRed : ''}`}>{criticalRiskCount}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Stale &gt; 10d</span>
          <span className={`${styles.kpiValue} ${staleRiskCount > 0 ? styles.kpiValueAmber : ''}`}>{staleRiskCount}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Ownerless</span>
          <span className={`${styles.kpiValue} ${ownerlessRiskCount > 0 ? styles.kpiValueRed : ''}`}>{ownerlessRiskCount}</span>
        </div>
      </div>
      <h3 className={styles.tabSectionHeading}>Team Risk Exposure</h3>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Open</th>
              <th>Critical</th>
              <th>Stale</th>
              <th>Ownerless</th>
            </tr>
          </thead>
          <tbody>
            {teamRiskExposure.map((teamEntry) => (
              <tr key={teamEntry.teamName}>
                <td>{teamEntry.teamName}</td>
                <td>{teamEntry.openCount}</td>
                <td>{teamEntry.criticalCount}</td>
                <td>{teamEntry.staleCount}</td>
                <td>{teamEntry.ownerlessCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className={styles.tabSectionHeading}>Critical and Stale Risks</h3>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Team</th>
              <th>Priority</th>
              <th>Age</th>
              <th>Assignee</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {openRisks
              .filter((risk) =>
                (risk.priority !== null && CRITICAL_RISK_PRIORITIES.has(risk.priority)) ||
                calculateIssueAgeDays(risk.updatedDate) > AGING_STALE_DAYS,
              )
              .map((risk) => {
                const isHighPriorityRisk =
                  risk.priority !== null && CRITICAL_RISK_PRIORITIES.has(risk.priority)
                const rowClass = isHighPriorityRisk ? styles.highRiskRow : ''

                return (
                  <tr key={risk.key} className={rowClass}>
                    <td>{risk.key}</td>
                    <td>{risk.summary}</td>
                    <td>{risk.teamName}</td>
                    <td>{risk.priority ?? '—'}</td>
                    <td>{calculateIssueAgeDays(risk.updatedDate)}d</td>
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
        {openRisks.length === 0 && (
          <p className={styles.emptyState}>No risks found.</p>
        )}
      </div>
    </div>
  )
}

// ── Flow tab ──

interface FlowTabProps {
  sprintIssues: SprintIssue[]
  throughputIssues: SprintIssue[]
  isLoading: boolean
  error: string | null
}

/** Flow tab — shows WIP by status lane and highlights bottlenecks in the sprint pipeline. */
function FlowTab({ sprintIssues, throughputIssues, isLoading, error }: FlowTabProps) {
  if (isLoading) return <p className={styles.emptyState}>Loading sprint data…</p>
  if (error !== null) return <p className={styles.emptyState}>{error}</p>

  const activeSprintIssues = sprintIssues.filter((issue) => issue.statusCategory !== 'done')
  const wipByStatus = new Map<string, number>()
  for (const issue of activeSprintIssues) {
    wipByStatus.set(issue.statusName, (wipByStatus.get(issue.statusName) ?? 0) + 1)
  }
  const recentCompletions = throughputIssues.filter((issue) => isWithinRecentDays(issue.resolutionDate, FLOW_LOOKBACK_DAYS))
  const staleWorkItems = activeSprintIssues.filter((issue) => calculateIssueAgeDays(issue.updatedDate) > AGING_STALE_DAYS)
  const maxWip = Math.max(0, ...Array.from(wipByStatus.values()))
  const flowByTeam = Array.from(
    [...activeSprintIssues, ...recentCompletions].reduce((teamMap, issue) => {
      const existingEntry = teamMap.get(issue.teamName) ?? {
        teamName: issue.teamName,
        currentWipCount: 0,
        blockedCount: 0,
        staleCount: 0,
        recentCompletionCount: 0,
      }

      if (issue.statusCategory === 'done') {
        existingEntry.recentCompletionCount += 1
      } else {
        existingEntry.currentWipCount += 1
        if (issue.isBlocked) {
          existingEntry.blockedCount += 1
        }
        if (calculateIssueAgeDays(issue.updatedDate) > AGING_STALE_DAYS) {
          existingEntry.staleCount += 1
        }
      }

      teamMap.set(issue.teamName, existingEntry)
      return teamMap
    }, new Map<string, { teamName: string; currentWipCount: number; blockedCount: number; staleCount: number; recentCompletionCount: number }>()).values(),
  ).sort((firstEntry, secondEntry) => secondEntry.staleCount - firstEntry.staleCount)

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Recent Completions (Last 30 Days)</h3>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>Completed: {recentCompletions.length}</span>
        <span className={styles.summaryBarItem}>Current WIP: {activeSprintIssues.length}</span>
        <span className={styles.summaryBarItem}>
          Stale WIP: {staleWorkItems.length}
        </span>
      </div>
      <h3 className={styles.tabSectionHeading}>Flow by Team</h3>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Completed 30d</th>
              <th>Current WIP</th>
              <th>Blocked</th>
              <th>Stale</th>
            </tr>
          </thead>
          <tbody>
            {flowByTeam.map((teamEntry) => (
              <tr key={teamEntry.teamName}>
                <td>{teamEntry.teamName}</td>
                <td>{teamEntry.recentCompletionCount}</td>
                <td>{teamEntry.currentWipCount}</td>
                <td>{teamEntry.blockedCount}</td>
                <td>{teamEntry.staleCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {flowByTeam.length === 0 && (
          <p className={styles.emptyState}>No active sprint issues found.</p>
        )}
      </div>
      <h3 className={styles.tabSectionHeading}>WIP Pipeline</h3>
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
      </div>
    </div>
  )
}

// ── Impact tab ──

interface ImpactTabProps {
  defects: JiraFeatureIssue[]
  risks: JiraFeatureIssue[]
  sprintIssues: SprintIssue[]
  throughputIssues: SprintIssue[]
  isLoading: boolean
  error: string | null
}

/** Impact tab — surfaces high-priority and blocked issues that need immediate attention. */
function ImpactTab({ defects, risks, sprintIssues, throughputIssues, isLoading, error }: ImpactTabProps) {
  if (isLoading) return <p className={styles.emptyState}>Loading sprint data…</p>
  if (error !== null) return <p className={styles.emptyState}>{error}</p>

  const activeSprintIssues = sprintIssues.filter((issue) => issue.statusCategory !== 'done')
  const recentCompletions = throughputIssues.filter((issue) => isWithinRecentDays(issue.resolutionDate, FLOW_LOOKBACK_DAYS))
  const impactRows = Array.from(
    new Set([
      ...defects.map((defect) => defect.teamName),
      ...risks.map((risk) => risk.teamName),
      ...activeSprintIssues.map((issue) => issue.teamName),
      ...recentCompletions.map((issue) => issue.teamName),
    ]),
  ).map((teamName) => {
    const teamBlockedCount = activeSprintIssues.filter((issue) => issue.teamName === teamName && issue.isBlocked).length
    const teamUnassignedCount = activeSprintIssues.filter((issue) => issue.teamName === teamName && !issue.assigneeName).length
    const teamOpenDefectCount = defects.filter((defect) => defect.teamName === teamName && defect.statusCategory !== 'done').length
    const teamOpenRiskCount = risks.filter((risk) => risk.teamName === teamName && risk.statusCategory !== 'done').length
    const teamRecentCompletionCount = recentCompletions.filter((issue) => issue.teamName === teamName).length
    const pressureScore =
      (teamBlockedCount * 3) +
      (teamOpenDefectCount * 2) +
      (teamOpenRiskCount * 2) +
      teamUnassignedCount -
      teamRecentCompletionCount

    return {
      teamName,
      teamBlockedCount,
      teamUnassignedCount,
      teamOpenDefectCount,
      teamOpenRiskCount,
      teamRecentCompletionCount,
      pressureScore,
    }
  }).sort((firstEntry, secondEntry) => secondEntry.pressureScore - firstEntry.pressureScore)

  const highestPressureIssues = activeSprintIssues.filter(
    (issue) => HIGH_PRIORITY_VALUES.has(issue.priority) || issue.isBlocked,
  )

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Delivery Impact Scorecard</h3>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>Teams in View: {impactRows.length}</span>
        <span className={styles.summaryBarItem}>Recent Completions: {recentCompletions.length}</span>
        <span className={styles.summaryBarItem}>Blocked WIP: {activeSprintIssues.filter((issue) => issue.isBlocked).length}</span>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Completed 30d</th>
              <th>Blocked</th>
              <th>Open Defects</th>
              <th>Open Risks</th>
              <th>Unassigned</th>
              <th>Pressure Score</th>
            </tr>
          </thead>
          <tbody>
            {impactRows.map((impactRow) => (
              <tr key={impactRow.teamName}>
                <td>{impactRow.teamName}</td>
                <td>{impactRow.teamRecentCompletionCount}</td>
                <td>{impactRow.teamBlockedCount}</td>
                <td>{impactRow.teamOpenDefectCount}</td>
                <td>{impactRow.teamOpenRiskCount}</td>
                <td>{impactRow.teamUnassignedCount}</td>
                <td>{impactRow.pressureScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className={styles.tabSectionHeading}>Pressure Spotlight</h3>
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
            {highestPressureIssues.map((issue) => (
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
        {highestPressureIssues.length === 0 && (
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
  const ownershipLoadRows = individualEntries.map((individualEntry) => {
    const personIssues = sprintIssues.filter(
      (issue) => (issue.assigneeName ?? 'Unassigned') === individualEntry.assigneeName,
    )
    const staleCount = personIssues.filter(
      (issue) => issue.statusCategory !== 'done' && calculateIssueAgeDays(issue.updatedDate) > AGING_STALE_DAYS,
    ).length
    const highPriorityCount = personIssues.filter((issue) => HIGH_PRIORITY_VALUES.has(issue.priority)).length
    const isOvercommitted = individualEntry.inProgressCount >= OVERCOMMITTED_WORK_IN_PROGRESS_THRESHOLD

    return {
      ...individualEntry,
      staleCount,
      highPriorityCount,
      isOvercommitted,
    }
  }).sort((firstEntry, secondEntry) => {
    const firstAttentionScore = (firstEntry.isOvercommitted ? 100 : 0) + firstEntry.blockedCount + firstEntry.staleCount
    const secondAttentionScore = (secondEntry.isOvercommitted ? 100 : 0) + secondEntry.blockedCount + secondEntry.staleCount
    return secondAttentionScore - firstAttentionScore
  })
  const overcommittedPeopleCount = ownershipLoadRows.filter((entry) => entry.isOvercommitted).length

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Ownership Load Report</h3>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>People in View: {ownershipLoadRows.length}</span>
        <span className={styles.summaryBarItem}>Overcommitted: {overcommittedPeopleCount}</span>
        <span className={styles.summaryBarItem}>Blocked Owners: {ownershipLoadRows.filter((entry) => entry.blockedCount > 0).length}</span>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Assignee</th>
              <th>Total</th>
              <th>In Progress</th>
              <th>Done</th>
              <th>Blocked</th>
              <th>Stale</th>
              <th>High Priority</th>
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {ownershipLoadRows.map((entry) => (
              <tr key={entry.assigneeName}>
                <td>{entry.assigneeName}</td>
                <td>{entry.totalCount}</td>
                <td>{entry.inProgressCount}</td>
                <td>{entry.doneCount}</td>
                <td>{entry.blockedCount > 0 ? `⚠️ ${entry.blockedCount}` : '—'}</td>
                <td>{entry.staleCount > 0 ? entry.staleCount : '—'}</td>
                <td>{entry.highPriorityCount > 0 ? entry.highPriorityCount : '—'}</td>
                <td>{entry.isOvercommitted ? 'Needs Rebalance' : 'Balanced'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ownershipLoadRows.length === 0 && (
          <p className={styles.emptyState}>No sprint issues found.</p>
        )}
      </div>
    </div>
  )
}

// ── Quality tab ──

interface QualityTabProps {
  defects: JiraFeatureIssue[]
  storyIssues: JiraFeatureIssue[]
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
function QualityTab({ defects, storyIssues, isLoading, error }: QualityTabProps) {
  if (isLoading) return <p className={styles.emptyState}>Loading quality data…</p>
  if (error !== null) return <p className={styles.emptyState}>{error}</p>

  const storyCount = storyIssues.length
  const metrics = computeQualityMetrics(defects, storyCount)
  const teamQualityRows = Array.from(
    new Set([...defects.map((defect) => defect.teamName), ...storyIssues.map((storyIssue) => storyIssue.teamName)]),
  ).map((teamName) => {
    const teamDefects = defects.filter((defect) => defect.teamName === teamName && defect.statusCategory !== 'done')
    const teamStories = storyIssues.filter((storyIssue) => storyIssue.teamName === teamName)
    const teamCriticalCount = teamDefects.filter(
      (defect) => defect.priority !== null && CRITICAL_PRIORITY_VALUES.has(defect.priority),
    ).length
    const teamRecentDefectCount = teamDefects.filter((defect) => isWithinRecentDays(defect.createdDate, FLOW_LOOKBACK_DAYS)).length

    return {
      teamName,
      openDefectCount: teamDefects.length,
      criticalCount: teamCriticalCount,
      recentDefectCount: teamRecentDefectCount,
      storyCount: teamStories.length,
      defectDensity: teamStories.length > 0 ? Number((teamDefects.length / teamStories.length).toFixed(2)) : 0,
    }
  }).sort((firstEntry, secondEntry) => secondEntry.openDefectCount - firstEntry.openDefectCount)

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
      <h3 className={styles.tabSectionHeading}>Team Quality Scorecard</h3>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Open Defects</th>
              <th>Critical</th>
              <th>Opened 30d</th>
              <th>Stories</th>
              <th>Defect Density</th>
            </tr>
          </thead>
          <tbody>
            {teamQualityRows.map((teamEntry) => (
              <tr key={teamEntry.teamName}>
                <td>{teamEntry.teamName}</td>
                <td>{teamEntry.openDefectCount}</td>
                <td>{teamEntry.criticalCount}</td>
                <td>{teamEntry.recentDefectCount}</td>
                <td>{teamEntry.storyCount}</td>
                <td>{teamEntry.defectDensity.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const blockedCountByTeam = sprintIssues.reduce((blockedMap, issue) => {
    if (issue.isBlocked) {
      blockedMap.set(issue.teamName, (blockedMap.get(issue.teamName) ?? 0) + 1)
    }
    return blockedMap
  }, new Map<string, number>())
  const atRiskCount = healthEntries.filter((entry) => entry.healthScore < SPRINT_HEALTH_RED_THRESHOLD).length
  const watchCount = healthEntries.filter(
    (entry) => entry.healthScore >= SPRINT_HEALTH_RED_THRESHOLD && entry.healthScore <= SPRINT_HEALTH_WATCH_THRESHOLD,
  ).length

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Team Health</h3>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>Teams: {healthEntries.length}</span>
        <span className={styles.summaryBarItem}>Watch: {watchCount}</span>
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
              <th>Blocked</th>
              <th>Health Score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {healthEntries.map((entry) => {
              const blockedCount = blockedCountByTeam.get(entry.teamName) ?? 0
              const healthStatusLabel =
                entry.healthScore < SPRINT_HEALTH_RED_THRESHOLD
                  ? '🔴 At Risk'
                  : entry.healthScore <= SPRINT_HEALTH_WATCH_THRESHOLD
                    ? '🟡 Watch'
                    : '🟢 On Track'

              return (
                <tr key={entry.teamName}>
                  <td>{entry.teamName}</td>
                  <td>{entry.committedCount}</td>
                  <td>{entry.completedCount}</td>
                  <td>{blockedCount}</td>
                  <td>{entry.healthScore}%</td>
                  <td>{healthStatusLabel}</td>
                </tr>
              )
            })}
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
  throughputIssues: SprintIssue[]
  availableTeamNames: string[]
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
function ThroughputTab({ throughputData, throughputIssues, availableTeamNames, isLoading, error }: ThroughputTabProps) {
  if (isLoading) return <p className={styles.emptyState}>Loading throughput data…</p>
  if (error !== null) return <p className={styles.emptyState}>{error}</p>

  const totalResolved = throughputData.reduce((sum, entry) => sum + entry.resolvedCount, 0)
  const avgThroughput =
    throughputData.length > 0 ? Math.round(totalResolved / throughputData.length) : 0
  const benchmarkAvg = computeThroughputBenchmark(throughputData)
  const recentThroughputPeriods = throughputData.slice(-THROUGHPUT_MONTH_WINDOW)
  const throughputRows = recentThroughputPeriods.map((throughputEntry) => {
    const rowIssues = throughputIssues.filter((issue) => {
      if (!issue.resolutionDate) {
        return false
      }

      return new Date(issue.resolutionDate).toLocaleString('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }) === throughputEntry.periodLabel
    })

    const teamCounts = availableTeamNames.map((teamName) => ({
      teamName,
      resolvedCount: rowIssues.filter((issue) => issue.teamName === teamName).length,
    }))

    return {
      ...throughputEntry,
      teamCounts,
    }
  })

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Throughput Comparison (Last 6 Months)</h3>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>Total Resolved: {totalResolved}</span>
        <span className={styles.summaryBarItem}>Avg / Month: {avgThroughput}</span>
        {throughputData.length >= BENCHMARK_WINDOW_SPRINTS && (
          <span className={styles.summaryBarItem}>
            {BENCHMARK_WINDOW_SPRINTS}-Month Benchmark: {benchmarkAvg}
          </span>
        )}
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Month</th>
              <th>ART Total</th>
              {availableTeamNames.map((teamName) => (
                <th key={teamName}>{teamName}</th>
              ))}
              {throughputData.length >= BENCHMARK_WINDOW_SPRINTS && <th>vs Benchmark</th>}
            </tr>
          </thead>
          <tbody>
            {throughputRows.map((entry) => {
              const { label: deltaLabel, className: deltaClass } = resolveDeltaDisplay(entry.resolvedCount, benchmarkAvg)
              return (
                <tr key={entry.periodLabel}>
                  <td>{entry.periodLabel}</td>
                  <td>{entry.resolvedCount}</td>
                  {entry.teamCounts.map((teamCount) => (
                    <td key={`${entry.periodLabel}-${teamCount.teamName}`}>{teamCount.resolvedCount}</td>
                  ))}
                  {throughputData.length >= BENCHMARK_WINDOW_SPRINTS && (
                    <td className={deltaClass}>{deltaLabel}</td>
                  )}
                </tr>
              )
            })}
            {throughputData.length >= BENCHMARK_WINDOW_SPRINTS && (
              <tr className={styles.benchmarkRow}>
                <td>Benchmark ({BENCHMARK_WINDOW_SPRINTS}-month avg)</td>
                <td>{benchmarkAvg}</td>
                {availableTeamNames.map((teamName) => (
                  <td key={`benchmark-${teamName}`}>—</td>
                ))}
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

// ── Root component ──

/** Reports Hub — director-level PI reporting dashboard across all ART teams. */
export default function ReportsHubView() {
  const { state, actions } = useReportsHubState()
  const { isTabExplainerCollapsed, toggleTabExplainer } = useReportExplainer()
  const { markGenerated, getTabTimestamp } = useLastGenerated()
  const hasTriggeredInitialReportLoadRef = useRef(false)
  const hasAppliedCurrentPiDefaultRef = useRef(false)
  const reportCaptureSectionRef = useRef<HTMLElement | null>(null)

  const hasNoArtTeams = state.artTeams.length === 0

  // Load the report suite automatically the first time Reports Hub opens so the
  // dashboard is useful immediately, while still keeping Refresh for manual reloads.
  useEffect(() => {
    if (hasNoArtTeams || hasTriggeredInitialReportLoadRef.current) {
      return
    }

    hasTriggeredInitialReportLoadRef.current = true
    void actions.loadAllReports()
  }, [actions, hasNoArtTeams])

  // Record the last-generated timestamp whenever data is refreshed
  useEffect(() => {
    if (state.lastGeneratedAt !== null) {
      markGenerated(state.activeTab)
    }
  }, [state.lastGeneratedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeTabTimestamp = getTabTimestamp(state.activeTab)
  const filteredFeatures = filterFeatureIssuesByParameters(state.features, state.piFilter, state.teamFilter)
  const filteredDefects = filterFeatureIssuesByParameters(state.defects, state.piFilter, state.teamFilter)
  const filteredRisks = filterFeatureIssuesByParameters(state.risks, state.piFilter, state.teamFilter)
  const filteredSprintIssues = filterSprintIssuesByParameters(state.sprintIssues, state.piFilter, state.teamFilter)
  const filteredStoryIssues = filterFeatureIssuesByParameters(state.storyIssues, state.piFilter, state.teamFilter)
  const filteredThroughputIssues = filterSprintIssuesByParameters(state.throughputIssues, state.piFilter, state.teamFilter)
  const filteredThroughputData = aggregateFilteredThroughputData(filteredThroughputIssues)
  const piFilterOptions = extractPiFilterOptions(
    state.features,
    state.defects,
    state.risks,
    state.storyIssues,
    state.sprintIssues,
    state.throughputIssues,
  )
  const teamFilterOptions = extractTeamFilterOptions(
    state.artTeams,
    state.features,
    state.defects,
    state.risks,
    state.sprintIssues,
    state.throughputIssues,
  )
  const visibleTeamNames = extractTeamFilterOptions(
    [],
    filteredFeatures,
    filteredDefects,
    filteredRisks,
    filteredSprintIssues,
    filteredThroughputIssues,
  )
  const hasLoadedAnyReportData =
    state.features.length > 0
    || state.defects.length > 0
    || state.risks.length > 0
    || state.sprintIssues.length > 0
    || state.storyIssues.length > 0
    || state.throughputIssues.length > 0
  const shouldShowScopedTeamCount =
    state.teamFilter !== ''
    || state.piFilter !== ''
    || hasLoadedAnyReportData
  const visibleArtTeamCount = state.teamFilter !== ''
    ? 1
    : shouldShowScopedTeamCount
      ? visibleTeamNames.length
      : state.artTeams.length
  const handleCopyReportImage = useCallback(async (): Promise<void> => {
    const reportCaptureSection = reportCaptureSectionRef.current
    if (!reportCaptureSection) {
      throw new Error('The active report is not ready to copy yet.')
    }
    await copyElementImageToClipboard(
      reportCaptureSection,
      'The active report is no longer available to copy.',
    )
  }, [])

  // Once the report data exposes date-range PI labels, default the dropdown to the
  // current PI so Reports Hub opens in the same scoped view as the other PI-aware tools.
  useEffect(() => {
    if (hasNoArtTeams || hasAppliedCurrentPiDefaultRef.current || state.piFilter !== '') {
      return
    }

    const currentPiName = findPiNameForDate(piFilterOptions)
    if (currentPiName === null) {
      return
    }

    hasAppliedCurrentPiDefaultRef.current = true
    actions.setPiFilter(currentPiName)
  }, [actions, hasNoArtTeams, piFilterOptions, state.piFilter])

  function renderActiveTab() {
    switch (state.activeTab) {
      case 'dashboard':
        return (
          <DashboardTab
            defects={filteredDefects}
            risks={filteredRisks}
            sprintIssues={filteredSprintIssues}
            isLoading={state.isLoadingDefects || state.isLoadingRisks || state.isLoadingSprintData}
            error={state.defectsError ?? state.risksError ?? state.sprintDataError}
          />
        )
      case 'features':
        return (
          <FeatureReportTab
            features={filteredFeatures}
            artTeamCount={visibleArtTeamCount}
            isLoadingFeatures={state.isLoadingFeatures}
          />
        )
      case 'defects':
        return <DefectTrackerTab defects={filteredDefects} />
      case 'risks':
        return <RiskBoardTab risks={filteredRisks} />
      case 'flow':
        return (
          <FlowTab
            sprintIssues={filteredSprintIssues}
            throughputIssues={filteredThroughputIssues}
            isLoading={state.isLoadingSprintData || state.isLoadingThroughput}
            error={state.sprintDataError ?? state.throughputError}
          />
        )
      case 'impact':
        return (
          <ImpactTab
            defects={filteredDefects}
            risks={filteredRisks}
            sprintIssues={filteredSprintIssues}
            throughputIssues={filteredThroughputIssues}
            isLoading={state.isLoadingSprintData || state.isLoadingThroughput}
            error={state.sprintDataError ?? state.throughputError}
          />
        )
      case 'individual':
        return (
          <IndividualTab
            sprintIssues={filteredSprintIssues}
            isLoading={state.isLoadingSprintData}
            error={state.sprintDataError}
          />
        )
      case 'quality':
        return (
          <QualityTab
            defects={filteredDefects}
            storyIssues={filteredStoryIssues}
            isLoading={state.isLoadingQuality}
            error={state.qualityError}
          />
        )
      case 'sprintHealth':
        return (
          <SprintHealthTab
            sprintIssues={filteredSprintIssues}
            isLoading={state.isLoadingSprintData}
            error={state.sprintDataError}
          />
        )
      case 'throughput':
        return (
          <ThroughputTab
            throughputData={filteredThroughputData}
            throughputIssues={filteredThroughputIssues}
            availableTeamNames={
              teamFilterOptions.filter((teamName) => state.teamFilter === '' || teamName === state.teamFilter)
            }
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
            Refresh
          </button>
        </div>
      </header>

      {/* Hero KPI grid */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>ART Teams</span>
          <span className={styles.kpiValue}>
            {state.artTeams.length > 0 ? visibleArtTeamCount : '—'}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Features</span>
          <span className={styles.kpiValue}>{filteredFeatures.length}</span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Defects</span>
          <span
            className={`${styles.kpiValue} ${filteredDefects.length > 0 ? styles.kpiValueRed : ''}`}
          >
            {filteredDefects.length}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Risks</span>
          <span
            className={`${styles.kpiValue} ${filteredRisks.length > 0 ? styles.kpiValueAmber : ''}`}
          >
            {filteredRisks.length}
          </span>
        </div>
      </div>

      {/* Tab strip */}
      <PrimaryTabs
        ariaLabel="Reports Hub tabs"
        idPrefix="reports-hub"
        tabs={TAB_OPTIONS}
        activeTab={state.activeTab}
        onChange={actions.setActiveTab}
      />

      <section ref={reportCaptureSectionRef} className={styles.reportCaptureSection}>
        <GlobalReportFilters
          piFilter={state.piFilter}
          teamFilter={state.teamFilter}
          piOptions={piFilterOptions}
          teamOptions={teamFilterOptions}
          onPiFilterChange={actions.setPiFilter}
          onTeamFilterChange={actions.setTeamFilter}
        />

        {/* Tab preamble (explainer card + timestamp + copy button) */}
        <TabPreamble
          tabKey={state.activeTab}
          isCollapsed={isTabExplainerCollapsed(state.activeTab)}
          onToggleExplainer={() => { toggleTabExplainer(state.activeTab) }}
          lastGeneratedAt={activeTabTimestamp}
          onCopyReport={handleCopyReportImage}
        />

        {/* Tab content — dashboard and reports need ART team configuration before Jira queries can load. */}
        {hasNoArtTeams && (state.activeTab === 'dashboard' || state.activeTab === 'features') ? (
          <p className={styles.emptyState}>
            No ART teams configured — add them in ART View Settings or run a Refresh.
          </p>
        ) : (
          renderActiveTab()
        )}
      </section>
    </div>
  )
}
