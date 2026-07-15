// compositionDraftStorage.test.ts — Proves a Feature being composed survives the week, and that a
// brand-new composition gets its own draft rather than colliding with every other one (FR-043, FR-046).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyCompositionDraft, type CompositionDraft } from './draftModel';
import {
  buildCompositionDraftStorageKey,
  deriveCompositionScopeKeyForIssue,
  deriveCompositionScopeKeyForNew,
  discardCompositionDraft,
  listCompositionDraftScopeKeys,
  loadCompositionDraft,
  saveCompositionDraft,
} from './compositionDraftStorage';

function buildDraft(overrides: Partial<CompositionDraft> = {}): CompositionDraft {
  return {
    ...createEmptyCompositionDraft('profile-alpha', 'new:1'),
    summary: 'Claimant document submission',
    poNarrative: 'Claimants keep emailing documents in.',
    sources: [{ kind: 'paste', id: 'paste-1', label: 'Teams thread', text: 'Jana confirmed the SLA.' }],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scope keys (FR-043)', () => {
  it('scopes an enrichment draft to the Feature it enriches', () => {
    expect(deriveCompositionScopeKeyForIssue('ABC-7')).toBe('ABC-7');
  });

  it('treats a key as the same Feature regardless of how it was typed', () => {
    expect(deriveCompositionScopeKeyForIssue('  abc-7 ')).toBe('ABC-7');
  });

  it('gives a brand-new composition its own scope, so two of them never collide', () => {
    // Without this every from-scratch composition would share one key, and starting a second would
    // silently overwrite the first.
    expect(deriveCompositionScopeKeyForNew('a1b2')).toBe('new:a1b2');
    expect(deriveCompositionScopeKeyForNew('a1b2')).not.toBe(deriveCompositionScopeKeyForNew('c3d4'));
  });

  it('cannot confuse a new composition with a Feature key', () => {
    expect(deriveCompositionScopeKeyForNew('a1b2')).not.toBe(deriveCompositionScopeKeyForIssue('a1b2'));
  });
});

describe('buildCompositionDraftStorageKey', () => {
  it('scopes by team and composition', () => {
    expect(buildCompositionDraftStorageKey('profile-alpha', 'ABC-7')).toBe(
      'tbxPoFeatureCompositionDraft:profile-alpha:ABC-7',
    );
  });
});

describe('save and load', () => {
  it('round-trips a draft, including the gathered sources', () => {
    expect(saveCompositionDraft(buildDraft())).toBe(true);

    const restored = loadCompositionDraft('profile-alpha', 'new:1');

    expect(restored.summary).toBe('Claimant document submission');
    expect(restored.poNarrative).toBe('Claimants keep emailing documents in.');
    expect(restored.sources).toHaveLength(1);
  });

  it('returns an empty draft when nothing is stored', () => {
    expect(loadCompositionDraft('profile-alpha', 'new:1').summary).toBe('');
  });

  it('keeps one team\'s drafts away from another\'s', () => {
    saveCompositionDraft(buildDraft());

    expect(loadCompositionDraft('profile-beta', 'new:1').summary).toBe('');
  });

  it('keeps an enrichment draft separate from a from-scratch one', () => {
    saveCompositionDraft(buildDraft());
    saveCompositionDraft(buildDraft({ scopeKey: 'ABC-7', existingIssueKey: 'ABC-7', summary: 'Enriched' }));

    expect(loadCompositionDraft('profile-alpha', 'new:1').summary).toBe('Claimant document submission');
    expect(loadCompositionDraft('profile-alpha', 'ABC-7').summary).toBe('Enriched');
  });
});

describe('load never throws (INV-1)', () => {
  it('survives unparseable JSON', () => {
    window.localStorage.setItem('tbxPoFeatureCompositionDraft:profile-alpha:new:1', '{not json');

    expect(() => loadCompositionDraft('profile-alpha', 'new:1')).not.toThrow();
    expect(loadCompositionDraft('profile-alpha', 'new:1').summary).toBe('');
  });

  it('drops a source that cannot say what kind it is, keeping the rest of the draft', () => {
    window.localStorage.setItem(
      'tbxPoFeatureCompositionDraft:profile-alpha:new:1',
      JSON.stringify({
        summary: 'Real draft',
        sources: [
          { kind: 'paste', id: 'paste-1', label: 'Good', text: 'kept' },
          { id: 'no-kind' },
          { kind: 'invented', id: 'x' },
          null,
        ],
      }),
    );

    const restored = loadCompositionDraft('profile-alpha', 'new:1');

    expect(restored.summary).toBe('Real draft');
    expect(restored.sources).toHaveLength(1);
  });

  it('re-files a draft stored under the wrong identity', () => {
    window.localStorage.setItem(
      'tbxPoFeatureCompositionDraft:profile-alpha:new:1',
      JSON.stringify({ profileId: 'WRONG', scopeKey: 'WRONG', summary: 'Mine' }),
    );

    const restored = loadCompositionDraft('profile-alpha', 'new:1');

    expect(restored.profileId).toBe('profile-alpha');
    expect(restored.scopeKey).toBe('new:1');
  });
});

describe('storage availability (FR-047)', () => {
  it('reports a save that did not persist, so the tab can warn', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(saveCompositionDraft(buildDraft())).toBe(false);
  });
});

describe('discard (FR-045, FR-048)', () => {
  it('removes the draft', () => {
    saveCompositionDraft(buildDraft());

    discardCompositionDraft('profile-alpha', 'new:1');

    expect(loadCompositionDraft('profile-alpha', 'new:1').summary).toBe('');
  });

  it('leaves other drafts alone', () => {
    saveCompositionDraft(buildDraft());
    saveCompositionDraft(buildDraft({ scopeKey: 'ABC-7', summary: 'Other' }));

    discardCompositionDraft('profile-alpha', 'new:1');

    expect(loadCompositionDraft('profile-alpha', 'ABC-7').summary).toBe('Other');
  });
});

describe('listCompositionDraftScopeKeys', () => {
  it('lists what this team has in progress, so a PO can pick one back up', () => {
    saveCompositionDraft(buildDraft());
    saveCompositionDraft(buildDraft({ scopeKey: 'ABC-7' }));

    expect(listCompositionDraftScopeKeys('profile-alpha')).toEqual(['ABC-7', 'new:1']);
  });

  it('lists nothing for a team with no drafts', () => {
    saveCompositionDraft(buildDraft());

    expect(listCompositionDraftScopeKeys('profile-beta')).toEqual([]);
  });
});
