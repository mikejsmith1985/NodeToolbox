// boardVocabularySync.test.ts — Proves sharing the team's columns is always a deliberate act.
//
// The two properties that matter: publishing one team never disturbs another, and pulling shows
// what would change BEFORE anything changes. A silent overwrite of someone's columns would be
// indistinguishable, from their side, from the board breaking.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadStore, mockSaveStore } = vi.hoisted(() => ({
  mockLoadStore: vi.fn(),
  mockSaveStore: vi.fn(),
}));

vi.mock('../../../services/confluenceApi.ts', () => ({
  loadBoardVocabularyStore: mockLoadStore,
  saveBoardVocabularyStore: mockSaveStore,
}));

import {
  compareVocabularies,
  previewBoardVocabularyPull,
  publishBoardVocabulary,
} from './boardVocabularySync.ts';
import type { BoardVocabulary } from './rollupBoardTypes.ts';

function buildVocabulary(teamProfileId: string, columns: BoardVocabulary['columns']): BoardVocabulary {
  return { teamProfileId, columns, updatedAt: '2026-08-07T10:00:00.000Z', lastSyncedAt: null };
}

const LOCAL_COLUMNS: BoardVocabulary['columns'] = [
  { id: 'col-1', name: 'Being coded', order: 0, mapping: { jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' } },
  { id: 'col-2', name: 'Waiting on SL test', order: 1, mapping: { jiraStatusName: 'In Progress', subStatusValue: 'Dev Complete' } },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveStore.mockResolvedValue(undefined);
});

describe('publishBoardVocabulary', () => {
  it('creates this team\'s entry when nobody has published yet', async () => {
    mockLoadStore.mockResolvedValue({ schemaVersion: 1, updatedAt: '', vocabularyByTeamProfileId: {} });

    await publishBoardVocabulary('db-123', buildVocabulary('team-a', LOCAL_COLUMNS));

    const [, savedStore] = mockSaveStore.mock.calls[0];
    expect(savedStore.vocabularyByTeamProfileId['team-a'].columns[0].name).toBe('Being coded');
  });

  it('leaves every other team\'s columns byte-identical', async () => {
    const otherTeamRecord = {
      teamProfileId: 'team-b',
      columns: [{ id: 'col-9', name: 'Their column', order: 0, mapping: null }],
      updatedAt: '2026-07-01T00:00:00.000Z',
      lastSyncedAt: null,
    };
    mockLoadStore.mockResolvedValue({
      schemaVersion: 1,
      updatedAt: '',
      vocabularyByTeamProfileId: { 'team-b': otherTeamRecord },
    });

    await publishBoardVocabulary('db-123', buildVocabulary('team-a', LOCAL_COLUMNS));

    const [, savedStore] = mockSaveStore.mock.calls[0];
    expect(savedStore.vocabularyByTeamProfileId['team-b']).toEqual(otherTeamRecord);
  });

  it('replaces this team\'s previous entry rather than accumulating copies', async () => {
    mockLoadStore.mockResolvedValue({
      schemaVersion: 1,
      updatedAt: '',
      vocabularyByTeamProfileId: {
        'team-a': { teamProfileId: 'team-a', columns: [{ id: 'old', name: 'Old', order: 0, mapping: null }], updatedAt: '', lastSyncedAt: null },
      },
    });

    await publishBoardVocabulary('db-123', buildVocabulary('team-a', LOCAL_COLUMNS));

    const [, savedStore] = mockSaveStore.mock.calls[0];
    expect(savedStore.vocabularyByTeamProfileId['team-a'].columns.map((column: { id: string }) => column.id))
      .toEqual(['col-1', 'col-2']);
  });
});

describe('compareVocabularies', () => {
  it('reports a column the team added', () => {
    const differences = compareVocabularies(
      buildVocabulary('team-a', [LOCAL_COLUMNS[0]]),
      buildVocabulary('team-a', LOCAL_COLUMNS),
    );

    expect(differences).toContainEqual({ kind: 'column-added', name: 'Waiting on SL test' });
  });

  it('reports a column the team removed', () => {
    const differences = compareVocabularies(
      buildVocabulary('team-a', LOCAL_COLUMNS),
      buildVocabulary('team-a', [LOCAL_COLUMNS[0]]),
    );

    expect(differences).toContainEqual({ kind: 'column-removed', name: 'Waiting on SL test' });
  });

  it('reports a rename, since the name is what the team says out loud', () => {
    const renamed = [{ ...LOCAL_COLUMNS[0], name: 'In development' }, LOCAL_COLUMNS[1]];

    const differences = compareVocabularies(buildVocabulary('team-a', LOCAL_COLUMNS), buildVocabulary('team-a', renamed));

    expect(differences).toContainEqual({ kind: 'column-renamed', fromName: 'Being coded', toName: 'In development' });
  });

  it('reports a mapping change, which silently moves every card in that column', () => {
    const remapped = [
      { ...LOCAL_COLUMNS[0], mapping: { jiraStatusName: 'In Progress', subStatusValue: 'Code Review' } },
      LOCAL_COLUMNS[1],
    ];

    const differences = compareVocabularies(buildVocabulary('team-a', LOCAL_COLUMNS), buildVocabulary('team-a', remapped));

    expect(differences.some((difference) => difference.kind === 'mapping-changed')).toBe(true);
  });

  it('reports a reordering', () => {
    const reordered = [{ ...LOCAL_COLUMNS[0], order: 1 }, { ...LOCAL_COLUMNS[1], order: 0 }];

    const differences = compareVocabularies(buildVocabulary('team-a', LOCAL_COLUMNS), buildVocabulary('team-a', reordered));

    expect(differences.filter((difference) => difference.kind === 'order-changed')).toHaveLength(2);
  });

  it('reports nothing when the two are the same', () => {
    expect(compareVocabularies(buildVocabulary('team-a', LOCAL_COLUMNS), buildVocabulary('team-a', LOCAL_COLUMNS)))
      .toEqual([]);
  });
});

describe('previewBoardVocabularyPull', () => {
  it('says nothing has been published yet rather than treating it as an error', async () => {
    mockLoadStore.mockResolvedValue({ schemaVersion: 1, updatedAt: '', vocabularyByTeamProfileId: {} });

    const preview = await previewBoardVocabularyPull('db-123', buildVocabulary('team-a', LOCAL_COLUMNS));

    expect(preview.remote).toBeNull();
    expect(preview.hasDifferences).toBe(false);
  });

  it('changes nothing — it only describes what a pull would do', async () => {
    mockLoadStore.mockResolvedValue({
      schemaVersion: 1,
      updatedAt: '',
      vocabularyByTeamProfileId: {
        'team-a': { teamProfileId: 'team-a', columns: [{ id: 'col-1', name: 'Renamed', order: 0, mapping: null }], updatedAt: '', lastSyncedAt: null },
      },
    });

    await previewBoardVocabularyPull('db-123', buildVocabulary('team-a', LOCAL_COLUMNS));

    // Previewing must never write. A pull that applied itself would be a silent overwrite.
    expect(mockSaveStore).not.toHaveBeenCalled();
  });

  it('enumerates the differences so a person can decide before accepting', async () => {
    mockLoadStore.mockResolvedValue({
      schemaVersion: 1,
      updatedAt: '',
      vocabularyByTeamProfileId: {
        'team-a': {
          teamProfileId: 'team-a',
          columns: [{ id: 'col-1', name: 'In development', order: 0, mapping: LOCAL_COLUMNS[0].mapping }],
          updatedAt: '',
          lastSyncedAt: null,
        },
      },
    });

    const preview = await previewBoardVocabularyPull('db-123', buildVocabulary('team-a', LOCAL_COLUMNS));

    expect(preview.hasDifferences).toBe(true);
    expect(preview.differences).toContainEqual({ kind: 'column-renamed', fromName: 'Being coded', toName: 'In development' });
    expect(preview.differences).toContainEqual({ kind: 'column-removed', name: 'Waiting on SL test' });
  });

  it('lets a schema version this client cannot read surface, without touching the local copy', async () => {
    mockLoadStore.mockRejectedValue(new Error('Unsupported board vocabulary schema version 2.'));

    await expect(previewBoardVocabularyPull('db-123', buildVocabulary('team-a', LOCAL_COLUMNS)))
      .rejects.toThrow(/schema version 2/);
    expect(mockSaveStore).not.toHaveBeenCalled();
  });
});
