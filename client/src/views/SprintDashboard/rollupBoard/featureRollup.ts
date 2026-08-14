// featureRollup.ts — Turns raw Jira issues into board items that know what they deliver.
//
// This is where "which Feature is this for?" is answered for every issue on the board. Stories and
// tasks resolve in one hop through the shared blueprint resolution; sub-tasks inherit their parent's
// answer; defects go through their own precedence chain. Whatever the route, it is recorded on the
// item so the card can state it — the board's promise is that a reader never has to infer parentage.

import { extractFeatureKeyFromIssueFields } from '../../../utils/featureLink.ts';
import { chooseChecklistFieldByValue, parseChecklistItems, summarizeChecklist } from './checklistItems.ts';
import { detectImpedimentReasons } from '../../ArtView/hooks/artHelpers.ts';
import { readIsFlagSet } from './issueFlagWrite.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { resolveDefectRollup } from './defectRollup.ts';
import {
  type IssueTypeBucket,
  type RollUpNote,
  type RollUpRoute,
  type RollupBoardIssueSet,
  type RollupBoardItem,
  type RollupBoardScope,
} from './rollupBoardTypes.ts';

/** Issue type names this instance uses for defects. It is "Defect" here, not "Bug". */
const DEFECT_ISSUE_TYPE_NAMES = new Set(['defect', 'bug']);

/** Issue type names that carry delivery work directly. */
const STORY_ISSUE_TYPE_NAMES = new Set(['story', 'task']);

/** How the caller decides which column an item's own state belongs to. */
export interface ColumnPlacement {
  /**
   * Which Features this team tracks, so a defect is never routed to a lane the board will then hide.
   *
   * Optional: absent means treat every Feature as tracked, which is how the board behaved before
   * project scoping existed.
   */
  isFeatureInScope?: (featureKey: string) => boolean;
  resolveColumnId: (statusName: string, subStatusValue: string | null) => string;
}

/** An empty route, for an issue nothing connects to a Feature. */
function buildUnattributedRoute(notes: RollUpNote[] = []): RollUpRoute {
  return { steps: [], featureKey: null, precedenceRank: null, unchosenCandidates: [], notes };
}

/** Normalised issue type name, or '' when absent. */
function readIssueTypeName(issue: JiraIssue): string {
  return ((issue.fields as { issuetype?: { name?: string } }).issuetype?.name ?? '').trim().toLowerCase();
}

/**
 * True when this issue should be ROUTED through its parent — by Jira's flag, or by carrying one.
 *
 * Left as flag-or-parent deliberately. Routing asks "where does this issue's Feature come from?", and
 * an issue with a parent genuinely does inherit it from there whatever its type is called. That is a
 * different question from what COLOUR the card wears — see readTypeBucket, where the same test was
 * wrong for exactly that reason.
 */
function isSubtaskIssue(issue: JiraIssue): boolean {
  const issueFields = issue.fields as { issuetype?: { subtask?: boolean }; parent?: { key?: string } | null };
  return issueFields.issuetype?.subtask === true || Boolean(issueFields.parent?.key);
}

/** True when Jira itself marks this issue as a sub-task. The only unambiguous answer available. */
function isMarkedSubtask(issue: JiraIssue): boolean {
  return (issue.fields as { issuetype?: { subtask?: boolean } }).issuetype?.subtask === true;
}

/** True when the issue carries a parent — suggestive of a sub-task, but far from proof of one. */
function hasParentIssue(issue: JiraIssue): boolean {
  return Boolean((issue.fields as { parent?: { key?: string } | null }).parent?.key);
}

/**
 * The visual family this issue's card belongs to. 'other' is a real answer, not a dumping ground.
 *
 * The ORDER matters, and it used to be wrong. "Has a parent" was tested first, so any issue carrying
 * one was coloured as a sub-task whatever its own type said. That is a live hazard rather than a
 * theoretical one: newer Jira populates `parent` for a Story under a Feature, not only for a sub-task
 * under a Story, so one instance change would have turned every Story on the board cyan at once.
 *
 * The issue's own TYPE is asked first now, and believed. The parent is consulted only where the type
 * name means nothing to us — there, "it has a parent, so it is probably a sub-task" is a reasonable
 * guess rather than a contradiction of what Jira plainly said.
 */
function readTypeBucket(issue: JiraIssue): IssueTypeBucket {
  if (isMarkedSubtask(issue)) return 'subtask';

  const typeName = readIssueTypeName(issue);
  if (DEFECT_ISSUE_TYPE_NAMES.has(typeName)) return 'defect';
  if (STORY_ISSUE_TYPE_NAMES.has(typeName)) return 'story';

  return hasParentIssue(issue) ? 'subtask' : 'other';
}

/**
 * Reads a story-point value from whichever candidate field this project uses.
 *
 * On this Jira instance story points are a DROPDOWN, so the value arrives as an option object rather
 * than a number. Returning null for "no estimate" matters: zero would claim the work was estimated
 * at nothing, which is a different and much more misleading statement.
 */
function readStoryPoints(issue: JiraIssue, storyPointsFieldIds: readonly string[]): number | null {
  const issueFields = issue.fields as unknown as Record<string, unknown>;
  for (const fieldId of storyPointsFieldIds) {
    const rawValue = issueFields[fieldId];
    if (rawValue === null || rawValue === undefined) continue;
    if (typeof rawValue === 'number') return rawValue;
    if (typeof rawValue === 'string' && rawValue.trim() !== '') {
      const parsedValue = Number(rawValue);
      if (!Number.isNaN(parsedValue)) return parsedValue;
    }
    if (typeof rawValue === 'object') {
      const optionValue = (rawValue as { value?: string }).value;
      const parsedValue = Number(optionValue);
      if (optionValue !== undefined && !Number.isNaN(parsedValue)) return parsedValue;
    }
  }
  return null;
}

/** Reads the sub-status value, tolerating both the option shape and a bare string. */
function readSubStatusValue(issue: JiraIssue, subStatusFieldId: string): string | null {
  if (!subStatusFieldId) return null;
  const rawValue = (issue.fields as unknown as Record<string, unknown>)[subStatusFieldId];
  if (typeof rawValue === 'string') return rawValue.trim() || null;
  if (rawValue && typeof rawValue === 'object') {
    const optionValue = (rawValue as { value?: string; name?: string });
    return optionValue.value ?? optionValue.name ?? null;
  }
  return null;
}

/** Resolves the Feature for a sub-task by asking its parent, when the parent is on this board. */
function resolveSubtaskRoute(
  subtask: JiraIssue,
  index: ReadonlyMap<string, JiraIssue>,
  featureLinkFieldId: string,
): RollUpRoute {
  const parentKey = (subtask.fields as { parent?: { key?: string } | null }).parent?.key ?? null;
  if (!parentKey) return buildUnattributedRoute();

  const parentIssue = index.get(parentKey);
  if (!parentIssue) {
    // The parent is real but not in this board's scope. The sub-task still groups under it — the
    // container header names it and marks it out of scope — so the structure stays intact.
    return buildUnattributedRoute(['parent-out-of-scope']);
  }

  const parentFeatureKey = extractFeatureKeyFromIssueFields(
    parentIssue.fields as unknown as Record<string, unknown>,
    featureLinkFieldId,
  );
  if (!parentFeatureKey) return buildUnattributedRoute();

  return {
    steps: [
      { kind: 'parent', toKey: parentKey },
      { kind: 'featureLink', fieldId: featureLinkFieldId, toKey: parentFeatureKey },
    ],
    featureKey: parentFeatureKey,
    precedenceRank: null,
    unchosenCandidates: [],
    notes: [],
  };
}

/** Resolves the Feature for an ordinary issue in a single hop. */
function resolveDirectRoute(issue: JiraIssue, featureLinkFieldId: string): RollUpRoute {
  const featureKey = extractFeatureKeyFromIssueFields(
    issue.fields as unknown as Record<string, unknown>,
    featureLinkFieldId,
  );
  if (!featureKey) return buildUnattributedRoute();

  const parentKey = (issue.fields as { parent?: { key?: string } | null }).parent?.key ?? null;
  const routeStep = parentKey === featureKey
    ? { kind: 'parent' as const, toKey: featureKey }
    : { kind: 'featureLink' as const, fieldId: featureLinkFieldId, toKey: featureKey };

  return { steps: [routeStep], featureKey, precedenceRank: null, unchosenCandidates: [], notes: [] };
}

/** Picks the right resolution strategy for one issue. */
/** True when a Feature has already shipped, read from its status CATEGORY not its status name. */
function buildFinishedFeatureTest(
  featureIssues: ReadonlyMap<string, JiraIssue>,
): (featureKey: string) => boolean {
  return (featureKey: string): boolean => {
    const featureIssue = featureIssues.get(featureKey);
    if (!featureIssue) return false;
    const status = (featureIssue.fields as { status?: { statusCategory?: { key?: string } } }).status;
    return String(status?.statusCategory?.key ?? '').toLowerCase() === 'done';
  };
}

function resolveRouteForIssue(
  issue: JiraIssue,
  index: ReadonlyMap<string, JiraIssue>,
  featureLinkFieldId: string,
  isFeatureFinished: (featureKey: string) => boolean,
  isFeatureInScope: (featureKey: string) => boolean,
): RollUpRoute {
  if (isSubtaskIssue(issue)) {
    return resolveSubtaskRoute(issue, index, featureLinkFieldId);
  }
  if (DEFECT_ISSUE_TYPE_NAMES.has(readIssueTypeName(issue))) {
    return resolveDefectRollup(issue, index, featureLinkFieldId, isFeatureFinished, isFeatureInScope);
  }
  return resolveDirectRoute(issue, featureLinkFieldId);
}

/** Which issue this one groups under inside a column, if any. */
/** The relationship a nested card shows: it is contained within the card above it. */
const CONTAINMENT_PHRASE = 'contained within';

/** Loosens a link phrase so "is contained within" and "Contained within" compare equal. */
function normalizeLinkPhrase(linkPhrase: string): string {
  return String(linkPhrase || '').toLowerCase().replace(/^is\s+/, '').replace(/\s+/g, ' ').trim();
}

/**
 * The keys of issues CONTAINED WITHIN these ones, read from the container's own links.
 *
 * The board scopes by PI, and a contained child often has none of its own — the SL story promoted
 * from a sub-task inherits nothing, so it was dropped before nesting was ever considered and the
 * parent appeared childless. But containment IS the reason it belongs on the board: whatever its own
 * PI says, it is part of the work of a card that is already here.
 *
 * Read from the CONTAINER's side because that is the side we have. Every link is visible from both
 * ends; the phrase that would describe the other end is the opposite of the one describing this issue.
 */
export function collectContainedChildKeys(issues: readonly JiraIssue[]): string[] {
  const childKeys = new Set<string>();

  for (const issue of issues) {
    const issueLinks = (issue.fields as { issuelinks?: unknown[] }).issuelinks ?? [];

    for (const rawLink of issueLinks) {
      const issueLink = rawLink as {
        type?: { inward?: string; outward?: string };
        inwardIssue?: { key?: string };
        outwardIssue?: { key?: string };
      };

      // The phrase describing the OTHER end is the one this issue does not read with.
      const otherEndKey = issueLink.inwardIssue?.key ?? issueLink.outwardIssue?.key ?? '';
      const phraseForOtherEnd = issueLink.inwardIssue?.key
        ? issueLink.type?.outward ?? ''
        : issueLink.type?.inward ?? '';

      if (normalizeLinkPhrase(phraseForOtherEnd) === CONTAINMENT_PHRASE && otherEndKey !== '') {
        childKeys.add(String(otherEndKey));
      }
    }
  }

  return [...childKeys];
}

/**
 * The issue this one is explicitly contained in, read from its own issue links.
 *
 * A containment link is how work gets nested without being a sub-task — dragged onto another card, or
 * linked by hand in Jira. Reading it here means the board draws the same parent container it already
 * draws for real sub-tasks, so one visual answers "what is inside what" regardless of how the team
 * happened to express it.
 *
 * Only the side the phrase applies TO counts, or a container would appear to be contained in the
 * thing it holds. Which side that is depends on which end of the link this issue sits on:
 *
 *   • the entry names `inwardIssue`  → this issue is the outward end → the INWARD phrase describes it
 *   • the entry names `outwardIssue` → this issue is the inward end  → the OUTWARD phrase describes it
 *
 * This used to read the inward phrase against the outwardIssue — both halves inverted — which only
 * ever looked right because the WRITER was inverted in the same way. Two bugs cancelling: the board
 * drew correct nesting from links that read backwards in Jira.
 */
function readContainmentParentKey(issue: JiraIssue): string | null {
  const issueLinks = (issue.fields as { issuelinks?: unknown[] }).issuelinks ?? [];

  for (const rawLink of issueLinks) {
    const issueLink = rawLink as {
      type?: { inward?: string; outward?: string };
      inwardIssue?: { key?: string };
      outwardIssue?: { key?: string };
    };

    // Read whichever phrase actually describes THIS issue, and the key at the other end.
    const otherEndKey = issueLink.inwardIssue?.key ?? issueLink.outwardIssue?.key ?? '';
    const phraseForThisIssue = issueLink.inwardIssue?.key
      ? issueLink.type?.inward ?? ''
      : issueLink.type?.outward ?? '';

    if (normalizeLinkPhrase(phraseForThisIssue) === CONTAINMENT_PHRASE && otherEndKey !== '') {
      return String(otherEndKey);
    }
  }
  return null;
}

function readGroupingParentKey(issue: JiraIssue, route: RollUpRoute): string | null {
  const containmentParentKey = readContainmentParentKey(issue);
  if (containmentParentKey) return containmentParentKey;

  if (isSubtaskIssue(issue)) {
    return (issue.fields as { parent?: { key?: string } | null }).parent?.key ?? null;
  }
  // A defect groups under whatever its precedence route decided it was raised against — the first
  // step of that route — so the card sits beside the work it threatens.
  if (route.precedenceRank === 'dev-story' || route.precedenceRank === 'via-qa-issue') {
    const lastDeliveryStep = [...route.steps].reverse().find((step) => step.kind === 'issueLink');
    return lastDeliveryStep && 'toKey' in lastDeliveryStep ? lastDeliveryStep.toKey : null;
  }
  return null;
}

/**
 * Turns every loaded issue into a placed, explained board item.
 *
 * The `resolveColumnId` callback is handed only the item's OWN status and sub-status, which is how
 * the board guarantees that an item's column can never be derived from its parent's or its
 * children's state — the thing that would hide where work actually is.
 */
export function resolveBoardItems(
  issueSet: RollupBoardIssueSet,
  scope: RollupBoardScope,
  placement: ColumnPlacement,
): RollupBoardItem[] {
  const allIssues = [...issueSet.boardIssues, ...issueSet.subtaskIssues];
  const uniqueIssuesByKey = new Map(allIssues.map((issue) => [issue.key, issue]));

  // Route resolution needs to SEE the Features as well as the board's own work: a defect linked
  // straight to a Feature can only be recognised if that Feature is look-up-able. Features are never
  // on a team board, so without this the "direct-feature" precedence rank could never fire at all.
  // This index is for lookup only — the Features themselves are not board items and are not rendered.
  const resolutionIndexByKey = new Map(uniqueIssuesByKey);
  // A defect linked to a shipped Feature is being delivered under whatever it is linked to NOW.
  const isFeatureFinished = buildFinishedFeatureTest(issueSet.featureIssues);
  // Choosing a Feature this team does not track does not move a defect to another lane — the board's
  // project scope removes it from the board altogether. So scope is asked before anything else.
  const isFeatureInScope = placement.isFeatureInScope ?? (() => true);
  for (const [featureKey, featureIssue] of issueSet.featureIssues) {
    if (!resolutionIndexByKey.has(featureKey)) {
      resolutionIndexByKey.set(featureKey, featureIssue);
    }
  }

  return [...uniqueIssuesByKey.values()].map((issue) => {
    const route = resolveRouteForIssue(
      issue, resolutionIndexByKey, scope.featureLinkFieldId, isFeatureFinished, isFeatureInScope,
    );
    const issueFields = issue.fields as unknown as Record<string, unknown>;
    const statusName = ((issueFields.status as { name?: string })?.name ?? '').trim();
    const subStatusValue = readSubStatusValue(issue, scope.subStatusFieldId);
    const assignee = issueFields.assignee as { accountId?: string; name?: string; key?: string; displayName?: string } | null;

    // Read once here so the badge and the nested cards come from the same parse. The field is chosen
    // per issue by which candidate actually yields items — an instance can hold the same checklist in
    // three fields, and only one of them in a form anything can read.
    const candidateFieldIds = scope.checklistFieldIds
      ?? (scope.checklistFieldId ? [scope.checklistFieldId] : []);
    const readableFieldId = chooseChecklistFieldByValue(
      candidateFieldIds, issueFields as Record<string, unknown>,
    );
    // The flag is read from the field this instance actually keeps it in; the shared detector's own
    // check is dropped because it hard-codes the default id, which is wrong here. Its OTHER signals —
    // a blocking link, a blocking status — are instance-independent and kept exactly as they are.
    const isFlagSet = readIsFlagSet(
      issue.fields as unknown as Record<string, unknown>,
      scope.flagFieldId ?? '',
    );
    const impedimentReasons: string[] = detectImpedimentReasons(issue).filter((reason) => reason !== 'Flagged');
    if (isFlagSet) impedimentReasons.unshift('Flagged');
    const checklistItems = readableFieldId === null
      ? []
      : parseChecklistItems((issueFields as Record<string, unknown>)[readableFieldId]);

    return {
      issue,
      key: issue.key,
      summary: String((issueFields.summary as string) ?? ''),
      typeBucket: readTypeBucket(issue),
      typeName: (issueFields.issuetype as { name?: string })?.name ?? 'Issue',
      parentKey: readGroupingParentKey(issue, route),
      route,
      featureKey: route.featureKey,
      columnId: placement.resolveColumnId(statusName, subStatusValue),
      statusName,
      subStatusValue,
      // accountId is Jira CLOUD only. This instance is Data Center, where a user is identified by
      // `name`/`key` — reading accountId alone left every issue looking unassigned, so the assignee
      // filter had nobody to offer.
      assigneeAccountId: assignee?.accountId ?? assignee?.name ?? assignee?.key ?? null,
      assigneeDisplayName: assignee?.displayName ?? null,
      fixVersionNames: ((issueFields.fixVersions as Array<{ name?: string }>) ?? [])
        .map((fixVersion) => fixVersion.name ?? '')
        .filter(Boolean),
      storyPoints: readStoryPoints(issue, scope.storyPointsFieldIds),
      // Checklist data is a paid Jira app's field this instance may not expose at all. Absent means
      // absent — never a zero-of-zero indicator asserting a checklist that does not exist.
      checklistItems,
      // Derived from the items themselves rather than counted separately, so the badge and the cards
      // beneath it can never disagree.
      checklistCompletion: summarizeChecklist(checklistItems),
      // The SAME detection the lane header uses, so a Feature and its children cannot disagree. The
      // field it reads is already fetched for every issue, so this costs no extra request.
      //
      // Split in two on purpose. `isFlagged` is the FLAG FIELD alone, because that is what the card's
      // menu can write — it was every impediment for one release, so a card blocked by a LINK claimed
      // to be flagged and then offered to remove a flag it never had, which removed nothing.
      isFlagged: isFlagSet,
      impedimentReasons,
    };
  });
}
