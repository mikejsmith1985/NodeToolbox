// boardVocabularySync.ts — Getting the team's column names to the rest of the team.
//
// One person defines the columns and publishes them; everyone else pulls. Both are explicit actions:
// nothing publishes on edit, nothing overwrites on load, and a newer copy does not win simply by
// being newer. A column vocabulary is the language a team uses to describe its work, so replacing
// someone's copy without showing them what changes would recreate the ambiguity this board exists
// to remove.
//
// A three-way merge is deliberately NOT used here even though the shared ART workspace has one. A
// field-level merge of a small ordered set could produce a vocabulary neither author wrote — and an
// unreviewed board vocabulary is exactly the problem. Preview-and-accept keeps a person in the loop.

import {
  loadBoardVocabularyStore,
  saveBoardVocabularyStore,
  type BoardVocabularyRecord,
} from '../../../services/confluenceApi.ts';
import { normalizeStoredVocabulary } from './boardVocabularyStore.ts';
import type { BoardVocabulary, ColumnStatusMapping } from './rollupBoardTypes.ts';

/** One way the team's published columns differ from the local ones. */
export type VocabularyDifference =
  | { kind: 'column-added'; name: string }
  | { kind: 'column-removed'; name: string }
  | { kind: 'column-renamed'; fromName: string; toName: string }
  | { kind: 'mapping-changed'; name: string; from: ColumnStatusMapping[]; to: ColumnStatusMapping[] }
  | { kind: 'order-changed'; name: string; fromOrder: number; toOrder: number };

export interface VocabularyPullPreview {
  /** null when nobody has published this team's columns yet. */
  remote: BoardVocabulary | null;
  differences: VocabularyDifference[];
  hasDifferences: boolean;
}

/** Converts the local shape to the shared store's record shape. */
function toRecord(vocabulary: BoardVocabulary): BoardVocabularyRecord {
  return {
    teamProfileId: vocabulary.teamProfileId,
    columns: vocabulary.columns.map((column) => ({
      id: column.id,
      name: column.name,
      order: column.order,
      mappings: column.mappings ?? [],
    })),
    updatedAt: vocabulary.updatedAt,
    lastSyncedAt: vocabulary.lastSyncedAt,
  };
}

/** Converts a shared store record back to the local shape. */
function fromRecord(record: BoardVocabularyRecord): BoardVocabulary {
  // A workspace published before a column could claim several states still holds the old shape.
  return normalizeStoredVocabulary(record, record.teamProfileId);
}

/** True when two columns claim the same set of Jira states, whatever order they were added in. */
function areMappingsEqual(left: readonly ColumnStatusMapping[], right: readonly ColumnStatusMapping[]): boolean {
  const toSortedKeys = (mappings: readonly ColumnStatusMapping[]): string[] =>
    mappings.map((mapping) => `${mapping.jiraStatusName}||${mapping.subStatusValue ?? ''}`).sort();
  return JSON.stringify(toSortedKeys(left)) === JSON.stringify(toSortedKeys(right));
}

/**
 * Publishes this team's columns to the shared workspace.
 *
 * Only this team's entry is replaced — every other team's vocabulary is carried through untouched,
 * so publishing can never cost a neighbouring team their columns.
 */
export async function publishBoardVocabulary(
  databaseId: string,
  vocabulary: BoardVocabulary,
): Promise<void> {
  const store = await loadBoardVocabularyStore(databaseId);
  await saveBoardVocabularyStore(databaseId, {
    ...store,
    vocabularyByTeamProfileId: {
      ...store.vocabularyByTeamProfileId,
      [vocabulary.teamProfileId]: toRecord(vocabulary),
    },
  });
}

/** Lists every way the published columns differ from the local ones, by column name. */
export function compareVocabularies(
  localVocabulary: BoardVocabulary,
  remoteVocabulary: BoardVocabulary,
): VocabularyDifference[] {
  const differences: VocabularyDifference[] = [];
  const localColumnsById = new Map(localVocabulary.columns.map((column) => [column.id, column]));
  const remoteColumnsById = new Map(remoteVocabulary.columns.map((column) => [column.id, column]));

  for (const remoteColumn of remoteVocabulary.columns) {
    const localColumn = localColumnsById.get(remoteColumn.id);
    if (!localColumn) {
      differences.push({ kind: 'column-added', name: remoteColumn.name });
      continue;
    }
    if (localColumn.name !== remoteColumn.name) {
      differences.push({ kind: 'column-renamed', fromName: localColumn.name, toName: remoteColumn.name });
    }
    if (!areMappingsEqual(localColumn.mappings, remoteColumn.mappings)) {
      differences.push({
        kind: 'mapping-changed',
        name: remoteColumn.name,
        from: localColumn.mappings,
        to: remoteColumn.mappings,
      });
    }
    if (localColumn.order !== remoteColumn.order) {
      differences.push({
        kind: 'order-changed',
        name: remoteColumn.name,
        fromOrder: localColumn.order,
        toOrder: remoteColumn.order,
      });
    }
  }

  for (const localColumn of localVocabulary.columns) {
    if (!remoteColumnsById.has(localColumn.id)) {
      differences.push({ kind: 'column-removed', name: localColumn.name });
    }
  }

  return differences;
}

/**
 * Fetches the team's published columns and describes how they differ, WITHOUT changing anything.
 *
 * The caller decides whether to accept. That separation is the whole point: a pull that silently
 * replaced someone's columns would be indistinguishable, from their side, from the board breaking.
 */
export async function previewBoardVocabularyPull(
  databaseId: string,
  localVocabulary: BoardVocabulary,
): Promise<VocabularyPullPreview> {
  const store = await loadBoardVocabularyStore(databaseId);
  const remoteRecord = store.vocabularyByTeamProfileId[localVocabulary.teamProfileId];

  if (!remoteRecord) {
    return { remote: null, differences: [], hasDifferences: false };
  }

  const remoteVocabulary = fromRecord(remoteRecord);
  const differences = compareVocabularies(localVocabulary, remoteVocabulary);
  return { remote: remoteVocabulary, differences, hasDifferences: differences.length > 0 };
}
