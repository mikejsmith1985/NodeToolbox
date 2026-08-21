// src/services/jiraEventOutput.js — Shared "GitHub-style event → Jira comment + transition" output.
//
// This is the Jira-writing half of the GitHub integration, factored out so the INPUT can vary. The GitHub
// Email Intake scheduler calls it to turn a parsed notification email into a Jira comment and an optional
// status transition. Keeping one shared output path means that behaviour is defined in exactly one place.

'use strict';

const { makeJiraApiRequest } = require('../utils/httpClient');
const { recordJiraWrite } = require('./jiraWriteJournal');
const { appendOperatorSignature } = require('./operatorSignature');

/** Maps an internal event type to the config key holding its target Jira status name. */
/**
 * End states that DISCARD the work rather than complete it.
 *
 * Jira files these under the Done category alongside genuine completions, so a rule asking for
 * "Done" on a workflow whose only Done-category transition is "Cancelled" resolved to it and
 * cancelled live development work. Cancelling is not a kind of completing: it throws the work away,
 * and no amount of category agreement makes that a safe guess.
 *
 * These stay reachable — an operator who types the name gets exactly that status — but they are
 * never INFERRED from a category.
 */
const DISCARD_STATUS_NAMES = [
  'cancelled',
  'canceled',
  'rejected',
  'abandoned',
  'withdrawn',
  "won't do",
  'wont do',
  "won't fix",
  'wont fix',
  'duplicate',
];

/** Whether a transition lands on a state that discards the work. */
function isDiscardTransition(transition) {
  const statusName = transition && transition.to && transition.to.name
    ? String(transition.to.name).trim().toLowerCase()
    : '';
  return DISCARD_STATUS_NAMES.indexOf(statusName) !== -1;
}

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

// ── Parent-story actions ──
//
// When a branch merges, the branch name references the DEV-EXECUTION SUB-TASK — but the team's
// definition of progress lives on the parent story. A rule may therefore also move the parent
// (e.g. to "Ready for Testing") and set its Sub-status dropdown. Because a story owns one coding
// sub-task per repo, the default guard only moves the parent once EVERY coding sub-task is done —
// the delivery-scaffold sub-tasks ([SL]/[IT]/[INT]/[REL]/[PROD]) never hold it.

/** Summary prefixes of the delivery-framework scaffold sub-tasks — not coding work. */
const DELIVERY_SCAFFOLD_SUBTASK_PATTERN = /^\[(SL|IT|INT|REL|PROD)\]/i;

/** True when a sub-task summary is coding work (i.e. not a delivery scaffold sub-task). */
function isCodingSubtaskSummary(summary) {
  return !DELIVERY_SCAFFOLD_SUBTASK_PATTERN.test(String(summary || '').trim());
}

/** True when a status object means the work is complete (done category, name fallback). */
function isDoneStatus(status) {
  const categoryKey = status && status.statusCategory && status.statusCategory.key;
  if (categoryKey) {
    return categoryKey === 'done';
  }
  return String((status && status.name) || '').toLowerCase() === 'done';
}

/** GETs one issue with the given fields; returns the fields object or null on any failure. */
function fetchIssueFields(jiraIssueKey, fieldList, configuration) {
  const isTlsVerified = configuration.sslVerify !== false;
  return makeJiraApiRequest(
    'GET',
    '/rest/api/2/issue/' + encodeURIComponent(jiraIssueKey) + '?fields=' + encodeURIComponent(fieldList),
    null,
    configuration.jira,
    isTlsVerified
  )
    .then((response) => (response.status === 200 && response.body && response.body.fields) || null)
    .catch(() => null);
}

/** Sets the parent's Sub-status dropdown (a Jira select field writes as { value }). */
function setParentSubStatusField(parentKey, fieldId, optionValue, configuration) {
  const isTlsVerified = configuration.sslVerify !== false;
  const fields = {};
  fields[fieldId] = { value: optionValue };
  return makeJiraApiRequest(
    'PUT',
    '/rest/api/2/issue/' + encodeURIComponent(parentKey),
    { fields },
    configuration.jira,
    isTlsVerified
  );
}

/**
 * Posts the short signed note that accompanies an automatic parent-story move.
 *
 * Kept deliberately plain: it states the delivery fact that caused the move (the coding work under
 * this story finished) and carries the operator's marker, so the change is explainable to the team
 * and identifiable to the operator without describing how it was produced.
 *
 * @param {string} parentKey
 * @param {string} subTaskKey
 * @param {string} requestedParentStatus
 * @param {object} configuration
 * @returns {Promise<void>}
 */
function postParentMoveNote(parentKey, subTaskKey, requestedParentStatus, configuration) {
  const noteBody = appendOperatorSignature(
    'Coding work complete (' + subTaskKey + ') — moving this story to "' + requestedParentStatus + '".',
  );
  const commentPath = '/rest/api/2/issue/' + encodeURIComponent(parentKey) + '/comment';
  recordJiraWrite({ method: 'POST', path: commentPath, source: 'github-intake' });
  return makeJiraApiRequest('POST', commentPath, { body: noteBody }, configuration.jira, configuration.sslVerify !== false)
    .then(() => undefined)
    .catch((noteError) => {
      // A missing note must never stop the move it describes.
      console.log('  [JiraEventOutput] parent note failed for ' + parentKey + ': ' + noteError.message);
    });
}

/**
 * Applies a rule's parent-story actions after the matched sub-task was handled: resolve the parent,
 * optionally require every coding sub-task to be done, then fire the parent transition and/or set the
 * Sub-status dropdown. Every outcome (moved, held, skipped, failed) is reported via recordResult so
 * the run log explains exactly what happened to the story.
 */
async function applyParentStoryActions(subTaskKey, parentActions, eventTypeName, repoFullPath, configuration, recordResult) {
  const report = (jiraKey, message, isSuccess) => recordResult({
    repo: repoFullPath, eventType: eventTypeName, jiraKey, message, isSuccess,
  });

  const matchedIssueFields = await fetchIssueFields(subTaskKey, 'parent,issuetype', configuration);
  const parentKey = matchedIssueFields && matchedIssueFields.parent && matchedIssueFields.parent.key;
  const isSubtask = !!(matchedIssueFields && matchedIssueFields.issuetype && matchedIssueFields.issuetype.subtask);
  if (!isSubtask || !parentKey) {
    report(subTaskKey, 'parent action skipped — ' + subTaskKey + ' is not a sub-task with a parent', true);
    return;
  }

  if (parentActions.requireAllDevDone !== false) {
    const parentFields = await fetchIssueFields(parentKey, 'subtasks', configuration);
    if (!parentFields) {
      report(parentKey, 'parent action failed — could not read ' + parentKey + "'s sub-tasks", false);
      return;
    }
    const codingSubtasks = (parentFields.subtasks || []).filter((subtaskStub) =>
      isCodingSubtaskSummary(subtaskStub.fields && subtaskStub.fields.summary));

    // A parent with NO coding sub-tasks at all used to satisfy "every coding sub-task is done"
    // vacuously — an empty list has nothing not-done in it — so the guard waved through exactly the
    // stories it knows least about. Absence of evidence is not evidence of completion: hold instead.
    if (codingSubtasks.length === 0) {
      report(parentKey, 'parent held — no coding sub-tasks found, so "all dev done" cannot be confirmed', true);
      return;
    }

    const notDoneCodingSubtasks = codingSubtasks.filter((subtaskStub) =>
      !isDoneStatus(subtaskStub.fields && subtaskStub.fields.status));
    if (notDoneCodingSubtasks.length > 0) {
      const waitingKeys = notDoneCodingSubtasks.map((subtaskStub) => subtaskStub.key).join(', ');
      report(parentKey, 'parent held — coding sub-tasks not yet done: ' + waitingKeys, true);
      return;
    }
  }

  const requestedParentStatus = String(parentActions.transitionStatus || '').trim();
  if (requestedParentStatus) {
    // The parent is moved without anyone naming it, so on its own this change appears in Jira's
    // history as an unexplained status jump by the operator. A short signed note next to it gives
    // the change a visible reason and makes it searchable later.
    await postParentMoveNote(parentKey, subTaskKey, requestedParentStatus, configuration);
    const parentOutcome = await fireJiraTransition(parentKey, requestedParentStatus, configuration);
    report(
      parentKey,
      parentOutcome.didMove
        ? 'parent moved to "' + parentOutcome.toStatusName + '"'
        : 'parent did not move to "' + requestedParentStatus + '": ' + parentOutcome.reason,
      parentOutcome.didMove,
    );
  }

  const subStatusValue = String(parentActions.subStatusValue || '').trim();
  if (subStatusValue) {
    const fieldId = String(parentActions.subStatusFieldId || '').trim() || 'customfield_10201';
    try {
      const putResponse = await setParentSubStatusField(parentKey, fieldId, subStatusValue, configuration);
      const isSubStatusSet = putResponse.status >= 200 && putResponse.status < 300;
      report(parentKey, 'parent Sub-status ' + (isSubStatusSet ? 'set to' : 'write failed for') + ' "' + subStatusValue + '"', isSubStatusSet);
    } catch (subStatusError) {
      report(parentKey, 'parent Sub-status write failed: ' + subStatusError.message.slice(0, 80), false);
    }
  }
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
 * @param {{ recordResult?: function, dryRun?: boolean, suppressTransition?: boolean, forcedTransitionStatus?: string }} [options]
 *   forcedTransitionStatus — an operator-set per-rule status that OVERRIDES the event-type map (and is the
 *   only way a custom bucket, which has no map entry, transitions at all).
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
    if (resolvedOptions.parentActions) {
      recordResult({
        repo:      repoFullPath,
        eventType: eventTypeName,
        jiraKey:   jiraIssueKey,
        message:   eventLabel + ' — dry run, parent-story action planned (transition/Sub-status), no Jira write',
        isSuccess: true,
      });
    }
    return Promise.resolve();
  }

  const commentPath = '/rest/api/2/issue/' + encodeURIComponent(jiraIssueKey) + '/comment';
  recordJiraWrite({ method: 'POST', path: commentPath, source: 'github-intake' });

  return makeJiraApiRequest(
    'POST',
    commentPath,
    { body: appendOperatorSignature(commentText) },
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
        // An operator-set per-rule transition wins over the event-type default map, and is the only
        // transition a custom bucket (no map entry) can have. Blank on both → comment only.
        const forcedTransition = (resolvedOptions.forcedTransitionStatus || '').trim();
        const requestedTransition = forcedTransition || jiraTransitions[TRANSITION_KEY_MAP[eventTypeName] || ''] || '';
        // The transition's outcome is REPORTED, not just logged: a refusal (an ambiguous "Done"
        // that could have meant Cancelled) otherwise looked identical to a rule that did nothing.
        const transitionPromise = requestedTransition
          ? fireJiraTransition(jiraIssueKey, requestedTransition, configuration).then((outcome) => {
            recordResult({
              repo:      repoFullPath,
              eventType: eventTypeName,
              jiraKey:   jiraIssueKey,
              message:   outcome.didMove
                ? eventLabel + ' — moved to "' + outcome.toStatusName + '"'
                : eventLabel + ' — did not move to "' + requestedTransition + '": ' + outcome.reason,
              isSuccess: outcome.didMove,
            });
          })
          : Promise.resolve();
        // Parent-story actions run AFTER the sub-task's own transition, so an all-dev-done guard read
        // already sees the just-completed sub-task as done. Comment-only mode never reaches here.
        if (resolvedOptions.parentActions) {
          return transitionPromise.then(() => applyParentStoryActions(
            jiraIssueKey, resolvedOptions.parentActions, eventTypeName, repoFullPath, configuration, recordResult,
          ));
        }
        return transitionPromise;
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
 * Chooses the transition that satisfies a requested status name, or null when the request cannot be
 * satisfied unambiguously.
 *
 * An exact status-name match always wins. Only when no status carries that name does the request
 * fall back to Jira's status CATEGORY ("To Do" / "In Progress" / "Done"), and then only when exactly
 * one available transition lands in that category.
 *
 * The single-candidate rule is the important part. Jira files several very different statuses under
 * the Done category — "Closed" and "Cancelled" among them — so a rule configured for "Done" on a
 * project with no status literally named Done used to resolve to whichever Done-category transition
 * Jira happened to list first. That could silently CANCEL an issue the operator only meant to
 * complete. When the category is ambiguous the correct behaviour is to do nothing and say so,
 * because there is no safe way to guess which of several end states was intended.
 *
 * Pure, so the ambiguity rule is directly testable.
 *
 * @param {Array<object>} availableTransitions - Jira's /transitions payload entries.
 * @param {string} requestedStatusName
 * @returns {{ transition: object|null, reason: string }}
 */
function selectTransitionForStatus(availableTransitions, requestedStatusName) {
  const normalizedRequest = String(requestedStatusName || '').trim().toLowerCase();
  const transitions = Array.isArray(availableTransitions) ? availableTransitions : [];

  const exactNameMatch = transitions.find((transition) =>
    transition.to && transition.to.name && transition.to.name.trim().toLowerCase() === normalizedRequest);
  if (exactNameMatch) {
    return { transition: exactNameMatch, reason: 'matched status name' };
  }

  const categoryMatches = transitions.filter((transition) =>
    transition.to && transition.to.statusCategory && transition.to.statusCategory.name
    && transition.to.statusCategory.name.trim().toLowerCase() === normalizedRequest);

  if (categoryMatches.length === 1) {
    // The gap the ambiguity rule below left open. One candidate is unambiguous, but "the only
    // Done-category transition out of Working is Cancelled" is exactly the workflow shape that let a
    // merged-PR rule discard live development work. Refused by name, not by count.
    if (isDiscardTransition(categoryMatches[0])) {
      return {
        transition: null,
        reason: 'refusing to infer a cancellation — the only "' + requestedStatusName + '" category status here is "'
          + categoryMatches[0].to.name + '", which discards the work rather than completing it. '
          + 'Name the exact status in the rule if that is really what you want.',
      };
    }
    return { transition: categoryMatches[0], reason: 'matched the only "' + requestedStatusName + '" category status' };
  }
  if (categoryMatches.length > 1) {
    const candidateNames = categoryMatches.map((transition) => transition.to.name).join(', ');
    return {
      transition: null,
      reason: 'ambiguous — "' + requestedStatusName + '" category offers several end states (' + candidateNames
        + '); refusing to guess. Name the exact status in the rule.',
    };
  }
  return { transition: null, reason: 'no transition matches "' + requestedStatusName + '"' };
}

/**
 * Whether a PERSON has already moved this issue out of the status the automation wants to set.
 *
 * The automation cancelled issues, somebody moved them back to Working, and the next poll cancelled
 * them again. The duplicate-event ledger cannot stop that: it only knows whether the same EMAIL was
 * processed before, and a fresh notification about the same branch is a new event. What repeats is
 * the OUTCOME, against a decision a human already made.
 *
 * So the changelog is read for the one thing that settles it: did somebody who is not the automation
 * move this issue OUT of the requested status? If so the automation stands down. It is not asked
 * whether that happened recently, because a person's decision does not expire — and an automation
 * move made afterwards is the loop itself, not evidence the reversal was withdrawn.
 *
 * With no automation account configured every move looks like a person's, and the guard holds. That
 * is the safe direction: declining to act beats acting on an identity we could not establish.
 *
 * Pure, so the rule is directly testable.
 *
 * @param {Array<object>} changelogHistories - entries from Jira's ?expand=changelog
 * @param {string} requestedStatusName
 * @param {string} automationAccountName - the account the automation itself posts as
 * @returns {{ wasReversed: boolean, reason: string }}
 */
function wasStatusReversedByPerson(changelogHistories, requestedStatusName, automationAccountName) {
  const histories = Array.isArray(changelogHistories) ? changelogHistories : [];
  const normalizedRequest = String(requestedStatusName || '').trim().toLowerCase();
  const normalizedAutomation = String(automationAccountName || '').trim().toLowerCase();

  for (const history of histories) {
    const items = (history && Array.isArray(history.items)) ? history.items : [];
    const hasMoveOutOfRequested = items.some((item) =>
      item && String(item.field || '').trim().toLowerCase() === 'status'
      && String(item.fromString || '').trim().toLowerCase() === normalizedRequest);
    if (!hasMoveOutOfRequested) {
      continue;
    }

    const author = (history && history.author) || {};
    const authorName = String(author.name || author.displayName || '').trim().toLowerCase();
    const isAutomationsOwnMove = normalizedAutomation !== '' && authorName === normalizedAutomation;
    if (isAutomationsOwnMove) {
      continue;
    }

    const authorLabel = author.displayName || author.name || 'someone';
    return {
      wasReversed: true,
      reason: 'held — ' + authorLabel + ' already moved this issue out of "' + requestedStatusName
        + '"; not putting it back. Move it there by hand if the automation was right.',
    };
  }

  return { wasReversed: false, reason: '' };
}

/**
 * Finds and fires the Jira transition that satisfies the requested status name, refusing to act when
 * the request is ambiguous (see selectTransitionForStatus).
 *
 * RETURNS its outcome rather than swallowing it. The ambiguity guard that stops a "Done" request
 * resolving to Cancelled used to console.log and return void, so on screen a refusal looked exactly
 * like nothing happening — the worst presentation a safety guard can have, because the operator
 * cannot tell a rule that did nothing from one that was stopped from doing harm.
 *
 * @param {string} jiraIssueKey
 * @param {string} requestedStatusName
 * @param {object} configuration
 * @returns {Promise<{ didMove: boolean, toStatusName: string|null, reason: string }>}
 */
function fireJiraTransition(jiraIssueKey, requestedStatusName, configuration) {
  const isTlsVerified = configuration.sslVerify !== false;

  // Read the issue's own history first. A person who has already moved this issue out of the status
  // being requested has overruled the automation, and re-applying it is the automation arguing with
  // them once per poll. A changelog that cannot be read is not treated as a reversal: the guard is
  // for a decision we can SEE, and inventing one from a failed request would stop the automation
  // working whenever Jira hiccuped.
  return makeJiraApiRequest(
    'GET',
    '/rest/api/2/issue/' + encodeURIComponent(jiraIssueKey) + '?expand=changelog&fields=status',
    null,
    configuration.jira,
    isTlsVerified
  )
    .then((issueResponse) => {
      const histories = (issueResponse.body && issueResponse.body.changelog && issueResponse.body.changelog.histories)
        || [];
      return wasStatusReversedByPerson(histories, requestedStatusName, (configuration.jira || {}).username || '');
    })
    .catch(() => ({ wasReversed: false, reason: '' }))
    .then((reversalVerdict) => {
      if (reversalVerdict.wasReversed) {
        return { didMove: false, toStatusName: null, reason: reversalVerdict.reason };
      }
      return fireResolvedJiraTransition(jiraIssueKey, requestedStatusName, configuration, isTlsVerified);
    });
}

/**
 * Resolves and fires the transition, once the reversal guard has allowed it.
 *
 * Split out so `fireJiraTransition` reads as the two decisions it makes -- may we move, and which
 * move is it -- rather than one function doing both.
 *
 * @param {string} jiraIssueKey
 * @param {string} requestedStatusName
 * @param {object} configuration
 * @param {boolean} isTlsVerified
 * @returns {Promise<{ didMove: boolean, toStatusName: string|null, reason: string }>}
 */
function fireResolvedJiraTransition(jiraIssueKey, requestedStatusName, configuration, isTlsVerified) {
  return makeJiraApiRequest(
    'GET',
    '/rest/api/2/issue/' + encodeURIComponent(jiraIssueKey) + '/transitions',
    null,
    configuration.jira,
    isTlsVerified
  )
    .then((transitionsResponse) => {
      const availableTransitions = (transitionsResponse.body && transitionsResponse.body.transitions) || [];
      const { transition: matchingTransition, reason } = selectTransitionForStatus(availableTransitions, requestedStatusName);

      if (matchingTransition) {
        const transitionPath = '/rest/api/2/issue/' + encodeURIComponent(jiraIssueKey) + '/transitions';
        recordJiraWrite({ method: 'POST', path: transitionPath, source: 'github-intake' });
        return makeJiraApiRequest(
          'POST',
          transitionPath,
          { transition: { id: matchingTransition.id } },
          configuration.jira,
          isTlsVerified
        ).then(() => {
          console.log('  [JiraEventOutput] ' + jiraIssueKey + ' → ' + matchingTransition.to.name + ' (' + reason + ')');
          return { didMove: true, toStatusName: matchingTransition.to.name, reason: reason };
        });
      }
      console.log('  [JiraEventOutput] ' + jiraIssueKey + ': ' + reason);
      return { didMove: false, toStatusName: null, reason: reason };
    })
    .catch((transitionError) => {
      console.log('  [JiraEventOutput] transition failed for ' + jiraIssueKey + ': ' + transitionError.message);
      return { didMove: false, toStatusName: null, reason: 'transition failed: ' + transitionError.message };
    });
}

module.exports = {
  TRANSITION_KEY_MAP,
  extractJiraIssueKey,
  postJiraCommentForEvent,
  fireJiraTransition,
  wasStatusReversedByPerson,
  selectTransitionForStatus,
  applyParentStoryActions,
};
