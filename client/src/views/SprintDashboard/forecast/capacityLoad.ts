// capacityLoad.ts — Does the work committed to this window fit the people holding it?
//
// One shape answers two questions — can dev build it by code freeze, and can test absorb it in the
// two weeks after — because a single computation is the only way those two can never disagree about
// what "over capacity" means.
//
// Two rules here would flatter every release if they were relaxed, and both are easy to relax by
// accident:
//
//   • Only people who actually HOLD some of this work count as capacity. Counting the whole roster
//     lets a release fit on the strength of people who are not working on it.
//   • Unassigned work is named, never pooled. Spreading it across an average makes the finding —
//     that nobody owns this — disappear into the very number meant to surface it.

import type {
  CapacityAssessment,
  CapacityItem,
  CapacityPerson,
  ForecastWindow,
  PersonLoad,
} from './forecastTypes.ts';

/** Which population a window is being assessed against. */
export interface CapacityOptions {
  roleFilter: 'dev' | 'test' | 'all';
  /** Issues whose fix version carries no date, passed through so a total can admit what it missed. */
  undatedIssueCount: number;
}

/** Whether an item belongs to the population being assessed. */
function isItemInRole(item: CapacityItem, roleFilter: CapacityOptions['roleFilter']): boolean {
  if (roleFilter === 'all') {
    return true;
  }
  if (roleFilter === 'test') {
    return item.chainRole === 'sl';
  }
  // Unclassified work counts as dev, matching how the chain schedules it — otherwise work nobody
  // labelled would vanish from both assessments.
  return item.chainRole === 'dev' || item.chainRole === 'unclassified';
}

/** Whether a person belongs to the population being assessed. */
function isPersonInRole(person: CapacityPerson, roleFilter: CapacityOptions['roleFilter']): boolean {
  if (roleFilter === 'all') {
    return true;
  }
  return roleFilter === 'test' ? person.canInternalTest : person.canDevelop;
}

/** Somebody the work names but the roster does not — reported rather than quietly dropped. */
function buildUnrosteredPerson(personKey: string): CapacityPerson {
  return {
    personKey,
    displayName: personKey,
    isOnRoster: false,
    canDevelop: true,
    canInternalTest: true,
  };
}

/** Builds one person's load from the items they hold. */
function buildPersonLoad(
  person: CapacityPerson,
  heldItems: readonly CapacityItem[],
  availableWorkingDays: number,
): PersonLoad {
  const inScopeItems = heldItems.filter((item) => item.isInScope);
  const sumDays = (items: readonly CapacityItem[]): number =>
    items.reduce((runningTotal, item) => runningTotal + (item.remainingWorkingDays ?? 0), 0);

  const inScopeWorkingDays = sumDays(inScopeItems);

  return {
    personKey: person.personKey,
    displayName: person.displayName,
    isOnRoster: person.isOnRoster,
    inScopeWorkingDays,
    // ALL their open work, not just this release's — so nobody looks free while drowning elsewhere.
    totalAssignedWorkingDays: sumDays(heldItems),
    availableWorkingDays,
    overCapacityWorkingDays: Math.max(0, inScopeWorkingDays - availableWorkingDays),
    isOverCapacity: inScopeWorkingDays > availableWorkingDays,
    unsizedIssueCount: inScopeItems.filter((item) => !item.isEstimated).length,
    inScopeIssueKeys: inScopeItems.map((item) => item.issueKey),
  };
}

/**
 * Works out whether one window's committed work fits the people holding it.
 *
 * `window.hasPassed` yields zero available days for everyone, so anybody still holding work is over
 * capacity. Reporting a negative window instead would let a caller subtract its way to runway that
 * does not exist.
 */
export function assessCapacity(
  items: readonly CapacityItem[],
  people: readonly CapacityPerson[],
  window: ForecastWindow,
  options: CapacityOptions,
): CapacityAssessment {
  const relevantItems = items.filter((item) => isItemInRole(item, options.roleFilter));
  const availableWorkingDays = window.hasPassed ? 0 : window.workingDayCount;

  const itemsByPersonKey = new Map<string, CapacityItem[]>();
  const unassignedItems: CapacityItem[] = [];
  relevantItems.forEach((item) => {
    if (item.assigneePersonKey === null) {
      unassignedItems.push(item);
      return;
    }
    const held = itemsByPersonKey.get(item.assigneePersonKey) ?? [];
    held.push(item);
    itemsByPersonKey.set(item.assigneePersonKey, held);
  });

  const peopleByKey = new Map(people.filter((person) => isPersonInRole(person, options.roleFilter))
    .map((person) => [person.personKey, person]));

  // Rostered people holding NONE of this work still get a row, with an empty load.
  //
  // They were previously absent, and they are the answer to the question a capacity report is most
  // often opened to ask: who has room. Somebody with nothing assigned is the MOST available person
  // on the team and was the one person the report could not show.
  //
  // Every total is untouched by this, structurally rather than by care: `totalRemainingWorkingDays`
  // sums their zero, and `totalAvailableWorkingDays` already filters to people holding in-scope
  // work — so an idle member still does not count as release capacity.
  const idlePersonKeys = [...peopleByKey.keys()].filter((personKey) => !itemsByPersonKey.has(personKey));

  const personLoads = [...itemsByPersonKey.entries()]
    // A person the roster has never heard of still gets a row: work assigned to somebody nobody
    // rostered is exactly the sort of thing a capacity report exists to surface.
    .filter(([personKey]) => peopleByKey.has(personKey) || options.roleFilter === 'all')
    .map(([personKey, heldItems]) => buildPersonLoad(
      peopleByKey.get(personKey) ?? buildUnrosteredPerson(personKey),
      heldItems,
      availableWorkingDays,
    ))
    .concat(idlePersonKeys.map((personKey) => buildPersonLoad(
      peopleByKey.get(personKey) as CapacityPerson,
      [],
      availableWorkingDays,
    )))
    .sort((left, right) => right.overCapacityWorkingDays - left.overCapacityWorkingDays
      || left.displayName.localeCompare(right.displayName));

  const unassignedWorkingDays = unassignedItems
    .reduce((runningTotal, item) => runningTotal + (item.remainingWorkingDays ?? 0), 0);
  const totalRemainingWorkingDays = personLoads
    .reduce((runningTotal, load) => runningTotal + load.inScopeWorkingDays, unassignedWorkingDays);
  // Only people who hold some of this work. An idle roster member is not release capacity.
  const totalAvailableWorkingDays = personLoads
    .filter((load) => load.inScopeIssueKeys.length > 0)
    .reduce((runningTotal, load) => runningTotal + load.availableWorkingDays, 0);
  const shortfallWorkingDays = Math.max(0, totalRemainingWorkingDays - totalAvailableWorkingDays);

  return {
    window,
    personLoads,
    unassignedWorkingDays,
    unassignedIssueKeys: unassignedItems.map((item) => item.issueKey),
    totalRemainingWorkingDays,
    totalAvailableWorkingDays,
    shortfallWorkingDays,
    shouldRemoveScope: shortfallWorkingDays > 0,
    unsizedIssueCount: relevantItems.filter((item) => item.isInScope && !item.isEstimated).length,
    undatedIssueCount: options.undatedIssueCount,
  };
}
