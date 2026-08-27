// releaseFeatureAttribution.ts — Working out which Feature each item in a release delivers.
//
// Most items say so themselves: a Story carries a Feature Link, and one hop settles it. Defects do
// not. A defect found in testing might be linked to the development Story, to the QA issue that
// found it, or straight to the Feature — the team has no single convention and cannot adopt one.
// Read with a single hop, every one of those defects lands under "No Feature", and a release note
// then reports that a third of the release delivered nothing in particular.
//
// The Roll-Up Board already solved this: `resolveDefectRollup` applies a fixed precedence and can
// always restate the route it took. What it needs is an INDEX of the issues a defect links to, which
// the board has because it loads the whole team's work and a release fetch does not.
//
// So this module's only real job is building that index, in the fewest requests that can possibly
// answer the question:
//
//   - Round one fetches what the unattributed items link to directly.
//   - Round two fetches what THOSE link to, because the chain's longest legitimate route is
//     defect → QA issue → dev Story → Feature, and stopping at round one would miss exactly the
//     case the precedence chain exists for.
//
// Two rounds, not a recursive crawl: the chain itself caps at one intermediate hop, so a third round
// could not change any answer and would only cost a request.
//
// The chain runs ONLY for items a single hop could not place. An item that states its own Feature is
// already correct, and re-deriving it through link precedence could only introduce a disagreement.

import { extractFeatureKeyFromIssueFields, featureLinkCandidateFieldIds } from '../../../utils/featureLink.ts';
import { resolveDefectRollup } from '../rollupBoard/defectRollup.ts';
import type { DefectPrecedence } from '../rollupBoard/rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

/** The fields a linked issue must carry for the precedence chain to read it. */
export function buildLinkedIssueFields(featureLinkFieldId: string): string {
  return ['summary', 'issuetype', 'issuelinks', ...featureLinkCandidateFieldIds(featureLinkFieldId)].join(',');
}

/** How one item's Feature was arrived at, so a placement can be explained rather than trusted. */
export interface FeatureAttribution {
  featureKey: string | null;
  /** Null when the item stated its own Feature; otherwise the precedence step that placed it. */
  viaPrecedence: DefectPrecedence | null;
}

/** Fetches issues by key. Injected so the attribution is testable without Jira. */
export interface IssuesByKeysFetcher {
  (issueKeys: readonly string[]): Promise<JiraIssue[]>;
}

/** Every key this issue links to, in either direction. */
function readLinkedKeys(issue: JiraIssue): string[] {
  const issueLinks = (issue.fields as { issuelinks?: unknown[] }).issuelinks ?? [];
  const linkedKeys: string[] = [];

  issueLinks.forEach((rawLink) => {
    const issueLink = rawLink as { inwardIssue?: { key?: string }; outwardIssue?: { key?: string } };
    const linkedKey = issueLink.outwardIssue?.key ?? issueLink.inwardIssue?.key;
    if (linkedKey !== undefined && !linkedKeys.includes(linkedKey)) {
      linkedKeys.push(linkedKey);
    }
  });

  return linkedKeys;
}

/** The keys worth fetching: linked, not already held, not already asked for. */
function readKeysToFetch(
  issues: readonly JiraIssue[],
  alreadyHeld: ReadonlyMap<string, JiraIssue>,
  alreadyRequested: ReadonlySet<string>,
): string[] {
  const keysToFetch = new Set<string>();
  issues.forEach((issue) => {
    readLinkedKeys(issue).forEach((linkedKey) => {
      if (!alreadyHeld.has(linkedKey) && !alreadyRequested.has(linkedKey)) {
        keysToFetch.add(linkedKey);
      }
    });
  });
  return [...keysToFetch];
}

/**
 * Builds the index of linked issues the precedence chain walks.
 *
 * A failed round returns what it has rather than throwing. Attribution is an improvement on a release
 * note that already renders; losing the whole table because one lookup timed out would be a poor trade.
 */
export async function buildLinkedIssueIndex(
  unattributedIssues: readonly JiraIssue[],
  fetchIssuesByKeys: IssuesByKeysFetcher,
): Promise<Map<string, JiraIssue>> {
  const index = new Map<string, JiraIssue>(unattributedIssues.map((issue) => [issue.key, issue]));
  const requestedKeys = new Set<string>(index.keys());
  let frontier: readonly JiraIssue[] = unattributedIssues;

  // Two rounds exactly. The chain caps at one intermediate hop, so a third could not change an answer.
  for (let round = 0; round < 2; round += 1) {
    const keysToFetch = readKeysToFetch(frontier, index, requestedKeys);
    if (keysToFetch.length === 0) {
      break;
    }
    keysToFetch.forEach((key) => requestedKeys.add(key));

    let fetchedIssues: JiraIssue[];
    try {
      fetchedIssues = await fetchIssuesByKeys(keysToFetch);
    } catch {
      break;
    }

    fetchedIssues.forEach((issue) => index.set(issue.key, issue));
    frontier = fetchedIssues;
  }

  return index;
}

/**
 * Resolves the Feature behind every issue in a release.
 *
 * One hop first, for everything. The precedence chain runs only over what is left — which is the
 * defects — because an item that named its own Feature is already right, and a second opinion could
 * only disagree with it.
 */
export async function resolveReleaseFeatureAttribution(
  releaseIssues: readonly JiraIssue[],
  featureLinkFieldId: string,
  fetchIssuesByKeys: IssuesByKeysFetcher,
): Promise<Map<string, FeatureAttribution>> {
  const attributionByIssueKey = new Map<string, FeatureAttribution>();
  const unattributedIssues: JiraIssue[] = [];

  releaseIssues.forEach((issue) => {
    const ownFeatureKey = extractFeatureKeyFromIssueFields(
      issue.fields as unknown as Record<string, unknown>,
      featureLinkFieldId,
    );
    if (ownFeatureKey !== null) {
      attributionByIssueKey.set(issue.key, { featureKey: ownFeatureKey, viaPrecedence: null });
      return;
    }
    attributionByIssueKey.set(issue.key, { featureKey: null, viaPrecedence: null });
    unattributedIssues.push(issue);
  });

  // Nothing to chase, and nothing that COULD be chased — an issue with no links has no route.
  const chaseableIssues = unattributedIssues.filter((issue) => readLinkedKeys(issue).length > 0);
  if (chaseableIssues.length === 0) {
    return attributionByIssueKey;
  }

  const index = await buildLinkedIssueIndex(unattributedIssues, fetchIssuesByKeys);

  chaseableIssues.forEach((issue) => {
    const route = resolveDefectRollup(issue, index, featureLinkFieldId);
    if (route.featureKey !== null) {
      attributionByIssueKey.set(issue.key, {
        featureKey: route.featureKey,
        viaPrecedence: route.precedenceRank,
      });
    }
  });

  return attributionByIssueKey;
}

/** How a precedence step reads on screen, for a placement that was not stated by the item itself. */
const PRECEDENCE_LABELS: Readonly<Record<DefectPrecedence, string>> = {
  'own-feature-link': 'from its own Feature link',
  'dev-story': 'via its linked story',
  'via-qa-issue': 'via the QA issue and its story',
  'direct-feature': 'linked directly to the Feature',
};

/**
 * Describes how an item reached its Feature, or nothing when it said so itself.
 *
 * Only shown for the placements somebody might reasonably query. An item carrying its own Feature
 * link needs no explanation, and labelling every row would bury the few that do.
 */
export function describeAttributionRoute(attribution: FeatureAttribution | undefined): string {
  if (attribution === undefined || attribution.featureKey === null || attribution.viaPrecedence === null) {
    return '';
  }
  return PRECEDENCE_LABELS[attribution.viaPrecedence];
}
