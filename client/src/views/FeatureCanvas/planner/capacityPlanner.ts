// capacityPlanner.ts — The pure, deterministic capacity-planning engine (feature 013, Layer 1).
//
// Given already-classified, already-sized work items, the team's per-role capacity, and the PI window,
// this builds a projected schedule of 2-week sprints: per-person load by role, dev→test sequencing,
// read-only assignment/rebalance proposals, the internal-testing bottleneck + staffing gap, and a
// completion projection that continues past the PI end. It never touches Jira, never reads the clock
// (today is injected), and yields the identical result for identical input — so it is fully unit-testable.

import { parsePiDateRange } from '../logic/piSchedule.ts';
import { computeBottleneck } from './bottleneck.ts';
import type {
  AssignmentProposal,
  BottleneckReport,
  DeliveryRole,
  PersonCapacity,
  PlanInput,
  PlanItem,
  PlanResult,
  ProjectedSprint,
  SprintPersonLoad,
} from './capacityTypes.ts';

// ── Named constants (no magic numbers) ───────────────────────────────────────

const DEFAULT_POINTS_PER_SPRINT = 8;      // A person's flat pool of points per 2-week sprint.
const DEFAULT_SPRINT_LENGTH_DAYS = 14;    // Sprint length when the caller does not supply one.
const DEFAULT_SYNTHETIC_TEST_FRACTION = 0.5; // Internal-test cost synthesized as this fraction of dev points.
const MAX_PROJECTED_SPRINTS = 200;        // Safety cap so a bad input can never loop forever.
const MINIMUM_SPRINTS_TO_PI_END = 1;      // The PI-end budget is always at least one sprint.
const MS_PER_DAY = 86_400_000;

// The three delivery roles, in the fixed order the engine assigns and sequences them.
const DELIVERY_ROLES: DeliveryRole[] = ['dev', 'internalTest', 'externalTest'];

// Bucket precedence — Must is scheduled before Should before Could before Won't.
const BUCKET_ORDER: Record<PlanItem['bucket'], number> = { Must: 0, Should: 1, Could: 2, Wont: 3 };

// Plain-English role names for operator-facing proposal reasons.
const ROLE_LABELS: Record<DeliveryRole, string> = {
  dev: 'development',
  internalTest: 'internal testing',
  externalTest: 'external testing',
};

// Maps a delivery role to the matching numeric field on a per-person sprint load.
type LoadPointsField = 'devPoints' | 'internalTestPoints' | 'externalTestPoints';
const ROLE_TO_LOAD_FIELD: Record<DeliveryRole, LoadPointsField> = {
  dev: 'devPoints',
  internalTest: 'internalTestPoints',
  externalTest: 'externalTestPoints',
};

// ── Internal working types (never leave this module) ─────────────────────────

/** An item after sizing/synthesis, carrying effective per-role points and sorted into schedule order. */
interface PreparedItem {
  key: string;
  bucket: PlanItem['bucket'];
  rankInBucket: number;
  assignee: string | null;
  pointsByRole: Record<DeliveryRole, number>;
  isTestEstimated: boolean;
}

/** One person's accumulating load inside a single working sprint. */
interface WorkingLoad {
  devPoints: number;
  internalTestPoints: number;
  externalTestPoints: number;
  usedTotal: number;
  itemKeys: Set<string>;
}

/** A single working sprint: a map from person to their accumulating load. */
interface WorkingSprint {
  loadByPerson: Map<string, WorkingLoad>;
}

/** Mutable scheduling state threaded through the greedy fill. */
interface FillContext {
  sprints: WorkingSprint[]; // index 0 is sprint number 1
  poolByPerson: Map<string, number>;
}

/** Result of placing one role's points for one item: where it finished, or that it could not fit. */
interface PlacementResult {
  completionSprintNumber: number; // 0 when there was nothing to place
  isUnschedulable: boolean;
}

// ── Step 1–2: prepare (sort + synthesize) ────────────────────────────────────

/** Sizes each item (synthesizing missing internal-test cost) and sorts by bucket then rank. */
function prepareItems(items: PlanItem[], syntheticTestFraction: number): PreparedItem[] {
  const prepared = items.map((item): PreparedItem => {
    const devPoints = item.devPoints ?? 0;
    // Synthesize internal-test cost only when it is genuinely absent and there is dev work to test.
    const hasSyntheticInternal = item.internalTestPoints === null && devPoints > 0;
    const internalTestPoints = hasSyntheticInternal
      ? Math.round(devPoints * syntheticTestFraction)
      : item.internalTestPoints ?? 0;
    return {
      key: item.key,
      bucket: item.bucket,
      rankInBucket: item.rankInBucket,
      assignee: item.assignee,
      pointsByRole: { dev: devPoints, internalTest: internalTestPoints, externalTest: item.externalTestPoints ?? 0 },
      isTestEstimated: hasSyntheticInternal || item.isTestEstimated,
    };
  });
  prepared.sort(
    (first, second) =>
      BUCKET_ORDER[first.bucket] - BUCKET_ORDER[second.bucket] || first.rankInBucket - second.rankInBucket,
  );
  return prepared;
}

// ── Step 3: capacity resolution ──────────────────────────────────────────────

/** Builds a lookup of each person's per-sprint pool, keyed by display name. */
function buildPoolByPerson(people: PersonCapacity[]): Map<string, number> {
  const poolByPerson = new Map<string, number>();
  for (const person of people) {
    poolByPerson.set(person.displayName, person.pointsPerSprint ?? DEFAULT_POINTS_PER_SPRINT);
  }
  return poolByPerson;
}

/** Builds, per delivery role, the alphabetically-sorted list of people who can perform it. */
function buildCapableByRole(people: PersonCapacity[]): Map<DeliveryRole, string[]> {
  const capableByRole = new Map<DeliveryRole, string[]>();
  for (const role of DELIVERY_ROLES) {
    const capableNames = people
      .filter((person) => person.roles.includes(role))
      .map((person) => person.displayName)
      .sort();
    capableByRole.set(role, capableNames);
  }
  return capableByRole;
}

/** True when every role the item actually needs has at least one capable person. */
function isItemSchedulable(item: PreparedItem, capableByRole: Map<DeliveryRole, string[]>): boolean {
  return DELIVERY_ROLES.every(
    (role) => item.pointsByRole[role] <= 0 || (capableByRole.get(role) ?? []).length > 0,
  );
}

// ── Step 4: assignment / rebalance proposals ─────────────────────────────────

/** Picks the capable person carrying the least cumulative load; ties break alphabetically (list is sorted). */
function pickLeastLoaded(capableNames: string[], cumulativeLoad: Map<string, number>): string {
  let chosen = capableNames[0];
  let lowestLoad = cumulativeLoad.get(chosen) ?? 0;
  for (const name of capableNames) {
    const load = cumulativeLoad.get(name) ?? 0;
    if (load < lowestLoad) {
      chosen = name;
      lowestLoad = load;
    }
  }
  return chosen;
}

/** Writes the operator-facing reason for a proposal (unassigned vs. role-illegal rebalance). */
function buildProposalReason(item: PreparedItem, role: DeliveryRole, fromAssignee: string | null, toAssignee: string): string {
  const label = ROLE_LABELS[role];
  if (fromAssignee === null) {
    return `unassigned ${item.bucket} item; ${label} work assigned to ${toAssignee} (most free capacity)`;
  }
  return `${fromAssignee} cannot perform ${label}; ${label} work reassigned to ${toAssignee}`;
}

/**
 * Decides who performs each item's dev/internal/external work. Keeps the current assignee when they
 * hold the role; otherwise proposes the least-loaded capable person and records the proposal. Returns
 * the per-item role→person map and the ordered proposal list. Never mutates Jira; capacity is nominal.
 */
function buildAssignments(
  items: PreparedItem[],
  people: PersonCapacity[],
  capableByRole: Map<DeliveryRole, string[]>,
): { assignments: Map<string, Partial<Record<DeliveryRole, string>>>; proposals: AssignmentProposal[] } {
  const rolesByPerson = new Map<string, Set<DeliveryRole>>();
  for (const person of people) {
    rolesByPerson.set(person.displayName, new Set(person.roles));
  }
  const cumulativeLoad = new Map<string, number>(people.map((person) => [person.displayName, 0]));
  const assignments = new Map<string, Partial<Record<DeliveryRole, string>>>();
  const proposals: AssignmentProposal[] = [];

  for (const item of items) {
    const perItemAssignment: Partial<Record<DeliveryRole, string>> = {};
    for (const role of DELIVERY_ROLES) {
      const points = item.pointsByRole[role];
      if (points <= 0) {
        continue;
      }
      const holdsRole = item.assignee !== null && (rolesByPerson.get(item.assignee)?.has(role) ?? false);
      const chosen = holdsRole ? item.assignee! : pickLeastLoaded(capableByRole.get(role) ?? [], cumulativeLoad);
      if (!holdsRole) {
        proposals.push({
          itemKey: item.key,
          role,
          fromAssignee: item.assignee,
          toAssignee: chosen,
          reason: buildProposalReason(item, role, item.assignee, chosen),
        });
      }
      perItemAssignment[role] = chosen;
      cumulativeLoad.set(chosen, (cumulativeLoad.get(chosen) ?? 0) + points);
    }
    assignments.set(item.key, perItemAssignment);
  }
  return { assignments, proposals };
}

// ── Step 5: greedy sprint fill ───────────────────────────────────────────────

/** Returns (creating if needed) the working load for a person in a sprint, growing the sprint list contiguously. */
function getWorkingLoad(context: FillContext, sprintNumber: number, personName: string): WorkingLoad {
  while (context.sprints.length < sprintNumber) {
    context.sprints.push({ loadByPerson: new Map<string, WorkingLoad>() });
  }
  const sprint = context.sprints[sprintNumber - 1];
  let load = sprint.loadByPerson.get(personName);
  if (load === undefined) {
    load = { devPoints: 0, internalTestPoints: 0, externalTestPoints: 0, usedTotal: 0, itemKeys: new Set<string>() };
    sprint.loadByPerson.set(personName, load);
  }
  return load;
}

/**
 * Places `points` of one role's work for one item onto `assigneeName`, starting no earlier than
 * `startSprintNumber`, filling their remaining pool sprint by sprint (opening new sprints as needed).
 * Returns the sprint the work finishes in, or flags it unschedulable if it cannot fit within the cap.
 */
function placeWork(
  context: FillContext,
  assigneeName: string,
  role: DeliveryRole,
  points: number,
  startSprintNumber: number,
  itemKey: string,
): PlacementResult {
  if (points <= 0) {
    return { completionSprintNumber: 0, isUnschedulable: false };
  }
  const personPool = context.poolByPerson.get(assigneeName) ?? 0;
  if (personPool <= 0) {
    return { completionSprintNumber: 0, isUnschedulable: true };
  }
  const loadField = ROLE_TO_LOAD_FIELD[role];
  let remainingPoints = points;
  let sprintNumber = startSprintNumber;
  let lastUsedSprint = 0;
  while (remainingPoints > 0) {
    if (sprintNumber > MAX_PROJECTED_SPRINTS) {
      return { completionSprintNumber: lastUsedSprint, isUnschedulable: true };
    }
    const load = getWorkingLoad(context, sprintNumber, assigneeName);
    const poolRemaining = personPool - load.usedTotal;
    if (poolRemaining > 0) {
      const placedPoints = Math.min(remainingPoints, poolRemaining);
      load[loadField] += placedPoints;
      load.usedTotal += placedPoints;
      load.itemKeys.add(itemKey);
      remainingPoints -= placedPoints;
      lastUsedSprint = sprintNumber;
    }
    if (remainingPoints > 0) {
      sprintNumber += 1;
    }
  }
  return { completionSprintNumber: lastUsedSprint, isUnschedulable: false };
}

/**
 * Fills sprints greedily in item order: development first, then the item's internal test no earlier than
 * dev completion, then external test no earlier than internal-test completion. Any item that cannot fit
 * (a person with no pool, or a scope past the sprint cap) is added to `unschedulable`.
 */
function runGreedyFill(
  items: PreparedItem[],
  assignments: Map<string, Partial<Record<DeliveryRole, string>>>,
  context: FillContext,
  unschedulable: Set<string>,
): void {
  for (const item of items) {
    const assignment = assignments.get(item.key) ?? {};
    const devResult = placeWork(context, assignment.dev ?? '', 'dev', item.pointsByRole.dev, 1, item.key);
    if (devResult.isUnschedulable) {
      unschedulable.add(item.key);
      continue;
    }
    const devCompletion = devResult.completionSprintNumber;
    const internalStart = Math.max(devCompletion, 1);
    const internalResult = placeWork(
      context, assignment.internalTest ?? '', 'internalTest', item.pointsByRole.internalTest, internalStart, item.key,
    );
    if (internalResult.isUnschedulable) {
      unschedulable.add(item.key);
      continue;
    }
    const internalCompletion = internalResult.completionSprintNumber || devCompletion;
    const externalStart = Math.max(internalCompletion, devCompletion, 1);
    const externalResult = placeWork(
      context, assignment.externalTest ?? '', 'externalTest', item.pointsByRole.externalTest, externalStart, item.key,
    );
    if (externalResult.isUnschedulable) {
      unschedulable.add(item.key);
    }
  }
}

// ── Step 6–7: dates, projection output, bottleneck, completion ───────────────

/** Formats an epoch-ms instant as a YYYY-MM-DD string from its UTC parts (pure; no clock read). */
function formatIsoDate(epochMs: number): string {
  const date = new Date(epochMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Converts a working sprint's person loads into the sorted, deterministic output shape. */
function buildSprintLoads(sprint: WorkingSprint): SprintPersonLoad[] {
  return [...sprint.loadByPerson.entries()]
    .filter(([, load]) => load.usedTotal > 0)
    .map(([displayName, load]): SprintPersonLoad => ({
      displayName,
      devPoints: load.devPoints,
      internalTestPoints: load.internalTestPoints,
      externalTestPoints: load.externalTestPoints,
      itemKeys: [...load.itemKeys].sort(),
    }))
    .sort((first, second) => first.displayName.localeCompare(second.displayName));
}

/** Projects each working sprint into a dated ProjectedSprint, flagging those beyond the PI end. */
function buildProjectedSprints(
  context: FillContext,
  anchorMs: number,
  sprintLengthDays: number,
  piEndMs: number | null,
): ProjectedSprint[] {
  return context.sprints.map((sprint, index): ProjectedSprint => {
    const startMs = anchorMs + index * sprintLengthDays * MS_PER_DAY;
    const endMs = startMs + (sprintLengthDays - 1) * MS_PER_DAY;
    const loads = buildSprintLoads(sprint);
    const scheduledPoints = loads.reduce(
      (sum, load) => sum + load.devPoints + load.internalTestPoints + load.externalTestPoints,
      0,
    );
    return {
      index: index + 1,
      startIso: formatIsoDate(startMs),
      endIso: formatIsoDate(endMs),
      isBeyondPiEnd: piEndMs !== null && startMs > piEndMs,
      loads,
      scheduledPoints,
    };
  });
}

/** Sums per-role demand across the items that were actually scheduled (excludes unschedulable ones). */
function sumDemandByRole(items: PreparedItem[], unschedulable: Set<string>): { dev: number; internalTest: number; externalTest: number } {
  const demand = { dev: 0, internalTest: 0, externalTest: 0 };
  for (const item of items) {
    if (unschedulable.has(item.key)) {
      continue;
    }
    demand.dev += item.pointsByRole.dev;
    demand.internalTest += item.pointsByRole.internalTest;
    demand.externalTest += item.pointsByRole.externalTest;
  }
  return demand;
}

/** Counts how many people can perform each delivery role (a multi-role person counts for each role held). */
function countPeopleByRole(capableByRole: Map<DeliveryRole, string[]>): { dev: number; internalTest: number; externalTest: number } {
  return {
    dev: (capableByRole.get('dev') ?? []).length,
    internalTest: (capableByRole.get('internalTest') ?? []).length,
    externalTest: (capableByRole.get('externalTest') ?? []).length,
  };
}

/** Resolves the plan anchor, PI end, and whole-sprint budget to the PI end from the PI window (or today). */
function resolveSprintTiming(
  piName: string,
  todayIso: string,
  sprintLengthDays: number,
): { anchorMs: number; piEndMs: number | null; sprintsToPiEnd: number } {
  const piWindow = parsePiDateRange(piName);
  const anchorIso = piWindow ? piWindow.startIso : todayIso;
  const anchorMs = Date.parse(`${anchorIso}T00:00:00Z`);
  const piEndMs = piWindow ? Date.parse(`${piWindow.endIso}T00:00:00Z`) : null;
  let sprintsToPiEnd = MINIMUM_SPRINTS_TO_PI_END;
  if (piEndMs !== null && !Number.isNaN(anchorMs)) {
    const daysToPiEnd = Math.floor((piEndMs - anchorMs) / MS_PER_DAY);
    sprintsToPiEnd = Math.max(MINIMUM_SPRINTS_TO_PI_END, Math.floor(daysToPiEnd / sprintLengthDays));
  }
  return { anchorMs, piEndMs, sprintsToPiEnd };
}

/** Finds the last sprint holding scheduled work and how many scheduled sprints fall beyond the PI end. */
function computeCompletion(sprints: ProjectedSprint[]): {
  completionSprintIndex: number;
  completionDateIso: string | null;
  sprintsBeyondPiEnd: number;
} {
  let completionSprintIndex = 0;
  let completionDateIso: string | null = null;
  let sprintsBeyondPiEnd = 0;
  for (const sprint of sprints) {
    if (sprint.scheduledPoints > 0) {
      completionSprintIndex = sprint.index;
      completionDateIso = sprint.endIso;
      if (sprint.isBeyondPiEnd) {
        sprintsBeyondPiEnd += 1;
      }
    }
  }
  return { completionSprintIndex, completionDateIso, sprintsBeyondPiEnd };
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Builds the deterministic capacity plan for the selected scope as of `todayIso`.
 *
 * Runs the seven-step engine: order → synthesize test cost → resolve capacity → propose assignments →
 * greedily fill sprints with dev→test sequencing → quantify the bottleneck → project completion past the
 * PI end. Pure: identical input and `todayIso` always yield a deeply-equal PlanResult (SC-1).
 */
export function buildCapacityPlan(input: PlanInput, todayIso: string): PlanResult {
  const syntheticTestFraction = input.syntheticTestFraction ?? DEFAULT_SYNTHETIC_TEST_FRACTION;
  const sprintLengthDays = input.sprintLengthDays > 0 ? input.sprintLengthDays : DEFAULT_SPRINT_LENGTH_DAYS;

  const preparedItems = prepareItems(input.items, syntheticTestFraction);
  const capableByRole = buildCapableByRole(input.people);

  // Items requiring a role with zero capacity are surfaced up front and excluded from scheduling.
  const unschedulable = new Set<string>();
  const schedulableItems = preparedItems.filter((item) => {
    const canSchedule = isItemSchedulable(item, capableByRole);
    if (!canSchedule) {
      unschedulable.add(item.key);
    }
    return canSchedule;
  });

  const { assignments, proposals } = buildAssignments(schedulableItems, input.people, capableByRole);

  const fillContext: FillContext = { sprints: [], poolByPerson: buildPoolByPerson(input.people) };
  runGreedyFill(schedulableItems, assignments, fillContext, unschedulable);

  const { anchorMs, piEndMs, sprintsToPiEnd } = resolveSprintTiming(input.piName, todayIso, sprintLengthDays);
  const sprints = buildProjectedSprints(fillContext, anchorMs, sprintLengthDays, piEndMs);

  const demand = sumDemandByRole(schedulableItems, unschedulable);
  const bottleneck: BottleneckReport = computeBottleneck(
    demand, countPeopleByRole(capableByRole), DEFAULT_POINTS_PER_SPRINT, sprintsToPiEnd,
  );

  const { completionSprintIndex, completionDateIso, sprintsBeyondPiEnd } = computeCompletion(sprints);

  return {
    sprints,
    proposals,
    bottleneck,
    completionSprintIndex,
    completionDateIso,
    sprintsBeyondPiEnd,
    unschedulableItemKeys: [...unschedulable],
  };
}
