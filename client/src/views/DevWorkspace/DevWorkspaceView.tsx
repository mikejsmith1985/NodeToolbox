// DevWorkspaceView.tsx — Tabbed Dev Workspace view for time tracking, Git sync, and monitoring.

import { useCallback, useEffect, useState } from 'react';

import JiraProjectPicker from '../../components/JiraProjectPicker/index.tsx';
import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs.tsx';
import { jiraGet } from '../../services/jiraApi.ts';
import {
  fetchSchedulerConfig,
  fetchSchedulerResults,
  fetchSchedulerStatus,
  runSchedulerNow,
  updateSchedulerConfig,
} from '../../services/schedulerApi.ts';
import type {
  RepoMonitorSchedulerConfig,
  SchedulerResultEvent,
  SchedulerStatusResponse,
} from '../../services/schedulerApi.ts';
import HygieneView from '../Hygiene/HygieneView.tsx';
import type { DevWorkspaceTab, WorkLogTab } from './hooks/useDevWorkspaceState.ts';
import { useDevWorkspaceState } from './hooks/useDevWorkspaceState.ts';
import { useDevWorkspaceSettings } from './hooks/useDevWorkspaceSettings.ts';
import { useGitHubPollingEngine } from './hooks/useGitHubPollingEngine.ts';
import { parseRepoIdentifiersFromInput } from './utils/repoIdentifierParser.ts';
import styles from './DevWorkspaceView.module.css';

const TICK_INTERVAL_MS = 1000;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const LEGACY_REPO_MONITOR_SETTINGS_KEY = 'tbxRepoMonitorSettings';

interface JiraProjectStatus {
  name?: string;
}

interface JiraProjectStatusGroup {
  statuses?: JiraProjectStatus[];
}

const DEV_WORKSPACE_TAB_OPTIONS: { key: DevWorkspaceTab; label: string }[] = [
  { key: 'hygiene', label: '✅ Hygiene' },
  { key: 'monitor', label: '🔁 Repo Monitor' },
  { key: 'gitsync', label: '🔧 Git Sync' },
  { key: 'time', label: '⏱ Time Tracking' },
  { key: 'settings', label: '⚙ Settings' },
];

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

/** Main Dev Workspace view with time tracking, Git sync, repo monitor, and settings tabs. */
export default function DevWorkspaceView() {
  const { state, actions } = useDevWorkspaceState();

  // Tick all running timers once per second
  useEffect(() => {
    const hasRunningTimer = state.issueTimers.some((timer) => timer.isRunning);
    if (!hasRunningTimer) return;

    const intervalId = setInterval(() => {
      actions.tickAllRunningTimers();
    }, TICK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [state.issueTimers, actions]);

  return (
    <div className={styles.workspace}>
      <PrimaryTabs
        ariaLabel="Dev Workspace tabs"
        idPrefix="dev-workspace"
        tabs={DEV_WORKSPACE_TAB_OPTIONS}
        activeTab={state.activeTab}
        onChange={actions.setActiveTab}
      />

      <div className={styles.tabContent}>
        {state.activeTab === 'hygiene' && <HygienePanel />}
        {state.activeTab === 'time' && <TimeTrackingPanel state={state} actions={actions} />}
        {state.activeTab === 'gitsync' && <GitSyncPanel state={state} actions={actions} />}
        {state.activeTab === 'monitor' && <RepoMonitorPanel />}
        {state.activeTab === 'settings' && <WorkspaceSettingsPanel />}
      </div>
    </div>
  );
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

/** Renders the primary Jira hygiene workspace for developer issue health. */
function HygienePanel() {
  return (
    <div className={styles.panel}>
      <HygieneView />
    </div>
  );
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
    jiraProjectKey: settings.jiraProjectKey,
    intervalMinutes: settings.syncIntervalMinutes,
    maxCommits: settings.maxCommitsPerSync,
    keyPattern: settings.commitKeyPattern,
    commitTemplate: settings.commitMessageTemplate,
    strategy: settings.postingStrategy,
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

/** Renders the Repo Monitor tab backed by the legacy server scheduler endpoints. */
function RepoMonitorPanel() {
  const [monitorConfig, setMonitorConfig] = useState<RepoMonitorSchedulerConfig | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<SchedulerStatusResponse | null>(null);
  const [monitorEvents, setMonitorEvents] = useState<SchedulerResultEvent[]>([]);
  const [isMonitorBusy, setIsMonitorBusy] = useState(false);
  const [monitorErrorMessage, setMonitorErrorMessage] = useState<string | null>(null);

  const refreshMonitorData = useCallback(async () => {
    setMonitorErrorMessage(null);
    try {
      const [latestConfig, latestStatus, latestResults] = await Promise.all([
        fetchSchedulerConfig(),
        fetchSchedulerStatus(),
        fetchSchedulerResults(),
      ]);
      setMonitorConfig(latestConfig.repoMonitor);
      setMonitorStatus(latestStatus);
      setMonitorEvents(latestResults.repoMonitor.events);
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
      setMonitorErrorMessage(errorMessage);
    }
  }, []);

  useEffect(() => {
    const initialRefreshTimeoutHandle = setTimeout(() => {
      void refreshMonitorData();
    }, 0);
    return () => clearTimeout(initialRefreshTimeoutHandle);
  }, [refreshMonitorData]);

  useEffect(() => {
    const statusIntervalHandle = setInterval(() => {
      void refreshMonitorData();
    }, 15000);
    return () => clearInterval(statusIntervalHandle);
  }, [refreshMonitorData]);

  const isMonitorEnabled = monitorStatus?.repoMonitor.enabled ?? false;

  return (
    <div className={styles.panel}>
      <div className={styles.syncStatus}>
        <span
          className={`${styles.statusDot} ${isMonitorEnabled ? styles.statusDotActive : styles.statusDotIdle}`}
          aria-label={isMonitorEnabled ? 'Monitoring' : 'Stopped'}
        />
        <span>{isMonitorEnabled ? 'Monitor Active' : 'Monitor Stopped'}</span>
        {monitorStatus?.repoMonitor.nextRunAt && (
          <span className={styles.countdownDisplay}>Next run: {new Date(monitorStatus.repoMonitor.nextRunAt).toLocaleTimeString()}</span>
        )}
      </div>
      <div className={styles.syncControls}>
        <button
          className={styles.primaryBtn}
          disabled={isMonitorBusy || monitorConfig === null}
          onClick={() => {
            if (monitorConfig === null) return;
            const nextEnabledValue = !isMonitorEnabled;
            setIsMonitorBusy(true);
            void updateSchedulerConfig({
              repoMonitor: { ...monitorConfig, enabled: nextEnabledValue },
            })
              .then(() => refreshMonitorData())
              .catch((caughtError) => {
                const errorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
                setMonitorErrorMessage(errorMessage);
              })
              .finally(() => {
                setIsMonitorBusy(false);
              });
          }}
        >
          {isMonitorEnabled ? '⏹ Stop Monitor' : '▶ Start Monitor'}
        </button>
        <button
          className={styles.secondaryBtn}
          disabled={isMonitorBusy}
          onClick={() => {
            setIsMonitorBusy(true);
            void runSchedulerNow()
              .then(() => refreshMonitorData())
              .catch((caughtError) => {
                const errorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
                setMonitorErrorMessage(errorMessage);
              })
              .finally(() => {
                setIsMonitorBusy(false);
              });
          }}
        >
          Check Now
        </button>
      </div>
      {monitorErrorMessage && (
        <p className={styles.errorText}>{monitorErrorMessage}</p>
      )}
      <div className={styles.syncLogContainer}>
        <div className={styles.syncLogHeader}><span>Legacy Monitor Status</span></div>
        <div className={styles.syncLog}>
          <div className={styles.syncLogEntry}>Configured repos: {monitorStatus?.repoMonitor.repos.length ?? 0}</div>
          <div className={styles.syncLogEntry}>Event count: {monitorStatus?.repoMonitor.eventCount ?? 0}</div>
          <div className={styles.syncLogEntry}>
            Last run: {monitorStatus?.repoMonitor.lastRunAt ? new Date(monitorStatus.repoMonitor.lastRunAt).toLocaleString() : 'Never'}
          </div>
          <div className={styles.syncLogEntry}>
            Branch pattern: {monitorConfig?.branchPattern ?? 'feature/[A-Z]+-\\d+'}
          </div>
        </div>
      </div>
      <div className={styles.syncLogContainer}>
        <div className={styles.syncLogHeader}><span>Monitor Events</span></div>
        <div className={styles.syncLog}>
          {monitorEvents.length === 0 && (
            <span className={styles.emptyState}>No monitor log entries.</span>
          )}
          {monitorEvents.map((eventItem, eventIndex) => (
            <div key={`${eventItem.timestamp}-${eventIndex}`} className={styles.syncLogEntry}>
              [{new Date(eventItem.timestamp).toLocaleTimeString()}] {eventItem.repo} — {eventItem.jiraKey || 'NO-KEY'} — {eventItem.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Renders the Settings tab for Dev Workspace configuration — full settings surface. */
function WorkspaceSettingsPanel() {
  const { settings, isPatVisible, updateSettings, clearGithubPat, togglePatVisibility } =
    useDevWorkspaceSettings();
  const [schedulerConfigDraft, setSchedulerConfigDraft] = useState<RepoMonitorSchedulerConfig | null>(null);
  const [schedulerLoadError, setSchedulerLoadError] = useState<string | null>(null);
  const [legacyImportNotice, setLegacyImportNotice] = useState<string | null>(null);
  const [isSchedulerLoading, setIsSchedulerLoading] = useState(true);
  const [isSchedulerSaving, setIsSchedulerSaving] = useState(false);
  const [isJiraStatusLoading, setIsJiraStatusLoading] = useState(false);
  const [jiraStatusLoadError, setJiraStatusLoadError] = useState<string | null>(null);
  const [jiraStatusNames, setJiraStatusNames] = useState<string[]>([]);
  const [repoInputText, setRepoInputText] = useState('');

  const readLegacyRepoMonitorSettings = useCallback((): Partial<RepoMonitorSchedulerConfig> | null => {
    try {
      const rawSettings = window.localStorage.getItem(LEGACY_REPO_MONITOR_SETTINGS_KEY);
      if (rawSettings === null) return null;
      const parsedSettings = JSON.parse(rawSettings) as {
        repos?: unknown;
        branchPattern?: unknown;
        intervalMin?: unknown;
        transitions?: unknown;
      };

      const parsedRepos = Array.isArray(parsedSettings.repos)
        ? parsedSettings.repos
            .map((repositoryValue) => String(repositoryValue).trim())
            .filter((repositoryValue) => repositoryValue.length > 0)
        : [];
      const parsedTransitions = parsedSettings.transitions && typeof parsedSettings.transitions === 'object'
        ? parsedSettings.transitions as Record<string, unknown>
        : {};

      if (parsedRepos.length === 0) return null;

      return {
        repos: parsedRepos,
        branchPattern: typeof parsedSettings.branchPattern === 'string'
          ? parsedSettings.branchPattern
          : undefined,
        intervalMin: typeof parsedSettings.intervalMin === 'number'
          ? parsedSettings.intervalMin
          : undefined,
        transitions: {
          branchCreated: typeof parsedTransitions.branchCreated === 'string' ? parsedTransitions.branchCreated : '',
          commitPushed: typeof parsedTransitions.commitPushed === 'string' ? parsedTransitions.commitPushed : '',
          prOpened: typeof parsedTransitions.prOpened === 'string' ? parsedTransitions.prOpened : '',
          prMerged: typeof parsedTransitions.prMerged === 'string' ? parsedTransitions.prMerged : '',
        },
      };
    } catch {
      return null;
    }
  }, []);

  const loadSchedulerConfig = useCallback(async () => {
    setIsSchedulerLoading(true);
    setSchedulerLoadError(null);
    setLegacyImportNotice(null);
    try {
      const schedulerConfigResponse = await fetchSchedulerConfig();
      const loadedSchedulerConfig = schedulerConfigResponse.repoMonitor;
      const legacyRepoMonitorSettings = readLegacyRepoMonitorSettings();
      if ((loadedSchedulerConfig.repos ?? []).length === 0 && legacyRepoMonitorSettings?.repos?.length) {
        setSchedulerConfigDraft({
          ...loadedSchedulerConfig,
          ...legacyRepoMonitorSettings,
          transitions: {
            ...loadedSchedulerConfig.transitions,
            ...(legacyRepoMonitorSettings.transitions ?? {}),
          },
        });
        setLegacyImportNotice(
          `Imported ${legacyRepoMonitorSettings.repos.length} repo(s) from legacy monitor settings. Save to persist.`
        );
      } else {
        setSchedulerConfigDraft(loadedSchedulerConfig);
      }
    } catch (error) {
      setSchedulerLoadError(error instanceof Error ? error.message : 'Failed to load scheduler config.');
    } finally {
      setIsSchedulerLoading(false);
    }
  }, [readLegacyRepoMonitorSettings]);

  useEffect(() => {
    const schedulerLoadTimeoutHandle = setTimeout(() => {
      void loadSchedulerConfig();
    }, 0);
    return () => clearTimeout(schedulerLoadTimeoutHandle);
  }, [loadSchedulerConfig]);

  const updateSchedulerDraft = useCallback(
    (patch: Partial<RepoMonitorSchedulerConfig>) => {
      setSchedulerConfigDraft((currentDraft) => {
        if (currentDraft === null) {
          return currentDraft;
        }
        return { ...currentDraft, ...patch };
      });
    },
    []
  );

  const saveSchedulerConfig = useCallback(async () => {
    if (schedulerConfigDraft === null) {
      return;
    }

    setIsSchedulerSaving(true);
    setSchedulerLoadError(null);
    try {
      await updateSchedulerConfig({ repoMonitor: schedulerConfigDraft });
      await loadSchedulerConfig();
    } catch (error) {
      setSchedulerLoadError(error instanceof Error ? error.message : 'Failed to save scheduler config.');
    } finally {
      setIsSchedulerSaving(false);
    }
  }, [loadSchedulerConfig, schedulerConfigDraft]);

  const loadJiraStatusNames = useCallback(async () => {
    const jiraProjectKey = settings.jiraProjectKey.trim();
    if (!jiraProjectKey) {
      setJiraStatusNames([]);
      setJiraStatusLoadError(null);
      return;
    }

    setIsJiraStatusLoading(true);
    setJiraStatusLoadError(null);
    try {
      const statusGroups = await jiraGet<JiraProjectStatusGroup[]>(
        `/rest/api/2/project/${encodeURIComponent(jiraProjectKey)}/statuses`
      );
      const uniqueStatusNames = Array.from(
        new Set(
          statusGroups
            .flatMap((statusGroup) => statusGroup.statuses ?? [])
            .map((statusItem) => statusItem.name?.trim() ?? '')
            .filter((statusName) => statusName.length > 0)
        )
      ).sort((leftName, rightName) => leftName.localeCompare(rightName));
      setJiraStatusNames(uniqueStatusNames);
    } catch (error) {
      setJiraStatusLoadError(error instanceof Error ? error.message : 'Failed to load Jira statuses.');
      setJiraStatusNames([]);
    } finally {
      setIsJiraStatusLoading(false);
    }
  }, [settings.jiraProjectKey]);

  useEffect(() => {
    const jiraStatusLoadTimeoutHandle = setTimeout(() => {
      void loadJiraStatusNames();
    }, 0);
    return () => clearTimeout(jiraStatusLoadTimeoutHandle);
  }, [loadJiraStatusNames]);

  const buildTransitionChoices = useCallback(
    (selectedValue: string): string[] => {
      if (!selectedValue || jiraStatusNames.includes(selectedValue)) {
        return jiraStatusNames;
      }
      return [selectedValue, ...jiraStatusNames];
    },
    [jiraStatusNames]
  );

  const persistMonitoredRepos = useCallback(async (nextRepos: string[]) => {
    if (schedulerConfigDraft === null) {
      return;
    }

    const nextSchedulerDraft: RepoMonitorSchedulerConfig = {
      ...schedulerConfigDraft,
      repos: nextRepos,
    };

    setSchedulerConfigDraft(nextSchedulerDraft);
    setIsSchedulerSaving(true);
    setSchedulerLoadError(null);
    try {
      await updateSchedulerConfig({ repoMonitor: nextSchedulerDraft });
      await loadSchedulerConfig();
    } catch (error) {
      setSchedulerLoadError(error instanceof Error ? error.message : 'Failed to save scheduler config.');
    } finally {
      setIsSchedulerSaving(false);
    }
  }, [loadSchedulerConfig, schedulerConfigDraft]);

  const addReposToMonitor = useCallback(() => {
    if (schedulerConfigDraft === null) {
      return;
    }

    const parsedRepos = parseRepoIdentifiersFromInput(repoInputText);
    if (parsedRepos.length === 0) {
      return;
    }

    const mergedRepos = Array.from(new Set([...schedulerConfigDraft.repos, ...parsedRepos]));
    void persistMonitoredRepos(mergedRepos);
    setRepoInputText('');
  }, [persistMonitoredRepos, repoInputText, schedulerConfigDraft]);

  const addPrimarySyncRepoToMonitor = useCallback(() => {
    if (schedulerConfigDraft === null) {
      return;
    }

    const parsedRepos = parseRepoIdentifiersFromInput(settings.repoFullName);
    if (parsedRepos.length === 0) {
      return;
    }

    const normalizedRepoIdentifier = parsedRepos[0];
    if (normalizedRepoIdentifier !== settings.repoFullName) {
      updateSettings({ repoFullName: normalizedRepoIdentifier });
    }

    const mergedRepos = Array.from(new Set([...schedulerConfigDraft.repos, normalizedRepoIdentifier]));
    void persistMonitoredRepos(mergedRepos);
  }, [persistMonitoredRepos, schedulerConfigDraft, settings.repoFullName, updateSettings]);

  const removeRepoFromMonitor = useCallback((repoToRemove: string) => {
    if (schedulerConfigDraft === null) {
      return;
    }

    const remainingRepos = schedulerConfigDraft.repos.filter((repoPath) => repoPath !== repoToRemove);
    void persistMonitoredRepos(remainingRepos);
  }, [persistMonitoredRepos, schedulerConfigDraft]);

  return (
    <div className={styles.panel}>
      <div className={styles.settingsHeader}>
        <h3 className={styles.sectionTitle}>Workspace Settings</h3>
        <p className={styles.helpText}>
          Configure Git sync, Jira behavior, and legacy repo-monitor automation in one place.
        </p>
      </div>

      <div className={styles.settingsCard}>
        <h4 className={styles.sectionSubTitle}>GitHub Integration</h4>
        <div className={styles.settingsGrid}>
          <div className={`${styles.settingsField} ${styles.settingsFieldWide}`}>
            <label className={styles.fieldLabel}>GitHub Personal Access Token</label>
            <div className={styles.patInputRow}>
              <input
                type={isPatVisible ? 'text' : 'password'}
                className={styles.textInput}
                value={settings.githubPat}
                placeholder="ghp_..."
                onChange={(event) => updateSettings({ githubPat: event.target.value })}
              />
              <button className={styles.patVisibilityBtn} onClick={togglePatVisibility}>
                {isPatVisible ? 'Hide' : 'Show'}
              </button>
              <button className={styles.patClearBtn} onClick={clearGithubPat} disabled={!settings.githubPat}>
                Clear
              </button>
            </div>
          </div>
          <div className={styles.settingsField}>
            <label className={styles.fieldLabel} htmlFor="dw-primary-sync-repo">
              Primary Sync Repository (owner/repo or GitHub URL)
            </label>
            <div className={styles.repoAddRow}>
              <input
                id="dw-primary-sync-repo"
                type="text"
                className={styles.textInput}
                value={settings.repoFullName}
                placeholder="https://github.com/acme-corp/my-project"
                onChange={(event) => updateSettings({ repoFullName: event.target.value })}
                onBlur={() => {
                  const parsedRepos = parseRepoIdentifiersFromInput(settings.repoFullName);
                  if (parsedRepos.length > 0 && parsedRepos[0] !== settings.repoFullName) {
                    updateSettings({ repoFullName: parsedRepos[0] });
                  }
                }}
              />
              <button
                className={styles.secondaryBtn}
                onClick={addPrimarySyncRepoToMonitor}
                disabled={schedulerConfigDraft === null}
                title={schedulerConfigDraft === null ? 'Repo monitor settings are still loading.' : undefined}
              >
                Add to Monitor List
              </button>
            </div>
            <p className={styles.helpText}>
              Paste a GitHub URL or owner/repo. Use <strong>Add to Monitor List</strong> to include it in Repo Monitor.
            </p>
            {schedulerConfigDraft !== null && (
              <div className={styles.repoListContainer}>
                {schedulerConfigDraft.repos.length === 0 && (
                  <p className={styles.helpText}>No monitored repos yet.</p>
                )}
                {schedulerConfigDraft.repos.map((repoPath) => (
                  <div key={`quick-${repoPath}`} className={styles.repoListItem}>
                    <span className={styles.repoPathText}>{repoPath}</span>
                    <button
                      className={styles.patClearBtn}
                      onClick={() => removeRepoFromMonitor(repoPath)}
                      aria-label={`Remove ${repoPath}`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.settingsCard}>
        <h4 className={styles.sectionSubTitle}>Jira Integration</h4>
        <div className={styles.settingsGrid}>
          <div className={styles.settingsField}>
            <label className={styles.fieldLabel}>Jira Base URL</label>
            <input
              type="text"
              className={styles.textInput}
              value={settings.jiraBaseUrl}
              placeholder="https://your-org.atlassian.net"
              onChange={(event) => updateSettings({ jiraBaseUrl: event.target.value })}
            />
          </div>
          <div className={styles.settingsField}>
            <JiraProjectPicker
              id="dw-jira-project"
              label="Jira Project"
              onChange={(key) => updateSettings({ jiraProjectKey: key })}
              placeholder="Select a Jira project"
              value={settings.jiraProjectKey ?? ''}
            />
          </div>
        </div>
      </div>

      <div className={styles.settingsCard}>
        <h4 className={styles.sectionSubTitle}>Sync Settings</h4>
        <div className={styles.settingsGrid}>
          <div className={styles.settingsField}>
            <label className={styles.fieldLabel}>Sync Interval</label>
            <select
              className={styles.selectInput}
              value={settings.syncIntervalMinutes}
              onChange={(event) => updateSettings({ syncIntervalMinutes: Number(event.target.value) })}
            >
              <option value={5}>Every 5 minutes</option>
              <option value={10}>Every 10 minutes</option>
              <option value={15}>Every 15 minutes</option>
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every hour</option>
            </select>
          </div>
          <div className={styles.settingsField}>
            <label className={styles.fieldLabel}>Max Commits per Sync</label>
            <input
              type="number"
              className={styles.textInput}
              value={settings.maxCommitsPerSync}
              min={1}
              max={100}
              onChange={(event) => updateSettings({ maxCommitsPerSync: Number(event.target.value) })}
            />
          </div>
          <div className={styles.settingsField}>
            <label className={styles.fieldLabel}>Commit Key Pattern (regex)</label>
            <input
              type="text"
              className={styles.textInput}
              value={settings.commitKeyPattern}
              placeholder="[A-Z]+-\\d+"
              onChange={(event) => updateSettings({ commitKeyPattern: event.target.value })}
            />
          </div>
          <div className={styles.settingsField}>
            <label className={styles.fieldLabel}>Branch Prefixes to Strip</label>
            <input
              type="text"
              className={styles.textInput}
              value={settings.branchPrefixesToStrip}
              placeholder="feature/,bugfix/,fix/"
              onChange={(event) => updateSettings({ branchPrefixesToStrip: event.target.value })}
            />
          </div>
        </div>
      </div>

      <div className={styles.settingsCard}>
        <h4 className={styles.sectionSubTitle}>Posting Strategy</h4>
        <div className={styles.radioGroup}>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="postingStrategy"
              value="comment"
              checked={settings.postingStrategy === 'comment'}
              onChange={() => updateSettings({ postingStrategy: 'comment' })}
            />
            Post as Comment
          </label>
          <label className={styles.radioLabel}>
            <input
              type="radio"
              name="postingStrategy"
              value="worklog"
              checked={settings.postingStrategy === 'worklog'}
              onChange={() => updateSettings({ postingStrategy: 'worklog' })}
            />
            Post as Worklog
          </label>
        </div>
        <div className={styles.settingsField}>
          <label className={styles.fieldLabel}>Commit Message Template</label>
          <textarea
            className={styles.textArea}
            value={settings.commitMessageTemplate}
            rows={5}
            onChange={(event) => updateSettings({ commitMessageTemplate: event.target.value })}
          />
          <p className={styles.helpText}>
            Variables: <code>&#123;key&#125;</code>, <code>&#123;summary&#125;</code>, <code>&#123;branch&#125;</code>
          </p>
        </div>
      </div>

      <div className={styles.settingsCard}>
        <h4 className={styles.sectionSubTitle}>Repo Monitor Settings</h4>
        <p className={styles.helpText}>
          Legacy monitor defaults load from the server scheduler. Update values here, then save.
        </p>
        {isSchedulerLoading && <p className={styles.helpText}>Loading scheduler settings...</p>}
        {schedulerLoadError !== null && <p className={styles.errorText}>{schedulerLoadError}</p>}
        {legacyImportNotice !== null && <p className={styles.helpText}>{legacyImportNotice}</p>}
        {isJiraStatusLoading && <p className={styles.helpText}>Loading Jira status options...</p>}
        {jiraStatusLoadError !== null && <p className={styles.helpText}>Status options unavailable: {jiraStatusLoadError}</p>}
        {schedulerConfigDraft !== null && (
          <>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="checkbox"
                  checked={schedulerConfigDraft.enabled}
                  onChange={(event) => updateSchedulerDraft({ enabled: event.target.checked })}
                />
                Enable scheduler monitor
              </label>
            </div>

            <div className={styles.settingsGrid}>
              <div className={styles.settingsField}>
                <label className={styles.fieldLabel}>Monitor Interval</label>
                <select
                  className={styles.selectInput}
                  value={schedulerConfigDraft.intervalMin}
                  onChange={(event) => updateSchedulerDraft({ intervalMin: Number(event.target.value) })}
                >
                  <option value={1}>Every 1 minute</option>
                  <option value={5}>Every 5 minutes</option>
                  <option value={10}>Every 10 minutes</option>
                  <option value={15}>Every 15 minutes</option>
                  <option value={30}>Every 30 minutes</option>
                  <option value={60}>Every hour</option>
                </select>
              </div>
              <div className={styles.settingsField}>
                <label className={styles.fieldLabel}>Branch Pattern</label>
                <input
                  type="text"
                  className={styles.textInput}
                  value={schedulerConfigDraft.branchPattern}
                  onChange={(event) => updateSchedulerDraft({ branchPattern: event.target.value })}
                />
              </div>
              <div className={`${styles.settingsField} ${styles.settingsFieldWide}`}>
                <label className={styles.fieldLabel}>Repositories to Monitor</label>
                <p className={styles.helpText}>Paste a GitHub repo URL (or owner/repo), then click Add Repo.</p>
                <div className={styles.repoAddRow}>
                  <input
                    type="text"
                    className={styles.textInput}
                    value={repoInputText}
                    placeholder="https://github.com/owner/repo-name"
                    onChange={(event) => setRepoInputText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addReposToMonitor();
                      }
                    }}
                  />
                  <button className={styles.secondaryBtn} onClick={addReposToMonitor}>
                    Add Repo
                  </button>
                </div>
                <div className={styles.repoListContainer}>
                  {schedulerConfigDraft.repos.length === 0 && (
                    <p className={styles.helpText}>No repos configured yet.</p>
                  )}
                  {schedulerConfigDraft.repos.map((repoPath) => (
                    <div key={repoPath} className={styles.repoListItem}>
                      <span className={styles.repoPathText}>{repoPath}</span>
                      <button
                        className={styles.patClearBtn}
                        onClick={() => removeRepoFromMonitor(repoPath)}
                        aria-label={`Remove ${repoPath}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <h4 className={styles.sectionSubTitle}>Event Actions</h4>
            <p className={styles.helpText}>
              Enter the Jira status name to move an issue to when an event is detected. Leave blank to log the event without changing Jira status.
            </p>
            <div className={styles.settingsGrid}>
              <div className={styles.settingsField}>
                <label className={styles.fieldLabel}>On Branch Created → Jira Status</label>
                <select
                  className={styles.selectInput}
                  value={schedulerConfigDraft.transitions.branchCreated}
                  onChange={(event) =>
                    updateSchedulerDraft({
                      transitions: {
                        ...schedulerConfigDraft.transitions,
                        branchCreated: event.target.value,
                      },
                    })
                  }
                >
                  <option value="">No status change</option>
                  {buildTransitionChoices(schedulerConfigDraft.transitions.branchCreated).map((statusName) => (
                    <option key={statusName} value={statusName}>
                      {statusName}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.settingsField}>
                <label className={styles.fieldLabel}>On Commit Pushed → Jira Status</label>
                <select
                  className={styles.selectInput}
                  value={schedulerConfigDraft.transitions.commitPushed}
                  onChange={(event) =>
                    updateSchedulerDraft({
                      transitions: {
                        ...schedulerConfigDraft.transitions,
                        commitPushed: event.target.value,
                      },
                    })
                  }
                >
                  <option value="">No status change</option>
                  {buildTransitionChoices(schedulerConfigDraft.transitions.commitPushed).map((statusName) => (
                    <option key={statusName} value={statusName}>
                      {statusName}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.settingsField}>
                <label className={styles.fieldLabel}>On PR Opened → Jira Status</label>
                <select
                  className={styles.selectInput}
                  value={schedulerConfigDraft.transitions.prOpened}
                  onChange={(event) =>
                    updateSchedulerDraft({
                      transitions: {
                        ...schedulerConfigDraft.transitions,
                        prOpened: event.target.value,
                      },
                    })
                  }
                >
                  <option value="">No status change</option>
                  {buildTransitionChoices(schedulerConfigDraft.transitions.prOpened).map((statusName) => (
                    <option key={statusName} value={statusName}>
                      {statusName}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.settingsField}>
                <label className={styles.fieldLabel}>On PR Merged → Jira Status</label>
                <select
                  className={styles.selectInput}
                  value={schedulerConfigDraft.transitions.prMerged}
                  onChange={(event) =>
                    updateSchedulerDraft({
                      transitions: {
                        ...schedulerConfigDraft.transitions,
                        prMerged: event.target.value,
                      },
                    })
                  }
                >
                  <option value="">No status change</option>
                  {buildTransitionChoices(schedulerConfigDraft.transitions.prMerged).map((statusName) => (
                    <option key={statusName} value={statusName}>
                      {statusName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.settingsActions}>
              <button className={styles.primaryBtn} onClick={() => void saveSchedulerConfig()} disabled={isSchedulerSaving}>
                {isSchedulerSaving ? 'Saving...' : 'Save Repo Monitor Settings'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
