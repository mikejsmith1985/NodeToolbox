// src/services/reportSurfaceRegistry.js — Single source of truth for the report
// surfaces that can be delivered to an Atlassian Automation webhook.
//
// Each surface knows (a) how to resolve the team's existing webhook destination
// from the live server config and (b) the shape of the report it sends. Both the
// delivery service and the docs generator read from here, so the payload contract
// and its documentation never drift apart.

'use strict';

/**
 * Decides whether a stored team record matches a caller-supplied team id.
 * Matches on team name or project key (or any of a team's project keys),
 * case-insensitively.
 *
 * @param {object} teamReport - A stored per-team config record.
 * @param {string} teamId - The team identifier supplied by the client.
 * @returns {boolean}
 */
function matchesTeam(teamReport, teamId) {
  const wanted = String(teamId || '').trim().toLowerCase();
  if (!wanted) return false;

  const teamName = String(teamReport.teamName || '').trim().toLowerCase();
  if (teamName && teamName === wanted) return true;

  const projectKey = String(teamReport.projectKey || '').trim().toLowerCase();
  if (projectKey && projectKey === wanted) return true;

  const projectKeys = Array.isArray(teamReport.projectKeys) ? teamReport.projectKeys : [];
  return projectKeys.some((key) => String(key || '').trim().toLowerCase() === wanted);
}

/**
 * Finds the destination (url + secret) for a team within a scheduler config
 * section that holds a `teamReports` array. Returns null when there is no match
 * or the matched team has no webhook configured.
 *
 * @param {object} schedulerSection - e.g. configuration.scheduler.scopeChange
 * @param {string} teamId
 * @returns {{ triggerUrl: string, triggerSecret: string, teamName: string, projectKey: string } | null}
 */
function resolveFromTeamReports(schedulerSection, teamId) {
  const teamReports = ((schedulerSection || {}).teamReports) || [];
  const match = teamReports.find((report) => matchesTeam(report, teamId));
  if (!match || !match.triggerUrl) return null;

  const firstProjectKey = Array.isArray(match.projectKeys) ? match.projectKeys[0] : '';
  return {
    triggerUrl: match.triggerUrl,
    triggerSecret: match.triggerSecret || '',
    teamName: match.teamName || '',
    projectKey: match.projectKey || firstProjectKey || '',
  };
}

// Reads the scheduler section for a surface off the live configuration.
function schedulerSection(configuration, sectionName) {
  return ((configuration || {}).scheduler || {})[sectionName];
}

// The deliverable surfaces. Keyed by the stable surface id used in payloads.
const SURFACES = {
  'standup-briefing': {
    id: 'standup-briefing',
    label: 'Standup Briefing',
    reportShape: 'Markdown briefing text (string).',
    reportExample: '## Standup Briefing\\n\\n### Blockers\\n- DENP-1284 …',
    resolveDestination: (configuration, teamId) =>
      resolveFromTeamReports(schedulerSection(configuration, 'standupBriefing'), teamId),
  },
  'scope-change': {
    id: 'scope-change',
    label: 'Scope Change report',
    reportShape: 'Object: { releaseChanges: Row[], sprintChanges: Row[] }.',
    reportExample: '{ "releaseChanges": [], "sprintChanges": [] }',
    resolveDestination: (configuration, teamId) =>
      resolveFromTeamReports(schedulerSection(configuration, 'scopeChange'), teamId),
  },
  'feature-change': {
    id: 'feature-change',
    label: 'Feature Change report',
    reportShape: 'Object: { featureChanges: Row[] }.',
    reportExample: '{ "featureChanges": [] }',
    resolveDestination: (configuration, teamId) =>
      resolveFromTeamReports(schedulerSection(configuration, 'featureChange'), teamId),
  },
  // Hygiene Monitor digest — emailed via an Atlassian Automation rule. Each team
  // stores its own digestTriggerUrl, digestTriggerSecret, and (optional) digestEmailTo
  // in hygieneMonitor.teams; NodeToolbox POSTs the digest to the Automation webhook,
  // which composes the email (the recipient's inbox rule forwards it to Teams).
  'hygiene-digest': {
    id: 'hygiene-digest',
    label: 'Hygiene Monitor digest',
    reportShape: 'Object: { teamName, scannedAt, issuesScanned, violationsFound, fixesApplied, actionsRequired, unassignedCount, trend, failures, emailTo }.',
    reportExample: '{ "teamName": "Platform", "trend": "down", "violationsFound": 4 }',
    resolveDestination: (configuration, teamId) => {
      const hygieneTeams = ((configuration || {}).hygieneMonitor || {}).teams || [];
      const matchedTeam = hygieneTeams.find((team) =>
        String(team.teamName || '').trim().toLowerCase() === String(teamId || '').trim().toLowerCase()
      );
      if (!matchedTeam || !matchedTeam.digestTriggerUrl) return null;
      return {
        triggerUrl:    matchedTeam.digestTriggerUrl,
        triggerSecret: matchedTeam.digestTriggerSecret || '',
        teamName:      matchedTeam.teamName,
        projectKey:    (matchedTeam.projectKeys || [])[0] || '',
      };
    },
  },
};

/**
 * Returns the surface definition for an id, or null if unknown.
 * @param {string} surfaceId
 */
function getSurface(surfaceId) {
  return SURFACES[surfaceId] || null;
}

/** Returns all surface definitions (used by the docs generator). */
function listSurfaces() {
  return Object.values(SURFACES);
}

module.exports = { getSurface, listSurfaces, SURFACE_IDS: Object.keys(SURFACES) };
