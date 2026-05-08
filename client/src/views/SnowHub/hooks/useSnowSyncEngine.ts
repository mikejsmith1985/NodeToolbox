// useSnowSyncEngine.ts — State machine and sync logic for the PRB Sync Monitor tab.
// Manages scheduled Jira→SNow synchronisation, issue tracking, and activity logging.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';

// ── localStorage keys ──
const STORAGE_KEY_SETTINGS = 'tbxPRBSyncSettings';
const STORAGE_KEY_STATUS_MAP = 'tbxPrbSyncMappings';
const STORAGE_KEY_ISSUE_STATE = 'tbxPrbSyncState';

// ── Timing and log constants ──
const DEFAULT_JQL_TEMPLATE = 'issuetype = Problem AND status changed AFTER -{interval}h';
const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_WORK_NOTE_PREFIX = '[Jira Sync]';
const MAX_LOG_ENTRIES = 200;
const COUNTDOWN_TICK_MS = 10_000;
const FALLBACK_LOOKBACK_HOURS = 24;

// ── PRB number pattern: 7-10 digit number prefixed by PRB ──
const PRB_NUMBER_PATTERN = /\bPRB\d{7,10}\b/i;

// ── Jira wiki macro pattern stripped from comment bodies before syncing to SNow ──
const JIRA_MACRO_PATTERN = /\{[^}]+\}/g;

/** Maps SNow problem state codes to their human-readable labels. */
export const SNOW_PROBLEM_STATES: Record<string, string> = {
  '101': 'New',
  '102': 'Assess',
  '103': 'Root Cause Analysis',
  '104': 'Fix in Progress',
  '106': 'Resolved',
  '107': 'Closed',
};

/**
 * Default mappings from lowercase Jira status names to SNow state codes.
 * Used as a fallback when the user's custom StatusMap has no entry for a given status.
 */
const DEFAULT_STATUS_DEFAULTS: Record<string, string> = {
  'to do': '101',
  open: '101',
  new: '101',
  backlog: '101',
  'in progress': '104',
  'in development': '104',
  'fix in progress': '104',
  'in review': '102',
  testing: '102',
  assess: '102',
  'in qa': '102',
  'in rca': '103',
  'root cause analysis': '103',
  done: '106',
  resolved: '106',
  fixed: '106',
  closed: '107',
  cancelled: '107',
  "won't fix": '107',
  'wont fix': '107',
};

// ── Exported types ──

export type LogEntryType = 'info' | 'status' | 'comment' | 'error';

export interface LogEntry {
  timestamp: string;
  type: LogEntryType;
  jiraKey: string;
  prbNumber: string;
  detail: string;
}

export interface SyncSettings {
  jqlTemplate: string;
  intervalMin: number;
  workNotePrefix: string;
  shouldSyncComments: boolean;
  lastCheckTime: string | null;
}

export type StatusMap = Record<string, string>;

export interface TrackedIssueState {
  prbNumber: string;
  lastStatus: string;
  lastCommentCount: number;
  lastSynced: string;
}

export type IssueStateMap = Record<string, TrackedIssueState>;

export interface SyncEngineState {
  isRunning: boolean;
  logEntries: LogEntry[];
  settings: SyncSettings;
  statusMap: StatusMap;
  jiraStatuses: string[];
  isFetchingStatuses: boolean;
  nextRunAt: number | null;
  trackedIssueCount: number;
}

export interface SyncEngineActions {
  startSync: () => void;
  stopSync: () => void;
  runNow: () => Promise<void>;
  clearLog: () => void;
  updateSettings: (partial: Partial<SyncSettings>) => void;
  saveSettings: () => void;
  fetchJiraStatuses: () => Promise<void>;
  saveStatusMappings: (map: StatusMap) => void;
  exportPs1: () => void;
}

// ── Internal Jira response shapes for the sync engine ──

interface JiraCommentBody {
  body: string;
  author: { displayName: string };
  created: string;
}

interface SyncJiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    comment: { total: number; comments: JiraCommentBody[] };
    updated: string;
  };
}

interface JiraSearchResult {
  issues: SyncJiraIssue[];
}

interface JiraStatusEntry {
  name?: string;
}

// ── Settings persistence helpers ──

function createDefaultSettings(): SyncSettings {
  return {
    jqlTemplate: DEFAULT_JQL_TEMPLATE,
    intervalMin: DEFAULT_INTERVAL_MINUTES,
    workNotePrefix: DEFAULT_WORK_NOTE_PREFIX,
    shouldSyncComments: true,
    lastCheckTime: null,
  };
}

/** Loads SyncSettings from localStorage, returning defaults when absent or corrupted. */
function loadSettings(): SyncSettings {
  try {
    const rawValue = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!rawValue) return createDefaultSettings();
    return JSON.parse(rawValue) as SyncSettings;
  } catch {
    return createDefaultSettings();
  }
}

/** Writes SyncSettings to localStorage. */
function persistSettings(settings: SyncSettings): void {
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
}

/** Loads StatusMap from localStorage, returning an empty map on failure. */
function loadStatusMap(): StatusMap {
  try {
    const rawValue = localStorage.getItem(STORAGE_KEY_STATUS_MAP);
    if (!rawValue) return {};
    return JSON.parse(rawValue) as StatusMap;
  } catch {
    return {};
  }
}

/** Writes StatusMap to localStorage. */
function persistStatusMap(statusMap: StatusMap): void {
  localStorage.setItem(STORAGE_KEY_STATUS_MAP, JSON.stringify(statusMap));
}

/** Loads IssueStateMap from localStorage, returning an empty map on failure. */
function loadIssueState(): IssueStateMap {
  try {
    const rawValue = localStorage.getItem(STORAGE_KEY_ISSUE_STATE);
    if (!rawValue) return {};
    return JSON.parse(rawValue) as IssueStateMap;
  } catch {
    return {};
  }
}

/** Writes IssueStateMap to localStorage. */
function persistIssueState(issueState: IssueStateMap): void {
  localStorage.setItem(STORAGE_KEY_ISSUE_STATE, JSON.stringify(issueState));
}

// ── JQL query builder ──

/**
 * Replaces `{lastCheck}` in the JQL template with a Jira-formatted datetime string.
 * Falls back to 24 hours ago when lastCheckTime is null so the first run always catches recent changes.
 */
export function buildJqlQuery(template: string, lastCheckTime: string | null): string {
  const checkTime = lastCheckTime
    ? new Date(lastCheckTime)
    : new Date(Date.now() - FALLBACK_LOOKBACK_HOURS * 60 * 60 * 1000);
  // Jira expects "YYYY-MM-DD HH:MM" — slice the ISO string to 16 chars then swap the T separator
  const formattedDateTime = checkTime.toISOString().slice(0, 16).replace('T', ' ');
  return template.replace('{lastCheck}', formattedDateTime);
}

/**
 * Returns the full Jira search API path for the given JQL, requesting only the fields
 * needed by the sync engine to keep the response payload small.
 */
export function buildJiraSearchPath(jql: string): string {
  const encodedJql = encodeURIComponent(jql);
  return `/rest/api/2/search?jql=${encodedJql}&fields=summary,status,comment,updated&maxResults=100`;
}

// ── SNow API helpers ──

type LogAppender = (entry: Omit<LogEntry, 'timestamp'>) => void;

/**
 * Looks up the SNow sys_id for a problem record by number.
 * Returns null when the record cannot be found so callers can log a warning.
 */
async function fetchSnowProblemSysId(prbNumber: string): Promise<string | null> {
  try {
    const encodedNumber = encodeURIComponent(prbNumber);
    const response = await snowFetch<{ result: Array<{ sys_id: string }> }>(
      `/api/now/table/problem?sysparm_query=number=${encodedNumber}&sysparm_limit=1&sysparm_fields=sys_id`,
    );
    return response.result[0]?.sys_id ?? null;
  } catch {
    return null;
  }
}

/** PATCHes a SNow problem record with the given body payload. */
async function patchSnowProblem(sysId: string, body: Record<string, unknown>): Promise<void> {
  await snowFetch(`/api/now/table/problem/${sysId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Sync logic ──

/**
 * Syncs a Jira status change to the corresponding SNow problem record by fetching the
 * sys_id, building a formatted work note, and PATCHing both the state code and work notes.
 */
async function syncIssueStatusChange(
  jiraKey: string,
  prbNumber: string,
  oldStatus: string,
  newStatus: string,
  settings: SyncSettings,
  statusMap: StatusMap,
  appendEntry: LogAppender,
): Promise<void> {
  const sysId = await fetchSnowProblemSysId(prbNumber);
  if (!sysId) {
    appendEntry({
      type: 'error',
      jiraKey,
      prbNumber,
      detail: `Could not find SNow record for ${prbNumber}`,
    });
    return;
  }

  const snStateCode = statusMap[newStatus] ?? DEFAULT_STATUS_DEFAULTS[newStatus.toLowerCase()] ?? '';
  const workNote = `${settings.workNotePrefix} Status changed from "${oldStatus}" to "${newStatus}" in Jira.`;

  const patchBody: Record<string, unknown> = { work_notes: workNote };
  if (snStateCode) {
    patchBody.state = snStateCode;
  }

  await patchSnowProblem(sysId, patchBody);

  const stateLabel = snStateCode
    ? ` → SNow state ${SNOW_PROBLEM_STATES[snStateCode] ?? snStateCode}`
    : '';
  appendEntry({
    type: 'status',
    jiraKey,
    prbNumber,
    detail: `Status: "${oldStatus}" → "${newStatus}"${stateLabel}`,
  });
}

/**
 * Syncs new Jira comments to the SNow problem record as work notes.
 * Strips Jira wiki macros before posting so the note reads cleanly in SNow.
 */
async function syncIssueComments(
  jiraKey: string,
  prbNumber: string,
  newComments: JiraCommentBody[],
  settings: SyncSettings,
  appendEntry: LogAppender,
): Promise<void> {
  const sysId = await fetchSnowProblemSysId(prbNumber);
  if (!sysId) {
    appendEntry({
      type: 'error',
      jiraKey,
      prbNumber,
      detail: `Could not find SNow record for ${prbNumber} (comment sync)`,
    });
    return;
  }

  for (const comment of newComments) {
    const cleanBody = comment.body.replace(JIRA_MACRO_PATTERN, '').trim();
    const workNote = `${settings.workNotePrefix} [${comment.author.displayName}]: ${cleanBody}`;
    await patchSnowProblem(sysId, { work_notes: workNote });
    appendEntry({
      type: 'comment',
      jiraKey,
      prbNumber,
      detail: `Comment by ${comment.author.displayName} synced`,
    });
  }
}

/**
 * Processes a single Jira issue: extracts the PRB number, detects status/comment changes,
 * and syncs those changes to the SNow problem record. Returns the updated IssueStateMap
 * so the caller can accumulate state across all issues in a search result.
 */
async function processJiraIssue(
  issue: SyncJiraIssue,
  settings: SyncSettings,
  statusMap: StatusMap,
  issueState: IssueStateMap,
  appendEntry: LogAppender,
): Promise<IssueStateMap> {
  const prbMatch = PRB_NUMBER_PATTERN.exec(issue.fields.summary);
  if (!prbMatch) {
    return issueState;
  }

  const prbNumber = prbMatch[0].toUpperCase();
  const currentStatus = issue.fields.status.name;
  const currentCommentCount = issue.fields.comment.total;
  const prevState = issueState[issue.key];

  if (!prevState) {
    // First time seeing this issue — start tracking it without syncing anything yet
    appendEntry({
      type: 'info',
      jiraKey: issue.key,
      prbNumber,
      detail: `Now tracking ${issue.key} → ${prbNumber}`,
    });
    return {
      ...issueState,
      [issue.key]: {
        prbNumber,
        lastStatus: currentStatus,
        lastCommentCount: currentCommentCount,
        lastSynced: new Date().toISOString(),
      },
    };
  }

  if (prevState.lastStatus !== currentStatus) {
    await syncIssueStatusChange(
      issue.key,
      prbNumber,
      prevState.lastStatus,
      currentStatus,
      settings,
      statusMap,
      appendEntry,
    );
  }

  if (settings.shouldSyncComments && currentCommentCount > prevState.lastCommentCount) {
    const newComments = issue.fields.comment.comments.slice(prevState.lastCommentCount);
    await syncIssueComments(issue.key, prbNumber, newComments, settings, appendEntry);
  }

  return {
    ...issueState,
    [issue.key]: {
      ...prevState,
      prbNumber,
      lastStatus: currentStatus,
      lastCommentCount: currentCommentCount,
      lastSynced: new Date().toISOString(),
    },
  };
}

// ── PS1 script generation ──

/**
 * Generates a standalone PowerShell script that replicates the browser sync engine logic,
 * suitable for running as a Windows scheduled task outside the browser.
 */
export function generatePs1Script(settings: SyncSettings, statusMap: StatusMap): string {
  const stateMapEntries = Object.entries(statusMap)
    .map(([jiraStatus, snowStateCode]) => `  "${jiraStatus}" = "${snowStateCode}"`)
    .join('\n');

  return `# prb-sync.ps1 — Jira-to-SNow PRB sync script generated by NodeToolbox
# Run once: .\\prb-sync.ps1 -Once
# Run on schedule: .\\prb-sync.ps1
param([switch]$Once)

$Prefix      = '${settings.workNotePrefix}'
$IntervalMin = ${settings.intervalMin}
$JqlTemplate = '${settings.jqlTemplate}'

$StateMap = @{
${stateMapEntries}
}

# Set these environment variables before running, or replace with literals below
$JiraBase  = $env:JIRA_BASE_URL
$JiraUser  = $env:JIRA_USERNAME
$JiraToken = $env:JIRA_API_TOKEN
$SnowBase  = $env:SNOW_BASE_URL
$SnowUser  = $env:SNOW_USERNAME
$SnowPass  = $env:SNOW_PASSWORD

function Get-BasicAuthHeader([string]$User, [string]$Pass) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("\${User}:\${Pass}"))
  return @{ Authorization = "Basic $encoded" }
}

function Get-SnowProblemSysId([string]$PrbNumber) {
  $uri = "$SnowBase/api/now/table/problem?sysparm_query=number=$PrbNumber&sysparm_limit=1&sysparm_fields=sys_id"
  $headers = Get-BasicAuthHeader $SnowUser $SnowPass
  $headers['Accept'] = 'application/json'
  try {
    $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
    return $resp.result[0].sys_id
  } catch {
    return $null
  }
}

function Update-SnowProblem([string]$SysId, [hashtable]$Body) {
  $uri = "$SnowBase/api/now/table/problem/$SysId"
  $headers = Get-BasicAuthHeader $SnowUser $SnowPass
  $headers['Content-Type'] = 'application/json'
  $headers['Accept']       = 'application/json'
  Invoke-RestMethod -Uri $uri -Headers $headers -Method Patch -Body ($Body | ConvertTo-Json) | Out-Null
}

function Sync-Now {
  $lastCheck = (Get-Date).AddMinutes(-$IntervalMin).ToString('yyyy-MM-dd HH:mm')
  $jql = $JqlTemplate -replace '\{lastCheck\}', $lastCheck
  $encoded = [Uri]::EscapeDataString($jql)
  $uri = "$JiraBase/rest/api/2/search?jql=$encoded&fields=summary,status,comment,updated&maxResults=100"
  $headers = Get-BasicAuthHeader $JiraUser $JiraToken
  $headers['Accept'] = 'application/json'
  $searchResult = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get

  foreach ($issue in $searchResult.issues) {
    $prbMatch = [regex]::Match($issue.fields.summary, '\bPRB\d{7,10}\b', 'IgnoreCase')
    if (-not $prbMatch.Success) { continue }
    $prbNumber = $prbMatch.Value.ToUpper()

    $sysId = Get-SnowProblemSysId $prbNumber
    if (-not $sysId) {
      Write-Host "[WARN] Could not find SNow record for $prbNumber"
      continue
    }

    $status   = $issue.fields.status.name
    $snState  = $StateMap[$status]
    $workNote = "$Prefix Status = $status for $($issue.key)"
    $patchBody = @{ work_notes = $workNote }
    if ($snState) { $patchBody.state = $snState }
    Update-SnowProblem $sysId $patchBody
    Write-Host "[SYNC] $($issue.key) -> $prbNumber  status=$status"
  }
}

if ($Once) {
  Sync-Now
} else {
  while ($true) {
    Sync-Now
    Start-Sleep -Seconds ($IntervalMin * 60)
  }
}
`;
}

/**
 * Triggers a browser download of the generated PowerShell sync script as prb-sync.ps1.
 */
export function downloadPs1File(scriptContent: string): void {
  const blob = new Blob([scriptContent], { type: 'text/plain' });
  const downloadUrl = URL.createObjectURL(blob);
  const anchorElement = document.createElement('a');
  anchorElement.href = downloadUrl;
  anchorElement.download = 'prb-sync.ps1';
  anchorElement.click();
  URL.revokeObjectURL(downloadUrl);
}

// ── Hook ──

/**
 * Provides the complete state machine and action set for the PRB Sync Monitor tab.
 * Manages scheduled Jira→SNow syncing, issue tracking, and a capped activity log.
 */
export function useSnowSyncEngine(): { state: SyncEngineState; actions: SyncEngineActions } {
  const [isRunning, setIsRunning] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [settings, setSettings] = useState<SyncSettings>(() => loadSettings());
  const [statusMap, setStatusMap] = useState<StatusMap>(() => loadStatusMap());
  const [jiraStatuses, setJiraStatuses] = useState<string[]>([]);
  const [isFetchingStatuses, setIsFetchingStatuses] = useState(false);
  const [nextRunAt, setNextRunAt] = useState<number | null>(null);
  const [trackedIssueCount, setTrackedIssueCount] = useState<number>(
    () => Object.keys(loadIssueState()).length,
  );

  // Refs keep timer callbacks from capturing stale closure values
  const settingsRef = useRef(settings);
  const statusMapRef = useRef(statusMap);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runNowRef = useRef<() => Promise<void>>(async () => {});

  // Mirror state into refs on every render so timers always see current values
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    statusMapRef.current = statusMap;
  }, [statusMap]);

  const appendLogEntry = useCallback((entry: Omit<LogEntry, 'timestamp'>) => {
    const fullEntry: LogEntry = { ...entry, timestamp: new Date().toISOString() };
    setLogEntries((prev) => [fullEntry, ...prev].slice(0, MAX_LOG_ENTRIES));
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
  }, []);

  const updateSettings = useCallback((partial: Partial<SyncSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...partial };
      // Keep the ref in sync immediately so timers use the updated value
      settingsRef.current = updated;
      return updated;
    });
  }, []);

  const saveSettings = useCallback(() => {
    persistSettings(settingsRef.current);
  }, []);

  const saveStatusMappings = useCallback((map: StatusMap) => {
    persistStatusMap(map);
    setStatusMap(map);
    statusMapRef.current = map;
  }, []);

  const fetchJiraStatuses = useCallback(async () => {
    setIsFetchingStatuses(true);
    try {
      const statusList = await jiraGet<JiraStatusEntry[]>('/rest/api/2/status');
      const uniqueNames = [
        ...new Set(statusList.map((entry) => entry.name).filter(Boolean) as string[]),
      ];
      setJiraStatuses(uniqueNames);
    } catch {
      appendLogEntry({
        type: 'error',
        jiraKey: '',
        prbNumber: '',
        detail: 'Failed to fetch Jira statuses',
      });
    } finally {
      setIsFetchingStatuses(false);
    }
  }, [appendLogEntry]);

  const runNow = useCallback(async () => {
    const currentSettings = settingsRef.current;
    const currentStatusMap = statusMapRef.current;
    const jqlQuery = buildJqlQuery(currentSettings.jqlTemplate, currentSettings.lastCheckTime);

    if (!jqlQuery.trim()) {
      appendLogEntry({
        type: 'error',
        jiraKey: '',
        prbNumber: '',
        detail: 'JQL template is empty — update settings and try again',
      });
      return;
    }

    try {
      const searchPath = buildJiraSearchPath(jqlQuery);
      const searchResult = await jiraGet<JiraSearchResult>(searchPath);
      let currentIssueState = loadIssueState();

      for (const issue of searchResult.issues) {
        currentIssueState = await processJiraIssue(
          issue,
          currentSettings,
          currentStatusMap,
          currentIssueState,
          appendLogEntry,
        );
      }

      persistIssueState(currentIssueState);
      setTrackedIssueCount(Object.keys(currentIssueState).length);

      const updatedSettings: SyncSettings = {
        ...currentSettings,
        lastCheckTime: new Date().toISOString(),
      };
      // Update both ref and state so the UI shows the latest check time
      settingsRef.current = updatedSettings;
      setSettings(updatedSettings);

      appendLogEntry({
        type: 'info',
        jiraKey: '',
        prbNumber: '',
        detail: `Search complete — ${searchResult.issues.length} issue(s) processed`,
      });
    } catch (unknownError) {
      const errorMessage =
        unknownError instanceof Error ? unknownError.message : 'Unknown error during sync';
      appendLogEntry({ type: 'error', jiraKey: '', prbNumber: '', detail: errorMessage });
    }
  }, [appendLogEntry]);

  // Keep the runNow ref in sync so the setInterval callback always invokes the latest version
  useEffect(() => {
    runNowRef.current = runNow;
  }, [runNow]);

  const stopSync = useCallback(() => {
    if (syncIntervalRef.current !== null) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }
    if (countdownIntervalRef.current !== null) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setNextRunAt(null);
    setIsRunning(false);
    appendLogEntry({
      type: 'info',
      jiraKey: '',
      prbNumber: '',
      detail: 'Sync monitor stopped',
    });
  }, [appendLogEntry]);

  const startSync = useCallback(() => {
    // Guard: ignore if already running to prevent duplicate intervals
    if (isRunning) return;

    const intervalMs = settingsRef.current.intervalMin * 60 * 1000;
    const firstNextRunAt = Date.now() + intervalMs;

    void runNowRef.current();
    setNextRunAt(firstNextRunAt);

    syncIntervalRef.current = setInterval(() => {
      const nextScheduledAt = Date.now() + intervalMs;
      setNextRunAt(nextScheduledAt);
      void runNowRef.current();
    }, intervalMs);

    // Tick every COUNTDOWN_TICK_MS to force re-renders so the countdown display stays accurate
    countdownIntervalRef.current = setInterval(() => {
      setNextRunAt((previousValue) => previousValue);
    }, COUNTDOWN_TICK_MS);

    appendLogEntry({
      type: 'info',
      jiraKey: '',
      prbNumber: '',
      detail: `Sync monitor started (every ${settingsRef.current.intervalMin} min)`,
    });
    setIsRunning(true);
  }, [isRunning, appendLogEntry]);

  // Clean up both timers on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (syncIntervalRef.current !== null) clearInterval(syncIntervalRef.current);
      if (countdownIntervalRef.current !== null) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  const exportPs1 = useCallback(() => {
    const scriptContent = generatePs1Script(settingsRef.current, statusMapRef.current);
    downloadPs1File(scriptContent);
  }, []);

  const state = useMemo<SyncEngineState>(
    () => ({
      isRunning,
      logEntries,
      settings,
      statusMap,
      jiraStatuses,
      isFetchingStatuses,
      nextRunAt,
      trackedIssueCount,
    }),
    [
      isRunning,
      logEntries,
      settings,
      statusMap,
      jiraStatuses,
      isFetchingStatuses,
      nextRunAt,
      trackedIssueCount,
    ],
  );

  const actions = useMemo<SyncEngineActions>(
    () => ({
      startSync,
      stopSync,
      runNow,
      clearLog,
      updateSettings,
      saveSettings,
      fetchJiraStatuses,
      saveStatusMappings,
      exportPs1,
    }),
    [
      startSync,
      stopSync,
      runNow,
      clearLog,
      updateSettings,
      saveSettings,
      fetchJiraStatuses,
      saveStatusMappings,
      exportPs1,
    ],
  );

  return { state, actions };
}
