// ReportsHubView.tsx — Director & RTE-level PI reporting dashboard across all ART teams.
//
// Nine tabs: Feature Report, Defect Tracker, Risk Board, Flow, Impact, Individual, Quality,
// Sprint Health, and Throughput. Hero KPI grid provides at-a-glance counts. All data
// loaded via useReportsHubState.

import type { IndividualEntry, JiraFeatureIssue, QualityMetrics, ReportsHubTab, SprintHealthEntry, SprintIssue, ThroughputEntry } from './hooks/useReportsHubState.ts'
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

/** Throughput tab — rolling resolved-issue counts per sprint for velocity tracking. */
function ThroughputTab({ throughputData, isLoading, error }: ThroughputTabProps) {
  if (isLoading) return <p className={styles.emptyState}>Loading throughput data…</p>
  if (error !== null) return <p className={styles.emptyState}>{error}</p>

  const totalResolved = throughputData.reduce((sum, entry) => sum + entry.resolvedCount, 0)
  const avgThroughput =
    throughputData.length > 0 ? Math.round(totalResolved / throughputData.length) : 0

  return (
    <div>
      <h3 className={styles.tabSectionHeading}>Throughput (Last {throughputData.length} Sprints)</h3>
      <div className={styles.summaryBar}>
        <span className={styles.summaryBarItem}>Total Resolved: {totalResolved}</span>
        <span className={styles.summaryBarItem}>Avg / Sprint: {avgThroughput}</span>
      </div>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Sprint</th>
              <th>Resolved</th>
            </tr>
          </thead>
          <tbody>
            {throughputData.map((entry) => (
              <tr key={entry.sprintName}>
                <td>{entry.sprintName}</td>
                <td>{entry.resolvedCount}</td>
              </tr>
            ))}
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

  const hasNoArtTeams = state.artTeams.length === 0

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
          <button className={styles.actionButton} onClick={actions.copyReport}>
            📋 Copy Report
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
