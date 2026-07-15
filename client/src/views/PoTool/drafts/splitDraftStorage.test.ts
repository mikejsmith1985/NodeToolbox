// splitDraftStorage.test.ts — Proves an in-progress split survives sessions, heals what it finds,
// and never lets a storage problem cost a PO their work silently (INV-1, INV-2, FR-043..FR-048).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptySplitDraft, PO_DRAFT_SCHEMA_VERSION, type SplitDraft } from './draftModel';
import {
  buildSplitDraftStorageKey,
  canPersistDrafts,
  deriveSplitScopeKey,
  discardSplitDraft,
  loadSplitDraft,
  saveSplitDraft,
} from './splitDraftStorage';

function buildDraft(overrides: Partial<SplitDraft> = {}): SplitDraft {
  return {
    ...createEmptySplitDraft('profile-alpha', 'ABC-1'),
    sourceFeatureKey: 'ABC-1',
    targetProjectKey: 'ABC',
    increments: [
      {
        localId: 'increment-1',
        summary: 'Submit a claim with one document',
        description: 'The happy path.',
        acceptanceCriteria: 'Given a valid claim…',
        origin: 'manual',
        isAccepted: true,
        rationale: 'Happy path first.',
        createdJiraKey: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deriveSplitScopeKey', () => {
  it('scopes a draft to its Feature, so returning to that Feature resumes the same draft', () => {
    expect(deriveSplitScopeKey('ABC-1')).toBe('ABC-1');
  });

  it('treats a key as the same Feature regardless of how it was typed', () => {
    expect(deriveSplitScopeKey('  abc-1 ')).toBe('ABC-1');
  });

  it('still gives a draft somewhere to live before a Feature is chosen', () => {
    expect(deriveSplitScopeKey('')).toBe('no-feature');
  });
});

describe('buildSplitDraftStorageKey', () => {
  it('scopes the key by team and Feature so two teams never share a draft', () => {
    expect(buildSplitDraftStorageKey('profile-alpha', 'ABC-1')).toBe(
      'tbxPoFeatureSplitDraft:profile-alpha:ABC-1',
    );
  });

  it('keeps a profile-less draft addressable', () => {
    expect(buildSplitDraftStorageKey('', 'ABC-1')).toBe('tbxPoFeatureSplitDraft:legacy-default:ABC-1');
  });
});

describe('save and load', () => {
  it('round-trips a draft so a PO returns to exactly what they left', () => {
    const draft = buildDraft();

    expect(saveSplitDraft(draft)).toBe(true);
    const restored = loadSplitDraft('profile-alpha', 'ABC-1');

    expect(restored.sourceFeatureKey).toBe('ABC-1');
    expect(restored.increments).toHaveLength(1);
    expect(restored.increments[0].summary).toBe('Submit a claim with one document');
  });

  it('returns an empty draft when there is nothing stored', () => {
    const draft = loadSplitDraft('profile-alpha', 'ABC-1');

    expect(draft.increments).toEqual([]);
    expect(draft.sourceFeatureKey).toBe('');
  });

  it('keeps one team\'s draft away from another\'s', () => {
    saveSplitDraft(buildDraft());

    expect(loadSplitDraft('profile-beta', 'ABC-1').increments).toEqual([]);
  });

  it('keeps one Feature\'s draft away from another\'s', () => {
    saveSplitDraft(buildDraft());

    expect(loadSplitDraft('profile-alpha', 'XYZ-9').increments).toEqual([]);
  });

  it('stamps the current schema version so a later version can heal it', () => {
    saveSplitDraft(buildDraft());

    expect(loadSplitDraft('profile-alpha', 'ABC-1').schemaVersion).toBe(PO_DRAFT_SCHEMA_VERSION);
  });
});

describe('load never throws (INV-1)', () => {
  it('survives unparseable JSON with an empty draft', () => {
    window.localStorage.setItem('tbxPoFeatureSplitDraft:profile-alpha:ABC-1', '{not json');

    expect(() => loadSplitDraft('profile-alpha', 'ABC-1')).not.toThrow();
    expect(loadSplitDraft('profile-alpha', 'ABC-1').increments).toEqual([]);
  });

  it('survives a draft of the wrong shape entirely', () => {
    window.localStorage.setItem('tbxPoFeatureSplitDraft:profile-alpha:ABC-1', '"just a string"');

    expect(loadSplitDraft('profile-alpha', 'ABC-1').increments).toEqual([]);
  });

  it('keeps the readable increments when one is malformed, rather than losing the draft', () => {
    window.localStorage.setItem(
      'tbxPoFeatureSplitDraft:profile-alpha:ABC-1',
      JSON.stringify({ sourceFeatureKey: 'ABC-1', increments: [{ summary: 'Real one' }, null] }),
    );

    const restored = loadSplitDraft('profile-alpha', 'ABC-1');

    expect(restored.increments).toHaveLength(2);
    expect(restored.increments[0].summary).toBe('Real one');
    expect(restored.increments[1].summary).toBe('');
  });

  it('re-files a draft stored under the wrong identity instead of trusting the payload', () => {
    window.localStorage.setItem(
      'tbxPoFeatureSplitDraft:profile-alpha:ABC-1',
      JSON.stringify({ profileId: 'profile-WRONG', scopeKey: 'WRONG-9', sourceFeatureKey: 'ABC-1' }),
    );

    const restored = loadSplitDraft('profile-alpha', 'ABC-1');

    expect(restored.profileId).toBe('profile-alpha');
    expect(restored.scopeKey).toBe('ABC-1');
  });
});

describe('storage availability (INV-2, FR-047)', () => {
  it('reports that a save did not persist, so the tab can warn instead of losing work silently', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(saveSplitDraft(buildDraft())).toBe(false);
  });

  it('never throws when storage refuses a write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => saveSplitDraft(buildDraft())).not.toThrow();
  });

  it('reports storage unavailable when writes are blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(canPersistDrafts()).toBe(false);
  });

  it('reports storage available in a normal browser', () => {
    expect(canPersistDrafts()).toBe(true);
  });

  it('leaves no probe key behind when checking availability', () => {
    canPersistDrafts();

    expect(window.localStorage.getItem('tbxPoFeatureSplitDraft:__probe__')).toBeNull();
  });
});

describe('discard (FR-045, FR-048)', () => {
  it('removes the draft', () => {
    saveSplitDraft(buildDraft());

    discardSplitDraft('profile-alpha', 'ABC-1');

    expect(loadSplitDraft('profile-alpha', 'ABC-1').increments).toEqual([]);
  });

  it('is harmless when there is no draft to discard', () => {
    expect(() => discardSplitDraft('profile-alpha', 'NOTHING-1')).not.toThrow();
  });

  it('leaves other drafts alone', () => {
    saveSplitDraft(buildDraft());
    saveSplitDraft(buildDraft({ scopeKey: 'XYZ-9', sourceFeatureKey: 'XYZ-9' }));

    discardSplitDraft('profile-alpha', 'ABC-1');

    expect(loadSplitDraft('profile-alpha', 'XYZ-9').increments).toHaveLength(1);
  });
});

describe('a draft is never a Jira write (FR-044)', () => {
  it('persists without any network call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    saveSplitDraft(buildDraft());
    loadSplitDraft('profile-alpha', 'ABC-1');

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
