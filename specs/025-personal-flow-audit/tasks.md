# Tasks: Personal Workflow — Auditable Markdown Report

**Input**: Design documents from `/specs/025-personal-flow-audit/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: INCLUDED — Article V (TDD, Red → Green → Refactor) is constitutional. Every implementation task is preceded
by its failing test. The generator, metrics and links are **pure**, so the document itself is under test, not merely
the plumbing around it.

**Organization**: five user stories. Because they are facets of one document rather than separate surfaces, the phases
are ordered by **dependency** — links and metrics are built before the document that assembles them. The shippable
increment is marked at Phase 5.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[US1..US5]**: story label on story-phase tasks only
- Exact file paths in every description

---

## Phase 1: Setup

- [X] T001 Confirm gates run green **before** any change: `cd client && npx vitest run && npx tsc -b`, then
      `npm test` and `npm run test:dom` from `C:\ProjectsWin\NodeToolbox`. Record the baseline — a pre-existing
      server failure in `test/unit/monthlyDeliveryConfig.test.js` is expected and unrelated.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the engine must retain the worked-example evidence it currently discards, and must stop truncating at 100
issues. **Both change the numbers the document reports**, so no story work starts until they are green.

**⚠️ CRITICAL**: `buildSearchJql` (`PersonalFlowTab.tsx:258`) is a **deliberate superset** of what gets credited —
do NOT "simplify" it, and do NOT link it beside a credited count (research R2, contract `evidence-links.md`).

- [X] T002 [P] RED — extend `client/src/views/ReportsHub/personalFlow.test.ts`: `computePersonalFlow` returns a
      **worked example** for one credited issue, carrying its ownership stints, qualifying in-progress spans (with
      status name and working days), and a total; the spans sum to the total; the total equals that issue's
      `cycleTimeDays` in `perIssue`. Assert an issue with **no** measurable hands-on time is never chosen (FR-010c).
- [X] T003 GREEN — in `client/src/views/ReportsHub/personalFlow.ts` retain the internal `OwnershipInterval` /
      `StateSegment` / `CompletedContribution` data for **one nominated credited issue** and expose it on
      `PersonalFlowResult` per `data-model.md`. **Select the issue inside the engine**, while the spans are still in
      scope — choosing it afterwards would mean re-deriving, and a second derivation could disagree with the first.
      Keep the function pure (clock still injected via `todayIso`).
- [X] T004 [P] RED — add tests in `client/src/views/ReportsHub/PersonalFlowTab.test.tsx` for the paged fetch: a
      person with more issues than one page returns **all** of them; the per-person ceiling stops at its limit and
      reports that it did; the overall run budget stops the roster and reports which people were affected (FR-019a/b).
- [X] T005 GREEN — in `client/src/views/ReportsHub/PersonalFlowTab.tsx` replace the single-page
      `maxResults=${MAX_ISSUES}` fetch at `:266` with a paged loop (`startAt`), bounded by two named constants — a
      per-person issue ceiling and an overall run budget — whichever is reached first. Surface which ceiling was hit
      and for whom. Remove the silent 100-issue truncation.
- [X] T006 GREEN — add progress reporting and cancellation to the roster loop in
      `client/src/views/ReportsHub/PersonalFlowTab.tsx` (`:1620`, `for (const rosterMember of ...)`): report **which
      person and how many of how many** (NFR-006), and check a cancel flag between people and between pages within a
      person (research R7). A cancelled run MUST leave prior results displayed and produce **no** document (NFR-006a).
- [X] T007 [P] Component test in `client/src/views/ReportsHub/PersonalFlowTab.test.tsx`: progress names the current
      person and position; cancelling stops further fetches, keeps prior results on screen, and yields no document.

**Checkpoint**: the engine reports complete figures and can explain one issue. Stories may now proceed.

---

## Phase 3: User Story 3 — I can open the exact issues in Jira (Priority: P1)

**Goal**: every claim is reachable in Jira, and each link returns exactly the number beside it (FR-011..FR-015;
contract `evidence-links.md`).

**Independent test**: for any person, the credited link returns exactly the credited count — not the larger fetched
set (quickstart Test 3).

- [X] T008 [P] [US3] RED — create `client/src/views/ReportsHub/flowAuditLinks.test.ts` covering the full list in
      `contracts/evidence-links.md`. **The highest-value case**: given 20 fetched of which 12 credited, the credited
      link names **12 keys** and is **not** the fetch JQL — this fails if anyone ever merges the link kinds. Plus:
      fetched link equals `buildSearchJql` character for character; one excluded link per reason containing only that
      reason's keys; `credited + Σ excluded === fetched`; `baseUrl = null` degrades to query text with
      `isClickable === false`; empty key set produces no malformed `issueKey in ()`; two people produce disjoint links.
- [X] T009 [US3] GREEN — implement `client/src/views/ReportsHub/flowAuditLinks.ts` exporting
      `buildFetchedIssuesLink`, `buildCreditedIssuesLink` and `buildExcludedIssuesLink`, each returning an
      `EvidenceLink { href, queryText, isClickable }`. Compose the **existing** `buildSearchJql`
      (`PersonalFlowTab.tsx:258`) and `buildJiraIssueNavigatorUrl`
      (`client/src/views/Hygiene/utils/buildHygieneJqlUrl.ts:100`) — the latter already returns raw JQL when no base
      URL is set, which is FR-015 for free. Build no URLs by hand.
- [X] T010 [US3] Upgrade `TeamFlowQueryCell` in `client/src/views/ReportsHub/PersonalFlowTab.tsx` (`:870`) from a
      copy-only cell to a **one-click link plus** the existing Copy button, using the credited link for the row's
      figures. Keep the copy affordance working (quickstart Test 10).

**Checkpoint**: every number in the on-screen table is already reachable in Jira.

---

## Phase 4: User Story 2 — Every number shows how it was calculated (Priority: P1)

**Goal**: each metric carries its meaning, formula and a worked value; history-derived metrics carry a worked example
(FR-006..FR-010d; contract `audit-document.md`).

**Independent test**: a reader can state what any figure measures and how it was derived, from the document alone
(quickstart Tests 2 and 5).

- [X] T011 [P] [US2] RED — create `client/src/views/ReportsHub/flowAuditMetrics.test.ts`: every column the team table
      renders has exactly one `MetricDefinition`; each carries meaning, formula and `linkKind`; `Avg Cycle Time` and
      `Median Cycle Time` are flagged `isHistoryDerived` and state that no Jira search reproduces them; a formula
      renders **with values substituted and names whose figures were used** (FR-008); an undefined metric renders
      "not applicable, because…" and **never `0`** (FR-009).
- [X] T012 [US2] GREEN — implement `client/src/views/ReportsHub/flowAuditMetrics.ts` with the `MetricDefinition` table
      from `contracts/audit-document.md` and a `renderMetricExplanation` that substitutes real values.
- [X] T013 [P] [US2] RED — extend `client/src/views/ReportsHub/flowAuditMetrics.test.ts` for worked-example
      rendering: it names the issue and the person (FR-010c), lists stints and qualifying spans with their working
      days, and its spans sum to the stated total.
- [X] T014 [US2] GREEN — implement worked-example rendering in
      `client/src/views/ReportsHub/flowAuditMetrics.ts`, consuming the evidence T003 surfaced. Derive nothing — a
      second derivation could disagree with the engine's.

---

## Phase 5: User Story 1 — I can publish the report with its working shown (Priority: P1) 🎯 MVP

**Goal**: one team-wide document, copyable in a single action (FR-001..FR-005, FR-020; contract `audit-document.md`).

**Independent test**: generate for a roster, copy, paste into Confluence — it renders as formatted content with
working links (quickstart Tests 1, 2, 6).

**Note**: this story *assembles* US2 and US3, so it follows them by dependency rather than by priority.

- [X] T015 [P] [US1] RED — create `client/src/views/ReportsHub/flowAuditDocument.test.ts`: all seven sections present
      in the order given in `contracts/audit-document.md`; **section 4 appears exactly once for a 10-person roster,
      not ten times** (FR-006a, SC-011 — the readability rule under test); per-issue detail comes last (FR-010d);
      every team-table column has a matching explanation; **purity** — two calls with identical inputs are
      byte-identical, inputs are not mutated, and output does not vary with wall-clock time. Also assert **NFR-002's
      three-way agreement directly**: for one person, the stated figure, the result of its formula-with-values, and
      the number of keys in its credited link all match. Asserting the parts individually is not the same as asserting
      they agree.
- [X] T016 [US1] GREEN — implement `client/src/views/ReportsHub/flowAuditDocument.ts` exporting
      `buildFlowAuditDocument(input: FlowAuditInput): string`, composing `flowAuditMetrics` and `flowAuditLinks`.
      `generatedAtIso` is **passed in**; never read the clock.
- [X] T017 [US1] Add a "Copy audit report" control to `client/src/views/ReportsHub/PersonalFlowTab.tsx` using the
      **async, result-returning** `copyToClipboard` from
      `client/src/views/JiraTemplateMaker/lib/copyToClipboard.ts` — not the fire-and-forget helper. A silently failed
      copy of a long report means the user pastes stale content into Confluence and never knows.
- [X] T018 [P] [US1] Component test in `client/src/views/ReportsHub/PersonalFlowTab.test.tsx`: the control copies the
      generated document, surfaces a **visible error** when the copy fails, and is disabled while running and when
      there are no results.

**Checkpoint**: 🎯 **Pure core complete and tested** — but NOT yet user-reachable: T017 (the copy control) is outstanding, so nothing in the UI invokes the generator.

**Original text**: 🎯 **Shippable.** A team-wide document with explanations and working Jira links, one click to
clipboard. This is the increment to ship this week.

---

## Phase 6: User Story 4 — I can see what was left out, and why (Priority: P2)

**Goal**: `fetched = credited + excluded`, each row explained and linked (FR-016..FR-019b).

**Independent test**: every fetched issue is accounted for and the arithmetic balances visibly (quickstart Test 4).

- [X] T019 [P] [US4] RED — extend `client/src/views/ReportsHub/flowAuditDocument.test.ts`: a 20-fetched /
      12-credited / 8-excluded fixture across two reasons renders all rows with their own links and balances; each
      exclusion reason is named and explained in plain English (FR-017); an **imbalance renders a visible warning**
      rather than silently printing rows that disagree.
- [X] T020 [US4] GREEN — implement the "What was counted and what was not" section in
      `client/src/views/ReportsHub/flowAuditDocument.ts`, using the engine's existing three exclusion reasons
      (`not-owned`, `wip-open`, `completed-out-of-window`) — introduce no new classification.

---

## Phase 7: User Story 5 — A sceptic can validate without me (Priority: P2)

**Goal**: the document stands alone and states its own provenance and limits (FR-003, FR-019b, NFR-003).

**Independent test**: a reader with Toolbox closed can follow it end to end (quickstart Tests 6, 9).

- [X] T021 [P] [US5] RED — extend `client/src/views/ReportsHub/flowAuditDocument.test.ts`: the header states roster,
      window with **explicit start/end dates**, generation time and tool version; a ceiling-reached envelope produces
      a notice **at the top** naming the ceiling and the affected people (FR-019b); a person whose analysis failed
      still appears with their error message (research R9 — the roster must not silently shrink); no base URL still
      produces a complete document with query text throughout.
- [X] T022 [US5] GREEN — implement the run header, the completeness notice, and the honest per-person states in
      `client/src/views/ReportsHub/flowAuditDocument.ts`.

---

## Phase 8: Direct Confluence publish (Priority: P2, US1 continued)

**Goal**: publish the same document straight to a named page (FR-020a, FR-020b, FR-021, FR-021a, FR-022; contract
`publish-routes.md`).

**Independent test**: publish, re-publish, and attempt to publish over unrelated content (quickstart Test 7).

- [ ] T023 [P] [US1] RED — create `client/src/views/ReportsHub/flowAuditPublish.test.ts`: headings, paragraphs,
      tables, **links**, bold and code spans each render to valid Confluence storage XHTML; special characters in a
      person's display name are escaped and cannot corrupt the page or break a link; rendering then reading back with
      `readConfluenceStorageText` recovers the document's text.
- [ ] T024 [US1] GREEN — implement `client/src/views/ReportsHub/flowAuditPublish.ts` converting the document's
      markdown to Confluence storage XHTML. **Record the Article VII drift justification from
      `contracts/publish-routes.md` as a comment**, stating it is a document-specific renderer and **not** a general
      markdown engine — otherwise a later reader will feed it arbitrary markdown.
- [ ] T025 [US1] Add the publish control to `client/src/views/ReportsHub/PersonalFlowTab.tsx`, writing via
      `updateConfluencePage` (`client/src/services/confluenceApi.ts:244`). Read the target page first and warn **by
      page name** that its entire contents will be replaced, distinguishing a page carrying a previous run (routine)
      from one carrying unrelated content (likely mistake). The user must be able to abandon.
- [ ] T025a [US1] Satisfy **NFR-004a / SC-006a** — the redistribution notice. Also confirm **NFR-004** holds by
      construction: every Jira query in this feature runs under the generating user's own credentials, with no
      elevated or service-account path — assert this in review rather than assuming it. At the point of publishing, state that the report
      will be visible to everyone who can read the target page and that it names individuals and quotes issue
      summaries. Separately, add a short "what this contains and whose figures these are" statement to the document
      header in `client/src/views/ReportsHub/flowAuditDocument.ts`, so a reader who finds the page later understands
      what they are looking at. Publishing redistributes to the **page's** audience, which may be wider than the
      **issues'** audience — the feature cannot prevent that, so it must make it an informed choice.
- [ ] T026 [P] [US1] Component test in `client/src/views/ReportsHub/PersonalFlowTab.test.tsx`: the named warning
      appears before any write; abandoning writes nothing; a previous-run page is presented as routine; a failed
      write leaves the copy path working (FR-022).

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T027 Style the new controls and progress indicator in
      `client/src/views/ReportsHub/ReportsHubView.module.css` — light/dark themes, A/A+/A++ text sizes, narrow widths
      reflowing rather than clipping, and **no meaning by colour alone** (NFR-005).
- [X] T028 Add one `CHANGELOG.md` entry under `## [Unreleased]`, covering the auditable document, the removal of the
      silent 100-issue truncation (a **figures-changing** fix worth calling out on its own), and the new progress and
      cancel behaviour.
- [ ] T029 Run quickstart Tests **3 and 5** by hand against live Jira — follow a credited link and confirm the count
      matches, then check the worked example against that issue's Jira history. **These cannot be automated and are
      the definition of done**: the unit tests prove the document is internally consistent, only these prove it is
      true.
- [ ] T029a **Verify SC-010 specifically**: choose a person and window known to exceed the old 100-issue limit, and
      confirm the document's credited count matches the count its Jira link returns. This is the acceptance test for
      the whole "raise the ceiling" decision — T004 proves paging works mechanically, but only this proves the
      figures are now complete for the case that was previously truncated.
- [ ] T030 Run the quickstart Test 10 regression sweep — Personal Workflow's on-screen figures unchanged for the same
      window, screen and document agreeing, Issue Aging / hygiene / PI Review untouched, and the existing per-person
      **Copy JQL** button still working after T010.
- [ ] T030a **Verify SC-006 on the published page**, not just the document: publish to Confluence, then compare a
      figure and a link on the **rendered page** against the screen. The markdown→storage conversion sits between the
      two and is otherwise unverified end-to-end — T023 proves text round-trips, which is not the same as proving the
      figures and links survive on a real page.
- [ ] T031 Final gates: `cd client && npx vitest run && npx tsc -b`, then `npm test` and `npm run test:dom` from
      `C:\ProjectsWin\NodeToolbox`. All green except the known pre-existing `monthlyDeliveryConfig` server failure.

---

## Dependencies

```
Phase 1 (Setup: T001)
        │
        ▼
Phase 2 (Foundational: T002–T007)   ◀── engine evidence + paging/ceilings + progress/cancel
        │
        ├──────────────┐
        ▼              ▼
   US3 (T008–T010) US2 (T011–T014)     independent of each other
        │              │
        └──────┬───────┘
               ▼
        US1 (T015–T018) 🎯 MVP — assembles US2 + US3
               │
        ┌──────┴───────┐
        ▼              ▼
   US4 (T019–T020) US5 (T021–T022)     both extend flowAuditDocument.ts
        │              │
        └──────┬───────┘
               ▼
   Phase 8 publish (T023–T026)
               │
               ▼
   Phase 9 (Polish: T027–T031)
```

**Story independence** — honestly stated: US2 and US3 are genuinely independent of each other. **US1 is not
independent** — it assembles them, which is why it follows despite being P1. US4 and US5 both extend
`flowAuditDocument.ts` and so are sequential with each other, not parallel.

---

## Parallel execution opportunities

| Phase | Parallel set | Why safe |
|---|---|---|
| 2 | T002 ∥ T004 | Different test files (`personalFlow.test.ts` vs `PersonalFlowTab.test.tsx`) |
| 3/4 | **US3 ∥ US2** | `flowAuditLinks.*` vs `flowAuditMetrics.*` — disjoint. The best two-agent split |
| 5 | T015 ∥ T018 | Different test files |
| 8 | T023 ∥ T026 | `flowAuditPublish.test.ts` vs `PersonalFlowTab.test.tsx` |

**Shared-file caveat**: T016, T020 and T022 all edit `client/src/views/ReportsHub/flowAuditDocument.ts`, and T005,
T006, T010, T017 and T025 all edit `client/src/views/ReportsHub/PersonalFlowTab.tsx`. Sequence within each file; do
not run those concurrently.

---

## Implementation strategy

**Ship Phase 5.** Phases 1–5 (T001–T018) deliver a team-wide document with per-metric explanations, worked examples
and one-click Jira links, copyable in one action — the whole of your stated need for this week, with no Confluence
write dependency. That is the release boundary.

**Then Phases 6–7** (T019–T022) add the exclusion accounting and the standalone provenance — both pure additions to
the generator, no new surfaces.

**Then Phase 8** (T023–T026) adds direct publishing, which is the only part needing the markdown→storage renderer that
does not exist yet (research R5).

**Sizing note**: Phase 2 is the riskiest work and it comes first — it changes what the engine returns *and* what the
figures cover. Expect the removal of the 100-issue truncation to change reported numbers for busy people; that is a
correction, not a regression, and T028 calls it out in the CHANGELOG so nobody mistakes it for a bug.

**Total: 34 tasks** — 1 setup, 6 foundational, 3 (US3), 4 (US2), 4 (US1 MVP), 2 (US4), 2 (US5), 5 (publish), 7 polish.

*(T025a, T029a, T030a were added by `/speckit-analyze` remediation to close the NFR-004a redistribution notice and the SC-010 / SC-006 verification gaps.)*
