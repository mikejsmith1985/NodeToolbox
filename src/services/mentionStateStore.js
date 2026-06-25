// mentionStateStore.js — Persists which @-mention comments a user has marked "addressed".
//
// The Mentions report (My Issues tab) hides any mention the user has already
// dealt with. That "addressed" state must survive restarts and follow the user
// across browsers, so it lives in a small JSON file in the same AppData folder
// as the main config — kept separate from toolbox-proxy.json so frequent
// mark/unmark writes never touch the credential file or its obfuscation flow.
//
// Shape on disk:
//   { "<userKey>": { "<issueKey>#<commentId>": { addressedAt, issueKey } } }

'use strict';

const fs = require('fs');
const path = require('path');

const { CONFIG_DIR_PATH } = require('../config/loader');

/** Default location of the addressed-mentions store, alongside toolbox-proxy.json. */
const DEFAULT_STORE_PATH = path.join(CONFIG_DIR_PATH, 'mention-state.json');

/**
 * Loads the entire addressed-mentions map (all users). Returns an empty object
 * when the file is missing or unreadable so callers never have to special-case
 * a fresh install or a corrupt file.
 *
 * @param {string} [storePath] - Override for tests; defaults to the AppData store.
 * @returns {Object<string, Object>} Map of userKey → (mentionKey → record).
 */
function loadAllMentionState(storePath = DEFAULT_STORE_PATH) {
  if (!fs.existsSync(storePath)) {
    return {};
  }
  try {
    const fileContent = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(fileContent);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_readError) {
    // A corrupt store should never block the report — treat it as empty.
    return {};
  }
}

/**
 * Returns the addressed-mentions map for a single user (mentionKey → record).
 * Empty object when the user has addressed nothing yet.
 *
 * @param {string} userKey - Stable identifier for the Jira user (accountId/name/displayName).
 * @param {string} [storePath]
 * @returns {Object<string, { addressedAt: string, issueKey: string }>}
 */
function getAddressedMentions(userKey, storePath = DEFAULT_STORE_PATH) {
  const allState = loadAllMentionState(storePath);
  return allState[userKey] ?? {};
}

/**
 * Marks a single mention addressed (or removes it when isAddressed is false),
 * persists the change, and returns the user's updated addressed map.
 *
 * @param {object} params
 * @param {string} params.userKey
 * @param {string} params.mentionKey - `${issueKey}#${commentId}`.
 * @param {string} params.issueKey - Stored for convenience so the UI can group by ticket.
 * @param {boolean} params.isAddressed - true marks addressed; false undoes it.
 * @param {string} [storePath]
 * @returns {Object<string, { addressedAt: string, issueKey: string }>} The user's updated map.
 */
function setMentionAddressed({ userKey, mentionKey, issueKey, isAddressed }, storePath = DEFAULT_STORE_PATH) {
  const allState = loadAllMentionState(storePath);
  const userMap = allState[userKey] ?? {};

  if (isAddressed) {
    userMap[mentionKey] = { addressedAt: new Date().toISOString(), issueKey };
  } else {
    delete userMap[mentionKey];
  }

  allState[userKey] = userMap;
  writeStore(storePath, allState);
  return userMap;
}

/** Writes the full state object to disk, creating the parent directory if needed. */
function writeStore(storePath, allState) {
  try {
    const parentDir = path.dirname(storePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(storePath, JSON.stringify(allState, null, 2) + '\n', 'utf8');
  } catch (writeError) {
    console.error('  ⚠ Could not save mention state: ' + writeError.message);
  }
}

module.exports = {
  loadAllMentionState,
  getAddressedMentions,
  setMentionAddressed,
  DEFAULT_STORE_PATH,
};
