// useReportsHubState.ts — State management hook for the Reports Hub view.
//
// Loads Epic, Defect, and Risk issues from Jira across all configured ART teams,
// storing them for display in the director-level PI reporting dashboard.

import { useState } from 'react'

import { jiraGet } from '../../../services/jiraApi.ts'

// ── Named constants ──

const ART_TEAMS_STORAGE_KEY = 'nodetoolbox-art-teams'
const LEGACY_ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings'
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
const SPRINT_ISSUE_FIELDS = 'summary,status,assignee,priority,labels,updated,customfield_10020,customfield_10301'
const STORY_ISSUE_TYPE = 'Story'
const SPRINT_MAX_RESULTS = 200
const THROUGHPUT_MAX_RESULTS = 200
const THROUGHPUT_MAX_SPRINTS = 4
const LOAD_SPRINT_DATA_FAILURE = 'Failed to load sprint data'
const LOAD_QUALITY_FAILURE = 'Failed to load quality data'
const LOAD_THROUGHPUT_FAILURE = 'Failed to load throughput data'
const BOARD_PROJECT_CACHE_PREFIX = 'board:'

// ── Type definitions ──

/** All reporting tabs available in the Reports Hub. */
export type ReportsHubTab =
  | 'dashboard'
  | 'features'
  | 'defects'
  | 'risks'
  | 'flow'
  | 'impact'
  | 'individual'
  | 'quality'
  | 'sprintHealth'
  | 'throughput'

/** A single ART team configuration loaded from localStorage. */
export interface ArtTeamConfig {
  name: string
  projectKey?: string
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
  piName: string | null
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
  storyIssues: JiraFeatureIssue[]
  isLoadingQuality: boolean
  qualityError: string | null
  throughputIssues: SprintIssue[]
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
      [PI_CUSTOM_FIELD]?: string | null
    }
  }>
}

interface JiraBoardProjectResponse {
  values?: Array<{ key?: string }>
}

const boardProjectKeyPromiseCache = new Map<string, Promise<string>>()

// ── Helper: localStorage team loader ──

/** Reads the ART teams from localStorage, returning an empty array on failure. */
function normalizeArtTeamConfig(rawTeamConfig: unknown): ArtTeamConfig | null {
  if (typeof rawTeamConfig !== 'object' || rawTeamConfig === null) {
    return null
  }

  const teamCandidate = rawTeamConfig as { name?: unknown; projectKey?: unknown; boardId?: unknown }
  if (typeof teamCandidate.name !== 'string') {
    return null
  }

  const trimmedTeamName = teamCandidate.name.trim()
  const trimmedProjectKey =
    typeof teamCandidate.projectKey === 'string' ? teamCandidate.projectKey.trim() : ''
  const trimmedBoardId =
    typeof teamCandidate.boardId === 'string' ? teamCandidate.boardId.trim() : ''
  if (trimmedTeamName === '' || (trimmedProjectKey === '' && trimmedBoardId === '')) {
    return null
  }

  const normalizedTeamConfig: ArtTeamConfig = {
    name: trimmedTeamName,
  }

  if (trimmedProjectKey !== '') {
    normalizedTeamConfig.projectKey = trimmedProjectKey
  }

  if (trimmedBoardId !== '') {
    normalizedTeamConfig.boardId = trimmedBoardId
  }

  return normalizedTeamConfig
}

/** Normalises a stored ART team array so bad localStorage data never breaks report rendering. */
function parseStoredArtTeams(rawStoredTeams: unknown): ArtTeamConfig[] {
  if (!Array.isArray(rawStoredTeams)) {
    return []
  }

  return rawStoredTeams
    .map((rawTeamConfig) => normalizeArtTeamConfig(rawTeamConfig))
    .filter((teamConfig): teamConfig is ArtTeamConfig => teamConfig !== null)
}

/** Reads and sanitizes ART team settings from localStorage to avoid render-time crashes. */
function loadArtTeamsFromStorage(): ArtTeamConfig[] {
  try {
    const rawStoredTeams = localStorage.getItem(ART_TEAMS_STORAGE_KEY)
    if (rawStoredTeams !== null) {
      const parsedStoredTeams = parseStoredArtTeams(JSON.parse(rawStoredTeams) as unknown)
      if (parsedStoredTeams.length > 0) {
        return parsedStoredTeams
      }
    }

    const rawLegacySettings = localStorage.getItem(LEGACY_ART_SETTINGS_STORAGE_KEY)
    if (rawLegacySettings === null) return []

    const parsedLegacySettings = JSON.parse(rawLegacySettings) as { teams?: unknown[] }
    return parseStoredArtTeams(parsedLegacySettings.teams)
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

/** Builds a Jira search request path so every Reports Hub loader calls the same endpoint shape. */
function buildIssueSearchPath(jql: string, maxResults: number, fields: string): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=${fields}`
}

/** Resolves a Jira project key from saved team data so board-only ART teams still load reports. */
async function resolveArtTeamProjectKey(teamConfig: ArtTeamConfig): Promise<string> {
  if (teamConfig.projectKey?.trim()) {
    return teamConfig.projectKey.trim()
  }

  if (!teamConfig.boardId?.trim()) {
    throw new Error(`Reports Hub could not determine a Jira project key for ${teamConfig.name}.`)
  }

  const boardProjectCacheKey = `${BOARD_PROJECT_CACHE_PREFIX}${teamConfig.boardId}`
  const cachedProjectKeyPromise = boardProjectKeyPromiseCache.get(boardProjectCacheKey)
  if (cachedProjectKeyPromise) {
    return cachedProjectKeyPromise
  }

  const projectLookupPromise = jiraGet<JiraBoardProjectResponse>(
    `/rest/agile/1.0/board/${teamConfig.boardId}/project`,
  )
    .then((projectResponse) => {
      const resolvedProjectKey = projectResponse.values?.[0]?.key?.trim()

      if (!resolvedProjectKey) {
        throw new Error(`Reports Hub could not determine a Jira project key for ${teamConfig.name}.`)
      }

      return resolvedProjectKey
    })
    .catch((projectLookupError) => {
      boardProjectKeyPromiseCache.delete(boardProjectCacheKey)
      throw projectLookupError
    })

  boardProjectKeyPromiseCache.set(boardProjectCacheKey, projectLookupPromise)
  return projectLookupPromise
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
    const resolvedProjectKey = await resolveArtTeamProjectKey(teamConfig)
    const jql = buildReportJql(resolvedProjectKey, issueType, orderField)
    const response = await jiraGet<JiraIssueListResponse>(
      buildIssueSearchPath(jql, REPORT_MAX_RESULTS, REPORT_FIELDS),
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
    piName: (rawIssue.fields[PI_CUSTOM_FIELD] as string | null | undefined) ?? null,
    isBlocked,
    updatedDate: rawIssue.fields.updated,
    sprintName: extractClosedSprintName(rawIssue.fields.customfield_10020),
  }
}

/** JQL for active-sprint issues (used by Flow, Impact, Individual, and Sprint Health). */
function buildSprintDataJql(projectKey: string): string {
  // Some Jira projects do not expose an "Epic" issuetype name, so excluding it by name
  // makes the entire report fail instead of returning sprint data. A broader sprint query
  // is safer here because the downstream report logic can tolerate mixed issue types.
  return `project="${projectKey}" AND sprint in openSprints() ORDER BY status ASC`
}

/** JQL for resolved issues in closed sprints (used by Throughput). */
function buildThroughputJql(projectKey: string): string {
  return `project="${projectKey}" AND status = Done AND sprint in closedSprints() ORDER BY updated DESC`
}

/** Fetches active-sprint issues across all configured teams. */
async function fetchSprintIssuesAcrossTeams(artTeams: ArtTeamConfig[]): Promise<SprintIssue[]> {
  if (artTeams.length === 0) return []
  const teamFetches = artTeams.map(async (teamConfig) => {
    const resolvedProjectKey = await resolveArtTeamProjectKey(teamConfig)
    const jql = buildSprintDataJql(resolvedProjectKey)
    const response = await jiraGet<JiraSprintIssueResponse>(
      buildIssueSearchPath(jql, SPRINT_MAX_RESULTS, SPRINT_ISSUE_FIELDS),
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
    const resolvedProjectKey = await resolveArtTeamProjectKey(teamConfig)
    const jql = buildThroughputJql(resolvedProjectKey)
    const response = await jiraGet<JiraSprintIssueResponse>(
      buildIssueSearchPath(jql, THROUGHPUT_MAX_RESULTS, SPRINT_ISSUE_FIELDS),
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
  const [storyIssues, setStoryIssues] = useState<JiraFeatureIssue[]>([])
  const [isLoadingQuality, setIsLoadingQuality] = useState(false)
  const [qualityError, setQualityError] = useState<string | null>(null)
  const [throughputIssues, setThroughputIssues] = useState<SprintIssue[]>([])
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
    storyIssues,
    isLoadingQuality,
    qualityError,
    throughputIssues,
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
      setStoryIssues(storyResults)
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
      setThroughputIssues(resolvedIssues)
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
    await Promise.allSettled([
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
