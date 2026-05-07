// DevPanelView.tsx — Standalone network activity monitor for Jira API calls emitted by NodeToolbox.

import { buildCsv } from './utils/csvExport.ts';
import { type DevPanelEntry, useDevPanelLog } from './hooks/useDevPanelLog.ts';
import styles from './DevPanelView.module.css';

const VIEW_TITLE = 'Dev Panel';
const VIEW_SUBTITLE = 'Live Jira API activity captured from toolbox:api browser events.';
const EMPTY_STATE_MESSAGE = 'No Jira API calls recorded yet. Use any Jira feature and calls will appear here in real time.';
const CSV_MIME_TYPE = 'text/csv;charset=utf-8';
const DOWNLOAD_FILE_PREFIX = 'nodetoolbox-api-log';
const HTTP_SUCCESS_MIN_STATUS = 200;
const HTTP_SUCCESS_MAX_STATUS = 299;
const HTTP_CLIENT_ERROR_MIN_STATUS = 400;
const HTTP_SERVER_ERROR_MIN_STATUS = 500;

/** Renders a standalone Dev Panel that listens for Jira API telemetry without coupling to jiraApi.ts. */
export default function DevPanelView() {
  const devPanelLog = useDevPanelLog();

  return (
    <section className={styles.devPanelView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
          <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
        </div>
        <div className={styles.actionBar}>
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
      </header>

      {devPanelLog.isPaused && <div className={styles.pauseBanner}>Paused — new API events are being dropped.</div>}
      {renderStats(devPanelLog.totalCalls, devPanelLog.errorCount, devPanelLog.averageDurationMs)}
      {devPanelLog.entries.length === 0 ? renderEmptyState() : renderActivityTable(devPanelLog.entries)}
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

function renderEmptyState() {
  return <div className={styles.emptyState}>{EMPTY_STATE_MESSAGE}</div>;
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
