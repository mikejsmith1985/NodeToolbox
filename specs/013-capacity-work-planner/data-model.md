# Phase 1 Data Model: Capacity Work Planner (Layer 1 — the pure engine)

TypeScript, client-side, **pure** (no storage, no clock — `todayIso` injected). Types live in
`client/src/views/FeatureCanvas/planner/capacityTypes.ts`.

## Inputs

```ts
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

export interface PlanInput {
  items: PlanItem[];             // only the selected priority buckets, any order (engine sorts by bucket+rank)
  people: PersonCapacity[];      // active-team roster mapped to delivery capacity
  piName: string;                // for the PI start/end window (piSchedule)
  sprintLengthDays: number;      // default 14
  /** Default fraction of dev points used to synthesize internal-test cost when absent (default 0.5). */
  syntheticTestFraction: number;
}
```

## Outputs

```ts
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
```

## Engine algorithm (deterministic; `buildCapacityPlan(input, todayIso)`)

1. **Order** items by `bucket` (Must→Should→Could→Wont) then `rankInBucket` (ascending).
2. **Synthesize** missing internal-test cost: if `internalTestPoints == null` and `devPoints > 0`, set it to
   `round(devPoints * syntheticTestFraction)` and mark `isTestEstimated`.
3. **Resolve capacity** per person: `pointsPerSprint` (default 8) as one pool across their `roles`.
4. **Assign / rebalance (proposals)**: for each item's dev/test work, if unassigned or the current assignee lacks
   the role, propose the next role-capable person with the most remaining capacity (deterministic tiebreak by name).
5. **Fill sprints greedily** in item order, respecting per-person per-sprint pool:
   - Place **dev** work first (dev-role capacity).
   - Place the item's **internal test** in the same sprint if an internal tester has room, else the next sprint;
     external test follows internal test by the same rule (**FR-11 sequencing** — testing never precedes dev).
   - Open a new sprint (advancing dates by `sprintLengthDays`) when the current one can hold no more of the next
     item's work. Continue **past the PI end** (`isBeyondPiEnd` from `piSchedule`).
6. **Bottleneck**: compare per-sprint role demand vs capacity; the role that most extends the schedule is limiting.
   Compute `additionalToMatchThroughput` (people to raise that role's per-sprint capacity to the upstream role's)
   and `additionalToFinishByPiEnd` (people needed so the last item lands ≤ PI end).
7. **Completion**: the last sprint holding scheduled work → `completionSprintIndex/DateIso`, `sprintsBeyondPiEnd`.

Pure: no `Date.now()`; all dates derive from the PI start (via `piSchedule.parsePiDateRange`) or an injected anchor,
advancing by `sprintLengthDays`. Same input → identical output (SC-1).

## Bottleneck math (concrete, deterministic)

Let `pool` = points/person/sprint (default 8). Per-sprint role capacity = `pool × (count of people whose roles
include that role)`. (A multi-role person counts toward each role they hold; the fill still caps their *total* at
`pool`, so these capacities are upper bounds — good enough for a headcount estimate.)

- **Limiting role**: the delivery role whose total demand ÷ its per-sprint capacity yields the most sprints (i.e.
  the role that stretches the schedule longest). Null if no role's demand exceeds what finishes within the dev-driven
  span.
- **additionalToMatchThroughput** — demand-based (people so the limiting role finishes within development's
  span, i.e. keeps pace with the *rate* testable work is produced, not with dev's raw head-count):
  `devSprints = ceil(demand.dev / (pool × devCount))`; `requiredPerSprint = devSprints ≤ 0 ? 0 : ceil(limitingDemand / devSprints)`;
  result = `max(0, ceil((requiredPerSprint − limitingCapacityPerSprint) / pool))`. (Matching to raw dev
  capacity, as an earlier draft did, over-provisions by the test:dev ratio — e.g. it reported +9 where the
  demand-based figure is +4.)
- **additionalToFinishByPiEnd**: `sprintsToPiEnd = max(1, floor(daysFromAnchorToPiEnd / sprintLengthDays))`;
  `requiredPerSprint = ceil(limitingRoleTotalPoints / sprintsToPiEnd)`;
  result = `max(0, ceil((requiredPerSprint − limitingCapacityPerSprint) / pool))`. Zero when the scope already
  fits by the PI end.

Both are explainable upper-bound estimates, not a solver result — consistent with the greedy, transparent engine.

## Traceability

| Type / step | Spec |
|-------------|------|
| PlanItem.bucket + rankInBucket | FR-1, D2 |
| PlanItem dev/internal/external points, isTestEstimated | FR-6,7,8a, D7,D10 |
| PersonCapacity single pool across roles | FR-4,5, D5,D6 |
| Assign/rebalance proposals | FR-9, D8 |
| Sprint fill + dev→test sequencing | FR-10,11, D11 |
| BottleneckReport (both targets) | FR-12, D12, SC-4 |
| Projection beyond PI | FR-13, D13, SC-5 |
| Determinism | SC-1 |
