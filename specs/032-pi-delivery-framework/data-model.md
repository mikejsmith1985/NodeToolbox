# Data Model — PI Delivery Framework (032)

Extends `client/src/views/ArtView/piPlan/piPlanTypes.ts`. **Reused** shapes (`PlanItem`, `PersonCapacity`,
`PlanResult`, `BottleneckReport`, `ProjectedSprint` from `FeatureCanvas/planner/capacityTypes.ts`; `DatedItem`,
`ReleaseSchedule`, `FeatureInput` from 028) are **not** redefined.

## Type changes to `piPlanTypes.ts`

### Sub-task kinds (dynamic coding sub-tasks)

```ts
// 028: type SubTaskKind = 'internalTest' | 'deployInt' | 'deployRel' | 'deployProd'
// 032:
export type SubTaskKind = 'coding' | 'slTest' | 'deployInt' | 'deployRel' | 'deployProd';
// 'internalTest' is RENAMED to 'slTest' (same 30% mechanic; relabeled [SL] SL Test).
// 'coding' is NEW and repeatable — one per repo (keyed by repoName), unlike the fixed deploy kinds.
```

**Validation**: a `coding` sub-task MUST carry a non-empty `repoName` and a resolved `repoComponentId`; `slTest` and
the three deploy kinds are exactly one-per-Story; there is **no** INT/REL test kind (FR-006).

### Sub-task payload gains repo identity

```ts
export interface RepoCodingSubtask {
  repoName: string;              // the repository this coding sub-task covers
  repoComponentId: string;       // resolved Jira component id → set on the sub-task's components field
  devPoints: number;             // this repo's share of the Story's 70% dev points (≥1), PO-editable
  assignee: string | null;       // roster displayName, load-balanced, PO-overridable
}
```

`ScheduledStory` gains `codingSubtasks: RepoCodingSubtask[]` and keeps its existing SL-test (`internalTestPoints`) +
deploy dating. A Story with `codingSubtasks.length === 0` is the honest "map repos first" state (FR-007).

### PI Planning Fact Sheet (new)

```ts
export interface FactSheetFeature {
  key: string; summary: string; sizePoints: number | null;
  priorityRank: number; priorityName: string | null; isCommitted: boolean;
  repoComponentNames: string[];   // classified 'repo' only (031)
  domainComponentNames: string[]; // classified 'domain' (never generate a sub-task)
  dependencyKeys: string[]; targetFixVersion: string | null;
  existingChildren: ExistingChild[];
}
export interface FactSheetPerson {
  displayName: string; accountId: string | null;
  roles: DeliveryRole[];           // 'dev' | 'internalTest' (=SL test) | 'externalTest'
  pointsPerSprint: number;         // already ×0.8 load factor
}
export interface FactSheetSprint { name: string; startIso: string; endIso: string; isInnovationWeek?: boolean; }
export interface PiPlanningFactSheet {
  piName: string; piStartIso: string; deliveryDeadlineIso: string; // = end of Sprint 5 Week 1
  features: FactSheetFeature[];
  people: FactSheetPerson[];
  sprints: FactSheetSprint[];
  releaseSchedule: ReleaseSchedule;
  repoAllowlist: string[];         // union of all classified repo component names (ingest allowlist)
  fieldConfig: { inIntStatusNames: string[]; slDoneStatusNames: string[]; doneCategoryNames: string[] };
  velocityByPerson: Record<string, number>;
}
```

**Validation**: `repoAllowlist` is the authoritative set for ingest rejection (FR-020). `deliveryDeadlineIso` MUST be
≤ the PI end and marks the Sprint-5 Week-1 cutoff (FR-013).

### Bottleneck (new)

```ts
export type BottleneckKind = 'slTestThroughput' | 'keyPerson' | 'dependencyOrder' | 'prodCarry';
export interface Bottleneck {
  id: string;                    // stable id the AI mitigation references
  kind: BottleneckKind;
  sprintName: string | null;     // for throughput/queue bottlenecks
  subjectKey: string | null;     // repo name / person / story key the bottleneck concerns
  figures: Record<string, number>; // e.g. { devPoints: 34, slCapacity: 20 } — the underlying numbers
  statement: string;             // deterministic one-line description
  mitigation: string | null;     // filled from the AI narrative on ingest; null until attached
}
```

**Validation**: `slTestThroughput` derives from `PlanResult.bottleneck` + per-sprint SL loads; a `keyPerson`
bottleneck requires exactly one roster member capable of a repo; `mitigation` MAY only be set from an AI item whose
`bottleneckId` matches an existing `Bottleneck.id` (FR-026).

### Monitoring (new)

```ts
export type MonitorSignalKind = 'burnUp' | 'subtaskAging' | 'slQueueDepth' | 'freshness' | 'commitVsComplete';
export interface MonitorSignal {
  kind: MonitorSignalKind; sprintName: string | null;
  value: number; target: number; isOnTrack: boolean; detail: string;
}
export type ReplanTriggerKind = 'storySlipped' | 'slQueueOverTwoSprints';
export interface ReplanTrigger { kind: ReplanTriggerKind; subjectKey: string | null; statement: string; }
export interface MonitorResult { signals: MonitorSignal[]; triggers: ReplanTrigger[]; }
```

## Entity relationships

```
PiPlanningFactSheet 1─┬─* FactSheetFeature ─* repoComponentNames
                      ├─* FactSheetPerson
                      ├─* FactSheetSprint (last one may be split: delivery week + innovation week)
                      └── repoAllowlist (ingest gate)

Feature 1─* Story(=PlanProposal 'story') 1─┬─* coding sub-task (RepoCodingSubtask, one per repo)
                                           ├─1 slTest sub-task
                                           └─3 deploy sub-tasks (INT, REL, PROD)  [per-story]

PlanResult (buildCapacityPlan) ── bottleneck: BottleneckReport ──► Bottleneck(slTestThroughput)
Bottleneck ◄── mitigation ── AI reply item (bottleneckId must match)
Written plan + live Jira ──► MonitorResult (signals + triggers)
```

## State transitions

- **PlanItemStatus** (reused): `new` → `accepted` (writes) | `dismissed`; `existing` (idempotency match) never
  re-created.
- **Sub-task lifecycle** (Jira, fixed): To Do → In Progress → Done (+ Cancel). DoD reached when SL-test = Done **and**
  the INT deploy sub-task = Done.
- **Bottleneck.mitigation**: `null` → set (only via a matching AI mitigation item).
