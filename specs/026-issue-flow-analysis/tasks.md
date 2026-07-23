# Tasks: Issue Flow Analysis — where the time actually goes

**Input**: Design documents from `/specs/026-issue-flow-analysis/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: INCLUDED — Article V (TDD, Red → Green → Refactor) is constitutional. Every implementation task is preceded
by its failing test. The timeline, stages, classifier and roll-ups are all **pure**, so the analysis itself is under
test rather than merely the plumbing.

**Organization**: five user stories. Because they are facets of one analysis, phases are ordered by **dependency**.
Two things are worth knowing before starting:

- **US4 depends on nothing.** It is three description corrections with a "no figure changes" guard. It fixes the
  report that is misleading people *today* and can ship on its own, first.
- **T003 is the riskiest task in the feature** and comes early. It refactors shipped code, and its acceptance test is
  that 35 existing tests pass **unmodified**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[US1..US5]**: story label on story-phase tasks only
- Exact file paths in every description

---

## Phase 1: Setup

- [X] T001 Confirm gates run green **before** any change: `cd client && npx vitest run && npx tsc -b`, then
      `npm test` and `npm run test:dom` from `C:\ProjectsWin\NodeToolbox`. Record the baseline — a pre-existing
      server failure in `test/unit/monthlyDeliveryConfig.test.js` is expected and unrelated. **Also capture a
      Personal Workflow run** (one roster, 90 days) and save its figures: T003 must not change them.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: extract the shared timeline core, and recover the assignee identity the existing reader discards.

**⚠️ T003 modifies shipped code.** `personalFlow.test.ts` must pass with **zero edits**. If a test needs changing to
go green, the extraction changed behaviour — revert and redo it rather than adjusting the test to fit
(`contracts/issue-timeline.md`).

- [X] T002 [P] RED — create `client/src/views/ReportsHub/issueTimeline.test.ts` covering the list in
      `contracts/issue-timeline.md`: `buildStateSegments` with a **boolean** value type reproduces the ownership
      behaviour the engine relies on; the **same function with an object value type** (an assignee identity) produces
      the same span structure — the genericity this whole feature rests on; change points at/before/after the origin
      are clamped not dropped; consecutive identical values merge rather than splitting; a weekend-only span credits
      zero working days but is still a span; two calls with identical input are deeply equal.
- [X] T003 GREEN — create `client/src/views/ReportsHub/issueTimeline.ts` by **moving** `buildStateSegments`,
      `StateSegment`, `resolveOriginMs` (exported as `resolveTimelineOriginMs`), `businessMillisBetween`, `isWorkday`
      and `MILLISECONDS_PER_DAY` out of `client/src/views/ReportsHub/personalFlow.ts`, and make `personalFlow.ts`
      import them. **Behaviour-preserving: keep the origin rule, the Monday–Friday definition and every boundary
      behaviour exactly as they are** — this is **NFR-005**, the safety property governing this task. Verify
      `personalFlow.test.ts` passes **unmodified**.
- [X] T004 [P] RED — create `client/src/views/ReportsHub/issueFlowHistory.test.ts`: a reader that turns an issue's
      changelog into `holderTransitions` **retaining the assignee identity** (machine id + display name), where a
      change to no assignee yields the explicit `Unassigned` holder; the initial holder is read from the first
      assignee change's `from` side, falling back to the current assignee field.
- [X] T005 GREEN — implement `client/src/views/ReportsHub/issueFlowHistory.ts`. Model it on `readOwnershipHistory`
      (`PersonalFlowTab.tsx:214`) but **keep `item.to` / `item.toString` instead of collapsing them to a boolean** —
      that single collapse is why the existing engine cannot answer "whose was it?". Do not modify the existing
      reader; the person-centric report still needs its boolean.
- [X] T006 Generalise `client/src/views/ReportsHub/flowAuditFetch.ts` — rename the person-scoped identifiers
      (`fetchAllPersonIssues`, `PER_PERSON_ISSUE_CEILING`, `PersonFetchOutcome`) to unit-neutral names so both
      analyses can bound themselves identically (NFR-006a). **Behaviour unchanged**; its 13 tests stay green with
      only the renamed imports touched.
- [X] T007 Add a `WAS` variant to `buildStandupRosterAssigneeClause`
      (`client/src/views/SprintDashboard/hooks/useStandupRosterStore.ts:313`) producing `assignee WAS in (…)`. The
      analysis needs issues the team **held at some point**, not ones they hold now — an issue built by a developer
      and handed to a PO outside the roster would be invisible under `assignee =`, and that hand-off is the delay the
      feature exists to find (research R3). Keep the existing `assignee in (…)` behaviour for its current callers.

**Checkpoint**: one shared reconstruction, identity retained, bounded fetching. Stories may now proceed.

---

## Phase 3: User Story 4 — The existing report describes itself accurately (Priority: P1) 🎯 SHIP FIRST

**Goal**: three descriptions that state things the calculation does not do (FR-016..FR-020). **Wording only.**

**Independent test**: read each description against its calculation; run the same window before and after and confirm
every figure is unchanged (quickstart Test 8).

**Depends on nothing** — not even Phase 2. It corrects a report that is misleading people today, so it can ship on
its own while the rest is built.

- [X] T008 [P] [US4] RED — extend `client/src/views/ReportsHub/flowAuditMetrics.test.ts`: the Issues description says
      work **advanced** and does **not** claim "moved to done"; it states that work handed on and never finished is
      still counted; the Points description frames points as the **issue's size credited in full to each person who
      advanced it**, not personal output; both are marked as **not summable across the team**. Plus the guard that
      matters: **a fixture's computed figures are byte-identical before and after** (FR-019).
- [X] T009 [US4] GREEN — correct the three descriptions in `client/src/views/ReportsHub/flowAuditMetrics.ts` per
      `contracts/flow-reporting.md`. Because the audit document derives from these same definitions, correcting them
      once fixes the screen and the published page together (FR-020). **Change no calculation.**

**Checkpoint**: 🎯 shippable on its own. The report no longer claims something it does not do.

---

## Phase 4: User Story 1 — Where a delivered issue's time went (Priority: P1)

**Goal**: per-issue stages and the three totals, reconciled (FR-001..FR-003, FR-005..FR-005b; contract
`flow-stages.md`).

**Independent test**: open one issue's stage breakdown beside its Jira history and confirm every stage matches, then
add the stage durations up by hand (quickstart Tests 1 and 2).

- [X] T010 [P] [US1] RED — create `client/src/views/ReportsHub/issueFlow.test.ts` covering `contracts/flow-stages.md`:
      a status change mid-holder produces two stages (same holder, different statuses); **a holder change mid-status
      produces two stages (same status, different holders)** — the case the existing engine cannot represent at all;
      three holders in turn produce ordered stages; unassigned periods appear as the `Unassigned` holder and are
      never merged into a neighbour; **stages sum exactly to lead time**; stages from first-started sum exactly to
      cycle time; `lead − cycle === preWorkWait`; an issue that never started has cycle time 0 and its whole lead
      time as wait; an issue with no done transition returns `null`; a reopened issue uses its **last** done entry;
      stages after completion are excluded from both clocks; two identical calls are deeply equal.
- [X] T011 [US1] GREEN — implement `client/src/views/ReportsHub/issueFlow.ts` exporting `buildIssueFlow`. Intersect
      the holder and status timelines into stages, then **derive every total by summing stages — never compute one in
      parallel** (research R9). That is the only way the reconciliation can fail, so the possibility is designed out
      rather than tested for. Durations in **working days**, via the shared `businessMillisBetween`.
- [X] T011a [US1] **Prove the two analyses agree (SC-007 / NFR-001)** — add a test in
      `client/src/views/ReportsHub/issueFlow.test.ts` that runs **both** engines over one fixture issue and asserts a
      person's summed `active` stage time from `buildIssueFlow` equals that same person's `cycleTimeDays` from
      `computePersonalFlow`. This is the one assertion proving the extraction achieved its purpose: the whole
      argument for sharing `issueTimeline.ts` rather than writing a second engine is that both analyses then agree
      **by construction**, and nothing else in the suite checks that they actually do. Without it the two reports
      could one day give different answers about the same person on the same issue — the exact failure this feature
      exists to prevent elsewhere.

---

## Phase 5: User Story 5 — Wait time attributed to a person or a queue (Priority: P2)

**Goal**: unowned time is visible as its own holder, never dropped and never charged to the next person (FR-002).

**Independent test**: find an issue that sat unassigned between hand-offs and confirm it shows an explicit
`Unassigned` stage with its own duration (quickstart Test 6).

- [X] T012 [P] [US5] RED — extend `client/src/views/ReportsHub/issueFlow.test.ts`: an issue unassigned between two
      people produces three stages — person, `Unassigned`, person — with the queue duration on the middle one and
      **not** added to either neighbour. An issue never assigned at all is entirely `Unassigned` and still analysed.
- [X] T013 [US5] GREEN — ensure `client/src/views/ReportsHub/issueFlow.ts` and
      `client/src/views/ReportsHub/issueFlowHistory.ts` carry the `Unassigned` holder end to end. It is a **value,
      not an absence**: queue time is expected to be one of the largest buckets, so representing it as missing data
      would hide the feature's most useful finding.

---

## Phase 6: User Story 2 — Where the team's flow is lost (Priority: P1)

**Goal**: classification and roll-ups — the "where is flow lost" answer (FR-007..FR-011, contract `flow-stages.md`
and `flow-reporting.md`).

**Independent test**: read the per-status roll-ups and name the largest contributor and whether it is work or waiting
(quickstart Tests 4 and 5).

- [X] T014 [P] [US2] RED — create `client/src/views/ReportsHub/issueFlowStatusClass.test.ts`: each default pattern
      (`ready for`, `waiting`, `blocked`, `on hold`, `pending`, `in review`, `to be`, `queue`) classifies as
      `waiting`, case-insensitively; other `indeterminate` statuses are `active`; `new` is `not-started` and `done`
      is `completed`; a user override beats every pattern; a genuinely ambiguous status is `unclassified` **and its
      time still counts**; **reclassifying a status changes its bucket and not its duration**.
- [X] T015 [US2] GREEN — implement `client/src/views/ReportsHub/issueFlowStatusClass.ts`. Keep it isolated from the
      arithmetic: this is a judgement call that will be revised, and isolating it means revising it cannot disturb a
      single duration.
- [X] T016 [P] [US2] RED — create `client/src/views/ReportsHub/issueFlowRollup.test.ts`: per-status total, median and
      p85 over a multi-issue fixture; **an outlier moves p85 but not the median** — the property that makes reporting
      the pair worthwhile; roll-up totals sum to the overall stage total; waiting and active never appear combined in
      one figure; the largest contributor is identified with its class; each roll-up carries its issue keys.
- [X] T017 [US2] GREEN — implement `client/src/views/ReportsHub/issueFlowRollup.ts` exporting
      `summariseStageRollups`, per `contracts/flow-reporting.md`.

---

## Phase 7: User Story 3 — Team totals are honest (Priority: P1)

**Goal**: the direct fix for the double-count found in review (FR-012..FR-015).

**Independent test**: sum the per-person Issues column and confirm it exceeds the team delivered-issue total, which
counts each issue once (quickstart Test 7).

- [X] T018 [P] [US3] RED — extend `client/src/views/ReportsHub/issueFlowRollup.test.ts`: an issue held by four people
      counts **once**, with its points counted once; and the test that pins the defect — for a fixture where one
      issue passes through two people, **the delivery total does not equal the sum of the per-person columns**.
- [X] T019 [US3] GREEN — implement `computeDeliveryTotals` in `client/src/views/ReportsHub/issueFlowRollup.ts`,
      computed over the **distinct issue set** and never by summing per-person figures.
- [X] T020 [US3] Label the non-summable per-person columns in
      `client/src/views/ReportsHub/PersonalFlowTab.tsx` and show the correct team total **beside** them (FR-014a). A
      label alone does not survive a copy into a document and being totalled there; supplying the number the reader
      was reaching for removes the reason to add the column up.

---

## Phase 8: Surfacing it — tab and document

**Goal**: the analysis is reachable and shareable (FR-011a/b, NFR-006, NFR-007).

- [X] T021 Create `client/src/views/ReportsHub/IssueFlowTab.tsx` — fetch via the generalised
      `flowAuditFetch` with both ceilings, using the `assignee WAS in (…)` roster clause from T007; render the flow
      summary, the roll-ups, the classification, and the per-issue breakdown. **No analysis logic in this file.**
- [X] T022 Register the tab in `client/src/views/ReportsHub/ReportsHubView.tsx`, passing `state.teamFilter` exactly as
      the Personal Workflow tab now does, so both tabs scope to the same team without reselecting.
- [X] T023 [P] RED — extend `client/src/views/ReportsHub/flowAuditDocument.test.ts`: the flow sections render in
      order; **lead and cycle time always appear together** and the pre-work wait appears as its own figure; every
      duration is marked **working days**; the classification section lists each status with its class including
      unclassified ones; the waiting-time redistribution notice is present **and distinct from** the throughput one.
- [X] T024 GREEN — add the flow sections to `client/src/views/ReportsHub/flowAuditDocument.ts` and the flow metric
      definitions to `client/src/views/ReportsHub/flowAuditMetrics.ts`, per `contracts/flow-reporting.md`. Write the
      waiting-time notice **specifically**: naming individuals against queue time reads as blame unless the reader is
      told a queue is usually a property of the system rather than of the person holding the issue.
- [X] T025 Add progress reporting and cancellation to the run in
      `client/src/views/ReportsHub/IssueFlowTab.tsx` (NFR-007), and disclose a reached ceiling prominently, naming
      what is incomplete (NFR-006). A cancelled run leaves prior results and produces **no** document.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T026 Style the new tab in `client/src/views/ReportsHub/ReportsHubView.module.css` — light/dark themes,
      A/A+/A++ text sizes, narrow widths reflowing rather than clipping, and **waiting versus active distinguishable
      without relying on colour** (NFR-004).
- [X] T027 Add one `CHANGELOG.md` entry under `## [Unreleased]` covering the new analysis, the three corrected
      descriptions, and the honest team totals. **Call out that per-person columns were never summable** — anyone who
      totalled them previously has a wrong number in a document somewhere.
- [~] T028 **Run quickstart Test 0 — the NFR-005 guard**: `personalFlow.test.ts` passes unmodified, and a Personal
      Workflow run matches the T001 baseline figure-for-figure. If anything moved, the extraction changed behaviour —
      revert it rather than accept the new numbers. Unit tests alone cannot prove this: a behaviour change all 35
      happen to tolerate would still move a real figure, which is why the before/after run exists.
- [ ] T029 Run quickstart Tests **1, 2 and 7** by hand against live Jira — check one issue's stages against its Jira
      history, add the stage durations up, and confirm the per-person column sums higher than the team total. **These
      cannot be automated and are the definition of done**: the suites prove internal consistency, only these prove
      the analysis is true.
- [ ] T030 Run the quickstart Test 10 regression sweep — **NFR-005** end to end: Personal Workflow figures and its
      audit document unchanged apart from the three descriptions; Issue Aging, hygiene and PI Review untouched; the
      Reports Hub team filter scoping both tabs consistently.
- [X] T030a **NFR-003 — confirm no widened data access.** Verify every Jira request this analysis makes runs under
      the running user's own credentials, with no elevated or service-account path. It holds by construction today,
      but this feature newly surfaces **people outside the roster** by name against waiting time, so the property is
      worth asserting in review rather than assumed.
- [X] T031 Final gates: `cd client && npx vitest run && npx tsc -b`, then `npm test` and `npm run test:dom` from
      `C:\ProjectsWin\NodeToolbox`. All green except the known pre-existing `monthlyDeliveryConfig` server failure.

---

## Dependencies

```
Phase 1 (Setup: T001)
        │
        ├──────────────────────────────► US4 (T008–T009) 🎯 needs NOTHING else — ship first
        ▼
Phase 2 (Foundational: T002–T007)
        │
        ▼
   US1 (T010–T011)  ── stages + totals
        │
        ├──────────────► US5 (T012–T013)   extends issueFlow.ts
        │
        ▼
   US2 (T014–T017)  ── classification + roll-ups
        │
        ▼
   US3 (T018–T020)  ── honest totals (extends issueFlowRollup.ts)
        │
        ▼
Phase 8 (Tab + document: T021–T025)
        │
        ▼
Phase 9 (Polish: T026–T031)
```

**Story independence — stated honestly**: **US4 is genuinely independent** of everything, including Phase 2. The
others are not: US5 extends US1's module, US3 extends US2's, and both depend on stages existing. The graph reflects
the real shape rather than implying parallelism that is not there.

---

## Parallel execution opportunities

| Phase | Parallel set | Why safe |
|---|---|---|
| 1/3 | **US4 ∥ Phase 2** | US4 touches only `flowAuditMetrics.ts` descriptions; Phase 2 touches the engine. Genuinely disjoint |
| 2 | T002 ∥ T004 | Different test files |
| 6 | T014 ∥ T016 | `issueFlowStatusClass.test.ts` vs `issueFlowRollup.test.ts` |
| 8 | T023 ∥ T021 | Document test vs tab component |

**Shared-file caveats**: T010/T011 and T012/T013 both edit `issueFlow.ts`; T016/T017 and T018/T019 both edit
`issueFlowRollup.ts`; T009 and T024 both edit `flowAuditMetrics.ts`. Sequence within each file.

---

## Implementation strategy

**Ship US4 first, on its own.** T001, T008, T009 — three description corrections and a guard that no figure moves.
It is a day's work at most and it stops a shipped report claiming something untrue. Everything else can follow at its
own pace.

**Then Phase 2, carefully.** T003 is the highest-risk task in the feature: it refactors code the Personal Workflow
report depends on. Its safety argument is entirely "nothing changed", which is why T028 re-checks it against the
T001 baseline at the end rather than trusting the unit tests alone.

**Then US1 → US5 → US2 → US3**, each building on the last, with the tab and document last so there is something
worth surfacing before the surfacing is built.

**Sizing note**: research R1 found the timeline machinery is already generic, so the reconstruction is an extraction
rather than a rewrite. The genuinely new code is the stage intersection, the classifier, and the roll-ups — all pure,
all small, all testable without a browser.

**Total: 33 tasks** — 1 setup, 6 foundational, 2 (US4), 3 (US1), 2 (US5), 4 (US2), 3 (US3), 5 (tab + document),
7 polish.

*(T011a and T030a were added by `/speckit-analyze` remediation: T011a proves the two analyses agree — SC-007, the
property the whole extraction exists to guarantee and the one thing nothing tested — and T030a covers NFR-003.
NFR-005 is now cited on T003, T028 and T030, the tasks that actually guard it.)*
