// boardVocabularyStore.test.ts — Proves the vocabulary is a team artefact and that an edit is
// distinguishable from a sync.

import { beforeEach, describe, expect, it } from 'vitest';

import { buildDefaultBoardColumns } from './defaultBoardColumns.ts';

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
    columns: [{ id: 'col-1', name: 'Being coded', order: 0, mappings: [{ jiraStatusName: 'In Progress', subStatusValue: null }] }],
    updatedAt: '',
    lastSyncedAt: null,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('loadTeamVocabulary', () => {
  it('starts a team on the org board rather than a blank one', () => {
    // This used to expect no columns at all, which put every issue in Unmapped and left a first-time
    // board useless until somebody rebuilt the enterprise workflow by hand.
    expect(loadTeamVocabulary('team-a').columns.map((column) => column.name))
      .toEqual(buildDefaultBoardColumns().map((column) => column.name));
  });

  it('leaves updatedAt empty on the shipped default, which nobody has edited', () => {
    // Stamping a time would present a default as this team's own decision, and the board uses that
    // stamp to tell a viewer their columns have drifted from what the team agreed.
    expect(loadTeamVocabulary('team-a').updatedAt).toBe('');
  });

  it('survives a round trip through storage', () => {
    saveTeamVocabulary(buildVocabulary('team-a'), NOW_ISO);

    expect(loadTeamVocabulary('team-a').columns[0].name).toBe('Being coded');
  });

  it('keeps one team\'s vocabulary out of another team\'s board', () => {
    saveTeamVocabulary(buildVocabulary('team-a'), NOW_ISO);

    expect(loadTeamVocabulary('team-b').columns.map((column) => column.name))
      .toEqual(buildDefaultBoardColumns().map((column) => column.name));
  });

  it('treats unreadable storage as nothing stored, rather than throwing on load', () => {
    window.localStorage.setItem('tbxRollupBoardVocabulary', '{{{ not json');

    expect(loadTeamVocabulary('team-a').columns.map((column) => column.name))
      .toEqual(buildDefaultBoardColumns().map((column) => column.name));
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

describe('reading columns saved by an older version', () => {
  /** Exactly what v0.140.x wrote: one Jira state per column, in a `mapping` field. */
  const LEGACY_STORED = {
    'team-a': {
      teamProfileId: 'team-a',
      columns: [
        { id: 'col-1', name: 'Being coded', order: 0, mapping: { jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' } },
        { id: 'col-2', name: 'Not started', order: 1, mapping: null },
      ],
      updatedAt: '2026-08-07T10:00:00.000Z',
      lastSyncedAt: null,
    },
  };

  it('upgrades a single mapping into the list a column now claims', () => {
    // Renaming this persisted field without a migration turned the board into a blank page:
    // the new code called .some() on an array that older saved data did not have.
    window.localStorage.setItem('tbxRollupBoardVocabulary', JSON.stringify(LEGACY_STORED));

    const vocabulary = loadTeamVocabulary('team-a');

    expect(vocabulary.columns[0].mappings).toEqual([{ jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' }]);
  });

  it('turns a column that claimed nothing into one claiming an empty list, not undefined', () => {
    window.localStorage.setItem('tbxRollupBoardVocabulary', JSON.stringify(LEGACY_STORED));

    expect(loadTeamVocabulary('team-a').columns[1].mappings).toEqual([]);
  });

  it('gives every column a usable mappings array, so nothing downstream can throw', () => {
    window.localStorage.setItem('tbxRollupBoardVocabulary', JSON.stringify(LEGACY_STORED));

    const vocabulary = loadTeamVocabulary('team-a');

    expect(vocabulary.columns.every((column) => Array.isArray(column.mappings))).toBe(true);
  });

  it('keeps the team\'s column names and order through the upgrade', () => {
    window.localStorage.setItem('tbxRollupBoardVocabulary', JSON.stringify(LEGACY_STORED));

    expect(loadTeamVocabulary('team-a').columns.map((column) => column.name)).toEqual(['Being coded', 'Not started']);
  });

  it('survives a stored column that has neither shape', () => {
    window.localStorage.setItem('tbxRollupBoardVocabulary', JSON.stringify({
      'team-a': { teamProfileId: 'team-a', columns: [{ id: 'col-1', name: 'Odd one', order: 0 }] },
    }));

    expect(loadTeamVocabulary('team-a').columns[0].mappings).toEqual([]);
  });
});
