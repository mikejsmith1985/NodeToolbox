// useReportsHubState.ts — State management hook for the Reports Hub view.
//
// Loads Epic, Defect, and Risk issues from Jira across all configured ART teams,
// storing them for display in the director-level PI reporting dashboard.

import { useState } from 'react'

import { jiraGet } from '../../../services/jiraApi.ts'

// ── Named constants ──

const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings'
const EPIC_ISSUE_TYPE = 'Epic'
const DEFECT_ISSUE_TYPE = 'Defect'
const RISK_ISSUE_TYPE = 'Risk'
const REPORT_MAX_RESULTS = 100
const PI_CUSTOM_FIELD = 'customfield_10301'
const REPORT_FIELDS =
  'summary,status,fixVersions,assignee,customfield_10301,priority,issuetype'

const LOAD_FEATURES_FAILURE = 'Failed to load features'
const LOAD_DEFECTS_FAILURE = 'Failed to load defects'
const LOAD_RISKS_FAILURE = 'Failed to load risks'
const SPRINT_ISSUE_FIELDS = 'summary,status,assignee,priority,labels,updated,customfield_10020'
const STORY_ISSUE_TYPE = 'Story'
const SPRINT_MAX_RESULTS = 200
const THROUGHPUT_MAX_RESULTS = 200
const THROUGHPUT_MAX_SPRINTS = 4
const LOAD_SPRINT_DATA_FAILURE = 'Failed to load sprint data'
const LOAD_QUALITY_FAILURE = 'Failed to load quality data'
const LOAD_THROUGHPUT_FAILURE = 'Failed to load throughput data'

// ── Type definitions ──

/** All nine reporting tabs available in the Reports Hub. */
export type ReportsHubTab = 'features' | 'defects' | 'risks' | 'flow' | 'impact' | 'individual' | 'quality' | 'sprintHealth' | 'throughput'

/** A single ART team configuration loaded from localStorage. */
export interface ArtTeamConfig {
  name: string
  projectKey: string
  boardId?: string
}

/** A normalised Jira issue record used across all three report types. */
export interface JiraFeatureIssue {
  key: string
  summary: string
  statusName: string
  statusCategory: string
  teamName: string
  fixVersions: string[]
  assigneeName: string | null
  piName: string | null
  priority: string | null
}

/** A normalised active-sprint Jira issue — shared data source for Flow, Impact, Individual, and Sprint Health tabs. */
export interface SprintIssue {
  key: string
  summary: string
  statusName: string
  statusCategory: string  // 'new' | 'indeterminate' | 'done'
  teamName: string
  assigneeName: string | null
  priority: string
  isBlocked: boolean
  updatedDate: string
  sprintName: string | null  // extracted from customfield_10020 for throughput grouping
}

/** Per-assignee workload summary for the Individual tab. */
export interface IndividualEntry {
  assigneeName: string
  totalCount: number
  inProgressCount: number
  doneCount: number
  blockedCount: number
}

/** Aggregated quality metrics computed from defects + story count. */
export interface QualityMetrics {
  totalDefects: number
  criticalDefectCount: number  // defects where priority is 'Highest' or 'Critical' and status != done
  totalStories: number
  defectDensity: number  // totalDefects / totalStories (0 when totalStories = 0)
}

/** Per-team sprint completion health entry for the Sprint Health tab. */
export interface SprintHealthEntry {
  teamName: string
  committedCount: number
  completedCount: number
  healthScore: number  // 0–100 integer
  isAtRisk: boolean   // healthScore < HEALTH_AT_RISK_THRESHOLD
}

/** Per-sprint resolved issue count for the Throughput tab. */
export interface ThroughputEntry {
  sprintName: string
  resolvedCount: number
}

/** All reactive state fields managed by this hook. */
export interface ReportsHubState {
  activeTab: ReportsHubTab
  artTeams: ArtTeamConfig[]
  piFilter: string
  teamFilter: string
  features: JiraFeatureIssue[]
  defects: JiraFeatureIssue[]
  risks: JiraFeatureIssue[]
  isLoadingFeatures: boolean
  isLoadingDefects: boolean
  isLoadingRisks: boolean
  featuresError: string | null
  defectsError: string | null
  risksError: string | null
  lastGeneratedAt: string | null
  sprintIssues: SprintIssue[]
  isLoadingSprintData: boolean
  sprintDataError: string | null
  storyCount: number
  isLoadingQuality: boolean
  qualityError: string | null
  throughputData: ThroughputEntry[]
  isLoadingThroughput: boolean
  throughputError: string | null
}

/** All action callbacks returned by this hook. */
export interface ReportsHubActions {
  setActiveTab(tab: ReportsHubTab): void
  setPiFilter(piName: string): void
  setTeamFilter(teamName: string): void
  loadAllReports(): Promise<void>
  loadFeatures(): Promise<void>
  loadDefects(): Promise<void>
  loadRisks(): Promise<void>
  loadSprintData(): Promise<void>
  loadQuality(): Promise<void>
  loadThroughput(): Promise<void>
  copyReport(): void
}

// ── API response shapes ──

interface JiraIssueListResponse {
  issues: Array<{
    key: string
    fields: {
      summary: string
      status: {
        name: string
        statusCategory: { name: string }
      }
      fixVersions: Array<{ name: string }>
      assignee: { displayName: string } | null
      priority: { name: string } | null
      issuetype: { name: string } | null
      [PI_CUSTOM_FIELD]?: string | null
    }
  }>
}

/** API response for sprint issue searches (different field set from report issues). */
interface JiraSprintIssueResponse {
  issues: Array<{
    key: string
    fields: {
      summary: string
      status: { name: string; statusCategory: { name: string } }
      assignee: { displayName: string } | null
      priority: { name: string } | null
      labels: string[]
      updated: string
      customfield_10020: Array<{ name: string; state: string }> | null
    }
  }>
}

// ── Helper: localStorage team loader ──

/** Reads the ART teams from localStorage, returning an empty array on failure. */
function loadArtTeamsFromStorage(): ArtTeamConfig[] {
  try {
    const rawSettings = localStorage.getItem(ART_SETTINGS_STORAGE_KEY)
    if (rawSettings === null) return []
    const parsedSettings = JSON.parse(rawSettings) as { teams?: ArtTeamConfig[] }
    return Array.isArray(parsedSettings.teams) ? parsedSettings.teams : []
  } catch {
    return []
  }
}

// ── Helper: issue mapper ──

/** Maps a raw Jira issue API response to the normalised JiraFeatureIssue shape. */
function mapJiraIssueToFeature(
  rawIssue: JiraIssueListResponse['issues'][number],
  teamName: string,
): JiraFeatureIssue {
  return {
    key: rawIssue.key,
    summary: rawIssue.fields.summary,
    statusName: rawIssue.fields.status.name,
    statusCategory: rawIssue.fields.status.statusCategory.name,
    teamName,
    fixVersions: rawIssue.fields.fixVersions.map((fixVersion) => fixVersion.name),
    assigneeName: rawIssue.fields.assignee?.displayName ?? null,
    piName: (rawIssue.fields[PI_CUSTOM_FIELD] as string | null | undefined) ?? null,
    priority: rawIssue.fields.priority?.name ?? null,
  }
}

// ── Helper: report JQL builder ──

/** Builds the JQL query for a given issue type and project key. */
function buildReportJql(projectKey: string, issueType: string, orderField: string): string {
  return `project="${projectKey}" AND issuetype = ${issueType} ORDER BY ${orderField} ASC`
}

// ── Helper: fetch issues for all teams ──

/** Fetches issues of a given type across all configured ART teams. */
async function fetchIssuesAcrossTeams(
  artTeams: ArtTeamConfig[],
  issueType: string,
  orderField: string,
): Promise<JiraFeatureIssue[]> {
  if (artTeams.length === 0) return []

  const teamFetches = artTeams.map(async (teamConfig) => {
    const jql = buildReportJql(teamConfig.projectKey, issueType, orderField)
    const response = await jiraGet<JiraIssueListResponse>(
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=${REPORT_MAX_RESULTS}&fields=${REPORT_FIELDS}`,
    )
    return response.issues.map((rawIssue) => mapJiraIssueToFeature(rawIssue, teamConfig.name))
  })

  const allTeamResults = await Promise.all(teamFetches)
  return allTeamResults.flat()
}

// ── Helper: sprint issue helpers ──

/** Extracts the most recent closed sprint name from the Jira sprint custom field array. */
function extractClosedSprintName(sprintField: Array<{ name: string; state: string }> | null): string | null {
  if (!sprintField || sprintField.length === 0) return null
  const closedSprint = sprintField.find((sprint) => sprint.state === 'closed')
  return closedSprint?.name ?? sprintField[0]?.name ?? null
}

/** Maps a raw Jira sprint issue to the normalised SprintIssue shape. */
function mapJiraIssueToSprintIssue(
  rawIssue: JiraSprintIssueResponse['issues'][number],
  teamName: string,
): SprintIssue {
  const issuePriority = rawIssue.fields.priority?.name ?? 'None'
  const issueLabels = rawIssue.fields.labels ?? []
  // An issue is blocked if it has a blocking/impediment label OR its status name contains "block"
  const isBlocked =
    issueLabels.some((label) =>
      label.toLowerCase().includes('block') || label.toLowerCase().includes('impediment'),
    ) || rawIssue.fields.status.name.toLowerCase().includes('block')

  return {
    key: rawIssue.key,
    summary: rawIssue.fields.summary,
    statusName: rawIssue.fields.status.name,
    statusCategory: rawIssue.fields.status.statusCategory.name,
    teamName,
    assigneeName: rawIssue.fields.assignee?.displayName ?? null,
    priority: issuePriority,
    isBlocked,
    updatedDate: rawIssue.fields.updated,
    sprintName: extractClosedSprintName(rawIssue.fields.customfield_10020),
  }
}

/** JQL for active-sprint issues (used by Flow, Impact, Individual, and Sprint Health). */
function buildSprintDataJql(projectKey: string): string {
  return `project="${projectKey}" AND sprint in openSprints() AND issuetype != Epic ORDER BY status ASC`
}

/** JQL for resolved issues in closed sprints (used by Throughput). */
function buildThroughputJql(projectKey: string): string {
  return `project="${projectKey}" AND status = Done AND sprint in closedSprints() ORDER BY updated DESC`
}

/** Fetches active-sprint issues across all configured teams. */
async function fetchSprintIssuesAcrossTeams(artTeams: ArtTeamConfig[]): Promise<SprintIssue[]> {
  if (artTeams.length === 0) return []
  const teamFetches = artTeams.map(async (teamConfig) => {
    const jql = buildSprintDataJql(teamConfig.projectKey)
    const response = await jiraGet<JiraSprintIssueResponse>(
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=${SPRINT_MAX_RESULTS}&fields=${SPRINT_ISSUE_FIELDS}`,
    )
    return response.issues.map((rawIssue) => mapJiraIssueToSprintIssue(rawIssue, teamConfig.name))
  })
  const allTeamResults = await Promise.all(teamFetches)
  return allTeamResults.flat()
}

/** Fetches resolved issues from closed sprints across all teams (for Throughput tab). */
async function fetchThroughputIssuesAcrossTeams(artTeams: ArtTeamConfig[]): Promise<SprintIssue[]> {
  if (artTeams.length === 0) return []
  const teamFetches = artTeams.map(async (teamConfig) => {
    const jql = buildThroughputJql(teamConfig.projectKey)
    const response = await jiraGet<JiraSprintIssueResponse>(
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=${THROUGHPUT_MAX_RESULTS}&fields=${SPRINT_ISSUE_FIELDS}`,
    )
    return response.issues.map((rawIssue) => mapJiraIssueToSprintIssue(rawIssue, teamConfig.name))
  })
  const allTeamResults = await Promise.all(teamFetches)
  return allTeamResults.flat()
}

/** Aggregates resolved issues by sprint name, returning the most recent THROUGHPUT_MAX_SPRINTS entries. */
function aggregateThroughputData(resolvedIssues: SprintIssue[]): ThroughputEntry[] {
  const countBySprintName = new Map<string, number>()
  for (const issue of resolvedIssues) {
    const sprintName = issue.sprintName
    if (sprintName !== null) {
      countBySprintName.set(sprintName, (countBySprintName.get(sprintName) ?? 0) + 1)
    }
  }
  return Array.from(countBySprintName.entries())
    .map(([sprintName, resolvedCount]) => ({ sprintName, resolvedCount }))
    .sort((a, b) => a.sprintName.localeCompare(b.sprintName))
    .slice(-THROUGHPUT_MAX_SPRINTS)
}

// ── Hook ──

/** Provides all reactive state and action callbacks for the Reports Hub view. */
export function useReportsHubState(): { state: ReportsHubState; actions: ReportsHubActions } {
  const [activeTab, setActiveTab] = useState<ReportsHubTab>('features')
  const [artTeams] = useState<ArtTeamConfig[]>(() => loadArtTeamsFromStorage())
  const [piFilter, setPiFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [features, setFeatures] = useState<JiraFeatureIssue[]>([])
  const [defects, setDefects] = useState<JiraFeatureIssue[]>([])
  const [risks, setRisks] = useState<JiraFeatureIssue[]>([])
  const [isLoadingFeatures, setIsLoadingFeatures] = useState(false)
  const [isLoadingDefects, setIsLoadingDefects] = useState(false)
  const [isLoadingRisks, setIsLoadingRisks] = useState(false)
  const [featuresError, setFeaturesError] = useState<string | null>(null)
  const [defectsError, setDefectsError] = useState<string | null>(null)
  const [risksError, setRisksError] = useState<string | null>(null)
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null)
  const [sprintIssues, setSprintIssues] = useState<SprintIssue[]>([])
  const [isLoadingSprintData, setIsLoadingSprintData] = useState(false)
  const [sprintDataError, setSprintDataError] = useState<string | null>(null)
  const [storyCount, setStoryCount] = useState(0)
  const [isLoadingQuality, setIsLoadingQuality] = useState(false)
  const [qualityError, setQualityError] = useState<string | null>(null)
  const [throughputData, setThroughputData] = useState<ThroughputEntry[]>([])
  const [isLoadingThroughput, setIsLoadingThroughput] = useState(false)
  const [throughputError, setThroughputError] = useState<string | null>(null)

  const currentArtTeams = artTeams.length > 0 ? artTeams : loadArtTeamsFromStorage()

  const state: ReportsHubState = {
    activeTab,
    artTeams: currentArtTeams,
    piFilter,
    teamFilter,
    features,
    defects,
    risks,
    isLoadingFeatures,
    isLoadingDefects,
    isLoadingRisks,
    featuresError,
    defectsError,
    risksError,
    lastGeneratedAt,
    sprintIssues,
    isLoadingSprintData,
    sprintDataError,
    storyCount,
    isLoadingQuality,
    qualityError,
    throughputData,
    isLoadingThroughput,
    throughputError,
  }

  async function loadFeatures(): Promise<void> {
    setIsLoadingFeatures(true)
    setFeaturesError(null)
    try {
      const loadedFeatures = await fetchIssuesAcrossTeams(
        currentArtTeams,
        EPIC_ISSUE_TYPE,
        'status',
      )
      setFeatures(loadedFeatures)
    } catch (fetchError) {
      const errorMessage =
        fetchError instanceof Error ? fetchError.message : LOAD_FEATURES_FAILURE
      setFeaturesError(errorMessage)
    } finally {
      setIsLoadingFeatures(false)
    }
  }

  async function loadDefects(): Promise<void> {
    setIsLoadingDefects(true)
    setDefectsError(null)
    try {
      const loadedDefects = await fetchIssuesAcrossTeams(
        currentArtTeams,
        DEFECT_ISSUE_TYPE,
        'priority',
      )
      setDefects(loadedDefects)
    } catch (fetchError) {
      const errorMessage =
        fetchError instanceof Error ? fetchError.message : LOAD_DEFECTS_FAILURE
      setDefectsError(errorMessage)
    } finally {
      setIsLoadingDefects(false)
    }
  }

  async function loadRisks(): Promise<void> {
    setIsLoadingRisks(true)
    setRisksError(null)
    try {
      const loadedRisks = await fetchIssuesAcrossTeams(
        currentArtTeams,
        RISK_ISSUE_TYPE,
        'priority',
      )
      setRisks(loadedRisks)
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : LOAD_RISKS_FAILURE
      setRisksError(errorMessage)
    } finally {
      setIsLoadingRisks(false)
    }
  }

  async function loadSprintData(): Promise<void> {
    setIsLoadingSprintData(true)
    setSprintDataError(null)
    try {
      const loadedSprintIssues = await fetchSprintIssuesAcrossTeams(currentArtTeams)
      setSprintIssues(loadedSprintIssues)
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : LOAD_SPRINT_DATA_FAILURE
      setSprintDataError(errorMessage)
    } finally {
      setIsLoadingSprintData(false)
    }
  }

  async function loadQuality(): Promise<void> {
    setIsLoadingQuality(true)
    setQualityError(null)
    try {
      // Fetch story count across all teams (numerator for defect-density ratio)
      const storyResults = await fetchIssuesAcrossTeams(currentArtTeams, STORY_ISSUE_TYPE, 'created')
      setStoryCount(storyResults.length)
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : LOAD_QUALITY_FAILURE
      setQualityError(errorMessage)
    } finally {
      setIsLoadingQuality(false)
    }
  }

  async function loadThroughput(): Promise<void> {
    setIsLoadingThroughput(true)
    setThroughputError(null)
    try {
      const resolvedIssues = await fetchThroughputIssuesAcrossTeams(currentArtTeams)
      const aggregatedThroughputData = aggregateThroughputData(resolvedIssues)
      setThroughputData(aggregatedThroughputData)
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : LOAD_THROUGHPUT_FAILURE
      setThroughputError(errorMessage)
    } finally {
      setIsLoadingThroughput(false)
    }
  }

  async function loadAllReports(): Promise<void> {
    setLastGeneratedAt(new Date().toISOString())
    await Promise.all([
      loadFeatures(),
      loadDefects(),
      loadRisks(),
      loadSprintData(),
      loadQuality(),
      loadThroughput(),
    ])
  }

  function copyReport(): void {
    const featureCount = features.length
    const defectCount = defects.length
    const riskCount = risks.length
    const generatedTimestamp = lastGeneratedAt ?? new Date().toISOString()

    const reportText = [
      `NodeToolbox ART Report — ${generatedTimestamp}`,
      `Features: ${featureCount}`,
      `Defects: ${defectCount}`,
      `Risks: ${riskCount}`,
    ].join('\n')

    navigator.clipboard.writeText(reportText)
  }

  const actions: ReportsHubActions = {
    setActiveTab,
    setPiFilter,
    setTeamFilter,
    loadAllReports,
    loadFeatures,
    loadDefects,
    loadRisks,
    loadSprintData,
    loadQuality,
    loadThroughput,
    copyReport,
  }

  return { state, actions }
}
