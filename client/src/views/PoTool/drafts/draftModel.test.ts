// draftModel.test.ts — Proves a stored draft heals into something safe to use, whatever it contains.
//
// These rules are what let the Splitter open reliably: a draft written by an older version, hand-edited,
// or half-corrupted must degrade to something usable rather than take the tab down (FR-046, INV-1).

import { describe, expect, it } from 'vitest';

import {
  createEmptyIncrement,
  createEmptySplitDraft,
  DEFAULT_SPLIT_LINK_TYPE,
  normalizeSplitDraft,
  PO_DRAFT_SCHEMA_VERSION,
} from './draftModel';

describe('createEmptySplitDraft', () => {
  it('carries its own identity so a save needs no key argument', () => {
    const draft = createEmptySplitDraft('profile-alpha', 'ABC-1');

    expect(draft.profileId).toBe('profile-alpha');
    expect(draft.scopeKey).toBe('ABC-1');
    expect(draft.schemaVersion).toBe(PO_DRAFT_SCHEMA_VERSION);
  });

  it('starts with no increments and no loaded source', () => {
    const draft = createEmptySplitDraft('profile-alpha', 'ABC-1');

    expect(draft.increments).toEqual([]);
    expect(draft.sourceSnapshot).toBeNull();
  });

  it('leaves the timestamp for the caller to stamp, keeping this module deterministic', () => {
    expect(createEmptySplitDraft('profile-alpha', 'ABC-1').updatedAtIso).toBe('');
  });

  it('defaults to a link type the PO can change', () => {
    expect(createEmptySplitDraft('profile-alpha', 'ABC-1').linkTypeName).toBe(DEFAULT_SPLIT_LINK_TYPE);
  });
});

describe('createEmptyIncrement', () => {
  it('is a manual, accepted, blank increment ready to type into', () => {
    const increment = createEmptyIncrement('increment-1');

    expect(increment.origin).toBe('manual');
    expect(increment.isAccepted).toBe(true);
    expect(increment.summary).toBe('');
    expect(increment.createdJiraKey).toBeNull();
  });
});

describe('normalizeSplitDraft', () => {
  it('takes identity from the arguments, not the payload, so a mis-filed draft re-files itself', () => {
    const healed = normalizeSplitDraft(
      { profileId: 'WRONG', scopeKey: 'WRONG', sourceFeatureKey: 'ABC-1' },
      'profile-alpha',
      'ABC-1',
    );

    expect(healed.profileId).toBe('profile-alpha');
    expect(healed.scopeKey).toBe('ABC-1');
  });

  it('always stamps the current schema version', () => {
    const healed = normalizeSplitDraft({ schemaVersion: 0 }, 'profile-alpha', 'ABC-1');

    expect(healed.schemaVersion).toBe(PO_DRAFT_SCHEMA_VERSION);
  });

  it('turns a non-object into an empty draft', () => {
    expect(normalizeSplitDraft(null, 'profile-alpha', 'ABC-1').increments).toEqual([]);
    expect(normalizeSplitDraft('nonsense', 'profile-alpha', 'ABC-1').increments).toEqual([]);
    expect(normalizeSplitDraft(42, 'profile-alpha', 'ABC-1').increments).toEqual([]);
  });

  it('treats a non-array increments field as no increments', () => {
    expect(normalizeSplitDraft({ increments: 'nope' }, 'profile-alpha', 'ABC-1').increments).toEqual([]);
  });

  it('mints an id for an increment that lost one, so accept and reject keep working', () => {
    const healed = normalizeSplitDraft({ increments: [{ summary: 'No id' }] }, 'profile-alpha', 'ABC-1');

    expect(healed.increments[0].localId).toBe('increment-1');
  });

  it('treats an increment that is not explicitly accepted as pending', () => {
    // The safe direction: an unaccepted increment is merely shown, but a wrongly-accepted one
    // could be committed to Jira without the PO ever agreeing to it.
    const healed = normalizeSplitDraft(
      { increments: [{ summary: 'Unclear', isAccepted: 'yes-please' }] },
      'profile-alpha',
      'ABC-1',
    );

    expect(healed.increments[0].isAccepted).toBe(false);
  });

  it('keeps an already-created Jira key so a retry never double-creates', () => {
    const healed = normalizeSplitDraft(
      { increments: [{ summary: 'Done', createdJiraKey: 'ABC-2' }] },
      'profile-alpha',
      'ABC-1',
    );

    expect(healed.increments[0].createdJiraKey).toBe('ABC-2');
  });

  it('treats a non-string created key as not yet created', () => {
    const healed = normalizeSplitDraft(
      { increments: [{ summary: 'Odd', createdJiraKey: 12345 }] },
      'profile-alpha',
      'ABC-1',
    );

    expect(healed.increments[0].createdJiraKey).toBeNull();
  });

  it('only honours "ai" as a non-manual origin', () => {
    const healed = normalizeSplitDraft(
      { increments: [{ origin: 'ai' }, { origin: 'something-else' }] },
      'profile-alpha',
      'ABC-1',
    );

    expect(healed.increments[0].origin).toBe('ai');
    expect(healed.increments[1].origin).toBe('manual');
  });

  it('restores a usable source snapshot', () => {
    const healed = normalizeSplitDraft(
      { sourceSnapshot: { key: 'ABC-1', issueTypeId: '10001', projectKey: 'ABC', summary: 'Big one' } },
      'profile-alpha',
      'ABC-1',
    );

    expect(healed.sourceSnapshot?.key).toBe('ABC-1');
    expect(healed.sourceSnapshot?.issueTypeId).toBe('10001');
  });

  it('drops a snapshot that cannot identify its issue type, forcing a fresh load', () => {
    // Without the original's issue type id an increment cannot be created as the right type, and
    // guessing "Feature" is exactly what this feature must never do.
    const healed = normalizeSplitDraft(
      { sourceSnapshot: { key: 'ABC-1', summary: 'Big one' } },
      'profile-alpha',
      'ABC-1',
    );

    expect(healed.sourceSnapshot).toBeNull();
  });

  it('drops a snapshot with no issue key', () => {
    const healed = normalizeSplitDraft(
      { sourceSnapshot: { issueTypeId: '10001' } },
      'profile-alpha',
      'ABC-1',
    );

    expect(healed.sourceSnapshot).toBeNull();
  });

  it('restores a missing link type to the default rather than writing an unknown one', () => {
    expect(normalizeSplitDraft({}, 'profile-alpha', 'ABC-1').linkTypeName).toBe(DEFAULT_SPLIT_LINK_TYPE);
  });

  it('keeps a link type the PO chose', () => {
    const healed = normalizeSplitDraft({ linkTypeName: 'blocks' }, 'profile-alpha', 'ABC-1');

    expect(healed.linkTypeName).toBe('blocks');
  });
});
