# Phase 0 Research: PI Planning Automation

All spec `## Clarifications` were resolved before planning; this file records the codebase-grounded design decisions (with the file:line evidence from recon) that make those clarifications buildable, plus the Framework-First reuse map.

## R1 — Reuse the FeatureCanvas planner for scheduling, capacity mapping, and assignment

- **Decision**: Feed the accepted Story breakdown into the existing `buildCapacityPlan(input, todayIso)` (`client/src/views/FeatureCanvas/planner/capacityPlanner.ts:506`) and render US2's capacity map directly from its `PlanResult.sprints[].loads` (`SprintPersonLoad`).
- **Rationale**: `capacityTypes.ts` already models exactly what we need: `PlanItem { devPoints, internalTestPoints, externalTestPoints, bucket, rankInBucket, assignee }`, `PersonCapacity { roles: ('dev'|'internalTest'|'externalTest')[], pointsPerSprint }`, and `PlanInput { items, people, piName, sprintLengthDays, syntheticTestFraction, planStartIso }`. The output `ProjectedSprint { index, name (YY.PI#.Sprint#), startIso, endIso, isBeyondPiEnd, loads, scheduledPoints }`, `AssignmentProposal`, `BottleneckReport`, `completionDateIso`, `sprintsBeyondPiEnd`, and `unschedulableItemKeys` cover Q1 (velocity via `pointsPerSprint`), Q2 (capability-aware assignment), the sprint calendar, and the honest states — already unit-tested. This is the Framework-First win; building a second scheduler would violate Article VII.
- **Alternatives considered**: a bespoke scheduler (rejected — duplicates a tested engine); the `SprintDashboard/capacityModel.ts` `CapacitySummary` (rejected as the *scheduler* — it is a single-window capacity total with no per-sprint breakdown, though it remains the source of the 80% recommended capacity per person).
- **Adaptation needed**: map roster `roleCapabilities {canDevelop, canInternalTest, canExternalTest}` → `DeliveryRole[]`; confirm the engine's assignment matches "least-loaded" and, if it differs, adapt via a thin wrapper rather than editing the engine (keep its tests green).
- **Per-person `pointsPerSprint` derivation (resolves analyze U2)**: `CapacitySummary` is a single PI-window, per-*role* total with **no per-sprint-per-person** breakdown, so `pointsPerSprint` is derived, not read directly. Rule: `sprintsInPi = ceil(workDayCount ÷ (sprintLengthDays × 5/7))` (whole 2-week sprints in the window); `teamPointsPerSprint = recommendedCapacityPoints ÷ sprintsInPi` (the 80%-adjusted total spread evenly); then **per person** `pointsPerSprint = teamPointsPerSprint ÷ activeMemberCount`, unless the roster/`useCapacityStore` supplies an explicit per-person capacity row, which takes precedence. This keeps the velocity basis (Q1) and the 80% recommendation consistent with what PI Review already shows. `activeMemberCount` counts roster members with ≥1 delivery capability. Encoded in the T009/T010 adapter and unit-tested.

## R2 — 70/30 dev/internal-test split maps onto PlanItem, not a new concept

- **Decision**: For each proposed Story of size `S` points, set `devPoints = split(S).dev` and `internalTestPoints = split(S).test` where the split is 70/30 (rounded, sum preserved), and feed those to the planner.
- **Rationale**: the planner already schedules dev and internalTest separately per person; expressing the split as explicit `devPoints`/`internalTestPoints` is the natural fit and keeps `syntheticTestFraction` available only as a fallback for Stories the AI leaves unsplit.
- **Alternatives**: rely on the engine's `syntheticTestFraction=0.5` (rejected — that is 50%, not the team's 70/30, and only fires when test points are absent).

## R2a — Feature priority/rank → MoSCoW bucket + rankInBucket (resolves analyze U1)

- **Decision**: the reused planner orders work by `PlanItem.bucket ('Must'|'Should'|'Could'|'Wont')` + `rankInBucket` (lower = more urgent), so `piPlanBreakdown.ts` maps each Feature's Jira priority → a bucket and its PI Review rank → `rankInBucket`. Mapping: `Highest`/`Blocker` → `Must`; `High` → `Should`; `Medium` → `Could`; `Low`/`Lowest` → `Wont` (still scheduled, last). A Feature marked **committed** in PI Review is forced to at least `Should`. `rankInBucket` = the Feature's PI Review priority ordinal (the `priority` column already used for ordering), stable-sorted; all Stories of a Feature inherit the Feature's bucket + rank. The mapping table is a named constant (not magic values) and is overridable via ART settings.
- **Rationale**: gives the deterministic scheduler a defined, repeatable ordering (SC-003) without inventing a new prioritization concept; reuses PI Review's existing priority/committed signals.
- **Alternatives**: let the AI assign buckets (rejected — non-deterministic, and bucketing is a scheduling concern the engine owns, not a breakdown concern); a flat FIFO order (rejected — ignores priority the team already sets).

## R3 — Working-day + deploy-cadence date engine is the one genuinely new pure module

- **Decision**: Build `piPlanDates.ts` — a pure, clock-injected module computing, per scheduled Story: **Target Start** (first working day of scheduled work), **internal-test end** (end of the 30% test portion → external-test gate), **Target End** = **deploy-to-INT** date (code in INT, the PI DoD) ≤ 1 day after internal-test end, **deploy-to-REL** = INT + 5 **working** days, **deploy-to-PROD** = the first production release date on/after REL, and **Due date** = the PROD date. All arithmetic in working days; any cadence date on a non-working day rolls to the next working day.
- **Rationale**: no existing module does calendar cadence; the planner stops at sprint placement + a completion date. Keeping this pure (inject `todayIso` + the working-day/holiday calendar) makes SC-005 (100% rules-conformant, explainable dates) unit-testable and satisfies the "recompute from rules, don't trust AI dates" requirement (FR-054).
- **PI dates source**: `parsePiDateRange(piName)` (`ArtView/hooks/artHelpers.ts:205`) parses start/end from the PI name string (e.g. `"PI 26.3 (05/21/26 - 07/29/26)"`); there is no separate PI date field. Sprint boundaries come from the planner's `ProjectedSprint.start/endIso`.
- **Alternatives**: let the AI supply dates (rejected — non-deterministic, breaks SC-003/SC-005); calendar-day cadence (rejected — user clarified 5 **working** days and all math is working-day).

## R4 — Production release schedule from PI-window fixVersions

- **Decision**: `piPlanReleaseSchedule.ts` reads project fixVersions, keeps those whose `releaseDate` falls within `[PI start, PI end]` (and slightly beyond, since PROD may follow the PI end per FR-036), sorts them into the release calendar, and — when a Story's earliest PROD date has no release on/after it — proposes an additional release positioned to keep releases ≈ monthly (flagged as a suggestion requiring acceptance).
- **Monthly-suggestion rule (resolves analyze A1)**: a suggested release is placed **deterministically** — its date = `rollToWorkingDay(max(REL, previousReleaseDate + 28 calendar days))`, i.e. the first working day that is both ≥ the Story's REL date and ≥ 28 days after the most recent (existing or already-suggested) production release. "previousReleaseDate" for the first suggestion is the last existing PI-window release, or the PI start when none exist. This keeps releases ≈ monthly, never closer than ~4 weeks, and is a pure function of the inputs (SC-003). Suggested releases are named e.g. `"<PI> Suggested Release <n>"` and always carry `isSuggested=true` (accept-required, FR-037).
- **Rationale**: FR-007/FR-037. fixVersions are read via the existing proxy; `saveFeatureReviewFixVersion` (`featureReviewFixes.ts:436`) already sets a version on an issue, so only the *read + suggest* half is new.
- **Open detail (plannable default)**: fixVersion listing endpoint — reuse the project/version read the field-discovery path already exercises; confirm the exact `GET /rest/api/2/project/{key}/versions` (or board release) call during implementation. Not blocking.

## R5 — Jira write flows: reuse primitives, add Story/Sub-task creation orchestration

- **Decision**: `piPlanJira.ts` orchestrates per accepted item, delegating every write to an existing primitive:
  - Create Story: `createIssue` (`jiraApi.ts:293`) with `issuetype: Story`, project from parent, and the Feature link (`customfield_10108` via `saveFeatureReviewIssueLinkField`, `featureReviewFixes.ts:417`, or the epic/parent field as the instance requires).
  - Create Sub-tasks (internal-test + INT/REL/PROD deploy): `createIssue` with `issuetype: Sub-task` **and `parent: { key }`** — the new parent-set path.
  - Dates: `savePiReviewFeatureDates` (`piReviewJira.ts:760`) writes Target Start (`customfield_10101`), Target End (`customfield_10102`), and `duedate`.
  - fixVersion: `saveFeatureReviewFixVersion` (`featureReviewFixes.ts:436`).
  - Sprint: `getBoardSprints` (`jiraApi.ts:219`) to reuse existing sprints; `createSprint` (`jiraApi.ts:196`) only for the derived-to-fill gaps; `assignIssueToSprint` (`commitJira.ts:38`) to place the Story.
  - Story points: `saveFeatureReviewStoryPoints` (dropdown-aware, `featureReviewFixes.ts:461`).
- **Rationale**: everything except Story/Sub-task *creation orchestration* already exists (recon GAP SUMMARY). The only new primitive behavior is passing `parent` to `createIssue` for sub-tasks.
- **Field ids**: discovered by name via `loadHygieneFieldConfig` / `matchFieldIdsByName` (`hygieneFieldConfig.ts:76,93`) with the known defaults (Target Start `customfield_10101`, Target End `customfield_10102`, PI `customfield_10301`, Feature link `customfield_10108`, Due = native `duedate`), overridable from `tbxARTSettings`.

## R6 — Idempotency read of a Feature's existing children

- **Decision**: `featureChildren.ts` fetches, per in-scope Feature, its existing child Stories and each Story's sub-tasks (requesting `subtasks` + a child-Story query) so the proposal marks already-present items as existing and never re-creates them (FR-055, US6).
- **Rationale**: recon confirms **no** current fetch requests `subtasks` or traverses child Stories (`SOURCE_FEATURE_BASE_FIELDS`, `loadSourceFeature.ts:17` omits `subtasks`). This is a genuine, small gap.
- **Alternatives**: skip idempotency (rejected — re-running is a first-class flow; duplicates are the exact failure the user wants avoided).

## R7 — AI envelope mirrors the shipped piReview module

- **Decision**: `ArtView/ai/piPlanAiAssist.ts` exposes `buildPiPlanAiPrompt(context)` and `parsePiPlanAiReply(reply, knownFeatureKeys)`, using the shared `extractJsonPayload` (`utils/extractJsonPayload.ts:13`) and a `kind:'piPlan'` guard, lenient-per-field/strict-per-key, returning `{ suggestions, unknownKeys, unparsedCount }`. The **AI proposes only the breakdown** (which Stories, their sizes, whether each has testable output); the engine owns all scheduling, assignment, and dates (FR-025, FR-054). Rendered through the reusable `ReportAiPanel` gated by `useAiAssistStore` (Ctrl+Alt+Z), with optional auto-dispatch via `useAiAssistExchange`.
- **Rationale**: identical shape to `piReviewAiAssist.ts` / `readinessAiAssist.ts` — a proven, tested pattern; keeps the AI's role minimal and the plan deterministic.
- **Alternatives**: let AI produce full dated plans (rejected — violates propose-only determinism and SC-003).

## R8 — Prompt input contract (answers "what else do we need")

The prompt (FR-001–FR-011) carries, as explicit data + named constants: PI name + parsed window; the sprint calendar (existing board sprints + derived fill); the working-day/holiday calendar; the roster with `roleCapabilities`; per-person + team per-sprint capacity (points); each Feature's key/summary/size/priority/dependencies/target fixVersion + existing children; the PI-window release schedule; the encoded rules (70/30, INT≤24h, REL+5 working days, PROD-on-fixVersion, monthly target, DoD-to-INT); the splitting rubric (testable-output definition, 13-pt max, independent-testability); the velocity effort→duration basis; and the issue-shape/field mapping. This is assembled by `piPlanAiFetch.ts` from the reused stores/fetches above.

## Summary of new vs reused

| Concern | Source |
|---------|--------|
| Sprint scheduling, per-person capacity map, assignment, completion/bottleneck | **REUSE** `FeatureCanvas/planner` |
| Roster + capabilities, capacity totals, PI dates, story-points write, field discovery, fixVersion set, target-date write, create issue/sprint, assign sprint, AI gate + prompt shell | **REUSE** existing modules |
| Feature→Story breakdown proposal (`{kind:'piPlan'}`) | **NEW** `ai/piPlan*` |
| Working-day + deploy-cadence date math | **NEW** `piPlanDates.ts` |
| Release schedule read + monthly suggestion | **NEW** `piPlanReleaseSchedule.ts` |
| Story/Sub-task creation flows (parent-set) + plan write orchestration | **NEW** `piPlanJira.ts` |
| Read Feature children for idempotency | **NEW** `featureChildren.ts` |
| Planner panel + capacity-map + proposal UI | **NEW** (composes `ReportAiPanel` + planner UI) |
