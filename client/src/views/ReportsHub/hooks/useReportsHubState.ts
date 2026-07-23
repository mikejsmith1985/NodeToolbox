// useReportsHubState.ts — State management hook for the Reports Hub view.
//
// Loads Epic, Defect, and Risk issues from Jira across all configured ART teams,
// storing them for display in the director-level PI reporting dashboard.

import { useCallback, useState } from 'react'

import { jiraGet } from '../../../services/jiraApi.ts'
import { readArtFeatureScopeSettings } from '../../ArtView/artFeatureScopeSettings.ts'
import { fetchScopedTeamFeatures } from '../../SprintDashboard/scopedTeamFeatures.ts'

// ── Named constants ──

const ART_TEAMS_STORAGE_KEY = 'nodetoolbox-art-teams'
const LEGACY_ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings'
const SEARCH_PAGE_SIZE = 100
const FEATURE_ISSUE_TYPE_JQL = '("Epic", "Feature")'
const DEFECT_ISSUE_TYPE = 'Defect'
const PI_CUSTOM_FIELD = 'customfield_10301'
const PI_LIKE_FIX_VERSION_PATTERN = /^PI\s+\d+(?:\.\d+)?(?:\s*\(.+\))?$/i
const REPORT_FIELDS =
  'summary,status,fixVersions,assignee,customfield_10301,priority,issuetype,created,updated,duedate,labels,issuelinks,resolutiondate'

const LOAD_FEATURES_FAILURE = 'Failed to load features'
const LOAD_BOTTOM_UP_FEATURES_FAILURE = 'Failed to load bottom-up features'
const LOAD_DEFECTS_FAILURE = 'Failed to load defects'
const LOAD_RISKS_FAILURE = 'Failed to load risks'
const SPRINT_ISSUE_FIELDS = 'summary,status,assignee,priority,labels,updated,created,resolutiondate,issuetype,fixVersions,customfield_10020,customfield_10301'
const SPRINT_MAX_RESULTS = 200
const THROUGHPUT_HISTORY_MONTH_LOOKBACK = 5
const LOAD_SPRINT_DATA_FAILURE = 'Failed to load sprint data'
const LOAD_QUALITY_FAILURE = 'Failed to load quality data'
const LOAD_THROUGHPUT_FAILURE = 'Failed to load throughput data'
const BOARD_PROJECT_CACHE_PREFIX = 'board:'
const RISK_LABELS_JQL = 'risk, risks'
const REPORTS_HUB_FEATURE_LOAD_LOG_PREFIX = '[Reports Hub][Feature Load]'

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
  | 'scopeChange'
  | 'featureChange'
  | 'hygiene'
  | 'personalFlow'
  | 'issueFlow'
  | 'issueAging'

/** A single ART team configuration loaded from localStorage. */
export interface ArtTeamConfig {
  name: string
  projectKey?: string
  boardId?: string
  /** Jira label used by the Feature Change report query: type = Feature AND labels in (jiraLabel). */
  jiraLabel?: string
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
  issueTypeName?: string
  createdDate?: string
  updatedDate?: string
  dueDate?: string | null
  resolutionDate?: string | null
  labelNames?: string[]
  dependencyCount?: number
  isRiskTagged?: boolean
  isBottomUpScoped?: boolean
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
  createdDate?: string
  resolutionDate?: string | null
  issueTypeName?: string
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
  periodLabel: string
  resolvedCount: number
}

/** A single scope-change event — an issue that received a new Sprint or fixVersion value. */
export interface ScopeChangeEntry {
  issueKey: string
  issueSummary: string
  issueType: string
  changeType: 'sprint' | 'fixVersion'
  fromValue: string
  toValue: string
  changedBy: string
  changedAt: string
}

/** Scope change results for a single ART team when running in ART Combined mode. */
export interface ArtTeamScopeResult {
  teamName: string
  projectKey: string
  releaseEntries: ScopeChangeEntry[]
  sprintEntries: ScopeChangeEntry[]
  error: string | null
}

/** A single Feature Change event — an Epic that received a change to a monitored PI-planning field. */
export interface FeatureChangeEntry {
  issueKey: string
  issueSummary: string
  /** Human-readable field name — "Fix Version", "Status", "Target Start", "Target End", "Due Date". */
  fieldLabel: string
  changeType: 'fixVersion' | 'status' | 'targetStart' | 'targetEnd' | 'dueDate'
  fromValue: string
  toValue: string
  changedBy: string
  changedAt: string
}

/** Feature change results for a single ART team in ART Combined mode. */
export interface ArtTeamFeatureChangeResult {
  teamName: string
  projectKey: string
  entries: FeatureChangeEntry[]
  error: string | null
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
  scopeChangeEntries: ScopeChangeEntry[]
  isLoadingScopeChange: boolean
  scopeChangeError: string | null
  scopeChangeProjectKey: string
  scopeChangeDaysBack: number
  hasScopeChangeGenerated: boolean
  isArtCombinedMode: boolean
  artCombinedResults: ArtTeamScopeResult[]
  isLoadingArtCombined: boolean
  artCombinedError: string | null
  artCombinedDaysBack: number
  featureChangeEntries: FeatureChangeEntry[]
  isLoadingFeatureChange: boolean
  featureChangeError: string | null
  featureChangeDaysBack: number
  hasFeatureChangeGenerated: boolean
  artCombinedFeatureResults: ArtTeamFeatureChangeResult[]
  isLoadingArtCombinedFeature: boolean
  artCombinedFeatureError: string | null
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
  setScopeChangeProjectKey(projectKey: string): void
  setScopeChangeDaysBack(daysBack: number): void
  loadScopeChanges(projectKeyOverride?: string): Promise<void>
  loadArtCombinedScopeChanges(): Promise<void>
  setArtCombinedMode(isEnabled: boolean): void
  setArtCombinedDaysBack(days: number): void
  /** Routes to single-team or ART Combined based on the current teamFilter value. */
  generateScopeChange(): Promise<void>
  setFeatureChangeDaysBack(daysBack: number): void
  /** Routes to single-team or ART Combined feature change query based on the current teamFilter value. */
  generateFeatureChange(): Promise<void>
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
      created?: string
      updated?: string
      duedate?: string | null
      labels?: string[]
      issuelinks?: unknown[]
      resolutiondate?: string | null
      [PI_CUSTOM_FIELD]?: JiraPiFieldValue
    }
  }>
  total?: number
  startAt?: number
  maxResults?: number
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
      created?: string
      resolutiondate?: string | null
      issuetype?: { name: string } | null
      fixVersions?: Array<{ name: string }>
      customfield_10020: Array<{ name: string; state: string }> | null
      [PI_CUSTOM_FIELD]?: JiraPiFieldValue
    }
  }>
  total?: number
  startAt?: number
  maxResults?: number
}

interface JiraBoardProjectResponse {
  values?: Array<{ key?: string }>
}

type JiraPiFieldValue = { value?: string | null; name?: string | null } | string | null

const boardProjectKeyPromiseCache = new Map<string, Promise<string>>()

function logFeatureLoadInfo(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(`${REPORTS_HUB_FEATURE_LOAD_LOG_PREFIX} ${message}`, details)
    return
  }

  console.info(`${REPORTS_HUB_FEATURE_LOAD_LOG_PREFIX} ${message}`)
}

function logFeatureLoadWarning(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.warn(`${REPORTS_HUB_FEATURE_LOAD_LOG_PREFIX} ${message}`, details)
    return
  }

  console.warn(`${REPORTS_HUB_FEATURE_LOAD_LOG_PREFIX} ${message}`)
}

// ── Helper: localStorage team loader ──

/** Reads the ART teams from localStorage, returning an empty array on failure. */
function normalizeArtTeamConfig(rawTeamConfig: unknown): ArtTeamConfig | null {
  if (typeof rawTeamConfig !== 'object' || rawTeamConfig === null) {
    return null
  }

  const teamCandidate = rawTeamConfig as { name?: unknown; projectKey?: unknown; boardId?: unknown; jiraLabel?: unknown }
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

  const trimmedJiraLabel = typeof teamCandidate.jiraLabel === 'string' ? teamCandidate.jiraLabel.trim() : undefined
  if (trimmedJiraLabel) {
    normalizedTeamConfig.jiraLabel = trimmedJiraLabel
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

/** Normalizes the Jira PI field so Reports Hub can work with both string and option-object values. */
function extractPiNameFromFieldValue(fieldValue: JiraPiFieldValue | undefined): string | null {
  if (typeof fieldValue === 'string') {
    const trimmedPiName = fieldValue.trim()
    return trimmedPiName === '' ? null : trimmedPiName
  }

  if (typeof fieldValue === 'object' && fieldValue !== null) {
    const preferredPiName = fieldValue.value?.trim() || fieldValue.name?.trim() || ''
    return preferredPiName === '' ? null : preferredPiName
  }

  return null
}

/** Falls back to PI-like fix versions for Jira projects that do not populate the dedicated PI field. */
function extractPiNameFromFixVersions(fixVersions: Array<{ name: string }> | undefined): string | null {
  const matchingFixVersion = fixVersions?.find((fixVersion) =>
    PI_LIKE_FIX_VERSION_PATTERN.test(fixVersion.name.trim()),
  )
  const trimmedPiName = matchingFixVersion?.name.trim() ?? ''
  return trimmedPiName === '' ? null : trimmedPiName
}

/** Picks the best available PI label for a report issue so every tab can share the same filter. */
function resolveIssuePiName(
  piFieldValue: JiraPiFieldValue | undefined,
  fixVersions?: Array<{ name: string }>,
): string | null {
  return extractPiNameFromFieldValue(piFieldValue) ?? extractPiNameFromFixVersions(fixVersions)
}

// ── Helper: issue mapper ──

/** Maps a raw Jira issue API response to the normalised JiraFeatureIssue shape. */
function mapJiraIssueToFeature(
  rawIssue: JiraIssueListResponse['issues'][number],
  teamName: string,
): JiraFeatureIssue {
  const issueLabels = rawIssue.fields.labels ?? []

  return {
    key: rawIssue.key,
    summary: rawIssue.fields.summary,
    statusName: rawIssue.fields.status.name,
    statusCategory: rawIssue.fields.status.statusCategory.name,
    teamName,
    fixVersions: rawIssue.fields.fixVersions.map((fixVersion) => fixVersion.name),
    assigneeName: rawIssue.fields.assignee?.displayName ?? null,
    piName: resolveIssuePiName(rawIssue.fields[PI_CUSTOM_FIELD], rawIssue.fields.fixVersions),
    priority: rawIssue.fields.priority?.name ?? null,
    issueTypeName: rawIssue.fields.issuetype?.name ?? undefined,
    createdDate: rawIssue.fields.created,
    updatedDate: rawIssue.fields.updated,
    dueDate: rawIssue.fields.duedate ?? null,
    resolutionDate: rawIssue.fields.resolutiondate ?? null,
    labelNames: issueLabels,
    dependencyCount: rawIssue.fields.issuelinks?.length ?? 0,
    isRiskTagged: issueLabels.some((issueLabel) => issueLabel.toLowerCase().includes('risk')),
  }
}

// ── Helper: report JQL builder ──

/** Builds the feature-report JQL so the report includes both Epic and Feature work where available. */
function buildFeatureReportJql(projectKey: string): string {
  return `project="${projectKey}" AND issuetype in ${FEATURE_ISSUE_TYPE_JQL} ORDER BY status ASC, updated DESC`
}

/** Builds the defect-report JQL ordered by newest and most severe quality debt first. */
function buildDefectReportJql(projectKey: string): string {
  return `project="${projectKey}" AND issuetype = ${DEFECT_ISSUE_TYPE} ORDER BY priority DESC, updated DESC`
}

/** Builds the risk-report JQL so labeled risk items are included alongside formal Risk issues. */
function buildRiskReportJql(projectKey: string): string {
  return `project="${projectKey}" AND (issuetype = Risk OR labels in (${RISK_LABELS_JQL})) ORDER BY priority DESC, updated DESC`
}

/** Builds the story-report JQL used as the denominator for quality reporting. */
function buildStoryReportJql(projectKey: string): string {
  return `project="${projectKey}" AND issuetype = Story ORDER BY created DESC`
}

/** Builds a Jira search request path so every Reports Hub loader calls the same endpoint shape. */
function buildIssueSearchPath(jql: string, maxResults: number, fields: string, startAt = 0): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${maxResults}&fields=${fields}`
}

/** Fetches every page for a Jira search so Reports Hub totals are not silently truncated. */
async function fetchAllSearchIssues<TIssue>(
  jql: string,
  fields: string,
): Promise<TIssue[]> {
  const collectedIssues: TIssue[] = []
  let currentStartAt = 0

  while (true) {
    const searchResponse = await jiraGet<{ issues?: TIssue[]; total?: number }>(
      buildIssueSearchPath(jql, SEARCH_PAGE_SIZE, fields, currentStartAt),
    )
    const currentPageIssues = searchResponse.issues ?? []
    collectedIssues.push(...currentPageIssues)

    if (currentPageIssues.length < SEARCH_PAGE_SIZE) {
      return collectedIssues
    }

    currentStartAt += currentPageIssues.length
    if (typeof searchResponse.total === 'number' && currentStartAt >= searchResponse.total) {
      return collectedIssues
    }
  }
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
  createTeamJql: (projectKey: string) => string,
): Promise<JiraFeatureIssue[]> {
  if (artTeams.length === 0) return []

  const teamFetches = artTeams.map(async (teamConfig) => {
    const resolvedProjectKey = await resolveArtTeamProjectKey(teamConfig)
    const jql = createTeamJql(resolvedProjectKey)
    const responseIssues = await fetchAllSearchIssues<JiraIssueListResponse['issues'][number]>(
      jql,
      REPORT_FIELDS,
    )
    return responseIssues.map((rawIssue) => mapJiraIssueToFeature(rawIssue, teamConfig.name))
  })

  const allTeamResults = await Promise.all(teamFetches)
  return allTeamResults.flat()
}

/** Fetches feature issues from ART-wide feature-scope projects when team projects do not own the feature records. */
async function fetchIssuesAcrossProjectKeys(
  projectKeys: string[],
  createProjectJql: (projectKey: string) => string,
): Promise<JiraFeatureIssue[]> {
  if (projectKeys.length === 0) return []

  const projectFetches = projectKeys.map(async (projectKey) => {
    const normalizedProjectKey = projectKey.trim().toUpperCase()
    const responseIssues = await fetchAllSearchIssues<JiraIssueListResponse['issues'][number]>(
      createProjectJql(normalizedProjectKey),
      REPORT_FIELDS,
    )
    return responseIssues.map((rawIssue) => mapJiraIssueToFeature(rawIssue, normalizedProjectKey))
  })

  const allProjectResults = await Promise.all(projectFetches)
  return allProjectResults.flat()
}

/** Merges feature issue collections by key so shared feature-scope queries do not duplicate team-owned records. */
function mergeFeatureIssuesByKey(
  preferredIssues: JiraFeatureIssue[],
  secondaryIssues: JiraFeatureIssue[],
): JiraFeatureIssue[] {
  const mergedIssuesByKey = new Map<string, JiraFeatureIssue>()

  for (const featureIssue of secondaryIssues) {
    mergedIssuesByKey.set(featureIssue.key, featureIssue)
  }

  for (const featureIssue of preferredIssues) {
    mergedIssuesByKey.set(featureIssue.key, featureIssue)
  }

  return Array.from(mergedIssuesByKey.values())
}

function normalizeStatusCategory(statusName: string): string {
  const normalizedStatusName = statusName.toLowerCase()
  if (
    normalizedStatusName.includes('done')
    || normalizedStatusName.includes('closed')
    || normalizedStatusName.includes('resolved')
    || normalizedStatusName.includes('complete')
  ) {
    return 'done'
  }

  if (
    normalizedStatusName.includes('to do')
    || normalizedStatusName.includes('todo')
    || normalizedStatusName.includes('open')
    || normalizedStatusName.includes('new')
  ) {
    return 'new'
  }

  return 'indeterminate'
}

/** Maps Team Dashboard bottom-up feature records to the Reports Hub issue shape. */
function mapScopedTeamFeatureToReportIssue(
  teamConfig: ArtTeamConfig,
  scopedFeatureRecord: Awaited<ReturnType<typeof fetchScopedTeamFeatures>>[number],
): JiraFeatureIssue {
  const featureIssue = scopedFeatureRecord.featureIssue
  const issueFields = featureIssue?.fields
  const issueLabels = issueFields?.labels ?? []

  return {
    key: scopedFeatureRecord.feature.key,
    summary: issueFields?.summary ?? scopedFeatureRecord.feature.summary,
    statusName: issueFields?.status?.name ?? scopedFeatureRecord.feature.status,
    statusCategory:
      issueFields?.status?.statusCategory?.key
      ?? normalizeStatusCategory(issueFields?.status?.name ?? scopedFeatureRecord.feature.status),
    teamName: teamConfig.name,
    fixVersions: issueFields?.fixVersions?.map((fixVersion) => fixVersion.name) ?? [],
    assigneeName: issueFields?.assignee?.displayName ?? null,
    piName: resolveIssuePiName(issueFields?.[PI_CUSTOM_FIELD] ?? null, issueFields?.fixVersions),
    priority: issueFields?.priority?.name ?? null,
    issueTypeName: issueFields?.issuetype?.name ?? 'Feature',
    createdDate: issueFields?.created ?? undefined,
    updatedDate: issueFields?.updated ?? undefined,
    dueDate: issueFields?.duedate ?? null,
    resolutionDate: issueFields?.resolutiondate ?? null,
    labelNames: issueLabels,
    dependencyCount: issueFields?.issuelinks?.length ?? 0,
    isRiskTagged: issueLabels.some((issueLabel) => issueLabel.toLowerCase().includes('risk')),
    isBottomUpScoped: true,
  }
}

/** Loads features using the Team Dashboard bottom-up hierarchy path for teams that otherwise return no feature records. */
async function fetchBottomUpFeaturesAcrossTeams(
  artTeams: ArtTeamConfig[],
): Promise<JiraFeatureIssue[]> {
  if (artTeams.length === 0) {
    return []
  }

  const featureScopeSettings = readArtFeatureScopeSettings()
  const scopedTeamFeatureResults = await Promise.all(
    artTeams.map(async (teamConfig) => {
      const scopedTeamFeatures = await fetchScopedTeamFeatures(
        {
          id: `${teamConfig.name}-${teamConfig.boardId ?? teamConfig.projectKey ?? 'reports-hub'}`,
          name: teamConfig.name,
          boardId: teamConfig.boardId ?? '',
          projectKey: teamConfig.projectKey,
          sprintIssues: [],
          isLoading: false,
          loadError: null,
        },
        '',
        {
          piFieldId: featureScopeSettings.piFieldId,
          featureProjectKeys: featureScopeSettings.featureProjectKeys,
          requestedFieldIds: [
            'assignee',
            'created',
            'duedate',
            'fixVersions',
            'issuelinks',
            'labels',
            'priority',
            'resolutiondate',
            'updated',
          ],
        },
      )
      return scopedTeamFeatures.map((scopedFeatureRecord) => mapScopedTeamFeatureToReportIssue(teamConfig, scopedFeatureRecord))
    }),
  )

  return scopedTeamFeatureResults.flat()
}

/** Extracts readable loader errors from settled promise results without losing partial success data. */
function extractRejectedMessages(
  settledResults: PromiseSettledResult<unknown>[],
  fallbackMessage: string,
): string[] {
  return settledResults
    .filter((settledResult): settledResult is PromiseRejectedResult => settledResult.status === 'rejected')
    .map((settledResult) => {
      if (settledResult.reason instanceof Error && settledResult.reason.message.trim() !== '') {
        return settledResult.reason.message
      }

      return fallbackMessage
    })
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
    piName: resolveIssuePiName(rawIssue.fields[PI_CUSTOM_FIELD], rawIssue.fields.fixVersions),
    isBlocked,
    updatedDate: rawIssue.fields.updated,
    sprintName: extractClosedSprintName(rawIssue.fields.customfield_10020),
    createdDate: rawIssue.fields.created,
    resolutionDate: rawIssue.fields.resolutiondate ?? null,
    issueTypeName: rawIssue.fields.issuetype?.name ?? undefined,
  }
}

/** JQL for active-sprint issues (used by Flow, Impact, Individual, and Sprint Health). */
function buildSprintDataJql(projectKey: string): string {
  // Some Jira projects do not expose an "Epic" issuetype name, so excluding it by name
  // makes the entire report fail instead of returning sprint data. A broader sprint query
  // is safer here because the downstream report logic can tolerate mixed issue types.
  return `project="${projectKey}" AND sprint in openSprints() ORDER BY status ASC`
}

/** JQL for resolved work over the last six months so throughput can compare trends across teams. */
function buildThroughputJql(projectKey: string): string {
  return `project="${projectKey}" AND resolutiondate >= startOfMonth(-${THROUGHPUT_HISTORY_MONTH_LOOKBACK}) AND resolutiondate is not EMPTY ORDER BY resolutiondate ASC`
}

/** Fetches active-sprint issues across all configured teams. */
async function fetchSprintIssuesAcrossTeams(artTeams: ArtTeamConfig[]): Promise<SprintIssue[]> {
  if (artTeams.length === 0) return []
  const teamFetches = artTeams.map(async (teamConfig) => {
    const resolvedProjectKey = await resolveArtTeamProjectKey(teamConfig)
    const jql = buildSprintDataJql(resolvedProjectKey)
    const responseIssues = await fetchAllSearchIssues<JiraSprintIssueResponse['issues'][number]>(
      jql,
      SPRINT_ISSUE_FIELDS,
    )
    return responseIssues
      .slice(0, SPRINT_MAX_RESULTS)
      .map((rawIssue) => mapJiraIssueToSprintIssue(rawIssue, teamConfig.name))
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
    const responseIssues = await fetchAllSearchIssues<JiraSprintIssueResponse['issues'][number]>(
      jql,
      SPRINT_ISSUE_FIELDS,
    )
    return responseIssues.map((rawIssue) => mapJiraIssueToSprintIssue(rawIssue, teamConfig.name))
  })
  const allTeamResults = await Promise.all(teamFetches)
  return allTeamResults.flat()
}

function createThroughputPeriodKey(resolutionDate: string): string | null {
  const resolutionTimestamp = new Date(resolutionDate)
  if (Number.isNaN(resolutionTimestamp.getTime())) {
    return null
  }

  return `${resolutionTimestamp.getUTCFullYear()}-${String(resolutionTimestamp.getUTCMonth() + 1).padStart(2, '0')}`
}

function formatThroughputPeriodLabel(periodKey: string): string {
  const [yearPart, monthPart] = periodKey.split('-')
  const periodDate = new Date(Date.UTC(Number(yearPart), Number(monthPart) - 1, 1))
  return periodDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Aggregates resolved issues by month so throughput can compare a real six-month history. */
function aggregateThroughputData(resolvedIssues: SprintIssue[]): ThroughputEntry[] {
  const countByPeriodKey = new Map<string, number>()
  for (const issue of resolvedIssues) {
    const resolutionDate = issue.resolutionDate
    if (typeof resolutionDate === 'string' && resolutionDate.trim() !== '') {
      const periodKey = createThroughputPeriodKey(resolutionDate)
      if (periodKey !== null) {
        countByPeriodKey.set(periodKey, (countByPeriodKey.get(periodKey) ?? 0) + 1)
      }
    }
  }

  return Array.from(countByPeriodKey.entries())
    .sort(([firstPeriodKey], [secondPeriodKey]) => firstPeriodKey.localeCompare(secondPeriodKey))
    .map(([periodKey, resolvedCount]) => ({
      periodLabel: formatThroughputPeriodLabel(periodKey),
      resolvedCount,
    }))
}

// ── Helper: scope change entry extraction ──

/** Raw Jira changelog issue shape used by scope change and feature change queries. */
interface ChangelogIssue {
  key: string
  fields: { summary: string; issuetype: { name: string } | null; labels?: string[] }
  changelog: {
    histories: Array<{
      created: string
      author: { displayName: string }
      items: Array<{ field: string; fieldId?: string; fromString: string | null; toString: string | null }>
    }>
  }
}

/**
 * Maps Jira changelog field identifiers (both display names and field IDs) to the
 * human-readable label and change type used in FeatureChangeEntry records.
 * Each field is keyed twice — once by display name, once by field ID — so matching
 * works regardless of which Jira returns in a given changelog item.
 */
const FEATURE_CHANGE_FIELD_MAP = new Map<string, { fieldLabel: string; changeType: FeatureChangeEntry['changeType'] }>([
  ['fix version',       { fieldLabel: 'Fix Version',  changeType: 'fixVersion'  }],
  ['status',            { fieldLabel: 'Status',       changeType: 'status'      }],
  ['customfield_10101', { fieldLabel: 'Target Start', changeType: 'targetStart' }],
  ['target start',      { fieldLabel: 'Target Start', changeType: 'targetStart' }],
  ['customfield_10102', { fieldLabel: 'Target End',   changeType: 'targetEnd'   }],
  ['target end',        { fieldLabel: 'Target End',   changeType: 'targetEnd'   }],
  ['duedate',           { fieldLabel: 'Due Date',     changeType: 'dueDate'     }],
  ['due date',          { fieldLabel: 'Due Date',     changeType: 'dueDate'     }],
])

/**
 * Scans changelog issues for Epic-level field changes (fix version, status, target
 * dates) that occurred on or after the cutoff date. Deduplicates by issue+field+timestamp.
 */
function extractFeatureChangeEntries(
  issues: ChangelogIssue[],
  cutoffDate: Date,
): FeatureChangeEntry[] {
  const collectedEntries: FeatureChangeEntry[] = []
  const seenKeys = new Set<string>()

  for (const issue of issues) {
    for (const history of issue.changelog?.histories ?? []) {
      if (new Date(history.created) < cutoffDate) continue

      for (const changeItem of history.items) {
        const fieldIdKey = (changeItem.fieldId ?? '').toLowerCase()
        const fieldDisplayKey = changeItem.field.toLowerCase()
        const fieldDef = FEATURE_CHANGE_FIELD_MAP.get(fieldIdKey) ?? FEATURE_CHANGE_FIELD_MAP.get(fieldDisplayKey)
        if (!fieldDef) continue

        // Skip changelog items where nothing meaningful changed (null → null)
        if (!changeItem.fromString && !changeItem.toString) continue

        const dedupeKey = `${issue.key}|${fieldDef.changeType}|${history.created}`
        if (seenKeys.has(dedupeKey)) continue
        seenKeys.add(dedupeKey)

        collectedEntries.push({
          issueKey: issue.key,
          issueSummary: issue.fields.summary,
          fieldLabel: fieldDef.fieldLabel,
          changeType: fieldDef.changeType,
          fromValue: changeItem.fromString ?? '—',
          toValue: changeItem.toString ?? '—',
          changedBy: history.author.displayName,
          changedAt: history.created,
        })
      }
    }
  }

  collectedEntries.sort((entryA, entryB) => entryB.changedAt.localeCompare(entryA.changedAt))
  return collectedEntries
}

/**
 * Scans a set of Jira changelog issues and returns ScopeChangeEntry records for
 * every matching field change that occurred on or after the given cutoff date.
 * Shared by both single-team and ART combined scope change loaders.
 */
function extractScopeEntries(
  issues: ChangelogIssue[],
  targetFieldName: 'fix version' | 'sprint',
  changeType: 'fixVersion' | 'sprint',
  cutoffDate: Date,
): ScopeChangeEntry[] {
  const collectedEntries: ScopeChangeEntry[] = []

  for (const issue of issues) {
    for (const history of issue.changelog?.histories ?? []) {
      // Skip changelog entries that fall outside the requested time window
      if (new Date(history.created) < cutoffDate) continue

      for (const changeItem of history.items) {
        if (changeItem.field.toLowerCase() !== targetFieldName) continue
        // Only include changes that set a new value (not removals)
        if (!changeItem.toString) continue

        collectedEntries.push({
          issueKey: issue.key,
          issueSummary: issue.fields.summary,
          issueType: issue.fields.issuetype?.name ?? 'Unknown',
          changeType,
          fromValue: changeItem.fromString ?? '—',
          toValue: changeItem.toString,
          changedBy: history.author.displayName,
          changedAt: history.created,
        })
      }
    }
  }

  return collectedEntries
}

// ── Hook ──

/** Provides all reactive state and action callbacks for the Reports Hub view. */
export function useReportsHubState(): { state: ReportsHubState; actions: ReportsHubActions } {
  const [activeTab, setActiveTab] = useState<ReportsHubTab>('dashboard')
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
  const [scopeChangeEntries, setScopeChangeEntries] = useState<ScopeChangeEntry[]>([])
  const [isLoadingScopeChange, setIsLoadingScopeChange] = useState(false)
  const [scopeChangeError, setScopeChangeError] = useState<string | null>(null)
  const [scopeChangeProjectKey, setScopeChangeProjectKey] = useState('')
  const [scopeChangeDaysBack, setScopeChangeDaysBack] = useState(14)
  const [hasScopeChangeGenerated, setHasScopeChangeGenerated] = useState(false)
  const [isArtCombinedMode, setIsArtCombinedMode] = useState(false)
  const [artCombinedResults, setArtCombinedResults] = useState<ArtTeamScopeResult[]>([])
  const [isLoadingArtCombined, setIsLoadingArtCombined] = useState(false)
  const [artCombinedError, setArtCombinedError] = useState<string | null>(null)
  const [artCombinedDaysBack, setArtCombinedDaysBack] = useState(7)
  const [featureChangeEntries, setFeatureChangeEntries] = useState<FeatureChangeEntry[]>([])
  const [isLoadingFeatureChange, setIsLoadingFeatureChange] = useState(false)
  const [featureChangeError, setFeatureChangeError] = useState<string | null>(null)
  const [featureChangeDaysBack, setFeatureChangeDaysBack] = useState(14)
  const [hasFeatureChangeGenerated, setHasFeatureChangeGenerated] = useState(false)
  const [artCombinedFeatureResults, setArtCombinedFeatureResults] = useState<ArtTeamFeatureChangeResult[]>([])
  const [isLoadingArtCombinedFeature, setIsLoadingArtCombinedFeature] = useState(false)
  const [artCombinedFeatureError, setArtCombinedFeatureError] = useState<string | null>(null)

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
    scopeChangeEntries,
    isLoadingScopeChange,
    scopeChangeError,
    scopeChangeProjectKey,
    scopeChangeDaysBack,
    hasScopeChangeGenerated,
    isArtCombinedMode,
    artCombinedResults,
    isLoadingArtCombined,
    artCombinedError,
    artCombinedDaysBack,
    featureChangeEntries,
    isLoadingFeatureChange,
    featureChangeError,
    featureChangeDaysBack,
    hasFeatureChangeGenerated,
    artCombinedFeatureResults,
    isLoadingArtCombinedFeature,
    artCombinedFeatureError,
  }

  async function loadFeatures(): Promise<void> {
    const featureLoadStartedAt = Date.now()
    setIsLoadingFeatures(true)
    setFeaturesError(null)
    const featureScopeProjectKeys = readArtFeatureScopeSettings().featureProjectKeys
    logFeatureLoadInfo('Starting feature load', {
      artTeamCount: currentArtTeams.length,
      artTeamNames: currentArtTeams.map((teamConfig) => teamConfig.name),
      featureScopeProjectKeys,
    })
    const featureResultSet = await Promise.allSettled([
      fetchIssuesAcrossTeams(
        currentArtTeams,
        buildFeatureReportJql,
      ),
      fetchIssuesAcrossProjectKeys(
        featureScopeProjectKeys,
        buildFeatureReportJql,
      ),
    ])
    try {
      const [teamScopedFeatureResult, scopedProjectFeatureResult] = featureResultSet
      const teamScopedFeatures = teamScopedFeatureResult.status === 'fulfilled'
        ? teamScopedFeatureResult.value
        : []
      const scopedProjectFeatures = scopedProjectFeatureResult.status === 'fulfilled'
        ? scopedProjectFeatureResult.value
        : []
      logFeatureLoadInfo('Project feature queries completed', {
        teamQueryStatus: teamScopedFeatureResult.status,
        teamFeatureCount: teamScopedFeatures.length,
        featureScopeQueryStatus: scopedProjectFeatureResult.status,
        featureScopeFeatureCount: scopedProjectFeatures.length,
      })
      let mergedFeatureIssues = mergeFeatureIssuesByKey(teamScopedFeatures, scopedProjectFeatures)

      const errorMessages = extractRejectedMessages(featureResultSet, LOAD_FEATURES_FAILURE)
      if (mergedFeatureIssues.length === 0 && currentArtTeams.length > 0) {
        logFeatureLoadWarning('No project-level features found, activating bottom-up fallback', {
          artTeamCount: currentArtTeams.length,
          artTeamNames: currentArtTeams.map((teamConfig) => teamConfig.name),
        })
        const bottomUpFeatureResult = await Promise.allSettled([
          fetchBottomUpFeaturesAcrossTeams(currentArtTeams),
        ])
        const loadedBottomUpFeatures = bottomUpFeatureResult[0]?.status === 'fulfilled'
          ? bottomUpFeatureResult[0].value
          : []
        mergedFeatureIssues = mergeFeatureIssuesByKey(mergedFeatureIssues, loadedBottomUpFeatures)
        errorMessages.push(...extractRejectedMessages(bottomUpFeatureResult, LOAD_BOTTOM_UP_FEATURES_FAILURE))
        logFeatureLoadInfo('Bottom-up fallback completed', {
          fallbackStatus: bottomUpFeatureResult[0]?.status ?? 'unknown',
          fallbackFeatureCount: loadedBottomUpFeatures.length,
        })
      }

      setFeatures(mergedFeatureIssues)

      if (errorMessages.length > 0) {
        const uniqueErrorMessages = Array.from(new Set(errorMessages))
        setFeaturesError(uniqueErrorMessages.join('; '))
        logFeatureLoadWarning('Feature load completed with errors', {
          errorMessages: uniqueErrorMessages,
        })
      }
      logFeatureLoadInfo('Feature load completed', {
        finalFeatureCount: mergedFeatureIssues.length,
        loadDurationMs: Date.now() - featureLoadStartedAt,
      })
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
        buildDefectReportJql,
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
        buildRiskReportJql,
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
      const storyResults = await fetchIssuesAcrossTeams(currentArtTeams, buildStoryReportJql)
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

  /** Fetches changelog events for the given (or previously-set) project key, extracting sprint and fixVersion changes. */
  async function loadScopeChanges(projectKeyOverride?: string): Promise<void> {
    const trimmedProjectKey = (projectKeyOverride ?? scopeChangeProjectKey).trim()
    if (!trimmedProjectKey) {
      setScopeChangeError('No project key — select a team first.')
      return
    }
    setIsLoadingScopeChange(true)
    setScopeChangeError(null)
    setHasScopeChangeGenerated(false)
    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - scopeChangeDaysBack)
      const cutoffDateString = cutoffDate.toISOString().slice(0, 10)

      // Jira's history-search JQL supports `fixVersion changed AFTER` but NOT `sprint changed AFTER`
      // (sprint is an Agile-managed field excluded from history predicates). We run two separate queries:
      //   1. fixVersion changed — use the native history predicate for accurate results.
      //   2. Sprint changed — use `updated >= date` to catch recently-touched issues, then filter
      //      the inline changelog client-side for sprint field changes in the window.
      const fixVersionJql = `project = "${trimmedProjectKey}" AND fixVersion changed AFTER "${cutoffDateString}"`
      const sprintJql = `project = "${trimmedProjectKey}" AND updated >= "${cutoffDateString}"`

      const [fixVersionResponse, sprintResponse] = await Promise.all([
        jiraGet<{ issues?: ChangelogIssue[] }>(
          `/rest/api/2/search?jql=${encodeURIComponent(fixVersionJql)}&fields=summary,issuetype&expand=changelog&maxResults=200`,
        ).catch(() => ({ issues: [] as ChangelogIssue[] })),
        jiraGet<{ issues?: ChangelogIssue[] }>(
          `/rest/api/2/search?jql=${encodeURIComponent(sprintJql)}&fields=summary,issuetype&expand=changelog&maxResults=200`,
        ).catch(() => ({ issues: [] as ChangelogIssue[] })),
      ])

      const releaseEntries = extractScopeEntries(fixVersionResponse.issues ?? [], 'fix version', 'fixVersion', cutoffDate)
      const sprintEntries = extractScopeEntries(sprintResponse.issues ?? [], 'sprint', 'sprint', cutoffDate)
      const collectedEntries = [...releaseEntries, ...sprintEntries]

      // Most-recent changes first within each section.
      collectedEntries.sort((entryA, entryB) => entryB.changedAt.localeCompare(entryA.changedAt))
      setScopeChangeEntries(collectedEntries)
      setHasScopeChangeGenerated(true)
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Failed to load scope changes.'
      setScopeChangeError(errorMessage)
    } finally {
      setIsLoadingScopeChange(false)
    }
  }

  /**
   * Fetches scope change data for all configured ART teams in parallel and stores
   * the combined results for display in the ART Combined mode of the Scope Change tab.
   */
  const loadArtCombinedScopeChanges = useCallback(async (): Promise<void> => {
    // Read ART teams from localStorage — re-read at call time to pick up any changes
    // since the component mounted (same storage key used by the rest of the Reports Hub).
    let rawArtTeams: Array<{ id: string; name: string; projectKey?: string }> = []
    try {
      const rawStoredValue = localStorage.getItem(ART_TEAMS_STORAGE_KEY)
      if (rawStoredValue) {
        rawArtTeams = JSON.parse(rawStoredValue) as typeof rawArtTeams
      }
    } catch {
      setArtCombinedError('Could not read ART teams from localStorage.')
      return
    }

    // Only teams with a project key can be queried; filter out teams missing one.
    const teamsWithProjectKeys = rawArtTeams.filter(
      (team) => typeof team.projectKey === 'string' && team.projectKey.trim() !== '',
    )
    if (teamsWithProjectKeys.length === 0) {
      setArtCombinedError(
        'No ART teams with project keys configured. Set project keys in ART View → Settings.',
      )
      return
    }

    setIsLoadingArtCombined(true)
    setArtCombinedError(null)
    setArtCombinedResults([])

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - scopeChangeDaysBack)
    const cutoffIso = cutoffDate.toISOString().slice(0, 10)

    // Query all teams in parallel — each team's result is independent so failures
    // are captured per-team rather than aborting the entire combined run.
    const teamResults = await Promise.all(
      teamsWithProjectKeys.map(async (team): Promise<ArtTeamScopeResult> => {
        const projectKey = team.projectKey!

        try {
          const fixVersionJql = `project = "${projectKey}" AND fixVersion changed AFTER "${cutoffIso}"`
          const sprintJql = `project = "${projectKey}" AND updated >= "${cutoffIso}"`
          const changelogFields = 'summary,issuetype'
          const maxResults = 200

          const [fixVersionResponse, sprintResponse] = await Promise.all([
            fetch(
              `/jira-proxy/rest/api/2/search?jql=${encodeURIComponent(fixVersionJql)}&fields=${changelogFields}&expand=changelog&maxResults=${maxResults}`,
            ).then((response) => response.json() as Promise<{ issues?: ChangelogIssue[] }>),
            fetch(
              `/jira-proxy/rest/api/2/search?jql=${encodeURIComponent(sprintJql)}&fields=${changelogFields}&expand=changelog&maxResults=${maxResults}`,
            ).then((response) => response.json() as Promise<{ issues?: ChangelogIssue[] }>),
          ])

          const releaseEntries = extractScopeEntries(
            fixVersionResponse.issues ?? [],
            'fix version',
            'fixVersion',
            cutoffDate,
          )
          const sprintEntries = extractScopeEntries(
            sprintResponse.issues ?? [],
            'sprint',
            'sprint',
            cutoffDate,
          )

          return { teamName: team.name, projectKey, releaseEntries, sprintEntries, error: null }
        } catch (teamError) {
          return {
            teamName: team.name,
            projectKey,
            releaseEntries: [],
            sprintEntries: [],
            error: teamError instanceof Error ? teamError.message : 'Query failed',
          }
        }
      }),
    )

    setArtCombinedResults(teamResults)
    setIsLoadingArtCombined(false)
  }, [scopeChangeDaysBack])

  /**
   * Dispatches to the correct scope change query based on the current team filter.
   * Empty team filter (All Teams) runs ART Combined; a specific team resolves its
   * project key and runs a single-team query.
   */
  async function generateScopeChange(): Promise<void> {
    if (teamFilter === '') {
      setIsArtCombinedMode(true)
      await loadArtCombinedScopeChanges()
    } else {
      setIsArtCombinedMode(false)
      const matchedTeam = artTeams.find((artTeam) => artTeam.name === teamFilter)
      if (!matchedTeam?.projectKey) {
        setScopeChangeError(`No project key configured for "${teamFilter}". Check ART View Settings.`)
        return
      }
      await loadScopeChanges(matchedTeam.projectKey)
    }
  }

  /** Fetches Feature-type issues with the given Jira label, extracting changes to PI-planning fields. */
  async function loadFeatureChanges(jiraLabel: string): Promise<void> {
    const trimmedLabel = jiraLabel.trim()
    if (!trimmedLabel) {
      setFeatureChangeError('No Jira label configured for this team. Set it in Admin Hub → Label Mapping.')
      return
    }
    setIsLoadingFeatureChange(true)
    setFeatureChangeError(null)
    setHasFeatureChangeGenerated(false)
    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - featureChangeDaysBack)
      const cutoffDateString = cutoffDate.toISOString().slice(0, 10)

      // Query Feature-type issues by team label with changelog expanded for client-side extraction.
      const featureJql = `type = Feature AND labels in ("${trimmedLabel}") AND updated >= "${cutoffDateString}" ORDER BY updated DESC`
      const response = await jiraGet<{ issues?: ChangelogIssue[] }>(
        `/rest/api/2/search?jql=${encodeURIComponent(featureJql)}&fields=summary,issuetype&expand=changelog&maxResults=200`,
      )

      const entries = extractFeatureChangeEntries(response.issues ?? [], cutoffDate)
      setFeatureChangeEntries(entries)
      setHasFeatureChangeGenerated(true)
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Failed to load feature changes.'
      setFeatureChangeError(errorMessage)
    } finally {
      setIsLoadingFeatureChange(false)
    }
  }

  /**
   * Fetches Feature-type changelog events for all ART teams using a single label-based query,
   * then groups results by team by matching issue labels to configured team labels.
   */
  const loadArtCombinedFeatureChanges = useCallback(async (): Promise<void> => {
    let rawArtTeams: Array<{ id?: string; name?: string; projectKey?: string; jiraLabel?: string }> = []
    try {
      const rawStoredValue = localStorage.getItem(ART_TEAMS_STORAGE_KEY)
      if (rawStoredValue) {
        rawArtTeams = JSON.parse(rawStoredValue) as typeof rawArtTeams
      }
    } catch {
      setArtCombinedFeatureError('Could not read ART teams from localStorage.')
      return
    }

    // Only teams with a configured Jira label can participate in the label-based query.
    const teamsWithLabels = rawArtTeams.filter(
      (team) =>
        typeof team.name === 'string' && team.name.trim() !== '' &&
        typeof team.jiraLabel === 'string' && team.jiraLabel.trim() !== '',
    )
    if (teamsWithLabels.length === 0) {
      setArtCombinedFeatureError(
        'No ART teams have a Jira label configured. Set labels in Admin Hub → Label Mapping.',
      )
      return
    }

    setIsLoadingArtCombinedFeature(true)
    setArtCombinedFeatureError(null)
    setArtCombinedFeatureResults([])

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - featureChangeDaysBack)
    const cutoffIso = cutoffDate.toISOString().slice(0, 10)

    // Single query covering all team labels — one round-trip instead of one per team.
    const allLabelsList = teamsWithLabels.map((team) => `"${team.jiraLabel!.trim()}"`).join(', ')
    const featureJql = `type = Feature AND labels in (${allLabelsList}) AND updated >= "${cutoffIso}" ORDER BY updated DESC`

    try {
      const response = await jiraGet<{ issues?: ChangelogIssue[] }>(
        `/rest/api/2/search?jql=${encodeURIComponent(featureJql)}&fields=summary,issuetype,labels&expand=changelog&maxResults=200`,
      )
      const allIssues = response.issues ?? []

      // Map each configured label to its team name for O(1) grouping of issues.
      const labelToTeamName = new Map(
        teamsWithLabels.map((team) => [team.jiraLabel!.trim().toLowerCase(), team.name!.trim()]),
      )
      const teamEntriesMap = new Map<string, FeatureChangeEntry[]>(
        teamsWithLabels.map((team) => [team.name!.trim(), []]),
      )

      for (const issue of allIssues) {
        const issueLabels = issue.fields.labels ?? []
        const matchingTeamNames = issueLabels
          .map((label) => labelToTeamName.get(label.toLowerCase()))
          .filter((teamName): teamName is string => teamName !== undefined)

        if (matchingTeamNames.length === 0) continue

        const issueEntries = extractFeatureChangeEntries([issue], cutoffDate)
        for (const teamName of matchingTeamNames) {
          teamEntriesMap.get(teamName)?.push(...issueEntries)
        }
      }

      const teamResults: ArtTeamFeatureChangeResult[] = teamsWithLabels.map((team) => ({
        teamName:   team.name!.trim(),
        projectKey: team.jiraLabel!.trim(),
        entries:    teamEntriesMap.get(team.name!.trim()) ?? [],
        error:      null,
      }))

      setArtCombinedFeatureResults(teamResults)
    } catch (combinedError) {
      const errorMessage = combinedError instanceof Error ? combinedError.message : 'Query failed'
      setArtCombinedFeatureError(errorMessage)
    } finally {
      setIsLoadingArtCombinedFeature(false)
    }
  }, [featureChangeDaysBack])

  /**
   * Routes to single-team or ART Combined feature change query based on the teamFilter value.
   * Empty team filter runs ART Combined across all teams; a specific team resolves its
   * project key and runs a single-team Epic changelog query.
   */
  async function generateFeatureChange(): Promise<void> {
    if (teamFilter === '') {
      await loadArtCombinedFeatureChanges()
    } else {
      const matchedTeam = artTeams.find((artTeam) => artTeam.name === teamFilter)
      if (!matchedTeam?.jiraLabel) {
        setFeatureChangeError(`No Jira label configured for "${teamFilter}". Set it in Admin Hub → Label Mapping.`)
        return
      }
      await loadFeatureChanges(matchedTeam.jiraLabel)
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
    setScopeChangeProjectKey,
    setScopeChangeDaysBack,
    loadScopeChanges,
    loadArtCombinedScopeChanges,
    setArtCombinedMode: setIsArtCombinedMode,
    setArtCombinedDaysBack,
    generateScopeChange,
    setFeatureChangeDaysBack,
    generateFeatureChange,
    copyReport,
  }

  return { state, actions }
}
