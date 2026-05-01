// src/services/repoMonitor.js — Background GitHub repo monitor and Jira event poster.
//
// Polls configured GitHub repositories on a schedule and posts Jira comments when
// feature branches are created, commits are pushed, or pull requests are opened/merged.
// Mirrors the browser's repo monitor logic so automation continues when the browser is closed.

'use strict';

const { makeGithubApiRequest, makeJiraApiRequest } = require('../utils/httpClient');

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of scheduler events kept in the in-memory ring buffer */
const MAX_RESULT_EVENTS = 100;

/**
 * Maximum number of branch names tracked per repo.
 * Old entries are trimmed once this limit is reached.
 */
const MAX_SEEN_BRANCHES_PER_REPO = 500;

/** How often the scheduler loop checks whether a run is due (in milliseconds) */
const SCHEDULER_LOOP_INTERVAL_MS = 30000;

// ── Module State ──────────────────────────────────────────────────────────────

/**
 * Ring buffer of the last MAX_RESULT_EVENTS scheduler results.
 * Prepended (unshift) so the most recent event is always at index 0.
 */
const schedulerResultEvents = [];

/**
 * Transient runtime stats — reset on every server restart.
 * These are not persisted to disk because they reflect the current process lifecycle.
 */
const schedulerRuntimeStats = {
  repoMonitor: {
    lastRunAt:  null,  // ISO-8601 UTC timestamp of the most recently completed run
    nextRunAt:  null,  // ISO-8601 UTC timestamp of the next scheduled run
    eventCount: 0,     // Total Jira events posted since the server started
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Starts the background scheduler loop. Checks every 30 seconds whether a run
 * is due based on the configured intervalMin. Safe to call once at startup.
 *
 * @param {import('../config/loader').ProxyConfig} configuration - Live config reference
 */
function startSchedulerLoop(configuration) {
  console.log('  [Scheduler] Background loop started');

  setInterval(() => {
    try {
      const repoMonitor = configuration.scheduler && configuration.scheduler.repoMonitor;
      if (!repoMonitor || !repoMonitor.enabled) return;

      const lastRunTimestamp  = schedulerRuntimeStats.repoMonitor.lastRunAt;
      const intervalInSeconds = (repoMonitor.intervalMin || 15) * 60;

      // Run immediately on first tick after being enabled (no lastRunAt yet)
      if (!lastRunTimestamp) {
        runRepoMonitor(configuration).catch((loopError) => {
          console.error('  [Scheduler] Run error: ' + loopError.message);
        });
        return;
      }

      const elapsedSeconds = (Date.now() - new Date(lastRunTimestamp).getTime()) / 1000;
      if (elapsedSeconds >= intervalInSeconds) {
        runRepoMonitor(configuration).catch((loopError) => {
          console.error('  [Scheduler] Run error: ' + loopError.message);
        });
      }
    } catch (unexpectedError) {
      console.error('  [Scheduler] Loop error: ' + unexpectedError.message);
    }
  }, SCHEDULER_LOOP_INTERVAL_MS);
}

/**
 * Runs the repo monitor immediately — polls all configured repos and posts
 * Jira comments for any new branches, commits, or PRs detected.
 * Also persists updated seen-state to toolbox-proxy.json.
 *
 * @param {import('../config/loader').ProxyConfig} configuration
 * @returns {Promise<void>}
 */
function runRepoMonitor(configuration) {
  const repoMonitor = configuration.scheduler && configuration.scheduler.repoMonitor;
  if (!repoMonitor) return Promise.resolve();

  const { repos, branchPattern, transitions, intervalMin } = repoMonitor;

  if (!repos || repos.length === 0) {
    console.log('  [Scheduler] No repos configured — skipping run');
    return Promise.resolve();
  }

  if (!configuration.github || !configuration.github.pat) {
    console.log('  [Scheduler] GitHub PAT not configured — skipping run');
    return Promise.resolve();
  }

  let compiledBranchRegex;
  try {
    compiledBranchRegex = new RegExp(branchPattern);
  } catch (_regexError) {
    compiledBranchRegex = /feature\/[A-Z]+-\d+/;
  }

  // Deep-copy the seen-state to detect changes atomically before persisting
  const workingSeenBranches = JSON.parse(JSON.stringify(repoMonitor.seenBranches || {}));
  const workingSeenCommits  = JSON.parse(JSON.stringify(repoMonitor.seenCommits  || {}));
  const workingSeenPrs      = JSON.parse(JSON.stringify(repoMonitor.seenPrs      || {}));

  console.log('  [Scheduler] Repo Monitor starting — ' + repos.length + ' repo(s)');
  let eventsPostedThisRun = 0;

  // Chain repos sequentially to avoid hammering GitHub API rate limits
  let processingChain = Promise.resolve();
  repos.forEach((repoFullPath) => {
    processingChain = processingChain.then(() =>
      pollSingleRepo(
        repoFullPath,
        compiledBranchRegex,
        transitions,
        workingSeenBranches,
        workingSeenCommits,
        workingSeenPrs,
        configuration,
        (eventCount) => { eventsPostedThisRun += eventCount; }
      )
    );
  });

  return processingChain.then(() => {
    // Persist updated state back to config so it survives server restarts
    repoMonitor.seenBranches = workingSeenBranches;
    repoMonitor.seenCommits  = workingSeenCommits;
    repoMonitor.seenPrs      = workingSeenPrs;

    const nowIso  = new Date().toISOString();
    const nextIso = new Date(Date.now() + (intervalMin || 15) * 60 * 1000).toISOString();
    schedulerRuntimeStats.repoMonitor.lastRunAt = nowIso;
    schedulerRuntimeStats.repoMonitor.nextRunAt = nextIso;

    // Lazy-load saveConfigToDisk to avoid a circular dependency at module load time
    const { saveConfigToDisk } = require('../config/loader');
    saveConfigToDisk(configuration);

    console.log('  [Scheduler] Run complete — ' + eventsPostedThisRun + ' event(s) posted');
  });
}

/**
 * Returns the current scheduler status for the /api/scheduler/status endpoint.
 *
 * @param {import('../config/loader').ProxyConfig} configuration
 * @returns {object}
 */
function getSchedulerStatus(configuration) {
  const repoMonitor = (configuration.scheduler && configuration.scheduler.repoMonitor) || {};
  return {
    repoMonitor: {
      enabled:     !!repoMonitor.enabled,
      repos:       repoMonitor.repos       || [],
      intervalMin: repoMonitor.intervalMin || 15,
      lastRunAt:   schedulerRuntimeStats.repoMonitor.lastRunAt,
      nextRunAt:   schedulerRuntimeStats.repoMonitor.nextRunAt,
      eventCount:  schedulerRuntimeStats.repoMonitor.eventCount,
    },
  };
}

/**
 * Returns the most recent scheduler result events (up to 50).
 *
 * @returns {object}
 */
function getSchedulerResults() {
  return {
    repoMonitor: {
      lastRunAt:  schedulerRuntimeStats.repoMonitor.lastRunAt,
      nextRunAt:  schedulerRuntimeStats.repoMonitor.nextRunAt,
      eventCount: schedulerRuntimeStats.repoMonitor.eventCount,
      events:     schedulerResultEvents.slice(0, 50),
    },
  };
}

/**
 * Updates the scheduler configuration and resets the run timer so changes
 * take effect on the next scheduler loop tick.
 *
 * @param {import('../config/loader').ProxyConfig} configuration - Mutated in place
 * @param {object} incomingSchedulerConfig - New scheduler settings from the API request
 */
function applySchedulerConfig(configuration, incomingSchedulerConfig) {
  const incomingMonitor = incomingSchedulerConfig.repoMonitor || {};
  const repoMonitor     = configuration.scheduler.repoMonitor;

  if (incomingMonitor.hasOwnProperty('enabled'))    repoMonitor.enabled       = !!incomingMonitor.enabled;
  if (Array.isArray(incomingMonitor.repos))          repoMonitor.repos         = incomingMonitor.repos;
  if (incomingMonitor.branchPattern)                 repoMonitor.branchPattern = String(incomingMonitor.branchPattern);
  if (incomingMonitor.intervalMin) {
    repoMonitor.intervalMin = Math.max(1, parseInt(incomingMonitor.intervalMin, 10) || 15);
  }
  if (incomingMonitor.transitions && typeof incomingMonitor.transitions === 'object') {
    repoMonitor.transitions = incomingMonitor.transitions;
  }

  if (repoMonitor.enabled) {
    // Reset the last-run timestamp so the monitor fires on the next loop tick
    schedulerRuntimeStats.repoMonitor.lastRunAt = null;
    schedulerRuntimeStats.repoMonitor.nextRunAt = null;
    console.log('  [Scheduler] Repo Monitor enabled — ' + repoMonitor.repos.length + ' repo(s), every ' + repoMonitor.intervalMin + ' min(s)');
  } else {
    console.log('  [Scheduler] Repo Monitor disabled');
  }
}

// ── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Polls a single GitHub repository for new branches, commits, and PRs,
 * posting Jira comments for any new events detected.
 *
 * @param {string}   repoFullPath          - "owner/repo" GitHub path
 * @param {RegExp}   branchRegex           - Pattern matching feature branches to track
 * @param {object}   jiraTransitions       - Map of event type → Jira transition name
 * @param {object}   workingSeenBranches   - Mutable seen-branches state (mutated in place)
 * @param {object}   workingSeenCommits    - Mutable seen-commits state (mutated in place)
 * @param {object}   workingSeenPrs        - Mutable seen-PRs state (mutated in place)
 * @param {object}   configuration         - Live config for credentials
 * @param {Function} onEventsPosted        - Callback receiving count of events posted
 * @returns {Promise<void>}
 */
function pollSingleRepo(
  repoFullPath,
  branchRegex,
  jiraTransitions,
  workingSeenBranches,
  workingSeenCommits,
  workingSeenPrs,
  configuration,
  onEventsPosted
) {
  const githubPat     = configuration.github.pat;
  const githubBaseUrl = configuration.github.baseUrl;
  const isTlsVerified = configuration.sslVerify !== false;

  return Promise.all([
    makeGithubApiRequest('/repos/' + repoFullPath + '/branches?per_page=100', githubPat, githubBaseUrl, isTlsVerified),
    makeGithubApiRequest('/repos/' + repoFullPath + '/pulls?state=all&per_page=50&sort=updated&direction=desc', githubPat, githubBaseUrl, isTlsVerified),
  ])
    .then(([branchesResult, pullRequestsResult]) => {
      const branchList     = Array.isArray(branchesResult.body)     ? branchesResult.body     : [];
      const pullRequestList = Array.isArray(pullRequestsResult.body) ? pullRequestsResult.body : [];
      let eventsThisRepo   = 0;

      let eventChain = processBranches(
        branchList, repoFullPath, branchRegex, jiraTransitions,
        workingSeenBranches, workingSeenCommits, configuration,
        (count) => { eventsThisRepo += count; }
      );

      eventChain = processPullRequests(
        pullRequestList, repoFullPath, branchRegex, jiraTransitions,
        workingSeenPrs, configuration, eventChain,
        (count) => { eventsThisRepo += count; }
      );

      return eventChain.then(() => onEventsPosted(eventsThisRepo));
    })
    .catch((pollError) => {
      console.log('  [Scheduler] Error polling ' + repoFullPath + ': ' + pollError.message);
      appendResultEvent({
        repo:      repoFullPath,
        eventType: 'error',
        jiraKey:   '',
        message:   'poll error: ' + pollError.message.slice(0, 100),
        isSuccess: false,
      });
    });
}

/**
 * Processes the branch list for a repo, detecting new branches and new commits
 * on tracked branches, and returning a promise chain of Jira comment posts.
 */
function processBranches(
  branchList, repoFullPath, branchRegex, jiraTransitions,
  workingSeenBranches, workingSeenCommits, configuration, onEventsPosted
) {
  let eventChain = Promise.resolve();

  branchList.forEach((branchData) => {
    const branchName = branchData.name || '';
    const headSha    = (branchData.commit || {}).sha || '';
    if (!branchRegex.test(branchName)) return;

    const jiraIssueKey = extractJiraIssueKey(branchName);
    if (!jiraIssueKey) return;

    const repoBranches   = workingSeenBranches[repoFullPath] || [];
    const isNewBranch    = repoBranches.indexOf(branchName) === -1;
    const previousSha    = (workingSeenCommits[repoFullPath] || {})[branchName];
    const hasNewCommit   = !isNewBranch && previousSha && headSha && previousSha !== headSha;

    if (!workingSeenCommits[repoFullPath]) workingSeenCommits[repoFullPath] = {};
    workingSeenCommits[repoFullPath][branchName] = headSha;

    if (isNewBranch) {
      if (!workingSeenBranches[repoFullPath]) workingSeenBranches[repoFullPath] = [];
      workingSeenBranches[repoFullPath].push(branchName);
      if (workingSeenBranches[repoFullPath].length > MAX_SEEN_BRANCHES_PER_REPO) {
        workingSeenBranches[repoFullPath] = workingSeenBranches[repoFullPath].slice(-MAX_SEEN_BRANCHES_PER_REPO);
      }
      onEventsPosted(1);
      eventChain = eventChain.then(() =>
        postJiraCommentForEvent(
          jiraIssueKey,
          '🔀 GitHub: branch created and work has started.',
          'branch_created',
          repoFullPath,
          jiraTransitions,
          configuration
        )
      );
    } else if (hasNewCommit) {
      onEventsPosted(1);
      eventChain = eventChain.then(() =>
        postJiraCommentForEvent(
          jiraIssueKey,
          '✅ GitHub: new commit pushed to feature branch.',
          'commit_pushed',
          repoFullPath,
          jiraTransitions,
          configuration
        )
      );
    }
  });

  return eventChain;
}

/**
 * Processes the pull request list for a repo, detecting new and newly-merged PRs.
 * Chains onto the provided eventChain so PR events fire after branch events.
 */
function processPullRequests(
  pullRequestList, repoFullPath, branchRegex, jiraTransitions,
  workingSeenPrs, configuration, existingChain, onEventsPosted
) {
  let eventChain  = existingChain;
  const repoPrs   = Object.assign({}, workingSeenPrs[repoFullPath] || {});

  pullRequestList.forEach((prData) => {
    const headBranchName = (prData.head || {}).ref || '';
    if (!branchRegex.test(headBranchName)) return;

    const jiraIssueKey = extractJiraIssueKey(headBranchName);
    if (!jiraIssueKey) return;

    const prNumberString = String(prData.number || '');
    const isPrOpen       = prData.state === 'open';
    const isPrMerged     = !!prData.merged_at;
    const previousPrState = repoPrs[prNumberString];

    if (!previousPrState && isPrOpen) {
      repoPrs[prNumberString] = 'open';
      onEventsPosted(1);
      eventChain = eventChain.then(() =>
        postJiraCommentForEvent(
          jiraIssueKey,
          '📬 GitHub: pull request opened for review.',
          'pr_opened',
          repoFullPath,
          jiraTransitions,
          configuration
        )
      );
    } else if (previousPrState === 'open' && isPrMerged) {
      repoPrs[prNumberString] = 'merged';
      onEventsPosted(1);
      eventChain = eventChain.then(() =>
        postJiraCommentForEvent(
          jiraIssueKey,
          '🎉 GitHub: pull request has been merged.',
          'pr_merged',
          repoFullPath,
          jiraTransitions,
          configuration
        )
      );
    } else if (!previousPrState && isPrMerged) {
      // Already merged when first seen — record state but don't post a duplicate comment
      repoPrs[prNumberString] = 'merged';
    }
  });

  workingSeenPrs[repoFullPath] = repoPrs;
  return eventChain;
}

/**
 * Posts a Jira comment for a repo event and optionally fires a Jira transition.
 * Records the result in the in-memory ring buffer regardless of success or failure.
 *
 * @param {string} jiraIssueKey     - Jira issue key (e.g. PROJ-1234)
 * @param {string} commentText      - Comment body to post
 * @param {string} eventTypeName    - One of: branch_created, commit_pushed, pr_opened, pr_merged
 * @param {string} repoFullPath     - "owner/repo" GitHub path (for logging)
 * @param {object} jiraTransitions  - Map of event type key → Jira status transition name
 * @param {object} configuration    - Live config for credentials
 */
function postJiraCommentForEvent(jiraIssueKey, commentText, eventTypeName, repoFullPath, jiraTransitions, configuration) {
  const shortRepoName      = repoFullPath.split('/').pop() || repoFullPath;
  const isTlsVerified      = configuration.sslVerify !== false;

  return makeJiraApiRequest(
    'POST',
    '/rest/api/2/issue/' + encodeURIComponent(jiraIssueKey) + '/comment',
    { body: commentText },
    configuration.jira,
    isTlsVerified
  )
    .then((jiraResponse) => {
      const isCommentPosted = jiraResponse.status === 200 || jiraResponse.status === 201;
      const eventLabel      = eventTypeName.replace(/_/g, ' ');

      appendResultEvent({
        repo:      repoFullPath,
        eventType: eventTypeName,
        jiraKey:   jiraIssueKey,
        message:   eventLabel + ' — comment ' + (isCommentPosted ? 'posted' : 'failed') + ' (' + shortRepoName + ')',
        isSuccess: isCommentPosted,
      });

      console.log('  [Scheduler] ' + jiraIssueKey + ' — ' + eventTypeName + ': ' + (isCommentPosted ? '✅' : '❌'));

      if (isCommentPosted) {
        const transitionKeyMap    = { branch_created: 'branchCreated', commit_pushed: 'commitPushed', pr_opened: 'prOpened', pr_merged: 'prMerged' };
        const requestedTransition = jiraTransitions[transitionKeyMap[eventTypeName] || ''] || '';
        if (requestedTransition) {
          return fireJiraTransition(jiraIssueKey, requestedTransition, configuration);
        }
      }
    })
    .catch((commentError) => {
      appendResultEvent({
        repo:      repoFullPath,
        eventType: eventTypeName,
        jiraKey:   jiraIssueKey,
        message:   eventTypeName.replace(/_/g, ' ') + ' — comment failed (' + shortRepoName + '): ' + commentError.message.slice(0, 80),
        isSuccess: false,
      });
    });
}

/**
 * Finds and fires the Jira transition that matches the requested status name.
 * Matches by exact status name first, then by status category name (case-insensitive).
 *
 * @param {string} jiraIssueKey        - Jira issue key (e.g. PROJ-1234)
 * @param {string} requestedStatusName - Target status name (e.g. "In Progress")
 * @param {object} configuration       - Live config for credentials
 */
function fireJiraTransition(jiraIssueKey, requestedStatusName, configuration) {
  const isTlsVerified = configuration.sslVerify !== false;

  return makeJiraApiRequest(
    'GET',
    '/rest/api/2/issue/' + encodeURIComponent(jiraIssueKey) + '/transitions',
    null,
    configuration.jira,
    isTlsVerified
  )
    .then((transitionsResponse) => {
      const availableTransitions = (transitionsResponse.body && transitionsResponse.body.transitions) || [];

      // Try exact status name match first, then status category name match
      const matchingTransition =
        availableTransitions.find((transition) =>
          transition.to && transition.to.name &&
          transition.to.name.toLowerCase() === requestedStatusName.toLowerCase()
        ) ||
        availableTransitions.find((transition) =>
          transition.to && transition.to.statusCategory &&
          transition.to.statusCategory.name &&
          transition.to.statusCategory.name.toLowerCase() === requestedStatusName.toLowerCase()
        );

      if (matchingTransition) {
        return makeJiraApiRequest(
          'POST',
          '/rest/api/2/issue/' + encodeURIComponent(jiraIssueKey) + '/transitions',
          { transition: { id: matchingTransition.id } },
          configuration.jira,
          isTlsVerified
        ).then(() => {
          console.log('  [Scheduler] ' + jiraIssueKey + ' → ' + matchingTransition.to.name);
        });
      } else {
        console.log('  [Scheduler] ' + jiraIssueKey + ': no transition matches \'' + requestedStatusName + '\'');
      }
    })
    .catch((transitionError) => {
      console.log('  [Scheduler] transition failed for ' + jiraIssueKey + ': ' + transitionError.message);
    });
}

/**
 * Extracts the first Jira issue key (e.g. PROJ-1234) from a string.
 * Used to find the Jira ticket linked to a GitHub branch name.
 *
 * @param {string} text - String to search (typically a branch name)
 * @returns {string|null} Jira issue key or null if none found
 */
function extractJiraIssueKey(text) {
  const match = (text || '').match(/([A-Z]+-\d+)/);
  return match ? match[1] : null;
}

/**
 * Appends a new event to the in-memory ring buffer.
 * Trims the buffer to MAX_RESULT_EVENTS to prevent unbounded memory growth.
 *
 * @param {{ repo: string, eventType: string, jiraKey: string, message: string, isSuccess: boolean }} eventData
 */
function appendResultEvent(eventData) {
  schedulerResultEvents.unshift({
    ...eventData,
    timestamp: new Date().toISOString(),
    source:    'server',
  });
  if (schedulerResultEvents.length > MAX_RESULT_EVENTS) {
    schedulerResultEvents.length = MAX_RESULT_EVENTS;
  }
  schedulerRuntimeStats.repoMonitor.eventCount++;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  startSchedulerLoop,
  runRepoMonitor,
  getSchedulerStatus,
  getSchedulerResults,
  applySchedulerConfig,
};
