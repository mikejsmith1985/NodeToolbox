# Phase 1 Data Model: PI Planning Automation

Plain-data contracts for the planner. All types are pure data (no methods, no clock, no I/O), consistent with the FeatureCanvas planner convention. Types that already exist are marked **REUSE**; new types name their owning module.

## Reused inputs (no new type)

- **`StandupRosterMember`** (REUSE — `useStandupRosterStore`): `displayName`, `assigneeQueryValue`, `jiraAccountId?`, `roleCapabilities? { canDevelop, canInternalTest, canExternalTest, … }`, `teamName?`.
- **`CapacitySummary`** (REUSE — `capacityModel.ts`): `startDate`, `endDate`, `workDayCount`, `totalCapacityPoints`, `recommendedCapacityPoints`, `roleCapacities`. Source of per-person/team capacity (points).
- **`PlanItem` / `PersonCapacity` / `PlanInput` / `PlanResult` / `ProjectedSprint` / `SprintPersonLoad` / `AssignmentProposal` / `BottleneckReport`** (REUSE — `FeatureCanvas/planner/capacityTypes.ts`): the scheduling contract. The engine consumes `PlanItem[] + PersonCapacity[]` and returns `PlanResult`.
- **`PiReviewRow`** (REUSE — `piReviewTable.ts`): the in-scope Feature as shown on PI Review (`feature` key+summary, `pointEstimate`, `dependency`, …).

## New types — `piPlanTypes.ts`

### FeatureInput
The planner's view of one in-scope Feature (assembled from `PiReviewRow` + reconciled Jira reads + `featureChildren.ts`).

| Field | Type | Notes |
|-------|------|-------|
| `key` | string | Jira Feature key |
| `summary` | string | |
| `sizePoints` | number \| null | Feature point size; null ⇒ unplannable-until-sized (honest state) |
| `priorityRank` | number | ordering for scheduling (from priority/rank) |
| `dependencyKeys` | string[] | Features this depends on (constrains Target Start ordering) |
| `targetFixVersion` | string \| null | pre-set fixVersion name, if any |
| `existingChildren` | ExistingChild[] | for idempotency (FR-055) |

### ExistingChild
| Field | Type | Notes |
|-------|------|-------|
| `key` | string | existing Story or sub-task key |
| `kind` | `'story' \| 'internalTest' \| 'deployInt' \| 'deployRel' \| 'deployProd' \| 'unknown'` | classified by type + naming convention |
| `parentKey` | string | Feature (for a Story) or Story (for a sub-task) |
| `summary` | string | used to match a proposal to an existing item |

### BreakdownSuggestion  *(AI output — `{kind:'piPlan'}` item, one per Feature)*
| Field | Type | Notes |
|-------|------|-------|
| `featureKey` | string | must be an in-scope Feature key (else rejected) |
| `stories` | StorySuggestion[] | proposed breakdown |
| `rationale` | string \| null | model's reasoning (display only) |

### StorySuggestion
| Field | Type | Notes |
|-------|------|-------|
| `summary` | string | proposed Story title |
| `sizePoints` | number | ≤ 13 and ≤ assignee sprint capacity (FR-024); else flagged for further split |
| `hasTestableOutput` | boolean | drives the internal-test sub-task (FR-021); default true unless model marks spike |
| `matchExistingKey` | string \| null | set by ingest when this matches an `ExistingChild` (idempotency) |

### ScheduledStory  *(engine output, before dating)*
The result of expanding accepted `StorySuggestion`s into planner `PlanItem`s and running `buildCapacityPlan`.

| Field | Type | Notes |
|-------|------|-------|
| `tempId` | string | stable id for an as-yet-uncreated Story |
| `featureKey` | string | parent Feature |
| `summary` | string | |
| `sizePoints` | number | |
| `devPoints` | number | 70% of size (rounded) |
| `internalTestPoints` | number | 30% of size (rounded; sum preserved) |
| `hasTestableOutput` | boolean | |
| `assignee` | string | roster `displayName` (capability-filtered least-loaded; PO-overridable) |
| `sprintName` | string | assigned sprint (`ProjectedSprint.name`) |
| `sprintStartIso` / `sprintEndIso` | string | from the assigned `ProjectedSprint` |

### DatedItem  *(engine output — the five dates for a Story and its sub-tasks)*
Produced by `piPlanDates.ts`; every date carries a derivation string (SC-005).

| Field | Type | Notes |
|-------|------|-------|
| `targetStartIso` | string | first working day of scheduled work |
| `internalTestEndIso` | string \| null | end of the 30% test portion; null when `hasTestableOutput=false`; gates external test |
| `targetEndIso` | string | **code in INT** (deploy-to-INT date) — the PI DoD; ≤ 1 day after internal-test end |
| `deployIntIso` | string | = `targetEndIso` — **invariant**: computed once and both fields set from it; `piPlanDates` tests assert `deployIntIso === targetEndIso` so the two labels can never drift |
| `deployRelIso` | string | INT + 5 working days |
| `deployProdIso` | string | first production release date on/after REL |
| `dueIso` | string | = `deployProdIso` (may be after PI end) |
| `derivations` | Record<string,string> | per-date "which rule + which input" explanation |

### ReleaseSchedule / ReleaseEntry  *(from `piPlanReleaseSchedule.ts`)*
| Field | Type | Notes |
|-------|------|-------|
| `entries` | ReleaseEntry[] | fixVersions in the PI window, sorted by date |
| ReleaseEntry.`name` | string | fixVersion name |
| ReleaseEntry.`releaseDateIso` | string | |
| ReleaseEntry.`isSuggested` | boolean | true ⇒ proposed monthly release, requires acceptance (FR-037) |

### PlanItemProposal  *(the reviewable unit — one accept/dismiss control)*
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | |
| `kind` | `'story' \| 'internalTest' \| 'deployInt' \| 'deployRel' \| 'deployProd' \| 'sprintCreate' \| 'releaseSuggest'` | |
| `status` | `'new' \| 'existing' \| 'accepted' \| 'dismissed'` | `existing` ⇒ idempotency match, not re-created |
| `parentKey` | string \| null | Feature (story) / Story (sub-task) / null |
| `payload` | ScheduledStory \| DatedItem \| ReleaseEntry \| SprintCreate | shape depends on `kind` |
| `warnings` | string[] | e.g. over-13-pt, over-capacity, missing capability, unsized feature |

### PlanProposal  *(top-level engine output — agree-by-construction with the capacity map)*
| Field | Type | Notes |
|-------|------|-------|
| `piName` | string | |
| `planResult` | PlanResult | REUSE — drives the capacity map (US2) *and* the schedule (FR-042) |
| `items` | PlanItemProposal[] | every reviewable item |
| `releaseSchedule` | ReleaseSchedule | |
| `honestStates` | string[] | empty scope, unsized Features, capability gaps, empty release schedule, PI over-commitment (FR-056) |

## Relationships

```
PI ─1:N─ ProjectedSprint (REUSE)      PI ─1:N─ FeatureInput
FeatureInput ─1:N─ StorySuggestion ─(accepted)→ ScheduledStory ─1:1─ DatedItem
ScheduledStory ─1:N─ Sub-task {internalTest?, deployInt, deployRel, deployProd}
ScheduledStory ─N:1─ ProjectedSprint (assigned)     ScheduledStory ─N:1─ RosterMember (assignee)
DatedItem.deployProdIso ─→ ReleaseEntry (existing or suggested)
PlanProposal.planResult.sprints[].loads ── the Capacity Map (same object as the schedule)
```

## Validation rules (from Requirements)

- A `StorySuggestion.sizePoints` > 13 **or** > assignee remaining sprint capacity ⇒ `warnings += over-size`, must split/flag (FR-024).
- `hasTestableOutput=false` ⇒ no internal-test sub-task and no `internalTestEndIso` (FR-021).
- `targetEndIso` (code in INT) must fall within the PI window; `dueIso` may exceed PI end (FR-031/FR-032/FR-036).
- Deploy cadence: `deployIntIso ≤ internalTestEndIso + 1 day`; `deployRelIso = deployIntIso + 5 working days`; `deployProdIso ∈ ReleaseSchedule` on/after REL (FR-033/34/35).
- Any cadence date on a non-working day rolls to the next working day (FR-038).
- An AI-proposed `featureKey` not in scope, or an assignee not on the roster, ⇒ item rejected with reason; remainder unaffected (Edge Cases).
- An `ExistingChild` match ⇒ `PlanItemProposal.status='existing'`, never re-created (FR-055).
- AI-supplied dates are ignored; dates always come from `piPlanDates.ts` (FR-054).
