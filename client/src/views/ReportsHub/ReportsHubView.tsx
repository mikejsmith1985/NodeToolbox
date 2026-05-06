// ReportsHubView.tsx — Director & RTE-level PI reporting dashboard across all ART teams.
//
// Three tabs: Feature Report (epics with PI/team filters), Defect Tracker, Risk Board.
// Hero KPI grid provides at-a-glance counts. All data loaded via useReportsHubState.

import type { JiraFeatureIssue, ReportsHubTab } from './hooks/useReportsHubState.ts'
import { useReportsHubState } from './hooks/useReportsHubState.ts'
import styles from './ReportsHubView.module.css'

// ── Named constants ──

const VIEW_TITLE = '📈 Reports Hub'
const VIEW_SUBTITLE = 'Director & RTE reporting dashboard for PI planning.'

const TAB_OPTIONS: { key: ReportsHubTab; label: string }[] = [
  { key: 'features', label: '🏛️ Feature Report' },
  { key: 'defects', label: '🔴 Defect Tracker' },
  { key: 'risks', label: '⚠️ Risk Board' },
]

const ALL_PIS_LABEL = 'All PIs'
const ALL_TEAMS_LABEL = 'All Teams'

const HIGH_RISK_PRIORITIES = new Set(['Highest', 'High'])

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
