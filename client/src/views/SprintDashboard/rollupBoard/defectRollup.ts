// defectRollup.ts — Decides which Feature a defect belongs to, and can always explain why.
//
// A defect found in testing might be linked to the development Story, to the QA issue, or straight
// to the Feature — the team has no single convention, and cannot adopt one. Rather than demand
// consistency the board cannot enforce, this module applies a fixed precedence and then SHOWS the
// route it took, so a reader never has to guess whether a defect was placed correctly.
//
// featureLink.ts already resolves one hop from an issue to its Feature. This module exists because a
// defect's route can be a chain, and nothing else walks chains.

import { extractFeatureKeyFromIssueFields } from '../../../utils/featureLink.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import type {
  DefectPrecedence,
  RollUpCandidate,
  RollUpNote,
  RollUpRoute,
  RollUpRouteStep,
} from './rollupBoardTypes.ts';

/** Issue type names that count as delivery work a defect can be raised against. */
const DELIVERY_ISSUE_TYPE_NAMES = new Set(['story', 'task']);

/** Issue type names that are the business outcome itself. */
const FEATURE_ISSUE_TYPE_NAMES = new Set(['feature', 'epic']);

/**
 * How many issues the walk may pass through before giving up.
 *
 * One. A placement a reader cannot restate in a sentence ("this defect sits here because it was
 * raised on QA-1, which tests DEV-1") is no better than an unexplained one, so the walk is capped
 * rather than left open-ended.
 */
const MAX_INTERMEDIATE_HOPS = 1;

/** One linked issue, as the walk sees it. */
interface LinkedIssueReference {
  key: string;
  linkTypeName: string;
}

/** Reads the issues linked to this one, in either direction, with their link type named. */
function readLinkedIssueReferences(issue: JiraIssue): LinkedIssueReference[] {
  const issueLinks = (issue.fields as { issuelinks?: unknown[] }).issuelinks ?? [];
  const references: LinkedIssueReference[] = [];

  for (const rawLink of issueLinks) {
    const issueLink = rawLink as {
      type?: { name?: string };
      inwardIssue?: { key?: string };
      outwardIssue?: { key?: string };
    };
    const linkTypeName = issueLink.type?.name ?? 'Link';
    const linkedKey = issueLink.outwardIssue?.key ?? issueLink.inwardIssue?.key;
    if (linkedKey) {
      references.push({ key: linkedKey, linkTypeName });
    }
  }

  // Sorted so two candidates of equal rank resolve the same way every time, whatever order Jira
  // happened to return the links in.
  return references.sort((leftReference, rightReference) => leftReference.key.localeCompare(rightReference.key));
}

/** Normalised issue type name, or '' when the issue does not state one. */
function readIssueTypeName(issue: JiraIssue): string {
  return ((issue.fields as { issuetype?: { name?: string } }).issuetype?.name ?? '').trim().toLowerCase();
}

/** True when this issue is delivery work a defect could have been raised against. */
function isDeliveryIssue(issue: JiraIssue): boolean {
  return DELIVERY_ISSUE_TYPE_NAMES.has(readIssueTypeName(issue));
}

/** True when this issue is itself the business outcome. */
function isFeatureIssue(issue: JiraIssue): boolean {
  return FEATURE_ISSUE_TYPE_NAMES.has(readIssueTypeName(issue));
}

/** Resolves an issue's own Feature in a single hop, reusing the shared blueprint resolution. */
function readFeatureKeyOf(issue: JiraIssue, featureLinkFieldId: string): string | null {
  return extractFeatureKeyFromIssueFields(
    issue.fields as unknown as Record<string, unknown>,
    featureLinkFieldId,
  );
}

/** One candidate route found during the walk, before precedence picks a winner. */
interface RankedCandidate {
  rank: DefectPrecedence;
  featureKey: string;
  steps: RollUpRouteStep[];
  candidate: RollUpCandidate;
}

/** Ranks precedence so the strongest route wins regardless of discovery order. */
const PRECEDENCE_ORDER: DefectPrecedence[] = ['dev-story', 'via-qa-issue', 'direct-feature'];

/** Collects every route this defect could take, one intermediate hop at most. */
function collectRankedCandidates(
  defect: JiraIssue,
  index: ReadonlyMap<string, JiraIssue>,
  featureLinkFieldId: string,
  notes: RollUpNote[],
): { ranked: RankedCandidate[]; examined: RollUpCandidate[] } {
  const ranked: RankedCandidate[] = [];
  const examined: RollUpCandidate[] = [];
  const visitedKeys = new Set<string>([defect.key]);

  for (const linkReference of readLinkedIssueReferences(defect)) {
    const linkedIssue = index.get(linkReference.key);
    if (!linkedIssue) continue;

    const linkStep: RollUpRouteStep = { kind: 'issueLink', linkTypeName: linkReference.linkTypeName, toKey: linkedIssue.key };
    const linkedFeatureKey = readFeatureKeyOf(linkedIssue, featureLinkFieldId);
    examined.push({ toKey: linkedIssue.key, viaLinkTypeName: linkReference.linkTypeName, resolvedFeatureKey: linkedFeatureKey });

    if (isFeatureIssue(linkedIssue)) {
      ranked.push({
        rank: 'direct-feature',
        featureKey: linkedIssue.key,
        steps: [linkStep],
        candidate: examined[examined.length - 1],
      });
      continue;
    }
    if (isDeliveryIssue(linkedIssue) && linkedFeatureKey) {
      ranked.push({
        rank: 'dev-story',
        featureKey: linkedFeatureKey,
        steps: [linkStep, { kind: 'featureLink', fieldId: featureLinkFieldId, toKey: linkedFeatureKey }],
        candidate: examined[examined.length - 1],
      });
      continue;
    }

    visitedKeys.add(linkedIssue.key);
    ranked.push(...walkIntermediate(linkedIssue, linkStep, index, featureLinkFieldId, visitedKeys, notes, examined));
  }

  return { ranked, examined };
}

/** Follows one further hop from an intermediate issue (typically the QA issue). */
function walkIntermediate(
  intermediateIssue: JiraIssue,
  linkStep: RollUpRouteStep,
  index: ReadonlyMap<string, JiraIssue>,
  featureLinkFieldId: string,
  visitedKeys: Set<string>,
  notes: RollUpNote[],
  examined: RollUpCandidate[],
): RankedCandidate[] {
  const ranked: RankedCandidate[] = [];

  for (const onwardReference of readLinkedIssueReferences(intermediateIssue).slice(0, undefined)) {
    if (visitedKeys.has(onwardReference.key)) {
      if (!notes.includes('link-loop-detected')) notes.push('link-loop-detected');
      continue;
    }
    const onwardIssue = index.get(onwardReference.key);
    if (!onwardIssue) continue;

    const onwardFeatureKey = readFeatureKeyOf(onwardIssue, featureLinkFieldId);
    if (!isDeliveryIssue(onwardIssue) || !onwardFeatureKey) continue;

    const candidate: RollUpCandidate = {
      toKey: onwardIssue.key,
      viaLinkTypeName: onwardReference.linkTypeName,
      resolvedFeatureKey: onwardFeatureKey,
    };
    examined.push(candidate);
    ranked.push({
      rank: 'via-qa-issue',
      featureKey: onwardFeatureKey,
      steps: [
        linkStep,
        { kind: 'issueLink', linkTypeName: onwardReference.linkTypeName, toKey: onwardIssue.key },
        { kind: 'featureLink', fieldId: featureLinkFieldId, toKey: onwardFeatureKey },
      ],
      candidate,
    });
  }

  // MAX_INTERMEDIATE_HOPS is 1, so the walk deliberately stops here rather than recursing.
  void MAX_INTERMEDIATE_HOPS;
  return ranked;
}

/** Picks the strongest-ranked candidate from one set, breaking ties by ascending issue key. */
function selectByPrecedence(ranked: readonly RankedCandidate[]): RankedCandidate | null {
  for (const precedenceRank of PRECEDENCE_ORDER) {
    const candidatesAtRank = ranked
      .filter((rankedCandidate) => rankedCandidate.rank === precedenceRank)
      .sort((leftCandidate, rightCandidate) => leftCandidate.candidate.toKey.localeCompare(rightCandidate.candidate.toKey));
    if (candidatesAtRank.length > 0) {
      return candidatesAtRank[0];
    }
  }
  return null;
}

/** How a candidate's Feature scores, best first. Lower is better. */
type CandidateStanding = 0 | 1 | 2 | 3;

/**
 * Ranks a candidate's Feature by how useful its lane actually is to this team.
 *
 * Two questions, in this order, because they fail differently:
 *
 *   Is the Feature one this team tracks?  A route to another team's Feature is hidden by the board's
 *   project scope, so choosing it does not move the defect to a different lane — it removes the defect
 *   from the board entirely. A defect this team is working on must never disappear because one of its
 *   many QA links happened to reach somebody else's Feature.
 *
 *   Has the Feature shipped?  A defect found while testing something that has since shipped is being
 *   delivered under whatever it is linked to now, so a live Feature beats a finished one.
 *
 * In scope beats out of scope even when the out-of-scope Feature is the livelier of the two: a lane
 * the viewer can see is worth more than a lane they cannot.
 */
function scoreCandidate(
  featureKey: string,
  isFeatureInScope: (featureKey: string) => boolean,
  isFeatureFinished: (featureKey: string) => boolean,
): CandidateStanding {
  const inScope = isFeatureInScope(featureKey);
  const finished = isFeatureFinished(featureKey);
  if (inScope && !finished) return 0;
  if (inScope) return 1;
  return finished ? 3 : 2;
}

/**
 * Picks the winning candidate: best-standing Feature first, then the precedence chain within it.
 *
 * Precedence still answers "how was this defect linked" — it just no longer gets to choose a lane the
 * team cannot see, or one that shipped two PIs ago, when a better lane is available.
 */
function selectWinningCandidate(
  ranked: readonly RankedCandidate[],
  isFeatureInScope: (featureKey: string) => boolean,
  isFeatureFinished: (featureKey: string) => boolean,
  notes: RollUpNote[],
): RankedCandidate | null {
  const standings: CandidateStanding[] = [0, 1, 2, 3];

  let bestWinner: RankedCandidate | null = null;
  let bestStanding: CandidateStanding | null = null;

  for (const standing of standings) {
    const candidatesAtStanding = ranked.filter(
      (rankedCandidate) =>
        scoreCandidate(rankedCandidate.featureKey, isFeatureInScope, isFeatureFinished) === standing,
    );
    const winnerAtStanding = selectByPrecedence(candidatesAtStanding);
    if (winnerAtStanding !== null) {
      bestWinner = winnerAtStanding;
      bestStanding = standing;
      break;
    }
  }

  if (bestWinner === null) return null;

  // Only worth saying when a stronger-ranked route actually lost, which is the surprising case.
  const strongestOverall = selectByPrecedence(ranked);
  const wasStrongerRoutePassedOver = strongestOverall !== null
    && strongestOverall.candidate.toKey !== bestWinner.candidate.toKey
    && PRECEDENCE_ORDER.indexOf(strongestOverall.rank) < PRECEDENCE_ORDER.indexOf(bestWinner.rank);
  if (wasStrongerRoutePassedOver && bestStanding === 0) {
    notes.push('preferred-unfinished-feature');
  }

  return bestWinner;
}

/**
 * Resolves which Feature a defect delivers against, by fixed precedence:
 * the development Story it is linked to, then the Story behind a linked QA issue, then a directly
 * linked Feature, and otherwise nothing.
 *
 * Every candidate examined and not taken is kept in `unchosenCandidates`, because a defect that also
 * touches a second Feature is a real fact about the work, and dropping it would make the board look
 * tidier than reality.
 */
export function resolveDefectRollup(
  defect: JiraIssue,
  index: ReadonlyMap<string, JiraIssue>,
  featureLinkFieldId: string,
  /** Tells the resolver which Features have already shipped. Absent means treat none as finished. */
  isFeatureFinished: (featureKey: string) => boolean = () => false,
  /** Tells the resolver which Features this team actually tracks. Absent means treat all as tracked. */
  isFeatureInScope: (featureKey: string) => boolean = () => true,
): RollUpRoute {
  const notes: RollUpNote[] = [];
  const { ranked, examined } = collectRankedCandidates(defect, index, featureLinkFieldId, notes);
  const winningCandidate = selectWinningCandidate(ranked, isFeatureInScope, isFeatureFinished, notes);

  const distinctFeatureKeys = new Set(ranked.map((rankedCandidate) => rankedCandidate.featureKey));
  if (distinctFeatureKeys.size > 1) {
    notes.push('multiple-features-touched');
  }

  const unchosenCandidates = examined.filter(
    (examinedCandidate) => examinedCandidate.toKey !== winningCandidate?.candidate.toKey,
  );

  if (!winningCandidate) {
    return { steps: [], featureKey: null, precedenceRank: null, unchosenCandidates, notes };
  }

  return {
    steps: winningCandidate.steps,
    featureKey: winningCandidate.featureKey,
    precedenceRank: winningCandidate.rank,
    unchosenCandidates,
    notes,
  };
}
