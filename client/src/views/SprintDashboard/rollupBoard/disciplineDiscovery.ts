// disciplineDiscovery.ts — Finding each Feature's clones and reading the other disciplines' work.
//
// Lifted out of the board component, where it lived as a 110-line effect among thirty-eight other
// pieces of state. It could only be exercised by rendering the whole tab with Jira mocked, which is
// the wrong place to be checking rules like "a clone in the dev team's own project is a peer, not a
// discipline" — and this is the part of the board that has caused the most trouble.
//
// The shape is deliberate: everything that is a RULE is a pure function tested directly, and the one
// piece that must talk to Jira takes its two readers as arguments, so a test supplies fakes instead
// of mocking a module.

import { classifyClone, readCloneAttribution, readCloneLinks } from './cloneFamily.ts';
import { resolveBoardItems } from './featureRollup.ts';
import { resolveColumnIdForItem } from './boardColumns.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import type {
  BoardVocabulary,
  CloneClassification,
  DisciplineProjects,
  MasterCard,
  RollupBoardItem,
  RollupBoardScope,
} from './rollupBoardTypes.ts';

/** Everything the discovery produced, ready to become the board's sub-lanes. */
export interface DisciplineWorkResult {
  /** The clone Features themselves, so a band can name what it is a copy of. */
  cloneFeatureIssuesByKey: Map<string, JiraIssue>;
  /** Each clone's work. A clone with none still gets an entry — "QE has not started" is a fact. */
  itemsByCloneFeatureKey: Map<string, RollupBoardItem[]>;
  /** Why a clone's work could not be read, so an empty band is never mistaken for an empty backlog. */
  failuresByCloneFeatureKey: Map<string, string[]>;
}

/** The two Jira reads this needs, passed in so the rules above them can be tested without mocking. */
export interface DisciplineWorkReaders {
  readCloneFeatures: (cloneKeys: readonly string[], scope: RollupBoardScope) => Promise<Map<string, JiraIssue>>;
  readDisciplineWork: (
    storyProjectKeys: readonly string[],
    cloneKeys: readonly string[],
    scope: RollupBoardScope,
  ) => Promise<{ issues: JiraIssue[]; failures: string[] }>;
}

/** An empty result, so callers never have to build one by hand or reason about undefined. */
export const EMPTY_DISCIPLINE_WORK: DisciplineWorkResult = {
  cloneFeatureIssuesByKey: new Map(),
  itemsByCloneFeatureKey: new Map(),
  failuresByCloneFeatureKey: new Map(),
};

/** Compares project keys the way a person typing them into Board setup would expect. */
function normalizeProjectKey(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * Classifies every clone named on every Feature the board is drawing.
 *
 * The synthetic "No Feature" card and any Feature that could not be read are skipped: neither has
 * issue links to read, and asking would only produce an empty answer that looked like a real one.
 */
export function classifyCloneFamilies(
  masterCards: readonly MasterCard[],
  devFeatureProjectKeys: readonly string[],
  disciplines: readonly DisciplineProjects[],
): Record<string, CloneClassification[]> {
  const classificationsByFeatureKey: Record<string, CloneClassification[]> = {};

  for (const masterCard of masterCards ?? []) {
    if (masterCard.isSynthetic || masterCard.featureIssue === null) continue;

    const classifications = readCloneLinks(masterCard.featureIssue).map((cloneLink) =>
      classifyClone(cloneLink.cloneIssueKey, cloneLink.evidence, devFeatureProjectKeys, disciplines));
    if (classifications.length > 0) classificationsByFeatureKey[masterCard.featureKey] = classifications;
  }

  return classificationsByFeatureKey;
}

/** The clone keys that belong to a configured discipline — the only ones worth a Jira request. */
export function selectDisciplineCloneKeys(
  classificationsByFeatureKey: Record<string, CloneClassification[]>,
): string[] {
  return Object.values(classificationsByFeatureKey ?? {})
    .flat()
    .filter((classification) => classification.kind === 'discipline')
    .map((classification) => classification.cloneIssueKey);
}

/** Which of these clone keys are this discipline's, decided by project key and nothing else. */
export function selectCloneKeysForDiscipline(
  cloneKeys: readonly string[],
  discipline: DisciplineProjects,
): string[] {
  const disciplineProjectKey = normalizeProjectKey(discipline.featureProjectKey);
  return (cloneKeys ?? []).filter((cloneKey) =>
    normalizeProjectKey(String(cloneKey).split('-')[0]) === disciplineProjectKey);
}

/**
 * Files each of a discipline's issues under the clone Feature it belongs to.
 *
 * Attribution is by whichever field actually carried the link, NOT by the roll-up's Feature Link
 * alone: QE hangs its INTTEST work off the clone through the portfolio Parent Link, so resolving by
 * Feature Link only fetched those issues and then discarded every one of them.
 *
 * Every clone key starts with an empty list rather than being absent, so a discipline that has not
 * begun still gets a band — an absence of work is a fact worth showing, not one to hide.
 */
export function indexDisciplineItems(
  disciplineItems: readonly RollupBoardItem[],
  cloneKeys: readonly string[],
  linkFieldIds: readonly string[],
): Map<string, RollupBoardItem[]> {
  const cloneKeySet = new Set(cloneKeys);
  const itemsByCloneKey = new Map<string, RollupBoardItem[]>();
  for (const cloneKey of cloneKeys) itemsByCloneKey.set(cloneKey, []);

  for (const item of disciplineItems ?? []) {
    const cloneKey = item.featureKey !== null && cloneKeySet.has(item.featureKey)
      ? item.featureKey
      : readCloneAttribution(item.issue, cloneKeySet, linkFieldIds);
    if (cloneKey === null) continue;
    itemsByCloneKey.set(cloneKey, [...(itemsByCloneKey.get(cloneKey) ?? []), item]);
  }

  return itemsByCloneKey;
}

/** What one discipline's work needs in order to be turned into board items. */
interface DisciplineWorkRequest {
  discipline: DisciplineProjects;
  cloneKeys: readonly string[];
  cloneFeatureIssuesByKey: Map<string, JiraIssue>;
  scope: RollupBoardScope;
  vocabulary: BoardVocabulary;
  hasSubStatusField: boolean;
  /** Tried after the Feature Link, because QE links its work through the portfolio Parent Link. */
  fallbackLinkFieldIds: readonly string[];
  readers: DisciplineWorkReaders;
}

/** Reads one discipline's work and turns it into board items, in the DEV team's own columns. */
async function readOneDisciplinesWork({
  discipline,
  cloneKeys,
  cloneFeatureIssuesByKey,
  scope,
  vocabulary,
  hasSubStatusField,
  fallbackLinkFieldIds,
  readers,
}: DisciplineWorkRequest): Promise<{ itemsByCloneKey: Map<string, RollupBoardItem[]>; failures: string[] }> {
  const workOutcome = await readers.readDisciplineWork(discipline.storyProjectKeys, cloneKeys, scope);
  const cloneKeySet = new Set(cloneKeys);

  // The board's OWN resolver, not a second item builder: the spec asks for the same roll-up rules,
  // and two implementations would agree only until one of them was edited.
  const disciplineItems = resolveBoardItems(
    {
      boardIssues: workOutcome.issues,
      subtaskIssues: [],
      featureIssues: cloneFeatureIssuesByKey,
      featureReadFailures: [],
      load: {
        isComplete: true,
        expectedBoardIssueCount: workOutcome.issues.length,
        loadedBoardIssueCount: workOutcome.issues.length,
        isOversized: false,
        failures: [],
      },
    },
    scope,
    {
      resolveColumnId: (statusName, subStatusValue) =>
        resolveColumnIdForItem(statusName, subStatusValue, vocabulary, hasSubStatusField),
      isFeatureInScope: (featureKey) => cloneKeySet.has(featureKey),
    },
  );

  return {
    itemsByCloneKey: indexDisciplineItems(
      disciplineItems, cloneKeys, [scope.featureLinkFieldId, ...fallbackLinkFieldIds],
    ),
    failures: workOutcome.failures,
  };
}

/** What the discovery needs to run. */
export interface DisciplineDiscoveryRequest {
  classificationsByFeatureKey: Record<string, CloneClassification[]>;
  disciplines: readonly DisciplineProjects[];
  scope: RollupBoardScope;
  vocabulary: BoardVocabulary;
  hasSubStatusField: boolean;
  /** Extra fields a discipline may have used to link its work, tried after the Feature Link. */
  fallbackLinkFieldIds: readonly string[];
  readers: DisciplineWorkReaders;
}

/**
 * Reads every configured discipline's work for the clones already classified.
 *
 * Discovery itself costs NOTHING — the clone links come from `issuelinks`, which every board fetch
 * already requests — so the only traffic here is the disciplines' own work, and none of it happens
 * until a team configures a discipline.
 */
export async function discoverDisciplineWork({
  classificationsByFeatureKey,
  disciplines,
  scope,
  vocabulary,
  hasSubStatusField,
  fallbackLinkFieldIds,
  readers,
}: DisciplineDiscoveryRequest): Promise<DisciplineWorkResult> {
  const disciplineCloneKeys = selectDisciplineCloneKeys(classificationsByFeatureKey);
  if (disciplineCloneKeys.length === 0) return EMPTY_DISCIPLINE_WORK;

  const cloneFeatureIssuesByKey = await readers.readCloneFeatures(disciplineCloneKeys, scope);

  const itemsByCloneFeatureKey = new Map<string, RollupBoardItem[]>();
  const failuresByCloneFeatureKey = new Map<string, string[]>();

  for (const discipline of disciplines) {
    const cloneKeys = selectCloneKeysForDiscipline(disciplineCloneKeys, discipline);
    if (cloneKeys.length === 0) continue;

    const outcome = await readOneDisciplinesWork({
      discipline, cloneKeys, cloneFeatureIssuesByKey, scope, vocabulary, hasSubStatusField,
      fallbackLinkFieldIds, readers,
    });
    for (const [cloneKey, items] of outcome.itemsByCloneKey) itemsByCloneFeatureKey.set(cloneKey, items);
    if (outcome.failures.length > 0) {
      for (const cloneKey of cloneKeys) failuresByCloneFeatureKey.set(cloneKey, outcome.failures);
    }
  }

  return { cloneFeatureIssuesByKey, itemsByCloneFeatureKey, failuresByCloneFeatureKey };
}
