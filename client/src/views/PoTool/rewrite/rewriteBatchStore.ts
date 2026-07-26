// rewriteBatchStore.ts — Local persistence + portable export/import for re-write batches (spec 030).
// Mirrors the composition draft store: team-scoped localStorage keys, no-op when storage is unavailable.
// The export/import file is the cross-machine backup path (local storage alone is per-machine).

import { canPersistDrafts } from '../drafts/splitDraftStorage';
import { buildTeamScopedStorageKey } from '../../SprintDashboard/hooks/teamScopedStorage';
import type { ItemState, RewriteBatch, RewriteBatchSummary } from './rewriteBatchModel';

/** Base storage key; the team id + batch id are appended, like the composition draft store. */
const REWRITE_BATCH_BASE_STORAGE_KEY = 'tbxPoRewriteBatch';

/** The storage key for one batch. */
function buildBatchStorageKey(teamProfileId: string, batchId: string): string {
  return `${buildTeamScopedStorageKey(REWRITE_BATCH_BASE_STORAGE_KEY, teamProfileId)}:${batchId}`;
}

/** Reads the current wall-clock time; isolated so the rest of the module stays deterministic. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Persists a batch (upsert), stamping `updatedAtIso`. Returns false when storage is unavailable. */
export function saveBatch(batch: RewriteBatch): boolean {
  if (!canPersistDrafts()) {
    return false;
  }
  try {
    const stamped: RewriteBatch = { ...batch, updatedAtIso: nowIso() };
    window.localStorage.setItem(buildBatchStorageKey(batch.teamProfileId, batch.id), JSON.stringify(stamped));
    return true;
  } catch {
    return false;
  }
}

/** Loads one batch, or null when absent/unavailable/corrupt. */
export function loadBatch(teamProfileId: string, batchId: string): RewriteBatch | null {
  if (!canPersistDrafts()) {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(buildBatchStorageKey(teamProfileId, batchId));
    return stored ? (JSON.parse(stored) as RewriteBatch) : null;
  } catch {
    return null;
  }
}

/** Removes one batch. */
export function deleteBatch(teamProfileId: string, batchId: string): void {
  if (!canPersistDrafts()) {
    return;
  }
  try {
    window.localStorage.removeItem(buildBatchStorageKey(teamProfileId, batchId));
  } catch {
    // best-effort
  }
}

/** Counts each item state for a batch summary. */
function countByState(batch: RewriteBatch): Partial<Record<ItemState, number>> {
  const counts: Partial<Record<ItemState, number>> = {};
  for (const item of batch.items) {
    counts[item.state] = (counts[item.state] ?? 0) + 1;
  }
  return counts;
}

/** Lists this team's batches (summaries, newest first), by scanning the team-scoped key prefix. */
export function listBatches(teamProfileId: string): RewriteBatchSummary[] {
  if (!canPersistDrafts()) {
    return [];
  }
  const keyPrefix = `${buildTeamScopedStorageKey(REWRITE_BATCH_BASE_STORAGE_KEY, teamProfileId)}:`;
  const summaries: RewriteBatchSummary[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index);
      if (!storageKey || !storageKey.startsWith(keyPrefix)) {
        continue;
      }
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) {
        continue;
      }
      const batch = JSON.parse(stored) as RewriteBatch;
      summaries.push({
        id: batch.id,
        name: batch.name,
        createdAtIso: batch.createdAtIso,
        updatedAtIso: batch.updatedAtIso,
        itemCount: batch.items.length,
        countsByState: countByState(batch),
      });
    }
  } catch {
    return summaries;
  }
  return summaries.sort((left, right) => right.updatedAtIso.localeCompare(left.updatedAtIso));
}

/** Serialises a batch to a downloadable file payload (the caller triggers the download). */
export function exportBatchFile(batch: RewriteBatch): { fileName: string; json: string } {
  return { fileName: `rewrite-batch-${batch.id}.json`, json: JSON.stringify(batch, null, 2) };
}

/** Validates that a parsed value has the minimum RewriteBatch shape; throws a labeled error otherwise. */
function assertBatchShape(candidate: unknown): asserts candidate is RewriteBatch {
  const batch = candidate as Partial<RewriteBatch> | null;
  if (!batch || typeof batch.id !== 'string' || typeof batch.teamProfileId !== 'string' || !Array.isArray(batch.items)) {
    throw new Error('This file is not a valid re-write batch.');
  }
  for (const item of batch.items) {
    if (!item || typeof item.jiraKey !== 'string' || typeof item.state !== 'string' || !item.original) {
      throw new Error('This re-write batch file has a malformed item.');
    }
  }
}

/** Parses + validates a batch file's JSON back into a RewriteBatch. Throws on malformed input. */
export function importBatchFile(json: string): RewriteBatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  assertBatchShape(parsed);
  return parsed;
}
