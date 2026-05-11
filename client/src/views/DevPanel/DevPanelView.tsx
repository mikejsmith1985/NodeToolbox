// DevPanelView.tsx — Network activity monitor with Jira API telemetry and Server Logs tabs.

import { useState } from 'react'
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

type ActiveTab = 'jira-api' | 'server-logs'

/** Renders a Dev Panel with two tabs: Jira API telemetry and server-side console logs. */
export default function DevPanelView() {
  const devPanelLog = useDevPanelLog();
  const serverLog = useServerLog();
  const [activeTab, setActiveTab] = useState<ActiveTab>('jira-api')

  return (
    <section className={styles.devPanelView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
          <p className={styles.pageSubtitle}>Live API telemetry and server console output.</p>
        </div>
      </header>

      {/* ── Tab bar ── */}
      <div className={styles.tabList} role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'jira-api'}
          className={activeTab === 'jira-api' ? styles.activeTab : styles.tab}
          onClick={() => setActiveTab('jira-api')}
        >
          Jira API
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'server-logs'}
          className={activeTab === 'server-logs' ? styles.activeTab : styles.tab}
          onClick={() => setActiveTab('server-logs')}
        >
          Server Logs
        </button>
      </div>

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
