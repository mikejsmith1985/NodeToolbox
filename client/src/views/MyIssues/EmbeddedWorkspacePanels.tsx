// EmbeddedWorkspacePanels.tsx — Time Tracking and Git Sync panels for embedding in My Issues.

import type { WorkLogTab } from './hooks/useDevWorkspaceState.ts';
import { useDevWorkspaceState } from './hooks/useDevWorkspaceState.ts';
import { useDevWorkspaceSettings } from './hooks/useDevWorkspaceSettings.ts';
import { useGitHubPollingEngine } from './hooks/useGitHubPollingEngine.ts';
import styles from './EmbeddedWorkspacePanels.module.css';

const TICK_INTERVAL_MS = 1000;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/** Formats a total seconds count into HH:MM:SS display string. */
function formatElapsedTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return [hours, minutes, seconds].map((unit) => String(unit).padStart(2, '0')).join(':');
}

/** Filters work log entries to only those logged today. */
function getTodayEntries(entries: { loggedAt: string; issueKey: string; issueSummary: string; durationSeconds: number }[]) {
  const todayPrefix = new Date().toISOString().slice(0, 10);
  return entries.filter((entry) => entry.loggedAt.startsWith(todayPrefix));
}

interface WorkLogTabButtonProps {
  label: string;
  tabKey: WorkLogTab;
  activeTab: WorkLogTab;
  onSelect: (tab: WorkLogTab) => void;
}

/** Renders a sub-tab button for the work log section. */
function WorkLogTabButton({ label, tabKey, activeTab, onSelect }: WorkLogTabButtonProps) {
  const isActive = activeTab === tabKey;
  return (
    <button
      role="tab"
      aria-selected={isActive}
      className={`${styles.subTabBtn} ${isActive ? styles.subTabBtnActive : ''}`}
      onClick={() => onSelect(tabKey)}
    >
      {label}
    </button>
  );
}

type PanelProps = {
  state: ReturnType<typeof useDevWorkspaceState>['state'];
  actions: ReturnType<typeof useDevWorkspaceState>['actions'];
};

/** Renders Time Tracking as an embedded panel inside other workspaces. */
export function EmbeddedTimeTrackingPanel() {
  const { state, actions } = useDevWorkspaceState();
  return <TimeTrackingPanel state={state} actions={actions} />;
}

/** Renders Git Sync as an embedded panel inside other workspaces. */
export function EmbeddedGitSyncPanel() {
  const { state, actions } = useDevWorkspaceState();
  return <GitSyncPanel state={state} actions={actions} />;
}

/** Renders the Time Tracking tab with issue search, timer cards, and work log. */
function TimeTrackingPanel({ state, actions }: PanelProps) {
  const todayEntries = getTodayEntries(state.workLogEntries);

  return (
    <div className={styles.panel}>
      <div className={styles.issueSearchRow}>
        <input
          type="text"
          className={styles.issueSearchInput}
          placeholder="Issue key e.g. TBX-42"
          value={state.issueSearchKey}
          onChange={(event) => actions.setIssueSearchKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') actions.searchAndAddIssue();
          }}
        />
        <button
          className={styles.addIssueBtn}
          onClick={() => actions.searchAndAddIssue()}
          disabled={state.isSearchingIssue}
        >
          {state.isSearchingIssue ? 'Searching…' : 'Add Issue'}
        </button>
      </div>

      {state.issueSearchError && (
        <p className={styles.errorText}>{state.issueSearchError}</p>
      )}

      <div className={styles.workLogSubTabs} role="tablist">
        <WorkLogTabButton label="Timers" tabKey="timers" activeTab={state.workLogTab} onSelect={actions.setWorkLogTab} />
        <WorkLogTabButton label="Today" tabKey="today" activeTab={state.workLogTab} onSelect={actions.setWorkLogTab} />
        <WorkLogTabButton label="History" tabKey="history" activeTab={state.workLogTab} onSelect={actions.setWorkLogTab} />
      </div>

      {state.workLogTab === 'timers' && (
        <div className={styles.timerGrid}>
          {state.issueTimers.length === 0 && (
            <p className={styles.emptyState}>No issues tracked yet. Add an issue key above.</p>
          )}
          {state.issueTimers.map((timer) => (
            <div key={timer.issueKey} className={styles.timerCard}>
              <div className={styles.timerCardHeader}>
                <span className={styles.timerIssueKey}>{timer.issueKey}</span>
                <button
                  className={styles.removeTimerBtn}
                  onClick={() => actions.removeTimer(timer.issueKey)}
                  aria-label={`Remove timer for ${timer.issueKey}`}
                >
                  ✕
                </button>
              </div>
              <p className={styles.timerSummary}>{timer.issueSummary}</p>
              <div className={styles.timerDisplay}>{formatElapsedTime(timer.elapsedSeconds)}</div>
              <div className={styles.timerControls}>
                {timer.isRunning ? (
                  <button className={styles.stopBtn} onClick={() => actions.stopTimer(timer.issueKey)}>
                    ⏹ Stop
                  </button>
                ) : (
                  <button className={styles.startBtn} onClick={() => actions.startTimer(timer.issueKey)}>
                    ▶ Start
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {state.workLogTab === 'today' && (
        <div className={styles.workLogList}>
          {todayEntries.length === 0 && (
            <p className={styles.emptyState}>No work logged today.</p>
          )}
          {todayEntries.map((entry, index) => (
            <div key={index} className={styles.workLogEntry}>
              <span className={styles.timerIssueKey}>{entry.issueKey}</span>
              <span className={styles.workLogSummary}>{entry.issueSummary}</span>
              <span className={styles.workLogDuration}>{formatElapsedTime(entry.durationSeconds)}</span>
            </div>
          ))}
        </div>
      )}

      {state.workLogTab === 'history' && (
        <div className={styles.workLogList}>
          {state.workLogEntries.length === 0 && (
            <p className={styles.emptyState}>No work log history yet.</p>
          )}
          {state.workLogEntries.map((entry, index) => (
            <div key={index} className={styles.workLogEntry}>
              <span className={styles.timerIssueKey}>{entry.issueKey}</span>
              <span className={styles.workLogSummary}>{entry.issueSummary}</span>
              <span className={styles.workLogDuration}>{formatElapsedTime(entry.durationSeconds)}</span>
              <span className={styles.workLogDate}>{entry.loggedAt.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Renders the Git Sync tab with the GitHub polling controls and sync log. */
function GitSyncPanel({ state, actions }: PanelProps) {
  const { settings } = useDevWorkspaceSettings()

  const pollingEngine = useGitHubPollingEngine({
    githubPat: settings.githubPat,
    repoFullName: settings.repoFullName,
    monitoredReposText: settings.monitoredReposText,
    jiraProjectKey: settings.jiraProjectKey,
    intervalMinutes: settings.syncIntervalMinutes,
    maxCommits: settings.maxCommitsPerSync,
    keyPattern: settings.commitKeyPattern,
    commitTemplate: settings.commitMessageTemplate,
    branchPrefixesToStrip: settings.branchPrefixesToStrip,
    strategy: settings.postingStrategy,
    shouldLogMissingJiraKeys: settings.shouldLogMissingJiraKeys,
    shouldLogHealthyRuns: settings.shouldLogHealthyRuns,
    onLogEntry: actions.appendSyncLog,
  })

  return (
    <div className={styles.panel}>
      <div className={styles.syncPanel}>
        <div className={styles.syncStatus}>
          <span
            className={`${styles.statusDot} ${pollingEngine.isRunning ? styles.statusDotActive : styles.statusDotIdle}`}
            aria-label={pollingEngine.isRunning ? 'Running' : 'Stopped'}
          />
          <span>{pollingEngine.isRunning ? 'Sync Running' : 'Sync Stopped'}</span>
          {pollingEngine.isRunning && pollingEngine.nextRunInSeconds > 0 && (
            <span className={styles.countdownDisplay}>
              Next sync in {pollingEngine.nextRunInSeconds}s
            </span>
          )}
        </div>
        <div className={styles.syncControls}>
          <button
            className={styles.primaryBtn}
            onClick={() => {
              if (pollingEngine.isRunning) {
                pollingEngine.stopPolling()
                actions.appendSyncLog('Sync stopped by user.')
              } else {
                pollingEngine.startPolling()
                actions.appendSyncLog('Sync started by user.')
              }
            }}
          >
            {pollingEngine.isRunning ? '⏹ Stop Sync' : '▶ Start Sync'}
          </button>
          <button
            className={styles.secondaryBtn}
            onClick={() => {
              actions.appendSyncLog('Manual sync requested.')
              void pollingEngine.syncNow()
            }}
            disabled={!settings.repoFullName}
          >
            Sync Now
          </button>
        </div>
        {pollingEngine.lastRunAt !== null && (
          <p className={styles.lastSyncText}>Last sync: {new Date(pollingEngine.lastRunAt).toLocaleTimeString()}</p>
        )}
        {!settings.repoFullName && (
          <p className={styles.helpText}>Configure the repository in Settings to enable sync.</p>
        )}
        <div className={styles.syncLogContainer}>
          <div className={styles.syncLogHeader}>
            <span>Sync Log</span>
            <button className={styles.clearBtn} onClick={actions.clearSyncLog}>Clear Log</button>
          </div>
          <div className={styles.syncLog}>
            {state.syncLog.length === 0 && <span className={styles.emptyState}>No log entries.</span>}
            {state.syncLog.map((entry, index) => (
              <div key={index} className={styles.syncLogEntry}>{entry}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Suppress unused variable warning — TICK_INTERVAL_MS is intentionally kept as a named constant
// matching its origin in DevWorkspaceView for clarity and future use.
void TICK_INTERVAL_MS;
