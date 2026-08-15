// boardVocabularyStore.ts — Where a team's own column names live between sessions.
//
// The vocabulary belongs to the TEAM, not the person looking at the board: a shared board where two
// people see different columns would recreate exactly the ambiguity this feature exists to remove.
// This module holds the local copy; boardVocabularySync publishes it to, and pulls it from, the
// team's shared Confluence workspace.

import type { ChecklistColumnMapping } from './checklistCards.ts';
import type { BoardColumn, BoardVocabulary, ColumnStatusMapping } from './rollupBoardTypes.ts';

const VOCABULARY_STORAGE_KEY = 'tbxRollupBoardVocabulary';

/**
 * A column as some earlier version of this board stored it.
 *
 * Columns used to claim exactly ONE Jira state, in a `mapping` field. Anything saved before that
 * changed is still sitting in browsers and in the shared workspace, so every read has to accept it.
 */
interface StoredBoardColumn {
  id: string;
  name: string;
  order: number;
  mappings?: ColumnStatusMapping[];
  /** The single-state shape this board used before a column could claim several. */
  mapping?: ColumnStatusMapping | null;
}

/**
 * Brings any stored column up to the current shape.
 *
 * Renaming a PERSISTED field without this is what turned the board into a blank page: the new code
 * called `.some()` on a `mappings` array that older saved data simply did not have.
 */
export function normalizeStoredColumn(storedColumn: StoredBoardColumn): BoardColumn {
  const upgradedMappings = storedColumn.mappings
    ?? (storedColumn.mapping ? [storedColumn.mapping] : []);
  return {
    id: storedColumn.id,
    name: storedColumn.name,
    order: storedColumn.order,
    mappings: upgradedMappings,
  };
}

/** Brings a whole stored vocabulary up to the current shape, whatever version wrote it. */
export function normalizeStoredVocabulary(
  storedVocabulary: {
    teamProfileId: string;
    columns?: StoredBoardColumn[];
    updatedAt?: string;
    lastSyncedAt?: string | null;
    checklistColumnMapping?: ChecklistColumnMapping;
  },
  fallbackTeamProfileId: string,
): BoardVocabulary {
  return {
    teamProfileId: storedVocabulary.teamProfileId || fallbackTeamProfileId,
    columns: (storedVocabulary.columns ?? []).map(normalizeStoredColumn),
    updatedAt: storedVocabulary.updatedAt ?? '',
    lastSyncedAt: storedVocabulary.lastSyncedAt ?? null,
    // Absent on every vocabulary saved before checklist items became cards. Left absent rather than
    // defaulted here, so the board can tell "this team has not chosen" from "this team chose".
    ...(storedVocabulary.checklistColumnMapping
      ? { checklistColumnMapping: storedVocabulary.checklistColumnMapping }
      : {}),
  };
}

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
  const storedVocabulary = readAllVocabularies()[teamProfileId];
  if (!storedVocabulary) return buildEmptyVocabulary(teamProfileId);
  return normalizeStoredVocabulary(storedVocabulary, teamProfileId);
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
