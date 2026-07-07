// capacityTypes.ts — The pure data contract (inputs and outputs) for the deterministic capacity planner.
//
// These interfaces are the single source of truth shared by the planner engine, the bottleneck
// calculator, and (later) the UI. Everything here is plain data: no methods, no clock, no I/O — so
// the engine that consumes it stays 100% unit-testable and reproducible (feature 013, Layer 1).

/** A delivery role the capacity engine schedules against. Coordination roles (SM/PO/SA) are not here. */
export type DeliveryRole = 'dev' | 'internalTest' | 'externalTest';

/** One planable work item, already classified and sized. Classification/fetch produce these upstream. */
export interface PlanItem {
  key: string;
  summary: string;
  /** MoSCoW bucket + intra-bucket rank (lower rank = more urgent). Drives scheduling order. */
  bucket: 'Must' | 'Should' | 'Could' | 'Wont';
  rankInBucket: number;
  /** Development effort in story points (≈ days). 0 or null when the item is pure test work. */
  devPoints: number | null;
  /** Internal-testing effort in points — from a QA sub-task, or synthesized (isTestEstimated=true). */
  internalTestPoints: number | null;
  /** External-testing effort in points — from an external-test link. Null when none. */
  externalTestPoints: number | null;
  /** True when internalTestPoints was synthesized (no QA sub-task/link found) — surfaced to the operator. */
  isTestEstimated: boolean;
  /** Current assignee display name, or null when unassigned. */
  assignee: string | null;
}

/** One person's capacity, derived from their roster role capabilities. */
export interface PersonCapacity {
  displayName: string;
  /** The delivery roles this person can perform (dev, internalTest, externalTest). May be empty. */
  roles: DeliveryRole[];
  /** Points available per sprint — a single pool spendable across any held role. Default 8. */
  pointsPerSprint: number;
}

/** The complete, self-contained input the engine needs to build a plan. */
export interface PlanInput {
  items: PlanItem[];             // only the selected priority buckets, any order (engine sorts by bucket+rank)
  people: PersonCapacity[];      // active-team roster mapped to delivery capacity
  piName: string;                // for the PI start/end window (piSchedule)
  sprintLengthDays: number;      // default 14
  /** Default fraction of dev points used to synthesize internal-test cost when absent (default 0.5). */
  syntheticTestFraction: number;
}

/** One person's scheduled load within one sprint, split by role. */
export interface SprintPersonLoad {
  displayName: string;
  devPoints: number;
  internalTestPoints: number;
  externalTestPoints: number;
  /** Item keys whose work this person carries in this sprint (dev and/or test). */
  itemKeys: string[];
}

/** One projected 2-week sprint, possibly beyond the PI end. */
export interface ProjectedSprint {
  index: number;               // 1-based
  startIso: string;
  endIso: string;
  isBeyondPiEnd: boolean;
  loads: SprintPersonLoad[];
  scheduledPoints: number;     // total points placed this sprint
}

/** A proposed assignment (unassigned→person) or rebalance (person→person). Never written to Jira. */
export interface AssignmentProposal {
  itemKey: string;
  role: DeliveryRole;
  fromAssignee: string | null; // null when the item was unassigned
  toAssignee: string;
  reason: string;              // e.g. "unassigned Must item; only free internalTest capacity"
}

/** Limiting-role bottleneck + how many more people that role needs, for both targets. */
export interface BottleneckReport {
  limitingRole: DeliveryRole | null;   // null when nothing is a bottleneck
  /** Extra people in the limiting role to match upstream (dev) throughput so it is not the critical path. */
  additionalToMatchThroughput: number;
  /** Extra people in the limiting role to finish the selected scope by the PI end date. */
  additionalToFinishByPiEnd: number;
  /** Human-readable one-line statement summarizing the gap. */
  statement: string;
}

/** The full deterministic result of a planning run — the read-only projection surfaced to the operator. */
export interface PlanResult {
  sprints: ProjectedSprint[];
  proposals: AssignmentProposal[];
  bottleneck: BottleneckReport;
  /** The sprint index / date the selected scope completes, and its offset past the PI end. */
  completionSprintIndex: number;
  completionDateIso: string | null;
  sprintsBeyondPiEnd: number;
  /** Items that could not be scheduled (e.g. a role with zero capacity) — surfaced, never dropped silently. */
  unschedulableItemKeys: string[];
}
