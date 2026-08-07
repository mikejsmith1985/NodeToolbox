// boardVocabularyStore.test.ts — Proves the vocabulary is a team artefact and that an edit is
// distinguishable from a sync.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  loadTeamVocabulary,
  markVocabularySynced,
  saveTeamVocabulary,
} from './boardVocabularyStore.ts';
import type { BoardVocabulary } from './rollupBoardTypes.ts';

const NOW_ISO = '2026-08-07T10:00:00.000Z';
const LATER_ISO = '2026-08-07T11:00:00.000Z';

function buildVocabulary(teamProfileId: string): BoardVocabulary {
  return {
    teamProfileId,
    columns: [{ id: 'col-1', name: 'Being coded', order: 0, mapping: { jiraStatusName: 'In Progress', subStatusValue: null } }],
    updatedAt: '',
    lastSyncedAt: null,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('loadTeamVocabulary', () => {
  it('starts a team with no columns, which shows everything as Unmapped rather than as nothing', () => {
    expect(loadTeamVocabulary('team-a').columns).toEqual([]);
  });

  it('survives a round trip through storage', () => {
    saveTeamVocabulary(buildVocabulary('team-a'), NOW_ISO);

    expect(loadTeamVocabulary('team-a').columns[0].name).toBe('Being coded');
  });

  it('keeps one team\'s vocabulary out of another team\'s board', () => {
    saveTeamVocabulary(buildVocabulary('team-a'), NOW_ISO);

    expect(loadTeamVocabulary('team-b').columns).toEqual([]);
  });

  it('treats unreadable storage as nothing stored, rather than throwing on load', () => {
    window.localStorage.setItem('tbxRollupBoardVocabulary', '{{{ not json');

    expect(loadTeamVocabulary('team-a').columns).toEqual([]);
  });
});

describe('saveTeamVocabulary', () => {
  it('advances updatedAt so an edit is dateable', () => {
    expect(saveTeamVocabulary(buildVocabulary('team-a'), NOW_ISO).updatedAt).toBe(NOW_ISO);
  });

  it('leaves lastSyncedAt alone, so an edit is never mistaken for a publish', () => {
    // This gap is exactly what lets the board say "your columns have drifted from the team's".
    expect(saveTeamVocabulary(buildVocabulary('team-a'), NOW_ISO).lastSyncedAt).toBeNull();
  });

  it('leaves other teams byte-identical', () => {
    saveTeamVocabulary(buildVocabulary('team-b'), NOW_ISO);
    saveTeamVocabulary(buildVocabulary('team-a'), LATER_ISO);

    expect(loadTeamVocabulary('team-b').updatedAt).toBe(NOW_ISO);
  });
});

describe('markVocabularySynced', () => {
  it('records when the local copy last matched the team\'s shared one', () => {
    const saved = saveTeamVocabulary(buildVocabulary('team-a'), NOW_ISO);

    expect(markVocabularySynced(saved, LATER_ISO).lastSyncedAt).toBe(LATER_ISO);
  });

  it('persists the sync stamp', () => {
    markVocabularySynced(saveTeamVocabulary(buildVocabulary('team-a'), NOW_ISO), LATER_ISO);

    expect(loadTeamVocabulary('team-a').lastSyncedAt).toBe(LATER_ISO);
  });
});
