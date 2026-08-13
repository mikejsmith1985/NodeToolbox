// disciplineDiscovery.test.ts — The sub-lane discovery rules, tested directly.
//
// These used to be reachable only by rendering the whole board tab with Jira mocked, which is why
// they went wrong three times before anybody could see it: a peer Feature nested under its own
// sibling, QE's work fetched and then silently discarded, and every band vanishing at once. The two
// Jira reads are passed in, so a test states what Jira returned rather than mocking a module.

import { describe, expect, it, vi } from 'vitest';

import {
  classifyCloneFamilies,
  discoverDisciplineWork,
  indexDisciplineItems,
  selectCloneKeysForDiscipline,
  selectDisciplineCloneKeys,
} from './disciplineDiscovery.ts';
import type {
  BoardVocabulary,
  DisciplineProjects,
  MasterCard,
  RollupBoardItem,
  RollupBoardScope,
} from './rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const QE: DisciplineProjects = { name: 'QE', featureProjectKey: 'QEINT', storyProjectKeys: ['INTTEST'] };
const BT: DisciplineProjects = { name: 'BT', featureProjectKey: 'UEFP', storyProjectKeys: ['UEFP'] };

const SCOPE: RollupBoardScope = {
  boardId: 42,
  teamProfileId: 'team-a',
  featureLinkFieldId: 'customfield_10108',
  subStatusFieldId: '',
  storyPointsFieldIds: [],
};

const VOCABULARY: BoardVocabulary = {
  teamProfileId: 'team-a',
  columns: [{ id: 'col-todo', name: 'To Do', order: 0, mappings: [{ jiraStatusName: 'To Do', subStatusValue: null }] }],
  updatedAt: '',
  lastSyncedAt: null,
};

/** A dev Feature carrying the clone links named. */
function buildMasterCard(featureKey: string, clonedByKeys: string[]): MasterCard {
  return {
    featureKey,
    isSynthetic: false,
    isFeatureUnreadable: false,
    featureIssue: {
      id: featureKey,
      key: featureKey,
      fields: {
        summary: featureKey,
        issuelinks: clonedByKeys.map((cloneKey) => ({
          type: { name: 'Cloners', inward: 'is cloned by', outward: 'clones' },
          inwardIssue: { key: cloneKey },
        })),
      },
    } as unknown as JiraIssue,
    vitals: {} as MasterCard['vitals'],
    items: [],
  };
}

describe('classifyCloneFamilies', () => {
  it('keeps a peer clone out of the discipline set — the project decides, not the link', () => {
    // The real DENP-1358: cloned by a sibling in its OWN project AND by QE's copy. Keying on "has a
    // Cloners link" would have nested a peer Feature underneath its own sibling.
    const families = classifyCloneFamilies(
      [buildMasterCard('DENP-1358', ['DENP-1359', 'QEINT-610'])], ['DENP'], [QE],
    );

    expect(selectDisciplineCloneKeys(families)).toEqual(['QEINT-610']);
  });

  it('records a clone in an unconfigured project rather than dropping it', () => {
    const families = classifyCloneFamilies(
      [buildMasterCard('DENP-1358', ['UEFP-1580'])], ['DENP'], [QE],
    );

    expect(families['DENP-1358'].map((classification) => classification.kind)).toEqual(['unconfigured']);
    expect(selectDisciplineCloneKeys(families)).toEqual([]);
  });

  it('skips the No Feature card and any Feature that could not be read', () => {
    const syntheticCard = { ...buildMasterCard('NO-FEATURE', ['QEINT-610']), isSynthetic: true };
    const unreadableCard = { ...buildMasterCard('DENP-9', ['QEINT-611']), featureIssue: null };

    expect(classifyCloneFamilies([syntheticCard, unreadableCard], ['DENP'], [QE])).toEqual({});
  });

  it('records nothing for a Feature with no clone links, so the map stays small', () => {
    expect(classifyCloneFamilies([buildMasterCard('DENP-1358', [])], ['DENP'], [QE])).toEqual({});
  });
});

describe('selectCloneKeysForDiscipline', () => {
  it('matches on project key, whatever case or spacing the setup was typed in', () => {
    const spacedDiscipline: DisciplineProjects = { ...QE, featureProjectKey: '  qeint ' };

    expect(selectCloneKeysForDiscipline(['QEINT-610', 'UEFP-1580'], spacedDiscipline)).toEqual(['QEINT-610']);
  });

  it('claims nothing when no clone belongs to this discipline', () => {
    expect(selectCloneKeysForDiscipline(['QEINT-610'], BT)).toEqual([]);
  });
});

describe('indexDisciplineItems', () => {
  /** One of a discipline's issues, linked to its clone by the field named. */
  function buildItem(key: string, featureKey: string | null, fields: Record<string, unknown> = {}): RollupBoardItem {
    return {
      key, featureKey, issue: { id: key, key, fields } as unknown as JiraIssue,
    } as unknown as RollupBoardItem;
  }

  it('gives a clone with no work an empty list, so "QE has not started" is still a band', () => {
    const itemsByCloneKey = indexDisciplineItems([], ['QEINT-610'], ['customfield_10108']);

    expect(itemsByCloneKey.get('QEINT-610')).toEqual([]);
  });

  it('files an item by the Feature Link when that is what carried it', () => {
    const itemsByCloneKey = indexDisciplineItems(
      [buildItem('INTTEST-1', 'QEINT-610')], ['QEINT-610'], ['customfield_10108'],
    );

    expect(itemsByCloneKey.get('QEINT-610')?.map((item) => item.key)).toEqual(['INTTEST-1']);
  });

  it('falls back to the portfolio Parent Link, which is how QE really wires its work', () => {
    // The bug that made every QE band read "has not broken its work down yet": the issues were
    // fetched and then discarded, because only the Feature Link was consulted.
    const itemsByCloneKey = indexDisciplineItems(
      [buildItem('INTTEST-1', null, { customfield_10100: 'QEINT-610' })],
      ['QEINT-610'],
      ['customfield_10108', 'customfield_10100'],
    );

    expect(itemsByCloneKey.get('QEINT-610')?.map((item) => item.key)).toEqual(['INTTEST-1']);
  });

  it('drops an item that belongs to no clone here rather than filing it somewhere plausible', () => {
    const itemsByCloneKey = indexDisciplineItems(
      [buildItem('INTTEST-9', 'QEINT-999')], ['QEINT-610'], ['customfield_10108'],
    );

    expect(itemsByCloneKey.get('QEINT-610')).toEqual([]);
  });
});

describe('discoverDisciplineWork', () => {
  /** Readers that answer with the issues named, and record what they were asked. */
  function buildReaders(workIssuesByProject: Record<string, JiraIssue[]> = {}, failures: string[] = []) {
    return {
      readCloneFeatures: vi.fn(async (cloneKeys: readonly string[]) =>
        new Map(cloneKeys.map((cloneKey) => [cloneKey, { id: cloneKey, key: cloneKey, fields: { summary: cloneKey } } as unknown as JiraIssue]))),
      readDisciplineWork: vi.fn(async (storyProjectKeys: readonly string[]) => ({
        issues: workIssuesByProject[storyProjectKeys[0]] ?? [],
        failures,
      })),
    };
  }

  const BASE_REQUEST = {
    disciplines: [QE],
    scope: SCOPE,
    vocabulary: VOCABULARY,
    hasSubStatusField: false,
    fallbackLinkFieldIds: ['customfield_10100'],
  };

  it('asks Jira nothing at all when no clone belongs to a configured discipline', async () => {
    const readers = buildReaders();

    const discovered = await discoverDisciplineWork({
      ...BASE_REQUEST,
      classificationsByFeatureKey: classifyCloneFamilies(
        [buildMasterCard('DENP-1358', ['DENP-1359'])], ['DENP'], [QE],
      ),
      readers,
    });

    expect(readers.readCloneFeatures).not.toHaveBeenCalled();
    expect(readers.readDisciplineWork).not.toHaveBeenCalled();
    expect(discovered.itemsByCloneFeatureKey.size).toBe(0);
  });

  it('reads only the disciplines that actually have a clone here', async () => {
    const readers = buildReaders();

    await discoverDisciplineWork({
      ...BASE_REQUEST,
      disciplines: [QE, BT],
      classificationsByFeatureKey: classifyCloneFamilies(
        [buildMasterCard('DENP-1358', ['QEINT-610'])], ['DENP'], [QE, BT],
      ),
      readers,
    });

    expect(readers.readDisciplineWork).toHaveBeenCalledTimes(1);
    expect(readers.readDisciplineWork.mock.calls[0][0]).toEqual(['INTTEST']);
  });

  it('still gives a clone a band when the discipline has no work under it yet', async () => {
    const discovered = await discoverDisciplineWork({
      ...BASE_REQUEST,
      classificationsByFeatureKey: classifyCloneFamilies(
        [buildMasterCard('DENP-1358', ['QEINT-610'])], ['DENP'], [QE],
      ),
      readers: buildReaders(),
    });

    expect(discovered.itemsByCloneFeatureKey.get('QEINT-610')).toEqual([]);
    expect(discovered.cloneFeatureIssuesByKey.has('QEINT-610')).toBe(true);
  });

  it('reports a failed read against every clone it was reading for', async () => {
    // An empty band that failed to load must never look like a band with nothing in it.
    const discovered = await discoverDisciplineWork({
      ...BASE_REQUEST,
      classificationsByFeatureKey: classifyCloneFamilies(
        [buildMasterCard('DENP-1358', ['QEINT-610'])], ['DENP'], [QE],
      ),
      readers: buildReaders({}, ['INTTEST is not visible to this account']),
    });

    expect(discovered.failuresByCloneFeatureKey.get('QEINT-610'))
      .toEqual(['INTTEST is not visible to this account']);
  });

  it('records no failure at all on a clean read', async () => {
    const discovered = await discoverDisciplineWork({
      ...BASE_REQUEST,
      classificationsByFeatureKey: classifyCloneFamilies(
        [buildMasterCard('DENP-1358', ['QEINT-610'])], ['DENP'], [QE],
      ),
      readers: buildReaders(),
    });

    expect(discovered.failuresByCloneFeatureKey.size).toBe(0);
  });
});
