// splitDraftStorage.ts — Persists an in-progress Feature split so a PO can finish it another day.
//
// Follows the established overlay-draft pattern: self-describing record, team-scoped key, normalise on
// read, never throw on load, never throw on save.
//
// One deliberate divergence from that pattern: it reports whether storage is actually AVAILABLE. The
// canvas overlay fails silently, which is right for an auto-saved canvas — but wrong here. This draft is
// hours of a PO's authoring, and silently discarding it is precisely the harm the requirement exists to
// prevent (FR-047). So the tab is told, and can warn.

import { buildTeamScopedStorageKey } from '../../SprintDashboard/hooks/teamScopedStorage';
import { createEmptySplitDraft, normalizeSplitDraft, type SplitDraft } from './draftModel';

const SPLIT_DRAFT_BASE_STORAGE_KEY = 'tbxPoFeatureSplitDraft';

/** Used when a split has no source Feature yet, so the draft still has somewhere to live. */
const MISSING_FEATURE_SCOPE = 'no-feature';

/** Guards every storage touch — private browsing and blocked storage must degrade, never throw. */
export function canPersistDrafts(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }
    // Availability is not the same as writability: Safari private browsing exposes the API and then
    // throws on write. The only honest check is to actually write something.
    const probeKey = `${SPLIT_DRAFT_BASE_STORAGE_KEY}:__probe__`;
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

/** One split draft per Feature per team, so returning to a Feature resumes that same draft (FR-043). */
export function deriveSplitScopeKey(sourceFeatureKey: string): string {
  return sourceFeatureKey.trim().toUpperCase() || MISSING_FEATURE_SCOPE;
}

/** `tbxPoFeatureSplitDraft:<profileId>:<FEATURE-KEY>` */
export function buildSplitDraftStorageKey(profileId: string, scopeKey: string): string {
  return `${buildTeamScopedStorageKey(SPLIT_DRAFT_BASE_STORAGE_KEY, profileId)}:${scopeKey}`;
}

/**
 * Loads a split draft, healing whatever it finds.
 *
 * Never throws. An absent, corrupt, or older-version draft yields an empty draft, because a bad draft
 * must never stop the Splitter opening (FR-046, INV-1).
 */
export function loadSplitDraft(profileId: string, scopeKey: string): SplitDraft {
  if (!canPersistDrafts()) {
    return createEmptySplitDraft(profileId, scopeKey);
  }
  try {
    const storedValue = window.localStorage.getItem(buildSplitDraftStorageKey(profileId, scopeKey));
    if (storedValue === null) {
      return createEmptySplitDraft(profileId, scopeKey);
    }
    return normalizeSplitDraft(JSON.parse(storedValue), profileId, scopeKey);
  } catch {
    return createEmptySplitDraft(profileId, scopeKey);
  }
}

/**
 * Saves a split draft.
 *
 * Returns whether it actually persisted, so the tab can tell the PO their work will not survive a
 * reload rather than letting them find out by losing it (FR-047, INV-2).
 */
export function saveSplitDraft(draft: SplitDraft): boolean {
  if (!canPersistDrafts()) {
    return false;
  }
  try {
    window.localStorage.setItem(
      buildSplitDraftStorageKey(draft.profileId, draft.scopeKey),
      JSON.stringify(draft),
    );
    return true;
  } catch {
    // Storage full or blocked mid-session — the in-memory draft stays authoritative for this session.
    return false;
  }
}

/** Discards a draft — the PO's explicit "throw this away" (FR-048), and the post-commit clear (FR-045). */
export function discardSplitDraft(profileId: string, scopeKey: string): void {
  if (!canPersistDrafts()) {
    return;
  }
  try {
    window.localStorage.removeItem(buildSplitDraftStorageKey(profileId, scopeKey));
  } catch {
    // Nothing useful to do — the draft is already unreachable for this session.
  }
}
