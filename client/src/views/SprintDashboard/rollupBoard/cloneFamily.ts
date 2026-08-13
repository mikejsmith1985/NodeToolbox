// cloneFamily.ts — Which Features are copies of this one, and which of those are another discipline's.
//
// A business outcome is delivered by three teams working from three copies of the same Feature. Dev
// owns the original; QE and BT clone it into their own Feature projects and break their own work down
// underneath their clone. The board saw none of that, so it reported a Feature as complete when DEV
// was complete — the same "looks finished, isn't" problem the board exists to end, one level up.
//
// The rule that matters here was not obvious and is easy to get wrong: **a Cloners link is not by
// itself evidence of another discipline.** A real Feature's links read:
//
//     is cloned by   DENP-1359   H Contract Migration — Blue Plans to Purple Platforms for 2028
//     is cloned by   QEINT-610   Enrollment- Migration — H Contract Consolidation … for 1/1/2027
//
// The first is a PEER: the dev team cloned its own Feature to split scope, and it deserves its own
// top-level lane. Only the second is a sub-lane. **The project decides, not the link.**
//
// The same sample kills the obvious fallback. Those two summaries share almost no words, because a
// discipline rewrites the title to describe its own scope and plan year. Matching on the Feature Name
// would have found nothing here, so it survives only as a narrow net for Features created by hand —
// exact, trimmed, and confined to the configured projects. It is never the mechanism.

import type { JiraIssue } from '../../../types/jira.ts';
import type { CloneClassification, CloneLink, DisciplineProjects } from './rollupBoardTypes.ts';

// ── Named constants ──

/**
 * The phrases Jira uses for a clone relationship, already normalised.
 *
 * Both directions, because which side Jira recorded depends on who pressed Clone — and a family that
 * appears or disappears based on that is not a family.
 */
const CLONE_LINK_PHRASES = new Set(['cloned by', 'clones', 'cloners', 'is cloned by']);

/** How many distinct tones the board rotates through before repeating. Matches the token palette. */
export const DISCIPLINE_TONE_COUNT = 6;

/** Loosens a link phrase so "is cloned by" and "Cloned by" compare equal. */
function normalizeLinkPhrase(linkPhrase: string): string {
  return String(linkPhrase ?? '').trim().toLowerCase().replace(/^is\s+/, '').replace(/\s+/g, ' ');
}

/** The project key part of a Jira issue key. The board reads project this way everywhere. */
export function readProjectKey(issueKey: string): string {
  const [projectKey = ''] = String(issueKey ?? '').split('-', 1);
  return projectKey.trim().toUpperCase();
}

/** Compares project keys and names the way a person typing them would expect. */
function normalizeKey(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * Every clone named on a Feature's own issue links.
 *
 * Reads both `inward` and `outward` phrases and takes whichever issue is on the other end, so the
 * result does not depend on which team pressed Clone.
 */
export function readCloneLinks(featureIssue: JiraIssue | null): CloneLink[] {
  const issueLinks = Array.isArray(featureIssue?.fields?.issuelinks)
    ? featureIssue.fields.issuelinks as unknown[]
    : [];

  const cloneKeys = new Set<string>();
  for (const rawLink of issueLinks) {
    const issueLink = rawLink as {
      type?: { name?: string; inward?: string; outward?: string };
      inwardIssue?: { key?: string };
      outwardIssue?: { key?: string };
    };

    const isCloneLink = [issueLink.type?.name, issueLink.type?.inward, issueLink.type?.outward]
      .some((phrase) => phrase !== undefined && CLONE_LINK_PHRASES.has(normalizeLinkPhrase(phrase)));
    if (!isCloneLink) continue;

    const linkedKey = issueLink.outwardIssue?.key ?? issueLink.inwardIssue?.key ?? '';
    if (linkedKey !== '') cloneKeys.add(linkedKey);
  }

  return [...cloneKeys].map((cloneIssueKey) => ({ cloneIssueKey, evidence: 'cloners-link' as const }));
}

/**
 * Decides what one clone actually is.
 *
 * Three outcomes and no fourth: a clone is another discipline's, our own peer, or in a project nobody
 * has configured. There is deliberately no "ignore" case — silently dropping a clone is exactly how a
 * Feature comes to read as finished while somebody still has open work.
 */
export function classifyClone(
  cloneIssueKey: string,
  evidence: CloneLink['evidence'],
  devFeatureProjectKeys: readonly string[],
  disciplineProjects: readonly DisciplineProjects[],
): CloneClassification {
  const cloneProjectKey = readProjectKey(cloneIssueKey);

  // Checked FIRST: a clone in our own Feature project is a peer however the disciplines are set up,
  // and a team that mistakenly configured its own project must not nest a lane under itself.
  const isOwnProject = (devFeatureProjectKeys ?? [])
    .some((projectKey) => normalizeKey(projectKey) === cloneProjectKey);
  if (isOwnProject) return { kind: 'peer', cloneIssueKey };

  const matchedDiscipline = (disciplineProjects ?? [])
    .find((discipline) => normalizeKey(discipline.featureProjectKey) === cloneProjectKey);
  if (matchedDiscipline) {
    return { kind: 'discipline', discipline: matchedDiscipline, cloneIssueKey, evidence };
  }

  return { kind: 'unconfigured', cloneIssueKey, projectKey: cloneProjectKey };
}

/** Reads the human title a Feature is known by, preferring the Feature Name field over the summary. */
function readFeatureName(featureIssue: JiraIssue | null, featureNameFieldId: string): string {
  const issueFields = (featureIssue?.fields ?? {}) as Record<string, unknown>;
  const featureName = featureNameFieldId === '' ? undefined : issueFields[featureNameFieldId];
  const rawName = typeof featureName === 'string' && featureName.trim() !== ''
    ? featureName
    : issueFields.summary;
  return String(rawName ?? '').trim().toLowerCase();
}

/**
 * The net, not the plan: a clone found by an identical title.
 *
 * Exists only for a discipline that created its Feature by hand and so left no Cloners link. Held to
 * an EXACT match after trimming, and only inside the configured discipline projects, because the
 * sampled data shows disciplines rewrite the title — which makes a loose match far likelier to invent
 * a family than to find one.
 */
export function findCloneByFeatureName(
  devFeatureIssue: JiraIssue | null,
  candidateFeatureIssues: readonly JiraIssue[],
  disciplineProjects: readonly DisciplineProjects[],
  featureNameFieldId = '',
): CloneLink[] {
  const devName = readFeatureName(devFeatureIssue, featureNameFieldId);
  if (devName === '') return [];

  const disciplineProjectKeys = new Set(
    (disciplineProjects ?? []).map((discipline) => normalizeKey(discipline.featureProjectKey)),
  );
  if (disciplineProjectKeys.size === 0) return [];

  return (candidateFeatureIssues ?? [])
    .filter((candidate) => disciplineProjectKeys.has(readProjectKey(candidate.key)))
    .filter((candidate) => readFeatureName(candidate, featureNameFieldId) === devName)
    .map((candidate) => ({ cloneIssueKey: candidate.key, evidence: 'feature-name-match' as const }));
}

/**
 * Which tone a discipline draws in, from its position in the configured list.
 *
 * Position rather than a stored colour, so the same discipline is the same colour on every reload and
 * for every viewer without anything having to be persisted or synchronised.
 */
export function readDisciplineToneIndex(
  discipline: DisciplineProjects,
  disciplineProjects: readonly DisciplineProjects[],
): number {
  const configuredPosition = (disciplineProjects ?? [])
    .findIndex((candidate) => normalizeKey(candidate.featureProjectKey) === normalizeKey(discipline.featureProjectKey));
  return configuredPosition < 0 ? 0 : configuredPosition % DISCIPLINE_TONE_COUNT;
}

/**
 * One sentence naming clones in projects nobody configured.
 *
 * An unconfigured discipline must be discovered by being TOLD, not by a Feature quietly reading as
 * finished while a whole team's work sits in a project the board decided to ignore.
 */
export function describeUnconfiguredClones(classifications: readonly CloneClassification[]): string {
  const unconfiguredKeys = (classifications ?? [])
    .filter((classification): classification is Extract<CloneClassification, { kind: 'unconfigured' }> =>
      classification.kind === 'unconfigured')
    .map((classification) => classification.cloneIssueKey);
  if (unconfiguredKeys.length === 0) return '';

  const projectKeys = [...new Set(unconfiguredKeys.map(readProjectKey))];
  const cloneWord = unconfiguredKeys.length === 1 ? 'clone' : 'clones';
  const projectWord = projectKeys.length === 1 ? 'project' : 'projects';

  return `${unconfiguredKeys.length} Feature ${cloneWord} sit in ${projectWord} this board does not know about`
    + ` (${projectKeys.join(', ')}): ${unconfiguredKeys.join(', ')}.`
    + ' Add the project as a discipline in Board setup to see its work, or ignore this if it is another'
    + ' team\'s copy.';
}

/**
 * Which clone Feature an issue belongs to, by whichever field actually carries the link.
 *
 * The board's own roll-up reads the Feature Link and nothing else, which is right for the dev team
 * because that is how the dev team works. It is not universal: QE's INTTEST work hangs off QEINT-608
 * through the portfolio Parent Link, so resolving by Feature Link alone found the issues and then
 * discarded every one of them for having no Feature.
 *
 * The query already restricted the search to these clones, so anything reaching here belongs to one
 * of them. This only has to say WHICH — and it tries each field in turn rather than assuming.
 */
export function readCloneAttribution(
  issue: { fields?: Record<string, unknown> },
  cloneFeatureKeys: ReadonlySet<string>,
  linkageFieldIds: readonly string[],
): string | null {
  const issueFields = (issue?.fields ?? {}) as Record<string, unknown>;

  for (const fieldId of linkageFieldIds) {
    if (fieldId === '') continue;
    const rawValue = issueFields[fieldId];
    const linkedKey = typeof rawValue === 'string'
      ? rawValue.trim()
      : String((rawValue as { key?: string } | null | undefined)?.key ?? '').trim();
    if (linkedKey !== '' && cloneFeatureKeys.has(linkedKey)) return linkedKey;
  }

  // A sub-task under a clone, which carries no custom field at all.
  const parentKey = String((issueFields.parent as { key?: string } | undefined)?.key ?? '').trim();
  return parentKey !== '' && cloneFeatureKeys.has(parentKey) ? parentKey : null;
}
