// featureScope.ts — Narrows the board to the Features a team actually tracks.
//
// A team board carries work linked to Features across many portfolio projects, and lanes for
// Features nobody on the team owns are noise. The project list is authoritative: if a Feature is
// not in it, its work does not become a lane.
//
// How an issue reached its Feature still matters, but it decides how the exclusion is REPORTED
// rather than whether it applies:
//
//   • Reached by the Feature Link FIELD — a deliberate, structural statement. Out of the team's
//     projects that is worth knowing about, so the Features are NAMED on the board even while their
//     work is hidden. It can be shown as lanes with a toggle.
//   • Reached only by a plain "relates to" issue link — an inference the board made. Out of the
//     team's projects that is just noise; counted, and shown only if asked for.
//
// An earlier version treated a Feature Link as an override that kept the work regardless of project.
// That made the filter useless in practice, because nearly all real work IS Feature-Linked — the
// override swallowed the whole filter and "Apply" appeared to do nothing.

import type { DisciplineProjects, RollUpRoute, RollupBoardItem } from './rollupBoardTypes.ts';

/** Which Features a team tracks, and which out-of-project ones it still wants to see. */
export interface FeatureScopeSettings {
  /** Jira project keys whose Features this team owns. Empty means "no filtering at all". */
  featureProjectKeys: readonly string[];
  /** Show out-of-project Features that ARE linked by the Feature Link field. Off by default. */
  shouldIncludeOutOfProjectFeatureLinks: boolean;
  /** Show out-of-project Features reached only by an issue link. Off by default. */
  shouldIncludeIssueLinkedFeatures: boolean;
  /**
   * A previous PI whose unfinished Features should also be pulled onto this board, with their work.
   *
   * Empty means the board shows only its own PI. A carried-over Feature keeps its original PI in Jira
   * — rewriting it would falsify what the ART committed last PI — so it can only be reached by asking
   * for it deliberately.
   */
  carryOverPiValue: string;
  /**
   * How carry-over is decided.
   *
   * 'pi-review' reads the Carry-Over ticks the team already maintains — exact, and impossible to
   * disagree with the PI Review page. 'unfinished-in-pi' derives it from status, which is close but
   * also catches Features that were abandoned rather than carried.
   */
  carryOverSource: 'none' | 'pi-review' | 'unfinished-in-pi';
  /**
   * A Jira label marking the Features this team owns. Empty means fall back to inference.
   *
   * Ownership is otherwise GUESSED — assigned to the PO, reported by the PO, or having a child in the
   * team's project — because nothing in Jira records it. Those guesses hold while a team owns whole
   * projects and break as soon as two teams share one: adding DASP to reach six Features drags in
   * every other team's DASP work too. A label is the missing fact, recorded once, in the one place
   * both teams can see it.
   */
  teamFeatureLabel: string;
  /**
   * Labels marking Features that should never get a lane of their own.
   *
   * Separate from the team label because it answers a different question. The team label says WHOSE a
   * Feature is; this says whether a Feature is the kind that gets broken down at all. Placeholder and
   * rolling Features — a defect bucket, a standing enhancement log — are genuinely the team's and
   * genuinely in the PI, so no ownership rule can tell them apart from real work. Only a second,
   * deliberate mark can. Suppresses EMPTY lanes only; a Feature with work under it keeps its lane.
   */
  excludedFeatureLabels: readonly string[];
  /**
   * The other disciplines that clone this team's Features — QE, BT, and any others.
   *
   * Empty means the sub-lane feature is off entirely. This is the single thing that separates
   * "another discipline's copy" from "our own second Feature", so it is explicit rather than inferred
   * from a project naming convention.
   */
  disciplineProjects: readonly DisciplineProjects[];
}

/** What survived the scope, and what did not — with enough detail for the board to explain itself. */
export interface FeatureScopeResult {
  items: RollupBoardItem[];
  hiddenIssueCount: number;
  /**
   * The issues actually held back, named rather than merely counted.
   *
   * A count sends somebody hunting for which issue vanished; a key can be pasted into Jira. This is
   * the difference between "9 issues are hidden" and knowing ENCUC-2070 is one of them.
   */
  hiddenIssueKeys: string[];
  /**
   * Out-of-project Features reached by the Feature Link field, named whether or not their work is
   * shown. This is the signal worth surfacing: a Feature Link crossing projects is usually a mistake.
   */
  featureLinkedOutOfProjectKeys: string[];
  /** Out-of-project Features reached only by an issue link. */
  issueLinkedOutOfProjectKeys: string[];
}

/** The project key part of a Jira issue key, upper-cased for comparison. */
function readProjectKey(issueKey: string): string {
  const [projectKey = ''] = issueKey.split('-', 1);
  return projectKey.trim().toUpperCase();
}

/**
 * True when the roll-up rests on the Feature Link field rather than on an inference.
 *
 * The test is the LAST hop into the Feature. A defect attached to a Story by "relates to" still
 * counts as Feature-Linked, because the Story itself carries a real Feature Link — the defect is
 * simply hanging off properly-linked work. Only a defect wired straight to a Feature by an issue
 * link has nothing structural behind it.
 */
export function isAuthoritativeFeatureRoute(route: RollUpRoute): boolean {
  if (route.featureKey === null || route.steps.length === 0) {
    return false;
  }
  const finalStep = route.steps[route.steps.length - 1];
  return finalStep.kind === 'featureLink' || finalStep.kind === 'parent';
}

/**
 * Filters board items to the Features this team tracks.
 *
 * Work with no Feature at all is never touched — that is a hygiene problem the "No Feature" lane
 * exists to surface, and it has nothing to do with other people's projects.
 */
export function applyFeatureScope(
  items: readonly RollupBoardItem[],
  settings: FeatureScopeSettings,
): FeatureScopeResult {
  const trackedProjectKeys = new Set(
    settings.featureProjectKeys.map((projectKey) => projectKey.trim().toUpperCase()).filter(Boolean),
  );

  // Nothing configured means the board behaves exactly as it did before scoping existed.
  if (trackedProjectKeys.size === 0) {
    return {
      items: [...items],
      hiddenIssueCount: 0,
      hiddenIssueKeys: [],
      featureLinkedOutOfProjectKeys: [],
      issueLinkedOutOfProjectKeys: [],
    };
  }

  const keptItems: RollupBoardItem[] = [];
  const hiddenIssueKeys: string[] = [];
  const featureLinkedOutOfProjectKeys = new Set<string>();
  const issueLinkedOutOfProjectKeys = new Set<string>();

  for (const item of items) {
    if (item.featureKey === null) {
      keptItems.push(item);
      continue;
    }
    if (trackedProjectKeys.has(readProjectKey(item.featureKey))) {
      keptItems.push(item);
      continue;
    }

    // Outside the team's projects. It is recorded either way — the route decides which bucket it is
    // reported in, and which toggle governs whether its work becomes lanes.
    const isFeatureLinked = isAuthoritativeFeatureRoute(item.route);
    if (isFeatureLinked) {
      featureLinkedOutOfProjectKeys.add(item.featureKey);
    } else {
      issueLinkedOutOfProjectKeys.add(item.featureKey);
    }

    const isAllowedIn = isFeatureLinked
      ? settings.shouldIncludeOutOfProjectFeatureLinks
      : settings.shouldIncludeIssueLinkedFeatures;
    if (isAllowedIn) {
      keptItems.push(item);
    } else {
      hiddenIssueKeys.push(item.key);
    }
  }

  return {
    items: keptItems,
    hiddenIssueCount: items.length - keptItems.length,
    hiddenIssueKeys,
    featureLinkedOutOfProjectKeys: [...featureLinkedOutOfProjectKeys],
    issueLinkedOutOfProjectKeys: [...issueLinkedOutOfProjectKeys],
  };
}
