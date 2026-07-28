# Research — PI Delivery Framework (032)

All decisions were resolved against the **actual shipped code** (028 `piPlan*`, `FeatureCanvas/planner`, 031
classification) rather than assumed. Each entry: Decision · Rationale · Alternatives considered.

## R1 — Move the capacity unit from Story → per-repo coding sub-task

**Decision**: Feed each **coding sub-task** (one per repo a Story touches) into `buildCapacityPlan` as its own
`PlanItem` (`devPoints` = that repo's dev share, `internalTestPoints` = 0), and the Story's **SL-test** as a separate
`PlanItem` carrying the test points (`devPoints` = 0, role `internalTest`). The Story becomes a **grouping/parent**,
not a schedulable unit.

**Rationale**: `buildCapacityPlan` load-balances `PlanItem`s across `PersonCapacity` by role. Making each coding
sub-task a `PlanItem` yields exactly the requested behaviour — different devs assigned to different repos of the same
Story, working **in parallel** — with zero new scheduling code. Splitting SL-test into its own item makes SL testing a
**distinct capacity stream**, which is what surfaces it as its own constraint (R3).

**Alternatives**: (a) keep the Story as the unit and post-assign repos — rejected: cannot express parallel per-repo
assignment or SL-test-as-own-constraint. (b) A bespoke scheduler — rejected under Article VII (the planner already
does this).

## R2 — Roll the Story's dates up from its children

**Decision**: The Story's **Target Start** = earliest coding sub-task start; coding completes → **SL-test** runs
(its 30% duration) → **INT** within 24h of SL-test end (= **Target End** = code-in-INT = DoD) → **REL** = INT + 5
working days → **PROD** on the covering fixVersion (**Due**, may be post-PI). Dates are computed by the existing
`computeItemDates` (`piPlanDates.ts`) with the Story's rolled-up SL-test-end as the gate.

**Rationale**: `piPlanDates` already encodes the exact cadence (SL/internal-test end gates INT ≤24h; REL = INT + 5
working days; PROD on fixVersion; Due may exceed PI). Only the **input** changes — the gate date now comes from the
latest child rather than a single-assignee Story. Keeps all date math in one reused module.

**Alternatives**: date each sub-task independently with no rollup — rejected: the Story needs a single Target
Start/End for reporting and the DoD gate.

## R3 — SL-test as its own capacity constraint (reuse `BottleneckReport`)

**Decision**: Model SL testers via the existing `internalTest` `DeliveryRole`. `buildCapacityPlan` already emits a
`BottleneckReport` whose `limitingRole` becomes `internalTest` when test throughput — not dev — is the critical path,
with `additionalToMatchThroughput` / `additionalToFinishByPiEnd`. **This is the SL-test bottleneck**, already computed.
`piPlanBottlenecks` consumes it and adds a per-sprint SL-queue view.

**Rationale**: The named real-world pain (one shift-left tester, work piling up) is precisely a limiting-role
bottleneck, which the planner already detects and quantifies. Article VII: reuse, don't rebuild.

**Alternatives**: a from-scratch SL-throughput model — rejected; it would duplicate `BottleneckReport` and risk
disagreeing with the schedule it is supposed to describe.

## R4 — The PI Planning Fact Sheet and its query sources

**Decision**: A pure `assembleFactSheet(inputs)` builds a single immutable object from a **fixed** query set, each
mapped to an existing fetcher:

| Fact | Source (existing) |
|------|-------------------|
| Committed Features (key, summary, size, priority, committed, deps, fixVersion) | `piReviewPullFeatures` |
| Repo/domain classification per Feature (repo allowlist) | `componentClassificationStore` (031) |
| Roster + capabilities (roles → `DeliveryRole`) | `useStandupRosterStore` |
| Per-sprint capacity (`PersonCapacity`, ×0.8 load factor) | `buildCapacityPlan` inputs |
| PI board sprints (reuse-first) | `getBoardSprints` |
| Existing children (Stories/sub-tasks) for idempotency | `featureChildren` |
| fixVersion release schedule | `piPlanReleaseSchedule` |
| Historical velocity (points/sprint) | `workflowDelivery` |
| Field/status config (in-INT, SL-done, done-category) | `loadHygieneFieldConfig` |

The fact sheet feeds the engine **and** is embedded verbatim (compact tables) in the AI prompt.

**Rationale**: One deterministic bundle = the anti-hallucination spine. If the AI never has to supply a fact, it can't
get a fact wrong; agree-by-construction because engine and prompt read the identical object.

**Alternatives**: let the prompt gather context free-form — rejected: that is exactly the hallucination surface the
user asked to eliminate.

## R5 — 80% load factor and the Sprint-5 Week-1 delivery window

**Decision**: Apply the **0.8 load factor** by scaling each `PersonCapacity.pointsPerSprint` when assembling the fact
sheet (single choke point). Model the **delivery window** as ending at the **end of Sprint 5, Week 1**: for scheduling
purposes the effective planning deadline is that date, and **Sprint 5 Week 2 carries zero delivery capacity**
(implemented as a prorated final sprint of ~1 week, or a capacity of 0 for week 2). Work whose Target End would fall
in Week 2 is surfaced as over-commitment via the existing `sprintsBeyondPiEnd`/warning path.

**Rationale**: Both are thin, deterministic transforms on inputs the planner already consumes (`pointsPerSprint`,
`planStartIso`, sprint length). No scheduler change.

**Alternatives**: a formal IP-sprint concept in the planner — rejected as over-engineering; the window/capacity
haircut expresses the same intent with existing knobs.

## R6 — Partition dev points across a Story's coding sub-tasks

**Decision**: Split the Story's **dev (70%) points equally** across its repos, at least 1 point each, **PO-editable**
before acceptance (mirrors 031's `pointsPerRepoStory`). SL-test (30%) stays a single sub-task.

**Rationale**: Deterministic, explainable, and adjustable — no basis exists yet to weight repos differently (the
repo-affinity/effort learning is a future phase). Keeps the sum honest against the Story size.

**Alternatives**: AI-proposed per-repo weights — rejected: that is effort estimation the AI would guess; kept
deterministic and PO-overridable.

## R7 — The `{kind:'piDeliveryPlan'}` envelope and allowlist-reject

**Decision**: The prompt asks the AI for **only**: per-Feature Story decomposition (which repos group into which
Stories, Story name, AC hints) and a **mitigation narrative** keyed to engine-flagged bottleneck ids. The reply is a
`{kind:'piDeliveryPlan', stories:[…], mitigations:[…]}` envelope parsed through the shared
`extractJsonPayload`+`repairJsonPayload`. **Ingest rejects** any story whose repo/feature key, or any mitigation whose
person/sprint/bottleneck id, is **not present in the fact sheet**, with an explicit per-item reason; dates/capacity/
assignment fields, if present, are **ignored**.

**Rationale**: Matches the shipped propose-only pattern (016/028) and the 031 allowlist-reject-on-ingest rule;
constrains the AI to the one judgement it is good at (grouping/naming) while the engine owns everything checkable.

**Alternatives**: let the AI return dates/assignments for convenience — rejected (FR-017): it reintroduces the
hallucination risk and breaks agree-by-construction.

## R8 — Monitoring signals and replan-trigger thresholds

**Decision**: `piPlanMonitor` computes, against the written plan and live Jira: **burn-up** (completed vs planned
points per sprint), **sub-task aging** (In Progress beyond a cycle target), **SL-test queue depth** (SL-test sub-tasks
awaiting/started vs SL capacity), **issue freshness** (days since the last GitHub-intake comment), and **commit vs
complete** per sprint. **Replan triggers**: (a) a Story whose delivery has slipped beyond its planned sprint; (b) the
SL-test queue exceeding capacity for **two consecutive** sprints. Pure functions; clock injected.

**Rationale**: These are the deterministic signals that let the team watch adherence instead of re-planning; freshness
reuses the GitHub email-intake comments already landing on issues. Thresholds are explicit so "monitoring" never
silently becomes ad-hoc planning.

**Alternatives**: AI-summarised health — rejected: monitoring must be deterministic and trustworthy.

## R9 — Disposition of 031's `repoStoryBreakdown`

**Decision**: **Remove** `repoStoryBreakdown.ts` and its test once the repo-subtask path is green. 031's
**classification store** (`componentClassificationStore`) and **domain rule** are **kept** (still the repo allowlist +
domain tagging); only the one-Story-per-repo *generation* is superseded.

**Rationale**: The framework now generates one *sub-task* per repo, not one Story — the two cannot coexist as the
story set. Keeping the dead module would re-litigate the model. Confirm no other importer before deletion.

**Alternatives**: leave it dormant — rejected under Article VI/VII (dead, contradictory code).

## Resolved unknowns

No `NEEDS CLARIFICATION` remain — all resolved from the 2026-07-27 call, the follow-up answers (DoD, isolation,
load-balance assignment, 80%/Sprint-5, Spec-Kit-as-032), and the code recon above.
