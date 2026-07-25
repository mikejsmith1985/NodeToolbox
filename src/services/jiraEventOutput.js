// src/services/jiraEventOutput.js — Shared "GitHub-style event → Jira comment + transition" output.
//
// This is the Jira-writing half of the GitHub integration, factored out so the INPUT can vary. The GitHub
// Email Intake scheduler calls it to turn a parsed notification email into a Jira comment and an optional
// status transition. Keeping one shared output path means that behaviour is defined in exactly one place.

'use strict';

const { makeJiraApiRequest } = require('../utils/httpClient');

/** Maps an internal event type to the config key holding its target Jira status name. */
const TRANSITION_KEY_MAP = {
  branch_created: 'branchCreated',
  commit_pushed:  'commitPushed',
  pr_opened:      'prOpened',
  pr_merged:      'prMerged',
};

/**
 * Extracts the first Jira issue key (e.g. PROJ-1234) from a string — typically a branch name or an
 * email subject/body. Returns null when none is present.
 *
 * @param {string} text
 * @returns {string|null}
 */
function extractJiraIssueKey(text) {
  const match = (text || '').match(/([A-Z]+-\d+)/);
  return match ? match[1] : null;
}

/**
 * Posts a Jira comment for one event, then optionally fires the configured status transition.
 *
 * Behaviour is identical to the original repo-monitor version, with three additions so a second
 * caller (the email engine) can reuse it safely:
 *   • options.recordResult(record) — a sink callback for the outcome record ({repo, eventType,
 *     jiraKey, message, isSuccess}); defaults to a no-op. The repo monitor passes its ring-buffer
 *     appender so its Admin Hub event log is unchanged.
 *   • options.dryRun — when true, NOTHING is sent to Jira; a "would post" record is emitted and the
 *     function resolves. This backs the email engine's safe dry-run rollout mode.
 *   • options.suppressTransition — when true, the comment is posted but no transition fires
 *     (the email engine's comment-only mode).
 *
 * @param {string} jiraIssueKey
 * @param {string} commentText
 * @param {string} eventTypeName    - one of TRANSITION_KEY_MAP's keys
 * @param {string} repoFullPath     - "owner/repo", used for the result label
 * @param {object} jiraTransitions  - { branchCreated, commitPushed, prOpened, prMerged } status names
 * @param {object} configuration    - live config (credentials + sslVerify)
 * @param {{ recordResult?: function, dryRun?: boolean, suppressTransition?: boolean }} [options]
 * @returns {Promise<void>}
 */
function postJiraCommentForEvent(jiraIssueKey, commentText, eventTypeName, repoFullPath, jiraTransitions, configuration, options) {
  const resolvedOptions = options || {};
  const recordResult    = resolvedOptions.recordResult || function noop() {};
  const shortRepoName   = repoFullPath.split('/').pop() || repoFullPath;
  const eventLabel      = eventTypeName.replace(/_/g, ' ');
  const isTlsVerified   = configuration.sslVerify !== false;

  // Dry run: report what WOULD happen and touch nothing in Jira.
  if (resolvedOptions.dryRun) {
    recordResult({
      repo:      repoFullPath,
      eventType: eventTypeName,
      jiraKey:   jiraIssueKey,
      message:   eventLabel + ' — dry run, no Jira write (' + shortRepoName + ')',
      isSuccess: true,
    });
    return Promise.resolve();
  }

  return makeJiraApiRequest(
    'POST',
    '/rest/api/2/issue/' + encodeURIComponent(jiraIssueKey) + '/comment',
    { body: commentText },
    configuration.jira,
    isTlsVerified
  )
    .then((jiraResponse) => {
      const isCommentPosted = jiraResponse.status === 200 || jiraResponse.status === 201;

      recordResult({
        repo:      repoFullPath,
        eventType: eventTypeName,
        jiraKey:   jiraIssueKey,
        message:   eventLabel + ' — comment ' + (isCommentPosted ? 'posted' : 'failed') + ' (' + shortRepoName + ')',
        isSuccess: isCommentPosted,
      });

      console.log('  [JiraEventOutput] ' + jiraIssueKey + ' — ' + eventTypeName + ': ' + (isCommentPosted ? '✅' : '❌'));

      if (isCommentPosted && !resolvedOptions.suppressTransition) {
        const requestedTransition = jiraTransitions[TRANSITION_KEY_MAP[eventTypeName] || ''] || '';
        if (requestedTransition) {
          return fireJiraTransition(jiraIssueKey, requestedTransition, configuration);
        }
      }
    })
    .catch((commentError) => {
      recordResult({
        repo:      repoFullPath,
        eventType: eventTypeName,
        jiraKey:   jiraIssueKey,
        message:   eventLabel + ' — comment failed (' + shortRepoName + '): ' + commentError.message.slice(0, 80),
        isSuccess: false,
      });
    });
}

/**
 * Finds and fires the Jira transition that matches the requested status name.
 * Matches by exact status name first, then by status category name (case-insensitive).
 *
 * @param {string} jiraIssueKey
 * @param {string} requestedStatusName
 * @param {object} configuration
 * @returns {Promise<void>}
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

      // Try exact status name match first, then status category name match.
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
          console.log('  [JiraEventOutput] ' + jiraIssueKey + ' → ' + matchingTransition.to.name);
        });
      }
      console.log('  [JiraEventOutput] ' + jiraIssueKey + ': no transition matches \'' + requestedStatusName + '\'');
    })
    .catch((transitionError) => {
      console.log('  [JiraEventOutput] transition failed for ' + jiraIssueKey + ': ' + transitionError.message);
    });
}

module.exports = {
  TRANSITION_KEY_MAP,
  extractJiraIssueKey,
  postJiraCommentForEvent,
  fireJiraTransition,
};
