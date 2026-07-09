// reallocationModel.ts — Pure assembly of one target sprint's work for the re-allocation planner.
//
// Given the canvas nodes and a chosen sprint container, this module derives who is carrying which
// child stories inside that sprint — grouping by assignee, matching people to the team roster (so
// role-legal moves are visible), and surfacing spare capacity, unassigned work, and off-roster
// owners. It is pure and deterministic: "today" is injected, so tests never touch the clock or Jira.

import type { CanvasChildStory, CanvasNode } from '../logic/canvasTypes.ts';
import type { RosterRoleCapabilities, StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';
import { daysRemainingInPi, parsePiDateRange } from '../logic/piSchedule.ts';

const MS_PER_DAY = 86_400_000;
const UNASSIGNED_DISPLAY_NAME = 'Unassigned';
const NO_ROLES: RosterRoleCapabilities = {
  canDevelop: false, canInternalTest: false, canExternalTest: false,
  canScrumMaster: false, canProductOwner: false, canSystemsAnalyst: false,
  canSolutionArchitect: false, canDevLead: false, canReleaseTrainEngineer: false,
};

/** One child work item as the re-allocation reasoner sees it. */
export interface ReallocationWorkItem {
  key: string;
  summary: string;
  storyPoints: number | null;
  status: string;
  statusCategoryKey: string | null;
  daysInStatus: number | null;
  assignee: string | null;
}

/** The work carried by one person (or the unassigned/off-roster bucket) within the target sprint. */
export interface ReallocationPersonLoad {
  displayName: string;
  roles: RosterRoleCapabilities | null;
  isOnRoster: boolean;
  items: ReallocationWorkItem[];
  totalPoints: number;
}

/** Everything the prompt needs for one target sprint. */
export interface ReallocationContext {
  targetSprintTitle: string;
  piName: string;
  piStartIso: string | null;
  piEndIso: string | null;
  daysRemainingInPi: number | null;
  loads: ReallocationPersonLoad[];
  rosterWithoutWork: { displayName: string; roles: RosterRoleCapabilities }[];
  unassignedCount: number;
  offRosterAssignees: string[];
}

/** Lower-cases and collapses whitespace so assignee display names match roster values leniently. */
function normalizeMatchValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Finds the roster member owning a story's assignee, matching name or query value case-insensitively. */
function matchRosterMember(
  assignee: string,
  rosterMembers: readonly StandupRosterMember[],
): StandupRosterMember | null {
  const normalizedAssignee = normalizeMatchValue(assignee);
  return rosterMembers.find(
    (member) => normalizeMatchValue(member.assigneeQueryValue) === normalizedAssignee
      || normalizeMatchValue(member.displayName) === normalizedAssignee,
  ) ?? null;
}

/** Whole days between a status-change date and injected today; null when the date is missing/unparseable. */
function computeDaysInStatus(statusChangedIso: string | null | undefined, todayIso: string): number | null {
  if (!statusChangedIso) {
    return null;
  }
  const statusChangedMs = Date.parse(statusChangedIso);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(statusChangedMs) || Number.isNaN(todayMs)) {
    return null;
  }
  return Math.floor((todayMs - statusChangedMs) / MS_PER_DAY);
}

/** Projects a canvas child story into the flatter work-item shape the prompt reasons over. */
function toWorkItem(childStory: CanvasChildStory, todayIso: string): ReallocationWorkItem {
  return {
    key: childStory.key,
    summary: childStory.summary,
    storyPoints: childStory.storyPoints,
    status: childStory.status,
    statusCategoryKey: childStory.statusCategoryKey ?? null,
    daysInStatus: computeDaysInStatus(childStory.statusChangedIso, todayIso),
    assignee: childStory.assignee ?? null,
  };
}

/** Collects every child story whose resolved box equals the target container, as flat work items. */
function collectTargetItems(
  nodes: readonly CanvasNode[],
  targetContainerId: string,
  todayIso: string,
): ReallocationWorkItem[] {
  const targetItems: ReallocationWorkItem[] = [];
  for (const node of nodes) {
    for (const childStory of node.childStories) {
      const resolvedBox = node.storyPlacements[childStory.key] ?? node.containerId;
      if (resolvedBox === targetContainerId) {
        targetItems.push(toWorkItem(childStory, todayIso));
      }
    }
  }
  return targetItems;
}

/** Sums a bucket's story points, counting unpointed stories as zero. */
function sumPoints(items: readonly ReallocationWorkItem[]): number {
  return items.reduce((runningTotal, item) => runningTotal + (item.storyPoints ?? 0), 0);
}

/** The three per-assignee buckets the raw work items sort into before becoming person loads. */
interface GroupedWork {
  itemsByMemberId: Map<string, ReallocationWorkItem[]>;
  offRosterItemsByName: Map<string, { rawName: string; items: ReallocationWorkItem[] }>;
  unassignedItems: ReallocationWorkItem[];
}

/** Sorts each work item into the roster-member, off-roster, or unassigned bucket. */
function groupWorkByAssignee(
  items: readonly ReallocationWorkItem[],
  rosterMembers: readonly StandupRosterMember[],
): GroupedWork {
  const grouped: GroupedWork = { itemsByMemberId: new Map(), offRosterItemsByName: new Map(), unassignedItems: [] };
  for (const item of items) {
    if (item.assignee === null) {
      grouped.unassignedItems.push(item);
      continue;
    }
    const matchedMember = matchRosterMember(item.assignee, rosterMembers);
    if (matchedMember) {
      const existing = grouped.itemsByMemberId.get(matchedMember.id) ?? [];
      grouped.itemsByMemberId.set(matchedMember.id, [...existing, item]);
      continue;
    }
    const offRosterKey = normalizeMatchValue(item.assignee);
    const existing = grouped.offRosterItemsByName.get(offRosterKey) ?? { rawName: item.assignee, items: [] };
    grouped.offRosterItemsByName.set(offRosterKey, { rawName: existing.rawName, items: [...existing.items, item] });
  }
  return grouped;
}

/** Builds the ordered person-load list: roster members with work, then off-roster, then unassigned. */
function buildLoads(grouped: GroupedWork, rosterMembers: readonly StandupRosterMember[]): ReallocationPersonLoad[] {
  const rosterLoads = rosterMembers
    .filter((member) => grouped.itemsByMemberId.has(member.id))
    .map((member) => {
      const items = grouped.itemsByMemberId.get(member.id) ?? [];
      return { displayName: member.displayName, roles: member.roleCapabilities ?? NO_ROLES, isOnRoster: true, items, totalPoints: sumPoints(items) };
    });
  const offRosterLoads = [...grouped.offRosterItemsByName.values()]
    .sort((left, right) => left.rawName.localeCompare(right.rawName))
    .map(({ rawName, items }) => ({ displayName: rawName, roles: null, isOnRoster: false, items, totalPoints: sumPoints(items) }));
  const unassignedLoads = grouped.unassignedItems.length > 0
    ? [{ displayName: UNASSIGNED_DISPLAY_NAME, roles: null, isOnRoster: false, items: grouped.unassignedItems, totalPoints: sumPoints(grouped.unassignedItems) }]
    : [];
  return [...rosterLoads, ...offRosterLoads, ...unassignedLoads];
}

/** Lists active roster members carrying no target-sprint work — the spare capacity a plan can move work to. */
function buildRosterWithoutWork(
  grouped: GroupedWork,
  rosterMembers: readonly StandupRosterMember[],
): { displayName: string; roles: RosterRoleCapabilities }[] {
  return rosterMembers
    .filter((member) => !grouped.itemsByMemberId.has(member.id))
    .map((member) => ({ displayName: member.displayName, roles: member.roleCapabilities ?? NO_ROLES }));
}

/**
 * Assembles the full re-allocation context for one target sprint: the per-person work loads, spare
 * capacity, unassigned/off-roster buckets, and the PI runway. Pure — pass `todayIso` for determinism.
 */
export function buildReallocationContext(
  nodes: readonly CanvasNode[],
  targetContainerId: string,
  targetSprintTitle: string,
  rosterMembers: readonly StandupRosterMember[],
  piName: string,
  todayIso: string,
): ReallocationContext {
  const targetItems = collectTargetItems(nodes, targetContainerId, todayIso);
  const grouped = groupWorkByAssignee(targetItems, rosterMembers);
  const piRange = parsePiDateRange(piName);
  return {
    targetSprintTitle,
    piName,
    piStartIso: piRange?.startIso ?? null,
    piEndIso: piRange?.endIso ?? null,
    daysRemainingInPi: daysRemainingInPi(piName, todayIso),
    loads: buildLoads(grouped, rosterMembers),
    rosterWithoutWork: buildRosterWithoutWork(grouped, rosterMembers),
    unassignedCount: grouped.unassignedItems.length,
    offRosterAssignees: [...grouped.offRosterItemsByName.values()]
      .map(({ rawName }) => rawName)
      .sort((left, right) => left.localeCompare(right)),
  };
}
