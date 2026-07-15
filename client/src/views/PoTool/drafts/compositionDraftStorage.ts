// compositionDraftStorage.ts — Persists a Feature being composed, so the work survives the week.
//
// Same contract as the split draft: team-scoped key, normalise on read, never throw, and report whether
// the save actually persisted so the tab can warn rather than lose a PO's afternoon silently (FR-047).
//
// The scope key is the one interesting difference. A composition may not have a Jira key yet — that is
// the whole point of composing from scratch — so a new composition gets a minted id that stays with it
// until it is committed. Without that, every new composition would collide on one key (FR-043).

import { buildTeamScopedStorageKey } from '../../SprintDashboard/hooks/teamScopedStorage';
import {
  createEmptyCompositionDraft,
  normalizeCompositionDraft,
  type CompositionDraft,
} from './draftModel';
import { canPersistDrafts } from './splitDraftStorage';

const COMPOSITION_DRAFT_BASE_STORAGE_KEY = 'tbxPoFeatureCompositionDraft';

/** Prefix marking a composition that has no Jira issue yet. */
const NEW_COMPOSITION_SCOPE_PREFIX = 'new';

/** Scope for enriching a Feature that already exists — returning to that key resumes that draft. */
export function deriveCompositionScopeKeyForIssue(issueKey: string): string {
  return issueKey.trim().toUpperCase();
}

/**
 * Scope for a Feature being written from scratch.
 *
 * The id is supplied rather than generated here so this module stays deterministic; the caller mints one
 * when the PO starts a new composition and keeps it in the draft.
 */
export function deriveCompositionScopeKeyForNew(newCompositionId: string): string {
  return `${NEW_COMPOSITION_SCOPE_PREFIX}:${newCompositionId}`;
}

/** `tbxPoFeatureCompositionDraft:<profileId>:<scopeKey>` */
export function buildCompositionDraftStorageKey(profileId: string, scopeKey: string): string {
  return `${buildTeamScopedStorageKey(COMPOSITION_DRAFT_BASE_STORAGE_KEY, profileId)}:${scopeKey}`;
}

/** Loads a composition draft, healing whatever it finds. Never throws (FR-046, INV-1). */
export function loadCompositionDraft(profileId: string, scopeKey: string): CompositionDraft {
  if (!canPersistDrafts()) {
    return createEmptyCompositionDraft(profileId, scopeKey);
  }
  try {
    const storedValue = window.localStorage.getItem(buildCompositionDraftStorageKey(profileId, scopeKey));
    if (storedValue === null) {
      return createEmptyCompositionDraft(profileId, scopeKey);
    }
    return normalizeCompositionDraft(JSON.parse(storedValue), profileId, scopeKey);
  } catch {
    return createEmptyCompositionDraft(profileId, scopeKey);
  }
}

/** Saves a composition draft. Returns whether it persisted, so the tab can warn (FR-047, INV-2). */
export function saveCompositionDraft(draft: CompositionDraft): boolean {
  if (!canPersistDrafts()) {
    return false;
  }
  try {
    window.localStorage.setItem(
      buildCompositionDraftStorageKey(draft.profileId, draft.scopeKey),
      JSON.stringify(draft),
    );
    return true;
  } catch {
    // Storage full or blocked — the in-memory draft stays authoritative for this session.
    return false;
  }
}

/** Discards a draft — the explicit throw-away (FR-048) and the post-commit clear (FR-045). */
export function discardCompositionDraft(profileId: string, scopeKey: string): void {
  if (!canPersistDrafts()) {
    return;
  }
  try {
    window.localStorage.removeItem(buildCompositionDraftStorageKey(profileId, scopeKey));
  } catch {
    // Nothing useful to do — the draft is already unreachable for this session.
  }
}

/** Lists the in-progress compositions for a team, so a PO can pick one back up. */
export function listCompositionDraftScopeKeys(profileId: string): string[] {
  if (!canPersistDrafts()) {
    return [];
  }
  const keyPrefix = `${buildTeamScopedStorageKey(COMPOSITION_DRAFT_BASE_STORAGE_KEY, profileId)}:`;
  const scopeKeys: string[] = [];
  try {
    for (let storageIndex = 0; storageIndex < window.localStorage.length; storageIndex += 1) {
      const storageKey = window.localStorage.key(storageIndex);
      if (storageKey?.startsWith(keyPrefix)) {
        scopeKeys.push(storageKey.slice(keyPrefix.length));
      }
    }
  } catch {
    return [];
  }
  return scopeKeys.sort();
}
