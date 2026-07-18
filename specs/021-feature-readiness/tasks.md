---
description: "Task list for 021 Feature Status & Readiness Workspace"
---

# Tasks: Feature Status & Readiness Workspace

**Input**: Design documents from `specs/021-feature-readiness/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)
**Tests**: INCLUDED — the constitution mandates TDD red-first (Article V); every source file gets a
same-named test file (pre-commit hook enforces this).

## Conventions

- All new code lives in `client/src/views/ArtView/readiness/` unless noted.
- Every Jira write delegates to `client/src/views/SprintDashboard/featureReviewFixes.ts` — no new
  fetch-to-Jira path is created.
- `readinessScan.ts` is the single evaluation; counts and listings consume its output only (FR-010).
- Honest states throughout (empty scope ⇒ amber message; unconfigured field family ⇒ "not checked").

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different file, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (setup, foundational, polish carry no story label)

---

## Phase 1: Setup

- [X] T001 Create the readiness directory scaffold `client/src/views/ArtView/readiness/` and
  `client/src/views/ArtView/readiness/ai/` (empty placeholder index note only; real files land in
  later phases).
- [X] T002 Confirm the working branch is `feature/021-feature-readiness` and record the
  `branch-created` workflow gate.

---

## Phase 2: Foundational (blocking prerequisites for all stories)

**Purpose**: field-config discovery + the feature-query builder + the pure scan, which every user
story consumes. NO story is testable until these exist.

- [X] T003 [P] Add `estimateFieldIds` and `pcodeFieldIds` (both `string[]`, default `[]`) to
  `HygieneFieldConfig` in `client/src/views/Hygiene/checks/hygieneChecks.ts`, and include them in
  `resolveHygieneFieldConfig`'s merge (configured-first, defaults-after). Update
  `hygieneChecks.test.ts` first (red) to assert the new keys resolve and default empty, and that
  NO existing check reads them.
- [X] T004 [P] Extend `loadHygieneFieldConfig` in
  `client/src/views/Hygiene/checks/hygieneFieldConfig.ts` with name discovery for
  `['Estimate (NF)','Estimate']` → `estimateFieldIds` and `['Spark ID/PCode','Spark ID','PCode']`
  → `pcodeFieldIds`. Update `hygieneFieldConfig.test.ts` first (red) asserting the matches and the
  "absent ⇒ empty" honesty.
- [X] T005 [P] Write `client/src/views/ArtView/readiness/readinessScan.test.ts` (RED): synthetic
  feature lists asserting lens membership (current/upcoming/carryover, one-lens-per-feature),
  each alert predicate, ownership dual-empty rule, upcoming refined/unrefined by
  `classifyStatusBucket`, unconfigured-family `notConfigured` state, empty-scope (`0`) vs
  load-failure (`null`), and count == listing-length identity.
- [X] T006 Implement `client/src/views/ArtView/readiness/readinessScan.ts` (pure
  `runReadinessScan(...)` → `ReadinessScanResult`) to green T005, reusing `classifyStatusBucket`
  (`client/src/utils/workflowDelivery.ts`) and `detectImpedimentReasons`
  (`client/src/views/ArtView/hooks/artHelpers.ts`). Includes `normalizePcodeInput` OR — if placed
  separately — export it here for T014's control to import.
- [X] T007 [P] Write `client/src/views/ArtView/readiness/readinessFeatureQuery.test.ts` (RED):
  assert exact JQL per scope-clause precedence (`featureProjectKeys` → roster `jiraLabel`s →
  none), the `issuetype = Feature AND cf[<n>] <PI clause>` base, `piFieldNumber` derivation from
  `tbxARTSettings.piFieldId` (default `customfield_10301`), and the 200-result ceiling note.
- [X] T008 Implement `client/src/views/ArtView/readiness/readinessFeatureQuery.ts` (JQL builders +
  `fetch` via existing `jiraApi`) to green T007, following the `piReviewPullFeatures` precedent
  (portfolio-project rule — never team projectKey).

---

## Phase 3: User Story 1 — Status & readiness lenses (Priority P1) 🎯 MVP

**Goal**: three PI lenses over one scan, state-grouped counts, filter-to-listing, honest empty
scope, deep-linkable.
**Independent test**: open the Readiness tab on a configured ART/PI → three lens tiles with counts;
selecting a lens/state filters the listing; empty scope shows the amber message; a shared
`?readinessLens=` link reopens the same view.

- [X] T009 [P] [US1] Add `'readiness'` to the `ArtTab` union in
  `client/src/views/ArtView/hooks/useArtData.ts` and a one-time initial-tab seed from a
  `?artTab=` param (validated against the union; no persistence side effect). Update
  `useArtData.test.ts` first (red) for the seed.
- [X] T010 [P] [US1] Write `client/src/views/ArtView/readiness/ReadinessPanel.test.tsx` (RED):
  mock the scan, assert three lens tiles with scan counts, lens/state selection filters the
  listing, count == rows, empty-scope amber message (no healthy zero), load-error path, and the
  `?readinessLens=`/`?readinessFilter=` deep-link read/write.
- [X] T011 [US1] Implement `client/src/views/ArtView/readiness/ReadinessPanel.tsx` +
  `ReadinessPanel.module.css` (lens strip, summary tiles, feature listing rows with IssueMeta
  chips — `StatusChip`/`AssigneeAvatar`/`AgeBadge`/`IssueTypeIcon`) consuming `runReadinessScan`
  output only; `useSearchParams` for lens/filter; honest states per contract. Green T010.
- [X] T012 [US1] Wire the tab into `client/src/views/ArtView/ArtView.tsx`: add
  `{ key: 'readiness', label: 'Readiness' }` to `ART_TAB_DEFINITIONS` and the conditional
  `{state.activeTab === 'readiness' && <ReadinessPanel .../>}` mount (additive only — no existing
  tab changes). Extend `ArtView.test.tsx` (or the panel-mount test) to assert the tab renders.

**Checkpoint**: US1 is a demonstrable MVP — lenses and listing work with no fixes/AI yet.

---

## Phase 4: User Story 2 — Hygiene alerts with inline fixes (Priority P2)

**Goal**: each alert renders a flag with an inline fix that writes to Jira via the shared writers,
clears on success, and re-runs the scan; honest "not checked" for unconfigured families; Jira
errors surfaced.
**Independent test**: seed a feature with each alert; fix one of each inline; verify the write
reaches Jira, the alert clears, and lens counts update; unconfigured field ⇒ "not checked"; a 400
shows Jira's message.

- [X] T013 [P] [US2] Write `client/src/views/ArtView/readiness/ReadinessFixControl.test.tsx`
  (RED): mock only the network write fns in `featureReviewFixes` (pure helpers stay real, per the
  `HygieneFixControl.test` precedent); assert correct writer + args per alert (ownership
  dual-target via `saveFeatureReviewUserField`; estimate via editmeta-aware option/simple; PCode
  via `saveFeatureReviewSimpleField` after `normalizePcodeInput`; dates via
  `saveFeatureReviewSimpleField`; transition via `saveFeatureReviewTransition` +
  `TransitionRequiredFields` gating), error surfacing, and rescan-on-success callback.
- [X] T014 [P] [US2] Write `normalizePcodeInput` unit tests (RED) — in `readinessScan.test.ts` or
  a dedicated `pcode.test.ts`: plain digits pass, `P00012345` → `12345`, whitespace trimmed,
  letters/mixed/empty rejected with a reason and no write.
- [X] T015 [US2] Implement `normalizePcodeInput` (green T014) in `readinessScan.ts` (or a small
  `pcode.ts` it re-exports).
- [X] T016 [US2] Implement `client/src/views/ArtView/readiness/ReadinessFixControl.tsx` (green
  T013): per-alert inputs delegating every write to `featureReviewFixes`; dual-target ownership
  choice (assignee vs configured PO field, PO option only when configured); estimate via
  `fetchFeatureReviewEditMeta` + `saveFeatureReviewOptionField`/`saveFeatureReviewSimpleField`;
  transitions via `fetchFeatureReviewTransitions` + shared
  `client/src/components/TransitionRequiredFields/index.tsx`; visible labels; disabled-in-flight;
  Jira error via `role="alert"`.
- [X] T017 [US2] Integrate `ReadinessFixControl` into `ReadinessPanel` rows behind each alert flag,
  render "not checked — no matching field" for `notConfigured` families, link-out for
  inline-uneditable alerts, mount the shared `IssueDetailPanel` (`isEmbedded`) on row expand, and
  re-run the scan on any successful fix. Extend `ReadinessPanel.test.tsx` for these paths.

**Checkpoint**: US1 + US2 deliver the "better than the org dashboard" core — every alert fixable
in place.

---

## Phase 5: User Story 3 — Gated AI readiness insights (Priority P3)

**Goal**: Ctrl+Alt+Z-gated propose-only panel; one prompt per active lens; `{kind:'featureReadiness'}`
reply; per-item accept writing estimate/target/due only (never ownership); invisible while locked.
**Independent test**: locked ⇒ no AI affordance; unlock, generate proposals, accept one/decline
one → only the accepted change writes via the shared writer.

- [X] T018 [P] [US3] Write `client/src/views/ArtView/readiness/ai/readinessAiAssist.test.ts` (RED):
  prompt built only from the active lens's features; `parseReadinessAiReply` accepts
  `{kind:'featureReadiness',items[]}` via shared `extractJsonPayload`, rejects wrong kind, reports
  unknown issue keys, tolerates missing optional fields.
- [X] T019 [US3] Implement `client/src/views/ArtView/readiness/ai/readinessAiAssist.ts` (green
  T018): `buildReadinessAiPrompt` + `parseReadinessAiReply`, `READINESS_REPLY_KIND =
  'featureReadiness'`, modeled on `client/src/views/ArtView/ai/piReviewAiAssist.ts`.
- [X] T020 [P] [US3] Write `client/src/views/ArtView/readiness/ai/ReadinessAiPanel.test.tsx` (RED):
  locked ⇒ renders `null`; unlocked ⇒ shows panel; prompt scoped to active lens; accept writes
  exactly one item via the mocked `featureReviewFixes` writer; decline writes nothing;
  ownership/insight items expose NO write button.
- [X] T021 [US3] Implement `client/src/views/ArtView/readiness/ai/ReadinessAiPanel.tsx` (green
  T020): `useAiAssistStore` gate (null when locked), `useAiAssistExchange`
  (`client/src/views/SnowHub/hooks/useAiAssistExchange.ts`), per-item Accept/Decline routing
  writable fields through the same `featureReviewFixes` writers, disclosure line; modeled on
  `client/src/views/ArtView/ai/PiReviewAiPanel.tsx`.
- [X] T022 [US3] Mount `ReadinessAiPanel` inside `ReadinessPanel` (passes the active lens's scan
  slice); verify no AI leakage while locked. Extend `ReadinessPanel.test.tsx`.

---

## Phase 6: Polish & cross-cutting

- [X] T023 [P] Add a CHANGELOG entry under `## [Unreleased]` describing the Readiness tab (lenses,
  inline fixes, gated AI, honest states).
- [X] T024 [P] Run the full client suite `cd client && npx vitest run` and `npx tsc -b`; fix any
  fallout. Record `tests-written` and `tests-passed` workflow gates.
- [X] T025 Run `npx playwright test test/e2e/agile-hub-home.spec.js` to confirm the Agile Hub shell
  guarantees still hold (no regression from the new ArtView tab).
- [X] T026 Manual quickstart pass (`specs/021-feature-readiness/quickstart.md` scenarios A–D) with
  a live or stubbed Jira; capture evidence per Article X.

---

## Dependencies & order

- **Setup (T001–T002)** → **Foundational (T003–T008)** → **US1 (T009–T012)** → **US2 (T013–T017)**
  → **US3 (T018–T022)** → **Polish (T023–T026)**.
- US2 depends on US1's panel/rows; US3 depends on US1's panel + US2's writers. Field-config tasks
  (T003–T004) block the scan (T006) reading estimate/PCode families.
- Within a phase, `[P]` tasks touch different files and can run together; a test task (RED) always
  precedes its implementation task.

## Parallel opportunities

- Foundational: T003, T004, T005, T007 in parallel (distinct files); T006 after T005, T008 after
  T007.
- US1: T009 and T010 in parallel; T011 after T010; T012 after T011.
- US2: T013 and T014 in parallel; T015 → T016 → T017.
- US3: T018 and T020 in parallel; T019 before T021; T022 last.

## MVP scope

**User Story 1 alone** (T001–T012) is a shippable MVP: the three-lens readiness picture with honest
states and deep links, even before inline fixes and AI land.
