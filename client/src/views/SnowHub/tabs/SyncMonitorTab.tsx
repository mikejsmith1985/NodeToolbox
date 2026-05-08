// SyncMonitorTab.tsx — PRB Sync Monitor tab for scheduling and observing Jira→SNow syncs.

import type { ChangeEvent } from 'react';
import { useEffect, useState } from 'react';

import { SNOW_PROBLEM_STATES, useSnowSyncEngine } from '../hooks/useSnowSyncEngine.ts';
import type { LogEntry, StatusMap, SyncSettings } from '../hooks/useSnowSyncEngine.ts';
import styles from './SyncMonitorTab.module.css';

// ── Constants ──
const TAB_TITLE = 'PRB Sync Monitor';
const TAB_SUBTITLE =
  'Monitor and sync Jira Problem tickets to ServiceNow PRB records on a configurable schedule.';
const SETTINGS_SECTION_TITLE = 'Sync Settings';
const MAPPINGS_SECTION_TITLE = 'Status Mappings';
const LOG_SECTION_TITLE = 'Activity Log';
const EMPTY_LOG_MESSAGE = 'No activity yet — start the monitor or click Sync Now.';
const NO_LAST_CHECK_LABEL = 'Never';
const POLL_INTERVAL_OPTIONS = [
  { label: '1 min', value: 1 },
  { label: '5 min', value: 5 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
] as const;
const LOG_TAG_LABELS: Record<LogEntry['type'], string> = {
  info: 'INFO',
  status: 'STATUS',
  comment: 'COMMENT',
  error: 'ERROR',
};
const LOG_TAG_CSS_CLASSES: Record<LogEntry['type'], string> = {
  info: 'logTagInfo',
  status: 'logTagStatus',
  comment: 'logTagComment',
  error: 'logTagError',
};
const COUNTDOWN_REFRESH_MS = 1000;

/**
 * Default status code fallbacks pre-populate the mapping dropdowns when the user has not
 * yet saved a custom mapping for a given Jira status.
 */
const STATUS_FALLBACK_MAP: Record<string, string> = {
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

// ── Sub-component types ──

interface SyncStatusBarProps {
  isRunning: boolean;
  lastCheckTime: string | null;
  nextRunAt: number | null;
  trackedIssueCount: number;
  onStart: () => void;
  onStop: () => void;
  onRunNow: () => void;
}

interface SyncSettingsPanelProps {
  settings: SyncSettings;
  onUpdateSettings: (partial: Partial<SyncSettings>) => void;
  onSaveSettings: () => void;
  onExportPs1: () => void;
}

interface StatusMappingEditorProps {
  jiraStatuses: string[];
  statusMap: StatusMap;
  isFetchingStatuses: boolean;
  onFetchStatuses: () => void;
  onSaveMappings: (map: StatusMap) => void;
}

interface SyncActivityLogProps {
  logEntries: LogEntry[];
  onClearLog: () => void;
}

// ── Helper functions ──

function formatCheckTime(lastCheckTime: string | null): string {
  if (!lastCheckTime) return NO_LAST_CHECK_LABEL;
  return new Date(lastCheckTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatCountdown(nextRunAt: number | null): string {
  if (nextRunAt === null) return '—';
  const secondsRemaining = Math.max(0, Math.round((nextRunAt - Date.now()) / 1000));
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatLogTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function resolveInitialStatusCode(jiraStatus: string, statusMap: StatusMap): string {
  return statusMap[jiraStatus] ?? STATUS_FALLBACK_MAP[jiraStatus.toLowerCase()] ?? '';
}

// ── Sub-components ──

/**
 * Shows the current running state, last-check time, next-run countdown, and issue count.
 * Provides Start, Stop, and Sync Now controls so operators can manage the sync schedule.
 */
function SyncStatusBar({
  isRunning,
  lastCheckTime,
  nextRunAt,
  trackedIssueCount,
  onStart,
  onStop,
  onRunNow,
}: SyncStatusBarProps) {
  // Local tick so the countdown updates every second without coupling to the engine's interval
  const [, setTickCounter] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const tickId = setInterval(() => setTickCounter((count) => count + 1), COUNTDOWN_REFRESH_MS);
    return () => clearInterval(tickId);
  }, [isRunning]);

  return (
    <div className={styles.statusBar}>
      <div className={styles.statusIndicator}>
        <span
          className={`${styles.statusDot} ${isRunning ? styles.statusDotRunning : styles.statusDotStopped}`}
        />
        <span className={styles.statusLabel}>{isRunning ? 'Running' : 'Stopped'}</span>
      </div>
      <div className={styles.buttonRow}>
        {isRunning ? (
          <button className={styles.secondaryButton} onClick={onStop} type="button">
            Stop
          </button>
        ) : (
          <button className={styles.primaryButton} onClick={onStart} type="button">
            Start
          </button>
        )}
        <button className={styles.secondaryButton} onClick={onRunNow} type="button">
          Sync Now
        </button>
      </div>
      <div className={styles.statusMeta}>
        <span className={styles.statusMetaItem}>
          <span className={styles.statusMetaKey}>Last check:</span>
          <span className={styles.statusMetaValue}>{formatCheckTime(lastCheckTime)}</span>
        </span>
        <span className={styles.statusMetaItem}>
          <span className={styles.statusMetaKey}>Next run:</span>
          <span className={styles.statusMetaValue}>{formatCountdown(nextRunAt)}</span>
        </span>
        <span className={styles.statusMetaItem}>
          <span className={styles.statusMetaKey}>Tracking:</span>
          <span className={styles.statusMetaValue}>{trackedIssueCount} issues</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Displays editable sync settings (JQL, interval, prefix, comment toggle) and lets the
 * operator save them to localStorage or export the equivalent PowerShell script.
 */
function SyncSettingsPanel({
  settings,
  onUpdateSettings,
  onSaveSettings,
  onExportPs1,
}: SyncSettingsPanelProps) {
  function handleJqlChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    onUpdateSettings({ jqlTemplate: event.target.value });
  }

  function handleIntervalChange(event: ChangeEvent<HTMLSelectElement>): void {
    onUpdateSettings({ intervalMin: Number(event.target.value) });
  }

  function handlePrefixChange(event: ChangeEvent<HTMLInputElement>): void {
    onUpdateSettings({ workNotePrefix: event.target.value });
  }

  function handleCommentsChange(event: ChangeEvent<HTMLInputElement>): void {
    onUpdateSettings({ shouldSyncComments: event.target.checked });
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{SETTINGS_SECTION_TITLE}</h3>
      </div>
      <div className={styles.sectionBody}>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="jql-template-input">
            JQL Template
          </label>
          <textarea
            className={styles.textarea}
            id="jql-template-input"
            onChange={handleJqlChange}
            value={settings.jqlTemplate}
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="poll-interval-select">
            Poll Interval
          </label>
          <select
            className={styles.select}
            id="poll-interval-select"
            onChange={handleIntervalChange}
            value={settings.intervalMin}
          >
            {POLL_INTERVAL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor="work-note-prefix-input">
            Work Note Prefix
          </label>
          <input
            className={styles.input}
            id="work-note-prefix-input"
            onChange={handlePrefixChange}
            type="text"
            value={settings.workNotePrefix}
          />
        </div>
        <label className={styles.checkboxLabel}>
          <input
            checked={settings.shouldSyncComments}
            className={styles.checkbox}
            onChange={handleCommentsChange}
            type="checkbox"
          />
          Sync Jira comments as SNow work notes
        </label>
        <div className={styles.buttonRow}>
          <button className={styles.primaryButton} onClick={onSaveSettings} type="button">
            Save Settings
          </button>
          <button className={styles.secondaryButton} onClick={onExportPs1} type="button">
            Export PS1
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * Lets operators map each Jira status to a SNow problem state code.
 * Dropdowns are pre-populated from saved mappings or built-in defaults.
 */
function StatusMappingEditor({
  jiraStatuses,
  statusMap,
  isFetchingStatuses,
  onFetchStatuses,
  onSaveMappings,
}: StatusMappingEditorProps) {
  const [localMapping, setLocalMapping] = useState<StatusMap>(() => {
    const initialMap: StatusMap = {};
    for (const jiraStatus of jiraStatuses) {
      initialMap[jiraStatus] = resolveInitialStatusCode(jiraStatus, statusMap);
    }
    return initialMap;
  });

  // Rebuild local mapping when the available statuses change (e.g., after fetching)
  useEffect(() => {
    const rebuiltMap: StatusMap = {};
    for (const jiraStatus of jiraStatuses) {
      rebuiltMap[jiraStatus] = localMapping[jiraStatus] ?? resolveInitialStatusCode(jiraStatus, statusMap);
    }
    setLocalMapping(rebuiltMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jiraStatuses]);

  function handleMappingChange(jiraStatus: string, snStateCode: string): void {
    setLocalMapping((prev) => ({ ...prev, [jiraStatus]: snStateCode }));
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{MAPPINGS_SECTION_TITLE}</h3>
      </div>
      <div className={styles.sectionBody}>
        <div className={styles.buttonRow}>
          <button
            className={styles.secondaryButton}
            disabled={isFetchingStatuses}
            onClick={onFetchStatuses}
            type="button"
          >
            {isFetchingStatuses ? 'Fetching…' : 'Fetch Statuses'}
          </button>
        </div>
        {jiraStatuses.length > 0 ? (
          <>
            <table className={styles.mappingTable}>
              <thead>
                <tr>
                  <th className={styles.mappingTableHeader}>Jira Status</th>
                  <th className={styles.mappingTableHeader}>SNow State</th>
                </tr>
              </thead>
              <tbody>
                {jiraStatuses.map((jiraStatus) => (
                  <tr className={styles.mappingTableRow} key={jiraStatus}>
                    <td className={styles.mappingTableCell}>{jiraStatus}</td>
                    <td className={styles.mappingTableCell}>
                      <select
                        className={styles.mappingSelect}
                        onChange={(event) => handleMappingChange(jiraStatus, event.target.value)}
                        value={localMapping[jiraStatus] ?? ''}
                      >
                        <option value="">— No state change —</option>
                        {Object.entries(SNOW_PROBLEM_STATES).map(([code, label]) => (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.buttonRow}>
              <button
                className={styles.primaryButton}
                onClick={() => onSaveMappings(localMapping)}
                type="button"
              >
                Save Mappings
              </button>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Displays the live activity log in reverse-chronological order so the most recent
 * events are visible at the top without scrolling.
 */
function SyncActivityLog({ logEntries, onClearLog }: SyncActivityLogProps) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{LOG_SECTION_TITLE}</h3>
        <button className={styles.secondaryButton} onClick={onClearLog} type="button">
          Clear Log
        </button>
      </div>
      <div className={styles.sectionBody}>
        <div className={styles.logPanel}>
          {logEntries.length === 0 ? (
            <p className={styles.logEmpty}>{EMPTY_LOG_MESSAGE}</p>
          ) : (
            [...logEntries].map((logEntry) => (
              <div
                className={styles.logEntry}
                key={`${logEntry.timestamp}-${logEntry.jiraKey}-${logEntry.type}`}
              >
                <span className={styles.logTimestamp}>{formatLogTimestamp(logEntry.timestamp)}</span>
                <span
                  className={`${styles.logTag} ${styles[LOG_TAG_CSS_CLASSES[logEntry.type]]}`}
                >
                  {LOG_TAG_LABELS[logEntry.type]}
                </span>
                {logEntry.jiraKey ? (
                  <span className={styles.logRef}>
                    {logEntry.jiraKey}→{logEntry.prbNumber}
                  </span>
                ) : null}
                <span className={styles.logDetail}>{logEntry.detail}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Renders the PRB Sync Monitor tab, wiring all sub-components to the sync engine hook
 * so operators can configure, start, stop, and observe Jira→SNow synchronisation.
 */
export default function SyncMonitorTab() {
  const { state, actions } = useSnowSyncEngine();

  return (
    <div className={styles.tabPanel}>
      <header className={styles.tabHeader}>
        <h2 className={styles.tabTitle}>{TAB_TITLE}</h2>
        <p className={styles.tabSubtitle}>{TAB_SUBTITLE}</p>
      </header>
      <SyncStatusBar
        isRunning={state.isRunning}
        lastCheckTime={state.settings.lastCheckTime}
        nextRunAt={state.nextRunAt}
        onRunNow={() => void actions.runNow()}
        onStart={actions.startSync}
        onStop={actions.stopSync}
        trackedIssueCount={state.trackedIssueCount}
      />
      <SyncSettingsPanel
        onExportPs1={actions.exportPs1}
        onSaveSettings={actions.saveSettings}
        onUpdateSettings={actions.updateSettings}
        settings={state.settings}
      />
      <StatusMappingEditor
        isFetchingStatuses={state.isFetchingStatuses}
        jiraStatuses={state.jiraStatuses}
        onFetchStatuses={() => void actions.fetchJiraStatuses()}
        onSaveMappings={actions.saveStatusMappings}
        statusMap={state.statusMap}
      />
      <SyncActivityLog logEntries={state.logEntries} onClearLog={actions.clearLog} />
    </div>
  );
}
