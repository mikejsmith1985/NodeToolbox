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

// ── Type definitions ──

/** The three reporting tabs available in the Reports Hub. */
export type ReportsHubTab = 'features' | 'defects' | 'risks'

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

  async function loadAllReports(): Promise<void> {
    setLastGeneratedAt(new Date().toISOString())
    await Promise.all([loadFeatures(), loadDefects(), loadRisks()])
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
    copyReport,
  }

  return { state, actions }
}
