// DevWorkspaceView.tsx — Tabbed Dev Workspace view for time tracking, Git sync, and monitoring.

import { useEffect } from 'react';
import { useDevWorkspaceSettings } from './hooks/useDevWorkspaceSettings.ts';
import { useGitHubPollingEngine } from './hooks/useGitHubPollingEngine.ts';
import { useDevWorkspaceState } from './hooks/useDevWorkspaceState.ts';
import type { DevWorkspaceTab, WorkLogTab, GitSyncSubTab } from './hooks/useDevWorkspaceState.ts';
import styles from './DevWorkspaceView.module.css';

const TICK_INTERVAL_MS = 1000;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const HOOK_GENERATOR_SCRIPTS = [
  { name: 'post-commit hook', filename: 'post-commit' },
  { name: 'pre-push hook', filename: 'pre-push' },
  { name: 'commit-msg hook', filename: 'commit-msg' },
] as const;

/** Script contents for each downloadable Git hook. Keyed by filename. */
const HOOK_SCRIPT_CONTENTS: Record<string, string> = {
  'post-commit': `#!/bin/sh
# post-commit — Logs the latest commit message to stdout after each commit.
# Install: copy to .git/hooks/post-commit and chmod +x

COMMIT_MSG=$(git log -1 --pretty=%B)
BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "✅ Committed on $BRANCH: $COMMIT_MSG"

# Extract Jira issue key from branch name (e.g. feature/PROJ-123-my-feature)
ISSUE_KEY=$(echo "$BRANCH" | grep -oE '[A-Z]+-[0-9]+' | head -1)
if [ -n "$ISSUE_KEY" ]; then
  echo "🔗 Linked Jira issue: $ISSUE_KEY"
fi
`,
  'pre-push': `#!/bin/sh
# pre-push — Validates that the branch name contains a Jira issue key before pushing.
# Install: copy to .git/hooks/pre-push and chmod +x

BRANCH=$(git rev-parse --abbrev-ref HEAD)
ISSUE_KEY=$(echo "$BRANCH" | grep -oE '[A-Z]+-[0-9]+' | head -1)

if [ -z "$ISSUE_KEY" ]; then
  echo "⚠️  Warning: Branch '$BRANCH' does not contain a Jira issue key."
  echo "   Rename your branch to include a key (e.g. feature/PROJ-123-description)."
  # Remove 'exit 1' below to make this a warning instead of a blocker
  # exit 1
fi

exit 0
`,
  'commit-msg': `#!/bin/sh
# commit-msg — Prepends the Jira issue key (from branch name) to commit messages.
# Install: copy to .git/hooks/commit-msg and chmod +x

COMMIT_MSG_FILE="$1"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
ISSUE_KEY=$(echo "$BRANCH" | grep -oE '[A-Z]+-[0-9]+' | head -1)

if [ -z "$ISSUE_KEY" ]; then
  exit 0
fi

CURRENT_MSG=$(cat "$COMMIT_MSG_FILE")

# Only prepend if the key isn't already in the message
if ! echo "$CURRENT_MSG" | grep -q "$ISSUE_KEY"; then
  echo "$ISSUE_KEY $CURRENT_MSG" > "$COMMIT_MSG_FILE"
fi

exit 0
`,
};

/**
 * Generates the PowerShell post-commit hook content baked with workspace settings.
 * Extracts a Jira key from the commit message and posts a comment via the proxy API.
 */
function buildPowerShellPostCommitScript(jiraBaseUrl: string, keyPattern: string): string {
  return `# post-commit.ps1 — Posts a Jira comment on every commit that contains a project key.
# Install: call from .git/hooks/post-commit via: powershell -File "path/to/post-commit.ps1"

$commitMsg = git log -1 --pretty=%B
$branch = git rev-parse --abbrev-ref HEAD
$keyRegex = "${keyPattern}"
$match = [regex]::Match($commitMsg, $keyRegex)

if (-not $match.Success) {
  Write-Host "No Jira key found in commit message — skipping post."
  exit 0
}

$issueKey = $match.Value
$jiraBase = "${jiraBaseUrl}"
$body = @{ body = "Git commit on branch $branch — $commitMsg" } | ConvertTo-Json

Invoke-RestMethod -Method POST -Uri "$jiraBase/rest/api/2/issue/$issueKey/comment" \`
  -ContentType "application/json" -Body $body

Write-Host "Posted comment to Jira issue $issueKey"
`
}

/**
 * Generates the PowerShell post-merge hook content baked with workspace settings.
 * Extracts a Jira key from the last merge commit message and posts a worklog entry.
 */
function buildPowerShellPostMergeScript(jiraBaseUrl: string, keyPattern: string): string {
  return `# post-merge.ps1 — Posts a Jira worklog entry on every merge that contains a project key.
# Install: call from .git/hooks/post-merge via: powershell -File "path/to/post-merge.ps1"

$commitMsg = git log -1 --pretty=%B
$branch = git rev-parse --abbrev-ref HEAD
$keyRegex = "${keyPattern}"
$match = [regex]::Match($commitMsg, $keyRegex)

if (-not $match.Success) {
  Write-Host "No Jira key found in merge commit — skipping worklog."
  exit 0
}

$issueKey = $match.Value
$jiraBase = "${jiraBaseUrl}"
$body = @{ timeSpent = "1m"; comment = "Merged into $branch" } | ConvertTo-Json

Invoke-RestMethod -Method POST -Uri "$jiraBase/rest/api/2/issue/$issueKey/worklog" \`
  -ContentType "application/json" -Body $body

Write-Host "Logged worklog on Jira issue $issueKey"
`
}

/**
 * Triggers a browser file download for the given hook script content.
 * Uses Blob and a temporary anchor element — no server request needed.
 *
 * @param filename - The Git hook filename (e.g. 'post-commit')
 * @param content  - The shell script text content to download
 */
function downloadHookScript(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Extracts all unique Jira issue keys from the input text using the provided regex pattern.
 * Returns an empty array when the pattern is invalid or no keys are found.
 */
function extractJiraKeysFromText(inputText: string, keyPattern: string): string[] {
  if (!inputText.trim() || !keyPattern.trim()) return []
  try {
    const regex = new RegExp(keyPattern, 'g')
    const matches = inputText.match(regex) ?? []
    return [...new Set(matches)]
  } catch {
    return []
  }
}

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
      <div className={styles.tabBar} role="tablist">
        <TabButton label="⏱ Time Tracking" tabKey="time" activeTab={state.activeTab} onSelect={actions.setActiveTab} />
        <TabButton label="🔧 Git Sync" tabKey="gitsync" activeTab={state.activeTab} onSelect={actions.setActiveTab} />
        <TabButton label="🔁 Repo Monitor" tabKey="monitor" activeTab={state.activeTab} onSelect={actions.setActiveTab} />
        <TabButton label="⚙ Settings" tabKey="settings" activeTab={state.activeTab} onSelect={actions.setActiveTab} />
      </div>

      <div className={styles.tabContent}>
        {state.activeTab === 'time' && <TimeTrackingPanel state={state} actions={actions} />}
        {state.activeTab === 'gitsync' && <GitSyncPanel state={state} actions={actions} />}
        {state.activeTab === 'monitor' && <RepoMonitorPanel state={state} actions={actions} />}
        {state.activeTab === 'settings' && <WorkspaceSettingsPanel />}
      </div>
    </div>
  );
}

interface TabButtonProps {
  label: string;
  tabKey: DevWorkspaceTab;
  activeTab: DevWorkspaceTab;
  onSelect: (tab: DevWorkspaceTab) => void;
}

/** Renders a single top-level tab button with active/inactive styling. */
function TabButton({ label, tabKey, activeTab, onSelect }: TabButtonProps) {
  const isActive = activeTab === tabKey;
  return (
    <button
      role="tab"
      aria-selected={isActive}
      className={`${styles.tabBtn} ${isActive ? styles.tabBtnActive : ''}`}
      onClick={() => onSelect(tabKey)}
    >
      {label}
    </button>
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

interface GitSyncSubTabButtonProps {
  label: string;
  tabKey: GitSyncSubTab;
  activeTab: GitSyncSubTab;
  onSelect: (tab: GitSyncSubTab) => void;
}

/** Renders a sub-tab button for the Git Sync section. */
function GitSyncSubTabButton({ label, tabKey, activeTab, onSelect }: GitSyncSubTabButtonProps) {
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

/** Renders the Git Sync tab with GitHub sync (polling engine), manual Jira post, and hook generator sub-tabs. */
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
  })

  // Preview which Jira keys the manual post input would match
  const extractedPreviewKeys = extractJiraKeysFromText(
    state.manualPostInput,
    settings.commitKeyPattern,
  )

  return (
    <div className={styles.panel}>
      <div className={styles.workLogSubTabs} role="tablist">
        <GitSyncSubTabButton label="⟳ GitHub Sync" tabKey="sync" activeTab={state.gitSyncSubTab} onSelect={actions.setGitSyncSubTab} />
        <GitSyncSubTabButton label="✏ Manual Post" tabKey="manual" activeTab={state.gitSyncSubTab} onSelect={actions.setGitSyncSubTab} />
        <GitSyncSubTabButton label="⚙ Hook Generator" tabKey="hooks" activeTab={state.gitSyncSubTab} onSelect={actions.setGitSyncSubTab} />
      </div>

      {state.gitSyncSubTab === 'sync' && (
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
                if (pollingEngine.isRunning) { pollingEngine.stopPolling() }
                else { pollingEngine.startPolling() }
              }}
            >
              {pollingEngine.isRunning ? '⏹ Stop Sync' : '▶ Start Sync'}
            </button>
            <button
              className={styles.secondaryBtn}
              onClick={() => { void pollingEngine.syncNow() }}
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
      )}

      {state.gitSyncSubTab === 'manual' && (
        <div className={styles.manualPostPanel}>
          <label className={styles.fieldLabel}>Issue reference or text with Jira key</label>
          <input
            type="text"
            className={styles.textInput}
            value={state.manualPostInput}
            onChange={(event) => actions.setManualPostInput(event.target.value)}
            placeholder="e.g. TBX-42 or any text containing a Jira key"
          />
          {/* Key extraction preview using settings.commitKeyPattern */}
          {state.manualPostInput.trim().length > 0 && (
            <div className={styles.keyPillSection}>
              {extractedPreviewKeys.length > 0 ? (
                <>
                  <span className={styles.fieldLabel}>Will post to:</span>
                  <div className={styles.keyPillList}>
                    {extractedPreviewKeys.map((jiraKey) => (
                      <span key={jiraKey} className={styles.keyPill}>{jiraKey}</span>
                    ))}
                  </div>
                </>
              ) : (
                <span className={styles.helpText}>No Jira keys found in input.</span>
              )}
            </div>
          )}
          <label className={styles.fieldLabel}>Comment</label>
          <textarea
            className={styles.textArea}
            value={state.manualPostComment}
            onChange={(event) => actions.setManualPostComment(event.target.value)}
            placeholder="Enter comment text (leave blank for default message)"
            rows={4}
          />
          <div className={styles.manualPostActions}>
            <button
              className={styles.primaryBtn}
              onClick={() => actions.postManualComment()}
              disabled={state.isManualPosting || extractedPreviewKeys.length === 0}
            >
              {state.isManualPosting ? 'Posting…' : `Post to All${extractedPreviewKeys.length > 0 ? ` (${extractedPreviewKeys.length})` : ''}`}
            </button>
            <button className={styles.secondaryBtn} onClick={actions.resetManualPost}>Reset</button>
          </div>
          {state.manualPostResult && (
            <p className={styles.postResult}>{state.manualPostResult}</p>
          )}
        </div>
      )}

      {state.gitSyncSubTab === 'hooks' && (
        <div className={styles.hookGeneratorPanel}>
          <h3>Git Hook Generator</h3>
          <p className={styles.helpText}>Download and install these hooks to automatically sync commit messages to Jira.</p>
          <div className={styles.hookButtonList}>
            {HOOK_GENERATOR_SCRIPTS.map((hookScript) => (
              <button
                key={hookScript.filename}
                className={styles.secondaryBtn}
                onClick={() => {
                  downloadHookScript(hookScript.filename, HOOK_SCRIPT_CONTENTS[hookScript.filename] ?? '');
                }}
              >
                ⬇ Download {hookScript.name}
              </button>
            ))}
          </div>

          {/* PowerShell hooks — baked with settings.jiraBaseUrl and settings.commitKeyPattern */}
          <div className={styles.psHooksSection}>
            <h4 className={styles.sectionSubTitle}>PowerShell Hooks (Windows)</h4>
            <p className={styles.helpText}>
              These scripts are pre-configured with your Jira base URL and key pattern.
              {!settings.jiraBaseUrl && (
                <strong> Set your Jira base URL in Settings first.</strong>
              )}
            </p>
            <div className={styles.hookButtonList}>
              <button
                className={styles.secondaryBtn}
                disabled={!settings.jiraBaseUrl}
                onClick={() => {
                  const scriptContent = buildPowerShellPostCommitScript(
                    settings.jiraBaseUrl,
                    settings.commitKeyPattern,
                  )
                  downloadHookScript('post-commit.ps1', scriptContent)
                }}
              >
                ⬇ Download post-commit.ps1
              </button>
              <button
                className={styles.secondaryBtn}
                disabled={!settings.jiraBaseUrl}
                onClick={() => {
                  const scriptContent = buildPowerShellPostMergeScript(
                    settings.jiraBaseUrl,
                    settings.commitKeyPattern,
                  )
                  downloadHookScript('post-merge.ps1', scriptContent)
                }}
              >
                ⬇ Download post-merge.ps1
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Renders the Repo Monitor tab for tracking repository activity. */
function RepoMonitorPanel({ state, actions }: PanelProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.syncStatus}>
        <span
          className={`${styles.statusDot} ${state.isSyncRunning ? styles.statusDotActive : styles.statusDotIdle}`}
          aria-label={state.isSyncRunning ? 'Monitoring' : 'Stopped'}
        />
        <span>{state.isSyncRunning ? 'Monitor Active' : 'Monitor Stopped'}</span>
      </div>
      <div className={styles.syncControls}>
        <button className={styles.primaryBtn} onClick={actions.toggleSync}>
          {state.isSyncRunning ? '⏹ Stop Monitor' : '▶ Start Monitor'}
        </button>
        <button className={styles.secondaryBtn}>Check Now</button>
      </div>
      <div className={styles.syncLog}>
        {state.syncLog.length === 0 && (
          <span className={styles.emptyState}>No monitor log entries.</span>
        )}
        {state.syncLog.map((entry, index) => (
          <div key={index} className={styles.syncLogEntry}>{entry}</div>
        ))}
      </div>
    </div>
  );
}

/** Renders the Settings tab for Dev Workspace configuration — full settings surface. */
function WorkspaceSettingsPanel() {
  const { settings, isPatVisible, updateSettings, clearGithubPat, togglePatVisibility } =
    useDevWorkspaceSettings()

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Workspace Settings</h3>

      {/* GitHub PAT — password field with show/hide and clear buttons */}
      <div className={styles.settingsSection}>
        <h4 className={styles.sectionSubTitle}>GitHub Integration</h4>
        <label className={styles.fieldLabel}>GitHub Personal Access Token</label>
        <div className={styles.patInputRow}>
          <input
            type={isPatVisible ? 'text' : 'password'}
            className={styles.textInput}
            value={settings.githubPat}
            placeholder="ghp_…"
            onChange={(event) => updateSettings({ githubPat: event.target.value })}
          />
          <button className={styles.patVisibilityBtn} onClick={togglePatVisibility}>
            {isPatVisible ? '🙈 Hide' : '👁 Show'}
          </button>
          <button className={styles.patClearBtn} onClick={clearGithubPat} disabled={!settings.githubPat}>
            ✕ Clear
          </button>
        </div>
        <label className={styles.fieldLabel}>Repository (owner/repo)</label>
        <input
          type="text"
          className={styles.textInput}
          value={settings.repoFullName}
          placeholder="e.g. acme-corp/my-project"
          onChange={(event) => updateSettings({ repoFullName: event.target.value })}
        />
      </div>

      {/* Jira settings */}
      <div className={styles.settingsSection}>
        <h4 className={styles.sectionSubTitle}>Jira Integration</h4>
        <label className={styles.fieldLabel}>Jira Base URL</label>
        <input
          type="text"
          className={styles.textInput}
          value={settings.jiraBaseUrl}
          placeholder="e.g. https://your-org.atlassian.net"
          onChange={(event) => updateSettings({ jiraBaseUrl: event.target.value })}
        />
        <label className={styles.fieldLabel}>Default Project Key</label>
        <input
          type="text"
          className={styles.textInput}
          value={settings.jiraProjectKey}
          placeholder="e.g. TBX"
          onChange={(event) => updateSettings({ jiraProjectKey: event.target.value })}
        />
      </div>

      {/* Sync settings */}
      <div className={styles.settingsSection}>
        <h4 className={styles.sectionSubTitle}>Sync Settings</h4>
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
        <label className={styles.fieldLabel}>Max Commits per Sync</label>
        <input
          type="number"
          className={styles.textInput}
          value={settings.maxCommitsPerSync}
          min={1}
          max={100}
          onChange={(event) => updateSettings({ maxCommitsPerSync: Number(event.target.value) })}
        />
        <label className={styles.fieldLabel}>Commit Key Pattern (regex)</label>
        <input
          type="text"
          className={styles.textInput}
          value={settings.commitKeyPattern}
          placeholder="e.g. [A-Z]+-\d+"
          onChange={(event) => updateSettings({ commitKeyPattern: event.target.value })}
        />
        <label className={styles.fieldLabel}>Branch Prefixes to Strip (comma-separated)</label>
        <input
          type="text"
          className={styles.textInput}
          value={settings.branchPrefixesToStrip}
          placeholder="e.g. feature/,bugfix/,fix/"
          onChange={(event) => updateSettings({ branchPrefixesToStrip: event.target.value })}
        />
      </div>

      {/* Posting strategy */}
      <div className={styles.settingsSection}>
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
        <label className={styles.fieldLabel}>Commit Message Template</label>
        <textarea
          className={styles.textArea}
          value={settings.commitMessageTemplate}
          rows={4}
          onChange={(event) => updateSettings({ commitMessageTemplate: event.target.value })}
        />
        <p className={styles.helpText}>
          Variables: <code>&#123;key&#125;</code>, <code>&#123;summary&#125;</code>, <code>&#123;branch&#125;</code>
        </p>
      </div>
    </div>
  )
}
