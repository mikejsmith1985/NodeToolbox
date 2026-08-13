// jiraWriteJournal.js — A local, append-only record of every write this server sends to Jira.
//
// Why this exists: the server writes to Jira as the operator, so Jira's own history cannot answer
// "did this application make that change, or did I?". Nothing was recorded anywhere, so the question
// was unanswerable after the fact. This journal is the missing half of the evidence: it stays on the
// operator's machine, is never sent to Jira, and lets a later review say with certainty whether a
// given issue was written to by this application at a given moment.
//
// It records only routing facts — when, which method, which endpoint, which issue, which part of the
// app. Request bodies are deliberately NOT stored: they can carry issue content, and the journal's
// job is attribution, not duplication of Jira.

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

/** How many write records are kept. Comfortably covers several months of ordinary use. */
const MAX_JOURNAL_ENTRIES = 5000;

/** HTTP methods that change something in Jira. Reads are never journalled — they are noise here. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// Jira issue keys look like ABC-123. The capture is anchored to the /issue/ segment so an issue key
// appearing inside a JQL query string is not mistaken for the issue being written to.
const ISSUE_KEY_IN_PATH_PATTERN = /\/issue\/([A-Z][A-Z0-9_]+-\d+)/i;

function getJournalFilePath() {
  return process.env.TBX_JIRA_WRITE_JOURNAL_PATH
    || path.join(process.env.APPDATA || os.homedir(), 'NodeToolbox', 'jira-write-journal.json');
}

/**
 * Reports whether a request is a Jira write worth journalling.
 *
 * @param {string} httpMethod
 * @param {string} requestPath - Downstream Jira path, e.g. /rest/api/2/issue/ABC-1/transitions
 * @returns {boolean}
 */
function isJiraWrite(httpMethod, requestPath) {
  if (typeof httpMethod !== 'string' || typeof requestPath !== 'string') {
    return false;
  }
  return WRITE_METHODS.has(httpMethod.toUpperCase());
}

/**
 * Pulls the issue key out of a Jira REST path, or null when the write does not target one issue
 * (creating an issue, or a board/sprint level call).
 *
 * @param {string} requestPath
 * @returns {string|null}
 */
function extractIssueKeyFromPath(requestPath) {
  if (typeof requestPath !== 'string') {
    return null;
  }
  const matchedKey = requestPath.match(ISSUE_KEY_IN_PATH_PATTERN);
  return matchedKey ? matchedKey[1].toUpperCase() : null;
}

/**
 * Classifies what the write did, so a reviewer scanning the journal can spot status changes without
 * reading REST paths. Anything unrecognised is reported as 'field' rather than guessed at.
 *
 * @param {string} requestPath
 * @returns {'transition'|'comment'|'worklog'|'link'|'field'}
 */
function classifyWriteKind(requestPath) {
  const lowerCasePath = String(requestPath || '').toLowerCase();
  if (lowerCasePath.includes('/transitions')) return 'transition';
  if (lowerCasePath.includes('/comment'))     return 'comment';
  if (lowerCasePath.includes('/worklog'))     return 'worklog';
  if (lowerCasePath.includes('issuelink'))    return 'link';
  return 'field';
}

/** Reads the persisted journal, newest first. A missing or corrupt file reads as empty. */
function readJournal() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getJournalFilePath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_readError) {
    return [];
  }
}

/**
 * Builds one journal record. Pure, so the record shape can be tested without touching the disk.
 *
 * @param {{ method: string, path: string, source: string, atIso?: string, statusCode?: number|null }} writeDetails
 * @returns {{ atIso: string, method: string, path: string, issueKey: string|null, kind: string, source: string, statusCode: number|null }}
 */
function buildJournalEntry(writeDetails) {
  const requestPath = String(writeDetails.path || '');
  return {
    atIso:      writeDetails.atIso || new Date().toISOString(),
    method:     String(writeDetails.method || '').toUpperCase(),
    path:       stripQueryString(requestPath),
    issueKey:   extractIssueKeyFromPath(requestPath),
    kind:       classifyWriteKind(requestPath),
    source:     String(writeDetails.source || 'unknown'),
    statusCode: typeof writeDetails.statusCode === 'number' ? writeDetails.statusCode : null,
  };
}

/**
 * Records one Jira write. Never throws and never blocks the caller's own error handling — a journal
 * that could break a Jira write would be worse than no journal at all.
 *
 * @param {{ method: string, path: string, source: string, atIso?: string, statusCode?: number|null }} writeDetails
 * @returns {void}
 */
function recordJiraWrite(writeDetails) {
  try {
    if (!isJiraWrite(writeDetails.method, writeDetails.path)) {
      return;
    }
    const trimmedJournal = [buildJournalEntry(writeDetails), ...readJournal()].slice(0, MAX_JOURNAL_ENTRIES);
    fs.mkdirSync(path.dirname(getJournalFilePath()), { recursive: true });
    fs.writeFileSync(getJournalFilePath(), JSON.stringify(trimmedJournal, null, 2) + '\n', 'utf8');
  } catch (writeError) {
    console.error('  ⚠ Could not persist Jira write journal entry: ' + writeError.message);
  }
}

/**
 * Returns journal records for review, newest first, optionally narrowed to a time window.
 *
 * @param {{ sinceIso?: string, issueKey?: string, limit?: number }} [queryOptions]
 * @returns {Array<object>}
 */
function queryJournal(queryOptions) {
  const options = queryOptions || {};
  const requestedIssueKey = options.issueKey ? String(options.issueKey).toUpperCase() : null;
  const matchingEntries = readJournal().filter((entry) => {
    if (options.sinceIso && String(entry.atIso || '') < options.sinceIso) return false;
    if (requestedIssueKey && entry.issueKey !== requestedIssueKey) return false;
    return true;
  });
  return typeof options.limit === 'number' ? matchingEntries.slice(0, options.limit) : matchingEntries;
}

/** Drops the query string so the journal stores endpoints, not the contents of JQL searches. */
function stripQueryString(requestPath) {
  const queryStart = requestPath.indexOf('?');
  return queryStart === -1 ? requestPath : requestPath.slice(0, queryStart);
}

module.exports = {
  MAX_JOURNAL_ENTRIES,
  getJournalFilePath,
  isJiraWrite,
  extractIssueKeyFromPath,
  classifyWriteKind,
  buildJournalEntry,
  recordJiraWrite,
  queryJournal,
  readJournal,
};
