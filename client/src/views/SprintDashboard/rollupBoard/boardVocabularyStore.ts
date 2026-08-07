// boardVocabularyStore.ts — Where a team's own column names live between sessions.
//
// The vocabulary belongs to the TEAM, not the person looking at the board: a shared board where two
// people see different columns would recreate exactly the ambiguity this feature exists to remove.
// This module holds the local copy; boardVocabularySync publishes it to, and pulls it from, the
// team's shared Confluence workspace.

import type { BoardVocabulary } from './rollupBoardTypes.ts';

const VOCABULARY_STORAGE_KEY = 'tbxRollupBoardVocabulary';

/** A team that has not defined any columns yet. Everything then shows as Unmapped, visibly. */
export function buildEmptyVocabulary(teamProfileId: string): BoardVocabulary {
  return { teamProfileId, columns: [], updatedAt: '', lastSyncedAt: null };
}

/** Reads every team's stored vocabulary; unreadable storage counts as nothing stored. */
export function readAllVocabularies(): Record<string, BoardVocabulary> {
  try {
    return JSON.parse(window.localStorage.getItem(VOCABULARY_STORAGE_KEY) || '{}') as Record<string, BoardVocabulary>;
  } catch {
    return {};
  }
}

/** Loads one team's vocabulary, falling back to an empty one. */
export function loadTeamVocabulary(teamProfileId: string): BoardVocabulary {
  return readAllVocabularies()[teamProfileId] ?? buildEmptyVocabulary(teamProfileId);
}

/**
 * Saves one team's vocabulary, leaving every other team's untouched.
 *
 * `updatedAt` advances on every edit but `lastSyncedAt` does not — that is what lets the board tell
 * a viewer their columns have drifted from the ones the team agreed on.
 */
export function saveTeamVocabulary(vocabulary: BoardVocabulary, nowIso: string): BoardVocabulary {
  const savedVocabulary: BoardVocabulary = { ...vocabulary, updatedAt: nowIso };
  const allVocabularies = readAllVocabularies();
  allVocabularies[vocabulary.teamProfileId] = savedVocabulary;
  window.localStorage.setItem(VOCABULARY_STORAGE_KEY, JSON.stringify(allVocabularies));
  return savedVocabulary;
}

/** Records that this vocabulary now matches the team's shared copy. */
export function markVocabularySynced(vocabulary: BoardVocabulary, nowIso: string): BoardVocabulary {
  const syncedVocabulary: BoardVocabulary = { ...vocabulary, lastSyncedAt: nowIso };
  const allVocabularies = readAllVocabularies();
  allVocabularies[vocabulary.teamProfileId] = syncedVocabulary;
  window.localStorage.setItem(VOCABULARY_STORAGE_KEY, JSON.stringify(allVocabularies));
  return syncedVocabulary;
}
