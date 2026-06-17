// src/services/sprintReleaseOrchestrator.js — Pure business logic for the Sprint–Release Workflow.
//
// All functions in this module are pure (or nearly pure — async Jira calls are
// clearly separated from decision logic) and fully unit-testable with mocked HTTP.
// No setInterval, no in-memory Maps — those live in sprintReleaseScheduler.js.
//
// Responsibilities:
//   - Sub-status change detection and handoff comment building
//   - Dev issue Done transition execution
//   - Sprint–FixVersion date synchronisation and business day math
//   - Defect intake issue creation and label management
//   - DoR (Definition of Ready) violation detection

'use strict';

const { makeJiraApiRequest, triggerWebhook } = require('../utils/httpClient');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Jira changelog field name for sub-status (customfield_10201 by default). */
const DEFAULT_SUB_STATUS_FIELD_ID = 'customfield_10201';

/** Prefix applied to all defect intake issue summaries. */
const DEFECT_SUMMARY_PREFIX = '[DEFECT] ';

/** Label applied to all new defect intake issues to distinguish them from original stories. */
const DEFECT_FROM_TESTING_LABEL = 'defect-from-testing';

/** Label applied to defect issues when the sprint is within the code-freeze window. */
const TRIAGE_REQUIRED_LABEL = 'TRIAGE REQUIRED';

/** Day-of-week numeric values for weekday boundary checks. */
const SUNDAY_DAY_NUMBER = 0;
const SATURDAY_DAY_NUMBER = 6;

// ── detectSubStatusChanges ────────────────────────────────────────────────────

/**
 * Inspects a list of Jira issues (with expanded changelogs) and returns events
 * for any issues whose sub-status (`customfield_10201`) changed to the QE or BT
 * handoff trigger value since the last recorded handoff.
 *
 * Issues labelled with `configOnlyLabel` produce a bypass event — the issue
 * closes without a handoff notification.
 *
 * This function is pure and side-effect-free.
 *
 * @param {object[]} jiraIssues - Issues from Jira search API with expand=changelog
 * @param {Map<string, {qeHandoffAt: string|null, btHandoffAt: string|null}>} lastHandoffByIssue
 *   Map keyed by "{teamProfileId}:{issueKey}". Indicates which handoffs have already fired.
 * @param {{ teamProfileId: string, subStatusFieldId: string, qeHandoffSubStatusValue: string,
 *   btHandoffSubStatusValue: string, configOnlyLabel: string }} profileConfig
 * @returns {Array<{ issueKey: string, handoffType: 'QE'|'BT'|'BYPASS', issue: object }>}
 */
function detectSubStatusChanges(jiraIssues, lastHandoffByIssue, profileConfig) {
  const subStatusFieldId = profileConfig.subStatusFieldId || DEFAULT_SUB_STATUS_FIELD_ID;
  const detectedEvents = [];

  for (const jiraIssue of jiraIssues) {
    const issueKey = jiraIssue.key;
    const mapKey = profileConfig.teamProfileId + ':' + issueKey;
    const priorHandoff = lastHandoffByIssue.get(mapKey) || { qeHandoffAt: null, btHandoffAt: null };
    const issueLabels = (jiraIssue.fields && jiraIssue.fields.labels) || [];
    const isConfigOnly = issueLabels.includes(profileConfig.configOnlyLabel);

    const changelogHistories = (jiraIssue.changelog && jiraIssue.changelog.histories) || [];

    // Walk histories from oldest to newest; take the most recent sub-status change.
    let latestSubStatusChange = null;
    for (const historyEntry of changelogHistories) {
      for (const changeItem of (historyEntry.items || [])) {
        if (changeItem.field !== subStatusFieldId) continue;
        latestSubStatusChange = { value: changeItem.toString, changedAt: historyEntry.created };
      }
    }

    if (!latestSubStatusChange) continue;

    const changedValue = latestSubStatusChange.value;
    const changedAt = latestSubStatusChange.changedAt;

    if (changedValue === profileConfig.qeHandoffSubStatusValue) {
      // Skip if QE handoff already fired at or after this timestamp.
      if (priorHandoff.qeHandoffAt && priorHandoff.qeHandoffAt >= changedAt) continue;
      const handoffType = isConfigOnly ? 'BYPASS' : 'QE';
      detectedEvents.push({ issueKey, handoffType, issue: jiraIssue });
    } else if (changedValue === profileConfig.btHandoffSubStatusValue) {
      // Skip if BT handoff already fired at or after this timestamp.
      if (priorHandoff.btHandoffAt && priorHandoff.btHandoffAt >= changedAt) continue;
      const handoffType = isConfigOnly ? 'BYPASS' : 'BT';
      detectedEvents.push({ issueKey, handoffType, issue: jiraIssue });
    }
  }

  return detectedEvents;
}

// ── buildHandoffComment ───────────────────────────────────────────────────────

/**
 * Builds the Jira comment body for a QE or BT handoff notification.
 * This function is pure and has no side effects.
 *
 * @param {string} issueKey - The dev issue key (e.g., "ENFCT-1012")
 * @param {'QE'|'BT'} handoffType - The type of handoff
 * @param {string} featureKey - Parent feature key from the feature project (e.g., "DENP-42")
 * @param {string} featureSummary - Summary text of the parent feature issue
 * @returns {string} Formatted Jira comment body text
 */
function buildHandoffComment(issueKey, handoffType, featureKey, featureSummary) {
  const isQeHandoff = handoffType === 'QE';
  const handoffLabel = isQeHandoff ? 'QE Handoff' : 'BT Handoff';
  const environmentName = isQeHandoff ? 'INT' : 'REL';
  const testTeamName = isQeHandoff ? 'QE' : 'BT';

  return [
    handoffLabel + ': ' + issueKey + ' is ready for ' + testTeamName + ' testing.',
    '',
    'Environment: ' + environmentName,
    'Parent feature: ' + featureKey + ' — ' + featureSummary,
    '',
    '_This comment was posted automatically by NodeToolbox Sprint–Release Workflow._',
  ].join('\n');
}

// ── executeDevIssueDone ───────────────────────────────────────────────────────

/**
 * Transitions a dev issue to the Done state using the Jira workflow transition API.
 * Fetches available transitions dynamically to find the correct transition ID — Jira
 * workflow transition IDs vary per project configuration.
 *
 * Never modifies the `assignee` field. The assignee is owned by the individual
 * developer and must not change when the issue status changes.
 *
 * @param {string} issueKey - The dev issue key to transition (e.g., "ENFCT-1012")
 * @param {object} jiraConfig - Jira service config { baseUrl, pat, username, apiToken }
 * @param {{ doneTransitionName: string }} profileConfig
 * @param {boolean} isTlsVerified - Whether to verify TLS certificates
 * @returns {Promise<{ wasTransitioned: boolean, reason?: string }>}
 */
async function executeDevIssueDone(issueKey, jiraConfig, profileConfig, isTlsVerified) {
  const transitionsPath = '/rest/api/2/issue/' + encodeURIComponent(issueKey) + '/transitions';

  let transitionsResponse;
  try {
    transitionsResponse = await makeJiraApiRequest('GET', transitionsPath, null, jiraConfig, isTlsVerified);
  } catch (fetchError) {
    console.error('[SprintRelease] Failed to fetch transitions for ' + issueKey + ': ' + fetchError.message);
    return { wasTransitioned: false, reason: 'Transitions fetch failed: ' + fetchError.message };
  }

  const availableTransitions = (transitionsResponse.body && transitionsResponse.body.transitions) || [];
  const targetTransitionName = profileConfig.doneTransitionName || 'Done';
  const doneTransition = availableTransitions.find(
    (transition) => transition.name === targetTransitionName
  );

  if (!doneTransition) {
    // Issue may already be Done, or the transition name is misconfigured.
    const transitionNames = availableTransitions.map((t) => t.name).join(', ');
    console.warn('[SprintRelease] No "' + targetTransitionName + '" transition found for '
      + issueKey + '. Available: ' + (transitionNames || 'none'));
    return { wasTransitioned: false, reason: 'Transition "' + targetTransitionName + '" not available' };
  }

  try {
    await makeJiraApiRequest(
      'POST',
      transitionsPath,
      { transition: { id: doneTransition.id } },
      jiraConfig,
      isTlsVerified
    );
    console.log('[SprintRelease] Transitioned ' + issueKey + ' to "' + targetTransitionName + '".');
    return { wasTransitioned: true };
  } catch (transitionError) {
    console.error('[SprintRelease] Failed to transition ' + issueKey + ' to Done: ' + transitionError.message);
    return { wasTransitioned: false, reason: 'Transition POST failed: ' + transitionError.message };
  }
}

// ── postHandoffComment ────────────────────────────────────────────────────────

/**
 * Posts a handoff notification as a Jira comment on the dev issue.
 * Optionally also calls the configured outbound webhook (e.g., Teams/Slack relay).
 *
 * @param {string} issueKey - Dev issue key
 * @param {'QE'|'BT'} handoffType - Type of handoff
 * @param {string} featureKey - Parent feature key
 * @param {string} featureSummary - Parent feature summary
 * @param {object} jiraConfig - Jira service config
 * @param {{ handoffDelivery?: { webhookUrl?: string, webhookSecret?: string } }} profileConfig
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<void>}
 */
async function postHandoffComment(issueKey, handoffType, featureKey, featureSummary, jiraConfig, profileConfig, isTlsVerified) {
  const commentBody = buildHandoffComment(issueKey, handoffType, featureKey, featureSummary);
  const commentPath = '/rest/api/2/issue/' + encodeURIComponent(issueKey) + '/comment';

  try {
    await makeJiraApiRequest('POST', commentPath, { body: commentBody }, jiraConfig, isTlsVerified);
    console.log('[SprintRelease] Posted ' + handoffType + ' handoff comment on ' + issueKey + '.');
  } catch (commentError) {
    console.error('[SprintRelease] Comment post failed for ' + issueKey + ': ' + commentError.message);
  }

  // Optional outbound webhook delivery (e.g., Teams/Slack relay).
  const webhookUrl = profileConfig.handoffDelivery && profileConfig.handoffDelivery.webhookUrl;
  if (!webhookUrl) return;

  const webhookPayload = { issueKey, handoffType, featureKey, featureSummary, commentBody };
  const webhookSecret = profileConfig.handoffDelivery.webhookSecret || null;
  try {
    await triggerWebhook(webhookUrl, webhookPayload, isTlsVerified, webhookSecret);
  } catch (webhookError) {
    console.error('[SprintRelease] Webhook delivery failed for ' + issueKey + ': ' + webhookError.message);
  }
}

// ── calculateCodeFreezeDate ───────────────────────────────────────────────────

/**
 * Computes the sprint end date (code freeze date) by counting backward a given
 * number of business days (Mon–Fri only) from a release date.
 *
 * Public holidays are excluded from scope — only weekends are skipped.
 * This keeps the implementation simple without requiring a holiday calendar dependency.
 *
 * @param {string} releaseDate - ISO date string (YYYY-MM-DD) of the release date
 * @param {number} businessDays - Number of business days to subtract (typically 13)
 * @returns {string} ISO date string of the computed code freeze date
 */
function calculateCodeFreezeDate(releaseDate, businessDays) {
  // Parse as UTC midnight to avoid timezone-induced off-by-one errors.
  const releaseDateMs = Date.parse(releaseDate + 'T00:00:00Z');
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  let currentDateMs = releaseDateMs;
  let remainingBusinessDays = businessDays;

  while (remainingBusinessDays > 0) {
    currentDateMs -= ONE_DAY_MS;
    const dayOfWeek = new Date(currentDateMs).getUTCDay();
    const isWeekend = dayOfWeek === SUNDAY_DAY_NUMBER || dayOfWeek === SATURDAY_DAY_NUMBER;
    if (!isWeekend) {
      remainingBusinessDays--;
    }
  }

  // Format as YYYY-MM-DD ISO date string.
  return new Date(currentDateMs).toISOString().slice(0, 10);
}

// ── detectFixVersionDateChange ────────────────────────────────────────────────

/**
 * Compares the current list of Jira fixVersions against previously seen release
 * dates. Returns change events for any fixVersion whose releaseDate differs from
 * the last known value.
 *
 * On first call (empty map) returns no events — we only track changes, not initial state.
 * Updates the lastSeenDatesMap in place with the current values.
 *
 * @param {object[]} fixVersions - FixVersion objects from Jira { id, name, releaseDate }
 * @param {Map<string, string>} lastSeenDatesMap
 *   Map keyed by "{teamProfileId}:{fixVersionId}", value is the last known releaseDate.
 * @param {{ teamProfileId: string }} profileConfig
 * @returns {Array<{ fixVersionId: string, fixVersionName: string, previousReleaseDate: string, newReleaseDate: string }>}
 */
function detectFixVersionDateChange(fixVersions, lastSeenDatesMap, profileConfig) {
  const changeEvents = [];
  const isFirstRun = lastSeenDatesMap.size === 0;

  for (const fixVersion of fixVersions) {
    if (!fixVersion.releaseDate) continue;

    const mapKey = profileConfig.teamProfileId + ':' + fixVersion.id;
    const previousReleaseDate = lastSeenDatesMap.get(mapKey);

    // On first run, just seed the map — don't emit change events.
    if (isFirstRun || previousReleaseDate === undefined) {
      lastSeenDatesMap.set(mapKey, fixVersion.releaseDate);
      continue;
    }

    if (previousReleaseDate !== fixVersion.releaseDate) {
      changeEvents.push({
        fixVersionId:         fixVersion.id,
        fixVersionName:       fixVersion.name,
        previousReleaseDate,
        newReleaseDate:       fixVersion.releaseDate,
      });
      lastSeenDatesMap.set(mapKey, fixVersion.releaseDate);
    }
  }

  return changeEvents;
}

// ── findSprintByName ──────────────────────────────────────────────────────────

/**
 * Queries the Jira Agile API for all active and future sprints on a board,
 * then returns the one whose name matches the given sprint name.
 *
 * Sprint names and fixVersion names share the same label by convention (e.g., "6/18").
 * Matching is exact — if the naming convention diverges, no sprint is found.
 *
 * @param {string} sprintName - The sprint name to find (e.g., "6/18")
 * @param {number} boardId - The Jira Software board ID
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<object|null>} Sprint object or null if not found
 */
async function findSprintByName(sprintName, boardId, jiraConfig, isTlsVerified) {
  const sprintListPath = '/rest/agile/1.0/board/' + boardId + '/sprint?state=active,future';

  try {
    const sprintResponse = await makeJiraApiRequest('GET', sprintListPath, null, jiraConfig, isTlsVerified);
    const sprints = (sprintResponse.body && sprintResponse.body.values) || [];
    const matchedSprint = sprints.find((sprint) => sprint.name === sprintName);

    if (!matchedSprint) {
      console.warn('[SprintRelease] No sprint named "' + sprintName + '" found on board ' + boardId + '.');
    }
    return matchedSprint || null;
  } catch (sprintFetchError) {
    console.error('[SprintRelease] Sprint list fetch failed for board ' + boardId + ': ' + sprintFetchError.message);
    return null;
  }
}

// ── updateSprintEndDate ───────────────────────────────────────────────────────

/**
 * Updates the end date of a Jira sprint via the Agile API.
 * Skips closed sprints to avoid modifying historical data.
 *
 * @param {object} sprint - Sprint object from findSprintByName (must include id, state)
 * @param {string} newEndDate - ISO date string of the new sprint end date
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<{ wasUpdated: boolean, warning?: string }>}
 */
async function updateSprintEndDate(sprint, newEndDate, jiraConfig, isTlsVerified) {
  if (sprint.state === 'closed') {
    const warning = 'Sprint "' + sprint.name + '" is closed — end date not updated.';
    console.warn('[SprintRelease] ' + warning);
    return { wasUpdated: false, warning };
  }

  // Guard against setting a sprint end date in the past.
  const todayIso = new Date().toISOString().slice(0, 10);
  if (newEndDate < todayIso) {
    const warning = 'Computed sprint end date ' + newEndDate
      + ' for sprint "' + sprint.name + '" is in the past — not updating.';
    console.warn('[SprintRelease] ' + warning);
    return { wasUpdated: false, warning };
  }

  const sprintUpdatePath = '/rest/agile/1.0/sprint/' + sprint.id;
  try {
    await makeJiraApiRequest('POST', sprintUpdatePath, { endDate: newEndDate }, jiraConfig, isTlsVerified);
    console.log('[SprintRelease] Updated sprint "' + sprint.name + '" end date to ' + newEndDate + '.');
    return { wasUpdated: true };
  } catch (updateError) {
    const warning = 'Sprint end date update failed: ' + updateError.message;
    console.error('[SprintRelease] ' + warning);
    return { wasUpdated: false, warning };
  }
}

// ── detectDefectIntakeLabels ──────────────────────────────────────────────────

/**
 * Filters QE/BT issues that have the defect intake label applied and are linked
 * to a dev project issue. Already-processed issue keys (in processedSet) are skipped
 * to prevent duplicate defect creation on subsequent poll cycles.
 *
 * This function is pure and side-effect-free.
 *
 * @param {object[]} qeBtIssues - Issues from QE and BT projects with expand=changelog
 * @param {Set<string>} processedSet - Set of already-processed intake keys "{profileId}:{issueKey}"
 * @param {{ teamProfileId: string, defectIntakeLabel: string, devProjectKey: string }} profileConfig
 * @returns {Array<{ triggerIssueKey: string, triggerIssue: object, linkedDevIssueKey: string }>}
 */
function detectDefectIntakeLabels(qeBtIssues, processedSet, profileConfig) {
  const newIntakes = [];

  for (const qeBtIssue of qeBtIssues) {
    const issueLabels = (qeBtIssue.fields && qeBtIssue.fields.labels) || [];
    if (!issueLabels.includes(profileConfig.defectIntakeLabel)) continue;

    const processedKey = profileConfig.teamProfileId + ':' + qeBtIssue.key;
    if (processedSet.has(processedKey)) continue;

    // Find a linked dev issue in the configured dev project.
    const issueLinks = (qeBtIssue.fields && qeBtIssue.fields.issueLinks) || [];
    let linkedDevIssueKey = null;

    for (const issueLink of issueLinks) {
      const linkedKey = (issueLink.inwardIssue && issueLink.inwardIssue.key)
        || (issueLink.outwardIssue && issueLink.outwardIssue.key);
      if (linkedKey && linkedKey.startsWith(profileConfig.devProjectKey + '-')) {
        linkedDevIssueKey = linkedKey;
        break;
      }
    }

    if (!linkedDevIssueKey) {
      console.warn('[SprintRelease] Defect intake label on ' + qeBtIssue.key
        + ' but no linked dev issue found — skipping.');
      continue;
    }

    newIntakes.push({ triggerIssueKey: qeBtIssue.key, triggerIssue: qeBtIssue, linkedDevIssueKey });
  }

  return newIntakes;
}

// ── isSprintInFreezeWindow ────────────────────────────────────────────────────

/**
 * Returns true when the given date falls on or after the sprint end date, meaning
 * the sprint is within (or past) its code-freeze window.
 *
 * This function is pure and has no side effects.
 *
 * @param {string} sprintEndDate - ISO date string of the sprint end date (YYYY-MM-DD)
 * @param {string} currentDate - ISO date string of the date to test against
 * @returns {boolean} True when currentDate >= sprintEndDate
 */
function isSprintInFreezeWindow(sprintEndDate, currentDate) {
  return currentDate >= sprintEndDate;
}

// ── buildDefectIssueSummary ───────────────────────────────────────────────────

/**
 * Prefixes the original dev issue summary with "[DEFECT] " to distinguish
 * defect work from the original delivery story.
 *
 * @param {string} originalSummary - Summary of the original dev issue
 * @returns {string} Prefixed summary string
 */
function buildDefectIssueSummary(originalSummary) {
  return DEFECT_SUMMARY_PREFIX + originalSummary;
}

// ── createDefectIssue ─────────────────────────────────────────────────────────

/**
 * Creates a new defect issue in the dev project linked to both the original dev
 * issue (stays Done) and the QE/BT trigger issue. Inherits the original assignee
 * and fixVersion. If the sprint is within the code-freeze window, the defect issue
 * is flagged for triage instead of being assigned to the active sprint.
 *
 * Never modifies the original dev issue — it stays Done with its assignee intact.
 *
 * @param {object} originalDevIssue - Full Jira dev issue object (used for assignee, fixVersions)
 * @param {object} triggerIssue - QE/BT Jira issue that had the defect-intake label
 * @param {string} sprintEndDate - Current active sprint end date (for freeze window check)
 * @param {{ devProjectKey: string, teamProfileId: string, freezeWindowBusinessDays: number }} profileConfig
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<{ createdIssueKey: string|null }>}
 */
async function createDefectIssue(originalDevIssue, triggerIssue, sprintEndDate, profileConfig, jiraConfig, isTlsVerified) {
  const originalFields = originalDevIssue.fields || {};
  const todayIso = new Date().toISOString().slice(0, 10);
  const isInFreezeWindow = sprintEndDate ? isSprintInFreezeWindow(sprintEndDate, todayIso) : false;

  const defectLabels = [DEFECT_FROM_TESTING_LABEL];
  if (isInFreezeWindow) {
    defectLabels.push(TRIAGE_REQUIRED_LABEL);
  }

  const defectIssueBody = {
    fields: {
      project:   { key: profileConfig.devProjectKey },
      issuetype: { name: 'Bug' },
      summary:   buildDefectIssueSummary(originalFields.summary || ''),
      labels:    defectLabels,
      // Inherit fix versions from the original dev issue so the defect stays in the
      // correct release cycle. If in freeze window, the triage label signals manual review.
      fixVersions: isInFreezeWindow ? [] : (originalFields.fixVersions || []),
    },
  };

  // Inherit assignee from original dev issue — preserves ownership traceability.
  // We set assignee only when copying from the original; we never set it to a new value.
  if (originalFields.assignee && originalFields.assignee.accountId) {
    defectIssueBody.fields.assignee = { accountId: originalFields.assignee.accountId };
  }

  let createdIssueKey = null;
  try {
    const createResponse = await makeJiraApiRequest('POST', '/rest/api/2/issue', defectIssueBody, jiraConfig, isTlsVerified);
    createdIssueKey = createResponse.body && createResponse.body.key;
    console.log('[SprintRelease] Created defect issue ' + createdIssueKey + ' from ' + triggerIssue.key + '.');
  } catch (createError) {
    console.error('[SprintRelease] Defect issue creation failed: ' + createError.message);
    return { createdIssueKey: null };
  }

  if (!createdIssueKey) return { createdIssueKey: null };

  // Link defect to original dev issue: "is caused by" ENFCT-XXXX
  await createIssueLink(createdIssueKey, originalDevIssue.key, 'is caused by', jiraConfig, isTlsVerified);
  // Link defect to QE/BT trigger issue: "triggered by" INTTEST-XXXX
  await createIssueLink(createdIssueKey, triggerIssue.key, 'triggered by', jiraConfig, isTlsVerified);

  return { createdIssueKey };
}

// ── createIssueLink ───────────────────────────────────────────────────────────

/**
 * Creates a directional link between two Jira issues.
 * Errors are logged but do not throw — a link failure should not abort the
 * defect issue that was already created.
 *
 * @param {string} fromIssueKey - The issue that is the "from" end of the link
 * @param {string} toIssueKey - The issue that is the "to" end of the link
 * @param {string} linkTypeName - Jira issue link type name (e.g., "is caused by")
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<void>}
 */
async function createIssueLink(fromIssueKey, toIssueKey, linkTypeName, jiraConfig, isTlsVerified) {
  const linkBody = {
    type:         { name: linkTypeName },
    inwardIssue:  { key: fromIssueKey },
    outwardIssue: { key: toIssueKey },
  };

  try {
    await makeJiraApiRequest('POST', '/rest/api/2/issueLink', linkBody, jiraConfig, isTlsVerified);
  } catch (linkError) {
    console.error('[SprintRelease] Issue link creation failed (' + fromIssueKey + ' → '
      + toIssueKey + '): ' + linkError.message);
  }
}

// ── removeDefectIntakeLabel ───────────────────────────────────────────────────

/**
 * Removes the defect-intake label from a QE/BT issue after the defect has been
 * created, preventing the next poll cycle from creating a duplicate.
 *
 * @param {string} triggerIssueKey - The QE/BT issue key
 * @param {string[]} currentLabels - The issue's current label array
 * @param {string} defectIntakeLabel - The label to remove (from profileConfig)
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<void>}
 */
async function removeDefectIntakeLabel(triggerIssueKey, currentLabels, defectIntakeLabel, jiraConfig, isTlsVerified) {
  const updatedLabels = currentLabels.filter((label) => label !== defectIntakeLabel);
  const updatePath = '/rest/api/2/issue/' + encodeURIComponent(triggerIssueKey);

  try {
    await makeJiraApiRequest('PUT', updatePath, { fields: { labels: updatedLabels } }, jiraConfig, isTlsVerified);
    console.log('[SprintRelease] Removed "' + defectIntakeLabel + '" label from ' + triggerIssueKey + '.');
  } catch (labelError) {
    console.error('[SprintRelease] Label removal failed for ' + triggerIssueKey + ': ' + labelError.message);
  }
}

// ── findDorViolations ─────────────────────────────────────────────────────────

/**
 * Scans a list of sprint issues for Definition of Ready violations.
 * A violation occurs when a configured DoR field (dorQeFieldId or dorBtFieldId)
 * is empty on an issue. Fields with an empty field ID in the config are skipped
 * to prevent false-positive violations when DoR is not yet configured.
 *
 * This function is pure and has no side effects.
 *
 * @param {object[]} sprintIssues - Jira issues in the active sprint
 * @param {{ dorQeFieldId: string, dorBtFieldId: string }} profileConfig
 * @returns {Array<{ issueKey: string, summary: string, assignee: string|null, missingFields: string[] }>}
 */
function findDorViolations(sprintIssues, profileConfig) {
  const violations = [];

  for (const jiraIssue of sprintIssues) {
    const issueFields = jiraIssue.fields || {};
    const missingFieldIds = [];

    // Only check a DoR field when its field ID is non-empty in the profile config.
    // An empty fieldId means the team hasn't configured that requirement yet.
    if (profileConfig.dorQeFieldId && !issueFields[profileConfig.dorQeFieldId]) {
      missingFieldIds.push('dorQeFieldId');
    }
    if (profileConfig.dorBtFieldId && !issueFields[profileConfig.dorBtFieldId]) {
      missingFieldIds.push('dorBtFieldId');
    }

    if (missingFieldIds.length === 0) continue;

    const assigneeDisplayName = (issueFields.assignee && issueFields.assignee.displayName) || null;
    violations.push({
      issueKey:      jiraIssue.key,
      summary:       issueFields.summary || '',
      assignee:      assigneeDisplayName,
      missingFields: missingFieldIds,
    });
  }

  return violations;
}

// ── postDorViolationComment ───────────────────────────────────────────────────

/**
 * Posts a Jira comment on an issue that has DoR violations, listing the missing
 * field names in human-readable form for the assignee to act on.
 *
 * @param {string} issueKey - The dev issue key with violations
 * @param {string[]} missingFields - Array of missing field keys (e.g., ["dorQeFieldId"])
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<void>}
 */
async function postDorViolationComment(issueKey, missingFields, jiraConfig, isTlsVerified) {
  const humanReadableFields = missingFields.map((fieldKey) => {
    if (fieldKey === 'dorQeFieldId') return 'QE Acceptance Criteria';
    if (fieldKey === 'dorBtFieldId') return 'BT Test Scenarios';
    return fieldKey;
  });

  const commentBody = [
    '[Definition of Ready] This issue is missing required fields before sprint start:',
    '',
    humanReadableFields.map((fieldName) => '• ' + fieldName).join('\n'),
    '',
    'Please update the issue before the sprint begins.',
    '',
    '_This comment was posted automatically by NodeToolbox Sprint–Release Workflow._',
  ].join('\n');

  const commentPath = '/rest/api/2/issue/' + encodeURIComponent(issueKey) + '/comment';
  try {
    await makeJiraApiRequest('POST', commentPath, { body: commentBody }, jiraConfig, isTlsVerified);
  } catch (commentError) {
    console.error('[SprintRelease] DoR violation comment failed for ' + issueKey + ': ' + commentError.message);
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  detectSubStatusChanges,
  buildHandoffComment,
  executeDevIssueDone,
  postHandoffComment,
  calculateCodeFreezeDate,
  detectFixVersionDateChange,
  findSprintByName,
  updateSprintEndDate,
  detectDefectIntakeLabels,
  isSprintInFreezeWindow,
  buildDefectIssueSummary,
  createDefectIssue,
  removeDefectIntakeLabel,
  findDorViolations,
  postDorViolationComment,
};
