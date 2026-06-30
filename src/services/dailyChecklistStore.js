// dailyChecklistStore.js — Persists which "Today" checklist categories a Scrum Master has marked complete.
//
// The Scrum Master's "Today" dashboard lets a user manually tick off checklist
// categories (standup done, board groomed, etc.). That completion state must
// survive restarts and follow the user across browsers, so it lives in a small
// JSON file in the same AppData folder as the main config — kept separate from
// toolbox-proxy.json so frequent tick/untick writes never touch the credential
// file or its obfuscation flow.
//
// The checklist resets every business day. Rather than run a timer, each write
// prunes every day-bucket for that user except the current business day, so the
// only state that ever survives a write is "today" — yesterday's ticks vanish
// the first time the user touches the list on a new day.
//
// Shape on disk:
//   { "<userKey>": { "<businessDayKey>": { "<categoryId>": { completedAt } } } }

'use strict';

const fs = require('fs');
const path = require('path');

const { CONFIG_DIR_PATH } = require('../config/loader');

/** Default location of the daily-checklist store, alongside toolbox-proxy.json. */
const DEFAULT_STORE_PATH = path.join(CONFIG_DIR_PATH, 'sm-checklist-state.json');

/**
 * Loads the entire checklist-state map (all users, all days). Returns an empty
 * object when the file is missing or unreadable so callers never have to
 * special-case a fresh install or a corrupt file.
 *
 * @param {string} [storePath] - Override for tests; defaults to the AppData store.
 * @returns {Object<string, Object>} Map of userKey → (dayKey → (categoryId → record)).
 */
function loadAllChecklistState(storePath = DEFAULT_STORE_PATH) {
  if (!fs.existsSync(storePath)) {
    return {};
  }
  try {
    const fileContent = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(fileContent);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_readError) {
    // A corrupt store should never block the dashboard — treat it as empty.
    return {};
  }
}

/**
 * Returns the completed-category map for a single user on a single business day
 * (categoryId → record). Empty object when the user has ticked nothing that day.
 *
 * @param {string} userKey - Stable identifier for the Scrum Master.
 * @param {string} dayKey - Business day key, e.g. `YYYY-MM-DD`.
 * @param {string} [storePath]
 * @returns {Object<string, { completedAt: string }>}
 */
function getDailyChecklist(userKey, dayKey, storePath = DEFAULT_STORE_PATH) {
  const allState = loadAllChecklistState(storePath);
  const userDays = allState[userKey] ?? {};
  return userDays[dayKey] ?? {};
}

/**
 * Marks one checklist category complete (or clears it when isComplete is false),
 * prunes any stale day-buckets for that user, persists the change, and returns
 * the user's updated map for the current business day.
 *
 * @param {object} params
 * @param {string} params.userKey
 * @param {string} params.dayKey - Current business day key, e.g. `YYYY-MM-DD`.
 * @param {string} params.categoryId - Checklist category being toggled.
 * @param {boolean} params.isComplete - true marks complete; false clears it.
 * @param {string} [storePath]
 * @returns {Object<string, { completedAt: string }>} The user's current-day map.
 */
function setCategoryComplete({ userKey, dayKey, categoryId, isComplete }, storePath = DEFAULT_STORE_PATH) {
  const allState = loadAllChecklistState(storePath);
  const userDays = allState[userKey] ?? {};

  // Daily reset: keep only the current business day, dropping every prior day.
  pruneStaleDays(userDays, dayKey);

  const userDayMap = userDays[dayKey] ?? {};
  if (isComplete) {
    userDayMap[categoryId] = { completedAt: new Date().toISOString() };
  } else {
    delete userDayMap[categoryId];
  }

  userDays[dayKey] = userDayMap;
  allState[userKey] = userDays;
  writeStore(storePath, allState);
  return userDayMap;
}

/** Deletes every day-bucket whose key is not the current business day. */
function pruneStaleDays(userDays, currentDayKey) {
  for (const existingDayKey of Object.keys(userDays)) {
    if (existingDayKey !== currentDayKey) {
      delete userDays[existingDayKey];
    }
  }
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
    console.error('  ⚠ Could not save daily checklist state: ' + writeError.message);
  }
}

module.exports = {
  loadAllChecklistState,
  getDailyChecklist,
  setCategoryComplete,
  DEFAULT_STORE_PATH,
};
