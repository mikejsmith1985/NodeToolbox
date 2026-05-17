// DevPanelView.tsx — Network activity monitor with Jira API telemetry, server logs, and repo monitor validation.

import { useCallback, useEffect, useState } from 'react'
import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs.tsx'
import {
  fetchSchedulerConfig,
  fetchSchedulerResults,
  fetchSchedulerStatus,
  fetchSchedulerValidation,
  fetchGitHubDebugInfo,
  runSchedulerNow,
  type RepoMonitorSchedulerConfig,
  type SchedulerResultsResponse,
  type SchedulerStatusResponse,
  type SchedulerValidationResponse,
  type GitHubDebugResponse,
} from '../../services/schedulerApi.ts'
import { buildCsv } from './utils/csvExport.ts';
import { type DevPanelEntry, useDevPanelLog } from './hooks/useDevPanelLog.ts';
import { useServerLog } from './hooks/useServerLog.ts';
import styles from './DevPanelView.module.css';

const VIEW_TITLE = 'Dev Panel';
const CSV_MIME_TYPE = 'text/csv;charset=utf-8';
const DOWNLOAD_FILE_PREFIX = 'nodetoolbox-api-log';
const HTTP_SUCCESS_MIN_STATUS = 200;
const HTTP_SUCCESS_MAX_STATUS = 299;
const HTTP_CLIENT_ERROR_MIN_STATUS = 400;
const HTTP_SERVER_ERROR_MIN_STATUS = 500;
const DEV_PANEL_TAB_OPTIONS: { key: ActiveTab; label: string }[] = [
  { key: 'jira-api', label: 'Jira API' },
  { key: 'server-logs', label: 'Server Logs' },
  { key: 'repo-monitor-validation', label: 'Repo Monitor Validation' },
  { key: 'github-debug', label: 'GitHub Debug' },
];

type ActiveTab = 'jira-api' | 'server-logs' | 'repo-monitor-validation' | 'github-debug'

/** Renders a Dev Panel with Jira API telemetry, server logs, and repo monitor validation. */
export default function DevPanelView() {
  const devPanelLog = useDevPanelLog();
  const serverLog = useServerLog();
  const [repoMonitorConfig, setRepoMonitorConfig] = useState<RepoMonitorSchedulerConfig | null>(null)
  const [repoMonitorStatus, setRepoMonitorStatus] = useState<SchedulerStatusResponse['repoMonitor'] | null>(null)
  const [repoMonitorResults, setRepoMonitorResults] = useState<SchedulerResultsResponse['repoMonitor'] | null>(null)
  const [repoMonitorValidation, setRepoMonitorValidation] = useState<SchedulerValidationResponse['repoMonitor'] | null>(null)
  const [isRepoMonitorLoading, setIsRepoMonitorLoading] = useState(false)
  const [isRunningRepoMonitorNow, setIsRunningRepoMonitorNow] = useState(false)
  const [repoMonitorErrorMessage, setRepoMonitorErrorMessage] = useState<string | null>(null)
  const [githubDebugInfo, setGitHubDebugInfo] = useState<GitHubDebugResponse | null>(null)
  const [isGitHubDebugLoading, setIsGitHubDebugLoading] = useState(false)
  const [githubDebugErrorMessage, setGitHubDebugErrorMessage] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('jira-api')

  const refreshRepoMonitorValidation = useCallback(async () => {
    setIsRepoMonitorLoading(true)
    try {
      const [configResponse, statusResponse, resultsResponse, validationResponse] = await Promise.all([
        fetchSchedulerConfig(),
        fetchSchedulerStatus(),
        fetchSchedulerResults(),
        fetchSchedulerValidation(),
      ])
      setRepoMonitorConfig(configResponse.repoMonitor)
      setRepoMonitorStatus(statusResponse.repoMonitor)
      setRepoMonitorResults(resultsResponse.repoMonitor)
      setRepoMonitorValidation(validationResponse.repoMonitor)
      setRepoMonitorErrorMessage(null)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to load monitor validation data'
      setRepoMonitorErrorMessage(errorMessage)
    } finally {
      setIsRepoMonitorLoading(false)
    }
  }, [])

  const fetchGitHubDebug = useCallback(async () => {
    setIsGitHubDebugLoading(true)
    try {
      const debugResponse = await fetchGitHubDebugInfo()
      setGitHubDebugInfo(debugResponse)
      setGitHubDebugErrorMessage(null)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to fetch GitHub debug info'
      setGitHubDebugErrorMessage(errorMessage)
    } finally {
      setIsGitHubDebugLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'repo-monitor-validation') {
      void refreshRepoMonitorValidation()
    } else if (activeTab === 'github-debug') {
      void fetchGitHubDebug()
    }
  }, [activeTab, refreshRepoMonitorValidation, fetchGitHubDebug])

  const handleRunRepoMonitorNow = useCallback(async () => {
    setIsRunningRepoMonitorNow(true)
    try {
      await runSchedulerNow()
      await refreshRepoMonitorValidation()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to run monitor now'
      setRepoMonitorErrorMessage(errorMessage)
    } finally {
      setIsRunningRepoMonitorNow(false)
    }
  }, [refreshRepoMonitorValidation])

  return (
    <section className={styles.devPanelView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
          <p className={styles.pageSubtitle}>Live API telemetry and server console output.</p>
        </div>
      </header>

      {/* ── Tab bar ── */}
      <PrimaryTabs
        ariaLabel="Dev Panel tabs"
        idPrefix="dev-panel"
        tabs={DEV_PANEL_TAB_OPTIONS}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {/* ── Tab panels ── */}
      {activeTab === 'jira-api' && (
        <div role="tabpanel" aria-label="Jira API">
          <div className={styles.actionBar} style={{ marginBottom: '0.75rem' }}>
            <button type="button" className={styles.button} aria-pressed={devPanelLog.isPaused} onClick={() => devPanelLog.setPaused(!devPanelLog.isPaused)}>
              {devPanelLog.isPaused ? 'Resume logging' : 'Pause logging'}
            </button>
            <button type="button" className={styles.button} onClick={devPanelLog.clear}>
              Clear log
            </button>
            <button type="button" className={styles.buttonPrimary} disabled={devPanelLog.entries.length === 0} onClick={() => exportEntriesAsCsv(devPanelLog.entries)}>
              Export CSV
            </button>
          </div>
          {devPanelLog.isPaused && <div className={styles.pauseBanner}>Paused — new API events are being dropped.</div>}
          {renderStats(devPanelLog.totalCalls, devPanelLog.errorCount, devPanelLog.averageDurationMs)}
          {devPanelLog.entries.length === 0
            ? <div className={styles.emptyState}>No Jira API calls recorded yet. Use any Jira feature and calls will appear here in real time.</div>
            : renderActivityTable(devPanelLog.entries)}
        </div>
      )}

      {activeTab === 'server-logs' && (
        <div role="tabpanel" aria-label="Server Logs">
          <div className={styles.actionBar} style={{ marginBottom: '0.75rem' }}>
            <button type="button" className={styles.button} onClick={() => void serverLog.clearLog()}>
              Clear server log
            </button>
          </div>
          {serverLog.fetchError && (
            <div className={styles.pauseBanner}>⚠ Could not fetch server logs: {serverLog.fetchError}</div>
          )}
          {serverLog.isLoading
            ? <div className={styles.emptyState}>Loading server logs…</div>
            : serverLog.entries.length === 0
            ? <div className={styles.emptyState}>No server log entries captured yet. Server console output will appear here.</div>
            : renderServerLogTable(serverLog.entries)}
        </div>
      )}

      {activeTab === 'repo-monitor-validation' && (
        <div role="tabpanel" aria-label="Repo Monitor Validation">
          <div className={styles.actionBar} style={{ marginBottom: '0.75rem' }}>
            <button
              type="button"
              className={styles.button}
              onClick={() => void refreshRepoMonitorValidation()}
              disabled={isRepoMonitorLoading}
            >
              {isRepoMonitorLoading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              className={styles.buttonPrimary}
              onClick={() => void handleRunRepoMonitorNow()}
              disabled={isRunningRepoMonitorNow}
            >
              {isRunningRepoMonitorNow ? 'Running check…' : 'Run Check Now'}
            </button>
          </div>
          <div className={styles.emptyState}>
            <strong>How validation works:</strong> this view runs a read-only GitHub probe for each
            configured monitor repo and also reads scheduler status/results. This proves whether
            GitHub is reachable even when there are zero matching workflow events.
          </div>
          {repoMonitorErrorMessage !== null && (
            <div className={styles.pauseBanner}>⚠ {repoMonitorErrorMessage}</div>
          )}
          <div className={styles.statsBar} aria-label="Repo monitor validation checks">
            {renderStatPill('Enabled', repoMonitorStatus?.enabled ? 'Yes' : 'No')}
            {renderStatPill('Configured repos', String(repoMonitorConfig?.repos.length ?? 0))}
            {renderStatPill('Event count', String(repoMonitorStatus?.eventCount ?? 0))}
            {renderStatPill('GitHub probe', repoMonitorValidation?.isGitHubReachable ? 'Reachable' : 'Unreachable')}
          </div>
          {renderRepoMonitorSummary(repoMonitorStatus, repoMonitorConfig, repoMonitorResults, repoMonitorValidation)}
        </div>
      )}

      {activeTab === 'github-debug' && (
        <div role="tabpanel" aria-label="GitHub Debug">
          <div className={styles.actionBar} style={{ marginBottom: '0.75rem' }}>
            <button
              type="button"
              className={styles.buttonPrimary}
              onClick={() => void fetchGitHubDebug()}
              disabled={isGitHubDebugLoading}
            >
              {isGitHubDebugLoading ? 'Fetching debug info…' : 'Fetch GitHub Debug Info'}
            </button>
          </div>
          {githubDebugErrorMessage !== null && (
            <div className={styles.pauseBanner}>⚠ {githubDebugErrorMessage}</div>
          )}
          {githubDebugInfo && renderGitHubDebugInfo(githubDebugInfo)}
        </div>
      )}
    </section>
  );
}

function renderStats(totalCalls: number, errorCount: number, averageDurationMs: number) {
  return (
    <div className={styles.statsBar} aria-label="API activity counters">
      {renderStatPill('Total calls', String(totalCalls))}
      {renderStatPill('Errors', String(errorCount))}
      {renderStatPill('Avg duration', `${averageDurationMs} ms`)}
    </div>
  );
}

function renderStatPill(label: string, value: string) {
  return (
    <div className={styles.statPill}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function renderActivityTable(entries: DevPanelEntry[]) {
  return (
    <div className={styles.tableShell}>
      <table className={styles.activityTable} aria-label="Jira API activity log">
        <thead>
          <tr>
            <th>Time</th>
            <th>Method</th>
            <th>URL</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>{entries.slice().reverse().map((entry) => renderActivityRow(entry))}</tbody>
      </table>
    </div>
  );
}

function renderActivityRow(entry: DevPanelEntry) {
  const statusToneClassName = readStatusToneClassName(entry);

  return (
    <tr key={entry.id} className={statusToneClassName}>
      <td>{formatTimestamp(entry.timestamp)}</td>
      <td><span className={styles.methodBadge}>{entry.method}</span></td>
      <td className={styles.urlCell}>{entry.url}</td>
      <td>{formatStatus(entry)}</td>
      <td>{entry.durationMs} ms</td>
      <td className={styles.errorCell}>{entry.errorMessage ?? '—'}</td>
    </tr>
  );
}

function exportEntriesAsCsv(entries: DevPanelEntry[]): void {
  const csvBlob = new Blob([buildCsv(entries)], { type: CSV_MIME_TYPE });
  const csvUrl = URL.createObjectURL(csvBlob);
  const downloadLink = document.createElement('a');

  downloadLink.href = csvUrl;
  downloadLink.download = `${DOWNLOAD_FILE_PREFIX}-${new Date().toISOString()}.csv`;
  downloadLink.click();
  URL.revokeObjectURL(csvUrl);
}

function readStatusToneClassName(entry: DevPanelEntry): string {
  if (entry.status === null) return styles.statusNetworkError;
  if (entry.status >= HTTP_SERVER_ERROR_MIN_STATUS) return styles.statusServerError;
  if (entry.status >= HTTP_CLIENT_ERROR_MIN_STATUS) return styles.statusClientError;
  if (entry.status >= HTTP_SUCCESS_MIN_STATUS && entry.status <= HTTP_SUCCESS_MAX_STATUS) return styles.statusSuccess;
  return styles.statusNeutral;
}

function formatStatus(entry: DevPanelEntry): string {
  return entry.status === null ? 'Network error' : String(entry.status);
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toTimeString().slice(0, 8);
}

/** Renders the server log table with level-coloured rows. */
function renderServerLogTable(entries: { id: number; timestamp: string; level: string; message: string }[]) {
  return (
    <div className={styles.tableShell}>
      <table className={styles.activityTable} aria-label="Server console log">
        <thead>
          <tr>
            <th>Time</th>
            <th>Level</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className={readServerLogRowClass(entry.level)}>
              <td>{formatTimestamp(entry.timestamp)}</td>
              <td><span className={styles.methodBadge}>{entry.level.toUpperCase()}</span></td>
              <td className={styles.urlCell}>{entry.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function readServerLogRowClass(level: string): string {
  if (level === 'error') return styles.statusServerError
  if (level === 'warn') return styles.statusClientError
  if (level === 'info') return styles.statusSuccess
  return styles.statusNeutral
}

function renderRepoMonitorSummary(
  repoMonitorStatus: SchedulerStatusResponse['repoMonitor'] | null,
  repoMonitorConfig: RepoMonitorSchedulerConfig | null,
  repoMonitorResults: SchedulerResultsResponse['repoMonitor'] | null,
  repoMonitorValidation: SchedulerValidationResponse['repoMonitor'] | null,
) {
  if (
    repoMonitorStatus === null ||
    repoMonitorConfig === null ||
    repoMonitorResults === null ||
    repoMonitorValidation === null
  ) {
    return <div className={styles.emptyState}>Loading repo monitor diagnostics…</div>
  }

  return (
    <>
      <div className={styles.emptyState}>
        <div><strong>GitHub probe checked:</strong> {formatTimestampOrPlaceholder(repoMonitorValidation.checkedAt)}</div>
        <div><strong>Configured:</strong> {repoMonitorValidation.isGitHubConfigured ? 'Yes' : 'No'}</div>
        <div><strong>Reachable repos:</strong> {repoMonitorValidation.reachableRepoCount}/{repoMonitorValidation.configuredRepoCount}</div>
        {repoMonitorValidation.probeErrorMessage && (
          <div><strong>Probe error:</strong> {repoMonitorValidation.probeErrorMessage}</div>
        )}
      </div>
      <div className={styles.emptyState}>
        <div><strong>Configured repos:</strong> {repoMonitorConfig.repos.join(', ') || 'None configured'}</div>
        <div><strong>Last run:</strong> {formatTimestampOrPlaceholder(repoMonitorStatus.lastRunAt)}</div>
        <div><strong>Next run:</strong> {formatTimestampOrPlaceholder(repoMonitorStatus.nextRunAt)}</div>
      </div>
      {repoMonitorValidation.repos.length > 0 && (
        <div className={styles.tableShell}>
          <table className={styles.activityTable} aria-label="Repo monitor connectivity probes">
            <thead>
              <tr>
                <th>Repo</th>
                <th>Reachable</th>
                <th>Branches HTTP</th>
                <th>PRs HTTP</th>
                <th>Probe Error</th>
              </tr>
            </thead>
            <tbody>
              {repoMonitorValidation.repos.map((repoProbeResult) => (
                <tr key={`probe-${repoProbeResult.repo}`}>
                  <td>{repoProbeResult.repo}</td>
                  <td>{repoProbeResult.isReachable ? 'Yes' : 'No'}</td>
                  <td>{repoProbeResult.branchesHttpStatus ?? '—'}</td>
                  <td>{repoProbeResult.pullsHttpStatus ?? '—'}</td>
                  <td>{repoProbeResult.probeErrorMessage ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {repoMonitorResults.events.length === 0 ? (
        <div className={styles.emptyState}>
          No monitor events found in the current buffer. If the GitHub probe above is reachable,
          this confirms connectivity is working and simply no matching monitor events were detected.
        </div>
      ) : (
        <div className={styles.tableShell}>
          <table className={styles.activityTable} aria-label="Repo monitor events">
            <thead>
              <tr>
                <th>Time</th>
                <th>Repo</th>
                <th>Event</th>
                <th>Jira</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {repoMonitorResults.events.map((event) => (
                <tr key={`${event.timestamp}-${event.repo}-${event.eventType}`}>
                  <td>{formatTimestamp(event.timestamp)}</td>
                  <td>{event.repo}</td>
                  <td>{event.eventType}</td>
                  <td>{event.jiraKey || '—'}</td>
                  <td>{event.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function formatTimestampOrPlaceholder(timestamp: string | null): string {
  return timestamp ? formatTimestamp(timestamp) : 'Not available yet'
}

function renderGitHubDebugInfo(debugInfo: GitHubDebugResponse) {
  if (!debugInfo || !debugInfo.debugInfo) {
    return <div className={styles.emptyState}>Loading GitHub debug info...</div>;
  }

  return (
    <>
      <div className={styles.emptyState}>
        <div><strong>Configuration Status:</strong> {debugInfo.isConfigured ? '✓ Configured' : '✗ Not Configured'}</div>
        {debugInfo.timestamp && <div><strong>Checked at:</strong> {formatTimestamp(debugInfo.timestamp)}</div>}
        {debugInfo.message && <div><strong>Message:</strong> {debugInfo.message}</div>}
      </div>

      <div className={styles.emptyState}>
        <div><strong>Debug Info:</strong></div>
        <div style={{ paddingLeft: '1rem', fontFamily: 'monospace', fontSize: '0.9rem' }}>
          <div><strong>PAT:</strong> {debugInfo.debugInfo.pat || 'Not configured'}</div>
          <div><strong>Base URL:</strong> {debugInfo.debugInfo.baseUrl}</div>
          <div><strong>Auth Header Format:</strong> {debugInfo.debugInfo.authHeaderFormat}</div>
          {debugInfo.debugInfo.expectedHeader && (
            <div><strong>Expected Header:</strong> {debugInfo.debugInfo.expectedHeader}</div>
          )}
          {debugInfo.debugInfo.sentHeader && (
            <div><strong>Sent Header:</strong> {debugInfo.debugInfo.sentHeader}</div>
          )}
        </div>
      </div>

      {debugInfo.probeResult && (
        <div className={styles.emptyState}>
          <div><strong>Probe Result:</strong></div>
          <div style={{ paddingLeft: '1rem', fontFamily: 'monospace', fontSize: '0.9rem' }}>
            <div><strong>Endpoint:</strong> {debugInfo.probeResult.endpoint}</div>
            <div><strong>Method:</strong> {debugInfo.probeResult.method}</div>
            <div><strong>Status:</strong> {debugInfo.probeResult.statusCode} {debugInfo.probeResult.statusText}</div>
            <div><strong>Response Time:</strong> {debugInfo.probeResult.responseTime}ms</div>
            <div><strong>Success:</strong> {debugInfo.probeResult.success ? '✓ Yes' : '✗ No'}</div>
            {debugInfo.probeResult.errorMessage && (
              <div><strong>Error:</strong> {debugInfo.probeResult.errorMessage}</div>
            )}
          </div>
        </div>
      )}

      {debugInfo.error && (
        <div className={styles.pauseBanner}>⚠ Error during probe: {debugInfo.error}</div>
      )}

      <div className={styles.emptyState} style={{ fontSize: '0.85rem', color: '#999' }}>
        <p><strong>What this shows:</strong> This debug panel displays the exact authentication headers being sent to GitHub and the results of a connectivity probe. If the probe shows HTTP 200 with success=true, GitHub connectivity is working correctly.</p>
        <p><strong>Common issues:</strong></p>
        <ul style={{ marginLeft: '1rem' }}>
          <li>HTTP 401: Invalid or expired GitHub PAT token</li>
          <li>HTTP 403: Valid token but insufficient permissions</li>
          <li>Network error: GitHub is unreachable or firewall/proxy blocking</li>
          <li>If PAT shows &quot;Not configured&quot;: Add your GitHub PAT in Admin Hub settings</li>
        </ul>
      </div>
    </>
  )
}
