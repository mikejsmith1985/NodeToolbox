// src/routes/sprintRelease.js — Express router for the Sprint–Release Workflow API.
//
// Exposes five endpoints used by the Admin Hub and the run-now trigger:
//   GET  /api/sprint-release/config           → current team workflow profile
//   POST /api/sprint-release/config           → validate and save profile
//   GET  /api/sprint-release/dor-violations   → DoR violations for active sprint
//   POST /api/sprint-release/run-now          → trigger immediate poll cycle
//   GET  /api/sprint-release/status           → full runtime state
//
// Webhook secrets in the team profile are stripped from all GET responses.

'use strict';

const express = require('express');
const { saveConfigToDisk } = require('../config/loader');
const { makeJiraApiRequest } = require('../utils/httpClient');
const { findSprintByName, findDorViolations, postDorViolationComment } = require('../services/sprintReleaseOrchestrator');
const { triggerPollCycleNow, getSprintReleaseStatus } = require('../services/sprintReleaseScheduler');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default team profile used when no profiles have been configured yet. */
const DEFAULT_TEAM_PROFILE = {
  teamProfileId:            'default',
  isEnabled:                true,
  featureProjectKey:        '',
  devProjectKey:            '',
  qeProjectKey:             '',
  btProjectKey:             '',
  boardId:                  0,
  subStatusFieldId:         'customfield_10201',
  qeHandoffSubStatusValue:  'Ready for System Integration Test',
  btHandoffSubStatusValue:  'Ready for UAT',
  configOnlyLabel:          'no-testing-required',
  defectIntakeLabel:        'defect-intake',
  freezeWindowBusinessDays: 13,
  doneTransitionName:       'Done',
  dorQeFieldId:             '',
  dorBtFieldId:             '',
  handoffDelivery:          { webhookUrl: '', webhookSecret: '' },
  pollIntervalMinutes:      5,
};

/** Required project key fields that must be validated against Jira before saving. */
const REQUIRED_PROJECT_KEY_FIELDS = ['featureProjectKey', 'devProjectKey', 'qeProjectKey', 'btProjectKey'];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the first team profile from the config, falling back to the default shape.
 * Strips the handoffDelivery.webhookSecret from the returned object.
 *
 * @param {object} configuration - Live server config
 * @returns {object} Safe (secret-stripped) team profile
 */
function getSafeTeamProfile(configuration) {
  const profiles = (configuration.sprintRelease || {}).teamProfiles || [];
  const activeProfile = profiles[0] || { ...DEFAULT_TEAM_PROFILE };

  // Deep-copy and strip webhook secret before returning.
  const safeProfile = JSON.parse(JSON.stringify(activeProfile));
  if (safeProfile.handoffDelivery) {
    safeProfile.handoffDelivery.webhookSecret = '***';
  }
  return safeProfile;
}

/**
 * Validates that a given Jira project key exists in the connected Jira instance.
 *
 * @param {string} projectKey - The Jira project key to validate
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<boolean>} True when the project exists (HTTP 200)
 */
async function isValidJiraProjectKey(projectKey, jiraConfig, isTlsVerified) {
  try {
    const projectResponse = await makeJiraApiRequest(
      'GET',
      '/rest/api/2/project/' + encodeURIComponent(projectKey),
      null, jiraConfig, isTlsVerified
    );
    return projectResponse.status === 200;
  } catch (_validationError) {
    return false;
  }
}

/**
 * Validates that a given board ID exists in the Jira Agile API.
 *
 * @param {number} boardId - The board ID to validate
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<boolean>} True when the board exists (HTTP 200)
 */
async function isValidJiraBoardId(boardId, jiraConfig, isTlsVerified) {
  try {
    const boardResponse = await makeJiraApiRequest(
      'GET',
      '/rest/agile/1.0/board/' + boardId,
      null, jiraConfig, isTlsVerified
    );
    return boardResponse.status === 200;
  } catch (_boardValidationError) {
    return false;
  }
}

// ── Workflow topology helpers ─────────────────────────────────────────────────

/**
 * Fetches issue types and all available statuses for a single Jira project.
 * Returns an object with isReachable=false when the project is unavailable or
 * returns a non-200 status — callers use this flag to render an error state
 * rather than throwing and aborting the whole topology fetch.
 *
 * @param {string}  projectKey    - Jira project key (e.g. "ENFCT")
 * @param {object}  jiraConfig    - Jira service credentials
 * @param {boolean} isTlsVerified - Whether to enforce TLS certificate checking
 * @returns {Promise<{isReachable: boolean, issueTypes: object[], allStatuses: string[]}>}
 */
async function fetchProjectTopology(projectKey, jiraConfig, isTlsVerified) {
  try {
    const statusesResponse = await makeJiraApiRequest(
      'GET',
      '/rest/api/2/project/' + encodeURIComponent(projectKey) + '/statuses',
      null, jiraConfig, isTlsVerified
    );
    if (statusesResponse.status !== 200) {
      return { isReachable: false, issueTypes: [], allStatuses: [] };
    }
    const issueTypeList = Array.isArray(statusesResponse.body) ? statusesResponse.body : [];
    const issueTypes = issueTypeList.map((issueType) => ({
      name:      issueType.name,
      isSubtask: !!issueType.subtask,
    }));
    // Deduplicate status names — multiple issue types often share the same statuses.
    const uniqueStatusNames = new Set();
    issueTypeList.forEach((issueType) => {
      (issueType.statuses || []).forEach((status) => uniqueStatusNames.add(status.name));
    });
    return { isReachable: true, issueTypes, allStatuses: Array.from(uniqueStatusNames).sort() };
  } catch (_topologyFetchError) {
    return { isReachable: false, issueTypes: [], allStatuses: [] };
  }
}

/**
 * Fetches the allowed option values for a custom select field using Jira's
 * issue creation metadata endpoint. This is the authoritative source for
 * custom field options — it reflects the project's active field configuration
 * rather than values inferred from existing issue data.
 * Returns an empty array when the field is absent from the project's metadata.
 *
 * @param {string}  devProjectKey   - Jira key of the dev project
 * @param {string}  subStatusFieldId - Custom field ID (e.g. "customfield_10201")
 * @param {object}  jiraConfig       - Jira service credentials
 * @param {boolean} isTlsVerified    - Whether to enforce TLS certificate checking
 * @returns {Promise<string[]>}
 */
async function fetchSubStatusFieldOptions(devProjectKey, subStatusFieldId, jiraConfig, isTlsVerified) {
  try {
    const metaPath = '/rest/api/2/issue/createmeta?projectKeys='
      + encodeURIComponent(devProjectKey)
      + '&expand=projects.issuetypes.fields';
    const metaResponse = await makeJiraApiRequest('GET', metaPath, null, jiraConfig, isTlsVerified);
    if (metaResponse.status !== 200 || !metaResponse.body) return [];

    const projectList = metaResponse.body.projects || [];
    const projectMeta = projectList.find((proj) => proj.key === devProjectKey);
    if (!projectMeta) return [];

    for (const issueType of (projectMeta.issuetypes || [])) {
      const fieldDefinition = (issueType.fields || {})[subStatusFieldId];
      if (fieldDefinition && Array.isArray(fieldDefinition.allowedValues) && fieldDefinition.allowedValues.length > 0) {
        return fieldDefinition.allowedValues.map(
          (optionItem) => optionItem.value || optionItem.name || String(optionItem.id)
        );
      }
    }
    return [];
  } catch (_metaFetchError) {
    return [];
  }
}

/**
 * Finds a sample issue in the dev project and returns its available transitions.
 * Transitions are fetched from a real issue rather than a static schema because
 * Jira workflows are state-dependent — available transitions vary by current status.
 * A sample recently-created issue is a reasonable proxy for the active workflow path.
 * Returns an empty array when the project has no issues or the fetch fails.
 *
 * @param {string}  devProjectKey - Jira key of the dev project
 * @param {object}  jiraConfig    - Jira service credentials
 * @param {boolean} isTlsVerified - Whether to enforce TLS certificate checking
 * @returns {Promise<{transitionId: string, transitionName: string, toStatusName: string}[]>}
 */
async function fetchDevProjectTransitions(devProjectKey, jiraConfig, isTlsVerified) {
  try {
    const searchPath = '/rest/api/2/search?jql='
      + encodeURIComponent('project = ' + devProjectKey + ' ORDER BY created DESC')
      + '&maxResults=1&fields=summary';
    const searchResponse = await makeJiraApiRequest('GET', searchPath, null, jiraConfig, isTlsVerified);
    if (searchResponse.status !== 200 || !searchResponse.body) return [];

    const sampleIssueList = searchResponse.body.issues || [];
    if (sampleIssueList.length === 0) return [];

    const sampleIssueKey = sampleIssueList[0].key;
    const transitionsResponse = await makeJiraApiRequest(
      'GET',
      '/rest/api/2/issue/' + encodeURIComponent(sampleIssueKey) + '/transitions',
      null, jiraConfig, isTlsVerified
    );
    if (transitionsResponse.status !== 200 || !transitionsResponse.body) return [];

    return (transitionsResponse.body.transitions || []).map((transition) => ({
      transitionId:   transition.id,
      transitionName: transition.name,
      toStatusName:   (transition.to || {}).name || '',
    }));
  } catch (_transitionsFetchError) {
    return [];
  }
}

// ── Router factory ────────────────────────────────────────────────────────────

/**
 * Creates and returns an Express router for the Sprint–Release Workflow API.
 * The `configuration` object is mutated in place on POST /config so that
 * in-process callers (the scheduler) see the update without a server restart.
 *
 * @param {object} configuration - Live server configuration object
 * @returns {express.Router}
 */
function createSprintReleaseRouter(configuration) {
  const router = express.Router();

  // ── GET /api/sprint-release/config ────────────────────────────────────────

  router.get('/api/sprint-release/config', (req, res) => {
    return res.json(getSafeTeamProfile(configuration));
  });

  // ── POST /api/sprint-release/config ──────────────────────────────────────

  router.post('/api/sprint-release/config', async (req, res) => {
    const submittedProfile = req.body || {};
    const jiraConfig = configuration.jira || {};
    const isTlsVerified = configuration.sslVerify !== false;

    // Validate all four required project keys against live Jira.
    const validatedProjectKeys = [];
    for (const projectKeyField of REQUIRED_PROJECT_KEY_FIELDS) {
      const projectKey = submittedProfile[projectKeyField];
      if (!projectKey) {
        return res.status(400).json({ error: 'Required field "' + projectKeyField + '" is missing.' });
      }

      const isValid = await isValidJiraProjectKey(projectKey, jiraConfig, isTlsVerified);
      if (!isValid) {
        return res.status(400).json({ error: 'Project key ' + projectKey + ' not found in Jira' });
      }
      validatedProjectKeys.push(projectKey);
    }

    // Validate boardId against the Jira Agile API.
    const boardId = parseInt(submittedProfile.boardId, 10);
    if (!boardId || boardId <= 0) {
      return res.status(400).json({ error: '"boardId" must be a positive integer.' });
    }
    const isBoardValid = await isValidJiraBoardId(boardId, jiraConfig, isTlsVerified);
    if (!isBoardValid) {
      return res.status(400).json({ error: 'Board ID ' + boardId + ' not found in Jira Agile' });
    }

    // Merge submitted values over defaults, preserving the existing webhookSecret
    // if the submitted value is the masked placeholder.
    const existingProfile = ((configuration.sprintRelease || {}).teamProfiles || [])[0] || {};
    const existingWebhookSecret = (existingProfile.handoffDelivery || {}).webhookSecret || '';
    const submittedWebhookSecret = (submittedProfile.handoffDelivery || {}).webhookSecret;
    const resolvedWebhookSecret = (submittedWebhookSecret === '***' || !submittedWebhookSecret)
      ? existingWebhookSecret
      : submittedWebhookSecret;

    const updatedProfile = {
      ...DEFAULT_TEAM_PROFILE,
      ...existingProfile,
      ...submittedProfile,
      boardId,
      handoffDelivery: {
        webhookUrl:    (submittedProfile.handoffDelivery || {}).webhookUrl || '',
        webhookSecret: resolvedWebhookSecret,
      },
    };

    // Mutate the live config so the scheduler picks up the new profile immediately.
    if (!configuration.sprintRelease) {
      configuration.sprintRelease = { teamProfiles: [] };
    }
    configuration.sprintRelease.teamProfiles = [updatedProfile];
    saveConfigToDisk(configuration);

    return res.json({ saved: true, validatedProjects: validatedProjectKeys });
  });

  // ── GET /api/sprint-release/dor-violations ────────────────────────────────

  router.get('/api/sprint-release/dor-violations', async (req, res) => {
    const jiraConfig = configuration.jira || {};
    const isTlsVerified = configuration.sslVerify !== false;
    const teamProfile = ((configuration.sprintRelease || {}).teamProfiles || [])[0];

    if (!teamProfile) {
      return res.status(400).json({ error: 'Sprint-release workflow not configured. POST /api/sprint-release/config first.' });
    }

    // Resolve the sprint to scan — caller can pass ?sprintId= to override.
    let sprintId = req.query.sprintId ? parseInt(req.query.sprintId, 10) : null;
    let sprintName = null;

    if (!sprintId) {
      const activeSprint = await findSprintByName('', teamProfile.boardId, jiraConfig, isTlsVerified)
        .catch(() => null);
      if (!activeSprint) {
        return res.status(404).json({ error: 'No active sprint found on board ' + teamProfile.boardId + '.' });
      }
      sprintId = activeSprint.id;
      sprintName = activeSprint.name;
    }

    const fieldList = [
      'summary', 'assignee', 'labels',
      teamProfile.dorQeFieldId,
      teamProfile.dorBtFieldId,
    ].filter(Boolean).join(',');

    const sprintIssuesPath = '/rest/agile/1.0/sprint/' + sprintId
      + '/issue?fields=' + encodeURIComponent(fieldList)
      + '&maxResults=100';

    let sprintIssues;
    try {
      const sprintResponse = await makeJiraApiRequest('GET', sprintIssuesPath, null, jiraConfig, isTlsVerified);
      sprintIssues = (sprintResponse.body && sprintResponse.body.issues) || [];
    } catch (sprintError) {
      return res.status(503).json({ error: 'Jira sprint issues fetch failed.', detail: sprintError.message });
    }

    const violations = findDorViolations(sprintIssues, teamProfile);

    // Post a comment on each violating issue (advisory only — non-blocking).
    for (const violation of violations) {
      await postDorViolationComment(violation.issueKey, violation.missingFields, jiraConfig, isTlsVerified)
        .catch(() => {});
    }

    return res.json({
      sprintId,
      sprintName,
      checkedAt:      new Date().toISOString(),
      violations,
      totalIssues:    sprintIssues.length,
      violationCount: violations.length,
    });
  });

  // ── POST /api/sprint-release/run-now ─────────────────────────────────────

  router.post('/api/sprint-release/run-now', async (req, res) => {
    const teamProfile = ((configuration.sprintRelease || {}).teamProfiles || [])[0];
    const teamProfileId = (teamProfile && teamProfile.teamProfileId) || 'default';

    // Fire and forget — the poll cycle is async; respond immediately.
    triggerPollCycleNow(configuration).catch((cycleError) => {
      console.error('[SprintRelease] run-now poll cycle threw: ' + cycleError.message);
    });

    return res.json({
      triggered:     true,
      teamProfileId,
      message:       'Poll cycle started. Check /api/sprint-release/status for results.',
    });
  });

  // ── GET /api/sprint-release/status ───────────────────────────────────────

  router.get('/api/sprint-release/status', (req, res) => {
    return res.json(getSprintReleaseStatus(configuration));
  });

  // ── GET /api/sprint-release/workflow-topology ─────────────────────────────
  //
  // Queries Jira in parallel for each configured project's issue types, statuses,
  // the sub-status custom field's allowed values, and the dev project's available
  // workflow transitions. Returns a structured topology with per-project reachability
  // and a validation block indicating whether each configured rule value actually
  // exists in Jira — so administrators can verify the workflow is supportable before
  // enabling the scheduler.

  router.get('/api/sprint-release/workflow-topology', async (req, res) => {
    const jiraConfig    = configuration.jira || {};
    const isTlsVerified = configuration.sslVerify !== false;
    const teamProfile   = ((configuration.sprintRelease || {}).teamProfiles || [])[0];

    if (!teamProfile) {
      return res.status(400).json({ error: 'Sprint-release workflow not configured. POST /api/sprint-release/config first.' });
    }

    const {
      featureProjectKey, devProjectKey, qeProjectKey, btProjectKey,
      subStatusFieldId, qeHandoffSubStatusValue, btHandoffSubStatusValue, doneTransitionName,
    } = teamProfile;

    if (!featureProjectKey || !devProjectKey || !qeProjectKey || !btProjectKey) {
      return res.status(400).json({ error: 'All four project keys must be configured before fetching the workflow topology.' });
    }

    const [featureTopology, devTopology, qeTopology, btTopology, subStatusOptions, devTransitions] = await Promise.all([
      fetchProjectTopology(featureProjectKey, jiraConfig, isTlsVerified),
      fetchProjectTopology(devProjectKey,     jiraConfig, isTlsVerified),
      fetchProjectTopology(qeProjectKey,      jiraConfig, isTlsVerified),
      fetchProjectTopology(btProjectKey,      jiraConfig, isTlsVerified),
      fetchSubStatusFieldOptions(devProjectKey, subStatusFieldId, jiraConfig, isTlsVerified),
      fetchDevProjectTransitions(devProjectKey, jiraConfig, isTlsVerified),
    ]);

    const isQeHandoffRuleValid  = subStatusOptions.includes(qeHandoffSubStatusValue);
    const isBtHandoffRuleValid  = subStatusOptions.includes(btHandoffSubStatusValue);
    const isDoneTransitionValid = devTransitions.some((trans) => trans.transitionName === doneTransitionName);

    return res.json({
      projects: {
        [featureProjectKey]: { role: 'feature', ...featureTopology },
        [devProjectKey]:     { role: 'dev',     ...devTopology     },
        [qeProjectKey]:      { role: 'qe',      ...qeTopology      },
        [btProjectKey]:      { role: 'bt',       ...btTopology      },
      },
      devTransitions,
      subStatusFieldOptions: subStatusOptions,
      validation: {
        qeHandoffSubStatusValue: { configuredValue: qeHandoffSubStatusValue, isFound: isQeHandoffRuleValid  },
        btHandoffSubStatusValue: { configuredValue: btHandoffSubStatusValue, isFound: isBtHandoffRuleValid  },
        doneTransitionName:      { configuredValue: doneTransitionName,      isFound: isDoneTransitionValid },
      },
      fetchedAt: new Date().toISOString(),
    });
  });

  return router;
}

module.exports = createSprintReleaseRouter;
