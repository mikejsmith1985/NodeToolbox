# Contract: Planning Engine (`piPlanEngine.ts`)

The pure orchestrator. Given accepted breakdown + reused inputs, it produces one `PlanProposal` that drives **both** the schedule and the capacity map (agree-by-construction, FR-042). No I/O, clock injected → deterministic (SC-003).

## Signature

```ts
buildPiPlanProposal(input: PiPlanEngineInput, todayIso: string): PlanProposal
```

### PiPlanEngineInput
- `piName: string` — window parsed via `parsePiDateRange` (REUSE).
- `features: FeatureInput[]` — in-scope Features (+ existing children).
- `acceptedStories: StorySuggestion[]` — the breakdown the PO accepted (AI-proposed, human-gated).
- `people: PersonCapacity[]` — roster mapped to delivery capacity (from `roleCapabilities` + per-sprint points).
- `releaseSchedule: ReleaseSchedule` — from `piPlanReleaseSchedule.ts`.
- `sprintLengthDays: number` (default 14), `workingCalendar: WorkingCalendar` (see date-cadence).

## Behavior (ordered)

1. **Expand** each accepted `StorySuggestion` → planner `PlanItem` with `devPoints`/`internalTestPoints` = 70/30 split of `sizePoints` (rounded, sum preserved); `bucket`/`rankInBucket` from the parent Feature's priority; `assignee` initially null.
2. **Schedule** by calling `buildCapacityPlan({ items, people, piName, sprintLengthDays, syntheticTestFraction, planStartIso }, todayIso)` (REUSE). Take `PlanResult.sprints`, `proposals` (assignment), `bottleneck`, `completionDateIso`, `unschedulableItemKeys`.
3. **Assign** each Story to its `ProjectedSprint` and to a roster member using the engine's capability-filtered least-loaded result (Q2); record `ScheduledStory`.
4. **Date** each `ScheduledStory` via `piPlanDates.ts` → `DatedItem` (see date-cadence contract).
5. **Match idempotency**: for each Story/sub-task, if an `ExistingChild` matches (by parent + kind + summary), mark `status='existing'` (not re-created).
6. **Assemble** `PlanItemProposal[]` (story + up to 4 sub-tasks + any `sprintCreate` for derived sprints + any `releaseSuggest`), attach `warnings`, and build `honestStates`.
7. Return `PlanProposal { piName, planResult, items, releaseSchedule, honestStates }`.

## Guarantees

- **Determinism**: same input + same `todayIso` ⇒ byte-identical `PlanProposal` (SC-003).
- **Agree-by-construction**: the capacity map reads `planResult.sprints[].loads`; committed totals equal the sum of scheduled work (FR-042, SC-004) — there is no second computation.
- **No silent drops**: `unschedulableItemKeys`, unsized Features, capability gaps, and PI over-commitment all surface in `honestStates`/`warnings` (FR-056).
- **Purity**: no `fetch`, no `Date.now()` — `todayIso` and `workingCalendar` are injected.

## Test obligations (TDD, vitest)

- 70/30 split rounds and preserves sum for odd sizes.
- A 13-pt cap breach and an over-capacity assignment each yield a `warning`, never a silent oversize.
- Two runs over identical input are identical.
- Capacity-map totals == sum of `ScheduledStory` effort per person/sprint.
- Existing child ⇒ `status='existing'`; no duplicate proposal.
- Existing `FeatureCanvas/planner` tests remain green (no engine edits, or wrapper-only).
