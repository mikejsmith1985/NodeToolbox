---
description: "Task list for PO Tool — Feature Splitter & Feature Composition"
---

# Tasks: PO Tool — Feature Splitter & Feature Composition

**Input**: Design documents from `specs/017-po-feature-tools/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: INCLUDED and TDD-ordered — the constitution (Article V) mandates a failing test before implementation.
Write each test task first, watch it fail, then implement. Tests are **co-located siblings** (`X.test.ts(x)` next to
`X.ts(x)`) per the repo convention — no `__tests__/` tree, no `lib/` folder (research R9).

**Organization**: Setup → Foundational (the PO Tool shell every story needs + the four shared seams) → one phase per
user story in priority order → Polish. **Client-only** — this feature changes **no server code** and adds **no
dependency**.

**Priorities** (derived from spec.md; the spec names US2 "the core value" and plan.md makes US1 the shippable
premise-prover):

| Priority | Stories | Why |
|----------|---------|-----|
| **P1** | US1 | The tool exists with both reused tabs — proves FR-003/004/005 cheaply. **MVP.** |
| **P2** | US2, US3 | Feature Splitter — the core value, incl. cross-session drafts |
| **P3** | US4, US5, US6, US7 | Feature Composition — workspace, DoR/hygiene, create & update |
| **P4** | US8 | Gated AI assists (both tabs) — strictly additive |
| n/a | US9 | "Works without AI" — **structurally enforced**, verified in every phase; final sweep in Polish |

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US9 (from spec.md); Setup/Foundational/Polish carry no story label
- All paths are repository-relative.

---

## Phase 1: Setup (Shared)

- [X] T001 Create branch `feature/017-po-feature-tools` from an **up-to-date `main`** and commit the
  `specs/017-po-feature-tools/` artifacts. **Do not** work on the stale `forge/wt-*` worktree branch — the
  pre-commit hook rejects it (plan.md "Branching note", Article III)
- [X] T002 [P] Add a `## [Unreleased]` stub to `CHANGELOG.md` naming feature 017 (PO Tool: Feature Splitter +
  Feature Composition), to be fleshed out in Polish (Article VI)
- [X] T003 [P] Scaffold `client/src/views/PoTool/` with the subfolders `hooks/`, `coaching/`, `drafts/`, `ai/`,
  `sources/`, `jira/` per plan.md's Source Code tree. **No new dependency is added** — confirm `xlsx` already
  resolves in `client/package.json` (research R5)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The PO Tool shell every story mounts into (Layer 1), plus the four shared seams the authoring stories
need (Layer 2). See "Dependencies & sequencing" — **Layer 2 does not block US1**, so Phase 3 may ship first.

### Layer 1 — PO Tool shell & registration ⚠️ tests first

**Blocks every user story.**

- [X] T004 [P] Write failing test `client/src/views/PoTool/hooks/usePoToolState.test.ts` — the `PoToolTab` union
  (`'featurereview' | 'pireview' | 'splitter' | 'composition'`), tab switching, and that the tool's **own** selected
  team-profile id + PI persist to `tbxPoToolSelection` and restore
- [X] T005 [P] Write failing test `client/src/views/PoTool/poToolArtTeam.test.ts` — `buildArtTeamFromProfile`
  maps a team profile to an `ArtTeam` (id/name/projectKey/boardId/piReviewPages) with `sprintIssues: []`
  (contracts/tab-reuse.md; `PiReviewTab` never reads `sprintIssues`)
- [X] T006 Implement `client/src/views/PoTool/hooks/usePoToolState.ts` — the tab union lives here (research R9);
  holds the PO Tool's own profile id. **MUST NOT** call `setSprintDashboardActiveTeamProfileId` (INV-T3)
- [X] T007 Implement `client/src/views/PoTool/poToolArtTeam.ts` (~10 lines, pure)
- [X] T008 Implement `client/src/views/PoTool/PoTeamSelector.tsx` + `.test.tsx` — the tool's **own** team/PI picker,
  reading `sprintDashboardTeamProfiles` as a **read-only catalog** (contracts/tab-reuse.md "The rule")
- [X] T009 Implement `client/src/views/PoTool/PoToolView.tsx` + `.module.css` — shell using the shared
  `components/PrimaryTabs`; panel wrapper ids **must** match `${idPrefix}-${key}-tab|panel` for a11y (research R9)
- [X] T010 Register the tool: append to `APP_CARDS` **and** `RECENT_VIEW_LABELS` in
  `client/src/views/Home/homeCardData.ts`, and add the route const + `<Route>` + import in `client/src/App.tsx`.
  The card entry powers Admin Hub tool-visibility **for free** (FR-001, contracts/tab-reuse.md "Registration")

### Layer 2 — The four shared seams ⚠️ tests first

**Blocks US2, US4, US5, US6, US7. Does NOT block US1.** This is where **shared-file regression risk
concentrates** — it lands isolated, unit-tested, with no UI depending on it yet (plan.md Layer 2).

- [X] T011 [P] Write failing test in `client/src/services/confluenceApi.test.ts` — a thrown Confluence error
  **carries `response.status`** so callers can distinguish 404 / 403 / 502-unreachable / not-configured
  (research R2b, FR-023b, SC-018)
- [X] T012 [P] Write failing test `client/src/utils/confluenceStorageText.test.ts` — storage-format HTML → readable
  text: `<br>`→newline, block-tag closes→newline, tags stripped, `&nbsp;/&amp;/&lt;/&gt;/&quot;` decoded
  (research R2c)
- [X] T013 [P] Write failing test in `client/src/services/jiraApi.test.ts` — `createIssueLink` POSTs
  `{type:{name}, inwardIssue:{key}, outwardIssue:{key}}` to `/rest/api/2/issueLink` and tolerates Jira's
  **201-with-empty-body** (research R3, contracts/jira-writes.md)
- [X] T014 Implement the Confluence error-status seam in `client/src/services/confluenceApi.ts` — **additive
  only**: attach the status; existing consumers keep reading `.message` unchanged (research R2b)
- [X] T015 [P] Implement `client/src/utils/confluenceStorageText.ts` — port of the server's `stripStorageHtml`
  (~20 lines, pure). Output is **plain text**; it is never injected as HTML (research R2c)
- [X] T016 [P] Implement `createIssueLink` in `client/src/services/jiraApi.ts` (~3 lines over the existing
  `jiraPost`; body shape ported verbatim from the server's `sprintReleaseOrchestrator`)
- [X] T017 Lift/export the hygiene field-config loader out of `client/src/views/Hygiene/hooks/useHygieneState.ts`
  into a shared, importable module, and **export** `HygieneFixControlProps` from
  `client/src/views/Hygiene/HygieneFixControl.tsx`. **Behavior-preserving refactor** — do not duplicate the loader
  (research R8; duplication would reproduce the drift the spec flags in A7)
- [X] T018 **Regression gate**: run `cd client && npx vitest run` — every existing Hygiene, Confluence, and Jira
  test MUST be green **unedited**. If a test needed editing, a seam was not backward-compatible → revert and redo

**Checkpoint**: shell renders with two empty tabs; all four seams unit-tested; no existing test edited.

---

## Phase 3: User Story 1 — One home for PO work (Priority: P1) 🎯 MVP

**Goal**: The PO Tool shows **the same** Feature Review and PI Review as Team Dashboard, on a team chosen
**independently**, with **zero** Team Dashboard regression.

**Independent test**: quickstart Scenario A — Team Dashboard on team Alpha, PO Tool on team Beta; both show their
own data; neither selection moves; Team Dashboard's existing tests pass **unedited**.

**This phase validates the feature's core premise (FR-003/004/005). It is independently shippable.**

### Tests first ⚠️

- [X] T019 [P] [US1] Write failing test in `client/src/views/SprintDashboard/FeatureReviewTab.test.tsx` — with
  `dashboardTeamProfileId` **provided**, the tab scopes its config + team name to **that** profile; with it
  **omitted**, behavior is **identical to today** (FR-005b, INV-T2)
- [X] T020 [P] [US1] Write failing test `client/src/views/PoTool/PoToolView.test.tsx` — the PO Tool mounts
  `ArtView/PiReviewTab` with `mode="authoring"` and its own `ArtTeam`, and mounts `FeatureReviewTab` with the PO
  Tool's own `dashboardTeamProfileId`; changing the PO Tool's team does **not** touch the app-wide active id
  (SC-015, INV-T3)

### Implementation

- [X] T021 [US1] Add the optional `dashboardTeamProfileId?: string` prop to
  `client/src/views/SprintDashboard/FeatureReviewTab.tsx` and resolve `?? activeDashboardTeamProfileId`; feed the
  resolved id to **both** the team-name lookup and `loadDashboardConfigFromStorage(...)`.
  **Constraints (contracts/tab-reuse.md)**: keep the **inline selector** form so re-render granularity is identical
  when the prop is omitted; **do not** touch Team Dashboard's call site; **do not** extract the CSS module; **do
  not** relocate the file. Precedent: `StandupTab.tsx`'s identical optional prop
- [X] T022 [US1] Mount both reused tabs in `client/src/views/PoTool/PoToolView.tsx`: `ArtView/PiReviewTab`
  **directly** with `mode="authoring"` — **never** `SprintDashboardPiReviewTab` (it hardwires the active profile and
  drags in the capacity singleton — contracts/tab-reuse.md, INV-T4) — and `FeatureReviewTab` with the PO Tool's
  profile id
- [X] T023 [US1] Scope `useStandupRosterStore` to the PO Tool's profile on mount so PI Review's "Pull Features from
  Jira" PO filter is correct — the established 3-line idiom from `FeatureCanvasView.tsx:65-67`. Safe: Team Dashboard
  re-asserts its stores on mount (research R1)
- [X] T024 [US1] Verify quickstart **Scenario A**, including the grep proof that `views/PoTool/` contains **zero**
  calls to `setSprintDashboardActiveTeamProfileId`, and that no `FeatureReviewTab`/`PiReviewTab` **copy** exists
  under `views/PoTool/` (SC-002, SC-003, SC-015)

**Checkpoint**: 🚢 **Shippable.** US1 delivered; the reuse premise is proven. If it were wrong, it surfaced here —
cheaply, before any authoring code.

---

## Phase 4: User Stories 2 & 3 — Feature Splitter (Priority: P2)

**Goal**: Load a Feature, split it into smaller **peer Features** with deterministic coaching, resume across
sessions, review a diff, and commit — original **kept and linked**, never closed.

**Independent test**: quickstart Scenarios B (gate **locked**), C (resume), D (commit + partial-failure +
pre-flight).

### Tests first ⚠️

- [X] T025 [P] [US2] Write failing test `client/src/views/PoTool/coaching/splitHeuristics.test.ts` — heuristics
  resolve with **no network call** and **no gate** (INV-6, FR-010, SC-013)
- [X] T026 [P] [US3] Write failing test `client/src/views/PoTool/drafts/draftModel.test.ts` +
  `drafts/splitDraftStorage.test.ts` — key `tbxPoFeatureSplitDraft:<profileId>:<sourceFeatureKey>`; **load never
  throws** (absent/corrupt/old-version → empty or migrated); **save no-ops** when storage is blocked **and surfaces
  an availability flag**; identity taken from **arguments**, not payload; discard removes the entry
  (INV-1, INV-2, FR-043/046/047/048)
- [X] T027 [P] [US2] Write failing test `client/src/views/PoTool/jira/buildSplitCommit.test.ts` — pure diff:
  every create **and** every link itemized; increments carry the **source's own `issueTypeId`** (INV-J5, A17);
  non-empty `blockingIssues` (missing instance-required fields) ⇒ commit disabled (INV-4, FR-034)
- [X] T028 [P] [US2] Write failing test `client/src/views/PoTool/jira/runCommit.test.ts` — per-item outcomes
  carrying the instance's **actual** rejection reason; a **link failure is reported, never thrown**, and never
  undoes a create (INV-5, INV-J4, FR-015/041); an item with `createdJiraKey` is **not re-created** on retry (SC-011)
- [X] T029 [P] [US2] Write failing test `client/src/views/PoTool/hooks/usePoHygieneContext.test.ts` — wires the
  **existing** `evaluateHygieneIssue` with the lifted field config + enterprise rules; a check whose field is
  **unconfigured** is **absent**, not reported missing (FR-028 — already the engine's behavior; this proves wiring)

### Implementation

- [X] T030 [P] [US2] Implement `client/src/views/PoTool/coaching/splitHeuristics.ts` — authored deterministic
  constants (by workflow step, business rule, data variation, happy-path-first, CRUD, effort-vs-value).
  **Advisory, never blocking** (FR-011, research R10)
- [X] T031 [US3] Implement `client/src/views/PoTool/drafts/draftModel.ts` + `drafts/splitDraftStorage.ts` — the
  canvas-overlay pattern (self-describing envelope, `canUseLocalStorage` guard, normalize-on-read, `schemaVersion`).
  **Deliberate divergence**: surface a storage-unavailable flag instead of failing silently (research R7, FR-047)
- [X] T032 [US2] Implement `client/src/views/PoTool/hooks/usePoHygieneContext.ts` — reuse `evaluateHygieneIssue`,
  the lifted field-config loader (T017), and the enterprise rules readers (research R8)
- [X] T033 [US2] Implement `client/src/views/PoTool/jira/buildSplitCommit.ts` (pure) — builds `CommitDiff` per
  data-model.md
- [X] T034 [US2] Implement `client/src/views/PoTool/jira/runCommit.ts` — order **creates → links → updates**; reuse
  `createIssue` + `findMissingRequiredFields`; links **best-effort** via `createIssueLink` (T016).
  **MUST NOT** close, transition, or delete the original (FR-016b, INV-J2, SC-016)
- [X] T035 [US2] Implement `client/src/views/PoTool/FeatureSplitterTab.tsx` + `.module.css` + `.test.tsx` — load by
  key via **one** `jiraGet(..., fields=project,issuetype,…)` capturing both `project.key` **and** `issuetype.id`
  (research R4); copyable source panel; increment editor; coaching; per-increment hygiene reusing
  `HygieneFixControl`; target-project picker defaulting to the original's project (FR-016c); link-type picker from
  live `GET /rest/api/2/issueLinkType` defaulting to `'relates to'` (FR-037); review step; commit.
  **Report an empty/failed Jira read as a connectivity failure — never as "no data"** (spec A11)
- [X] T036 [US2] Verify quickstart **Scenarios B, C, D** — including the decisive check: **zero POST/PUT in the Dev
  Panel API log** before Commit (SC-006), and that the original's status/content are **unchanged** after a
  committed split (SC-016)

**Checkpoint**: 🚢 Shippable. Splitter fully usable **with the gate locked** — proving US9/SC-005 structurally.

---

## Phase 5: User Stories 4, 5, 6 & 7 — Feature Composition (Priority: P3)

**Goal**: Gather four source types into one workspace with DoR coaching + live hygiene, then **create** a new
Feature in a chosen project **or update** an existing one.

**Independent test**: quickstart Scenarios F (four sources + bundle check), G (failure taxonomy), H (create vs
update + SC-007).

### Tests first ⚠️

- [X] T037 [P] [US4] Write failing test `client/src/views/PoTool/sources/sourceModel.test.ts` — the
  `ReferencedSource` union; every variant carries its **origin** (page URL / file name / issue key / "pasted")
  (FR-024)
- [X] T038 [P] [US4] Write failing test `client/src/views/PoTool/sources/workbookSource.test.ts` — `File` → rows via
  **dynamically imported** SheetJS; multi-sheet exposes `availableSheetNames`; an unreadable file yields a clear
  non-technical message and **leaves the draft untouched** (FR-023a, spec edge cases)
- [X] T039 [P] [US4] Write failing test `client/src/views/PoTool/sources/confluenceSource.test.ts` — reuses
  `fetchConfluencePageByReference`; text is **stripped** via T015; the **four** failure conditions produce **four
  distinct** messages and **none** renders as "empty" (FR-023b, SC-018, INV-J6)
- [X] T040 [P] [US5] Write failing test `client/src/views/PoTool/FeatureCompositionTab.test.tsx` (checklist half) —
  the live hygiene checklist updates as fields change and **never blocks** commit (FR-027, FR-029)
- [X] T041 [P] [US6] [US7] Write failing test `client/src/views/PoTool/jira/buildCompositionCommit.test.ts` — no key
  ⇒ **create** in the chosen project; key present ⇒ **update that issue, no duplicate**; the two paths are mutually
  exclusive; unsatisfied instance-required fields ⇒ **blocked, each named, no issue created** (FR-034/035/036,
  SC-008, SC-012, INV-J3)
- [X] T042 [P] [US4] Write failing test `client/src/views/PoTool/drafts/compositionDraftStorage.test.ts` — key
  `tbxPoFeatureCompositionDraft:<profileId>:<scopeKey>`; scopeKey = existing key, else a stable `new:<id>` so one
  composition resumes **one** draft (FR-043)

### Implementation

- [X] T043 [P] [US5] Implement `client/src/views/PoTool/coaching/definitionOfReady.ts` — authored deterministic DoR
  guidance; advisory, no gate, no network (FR-026, SC-013)
- [X] T044 [P] [US4] Implement `client/src/views/PoTool/sources/sourceModel.ts`
- [X] T045 [US4] Implement `client/src/views/PoTool/sources/workbookSource.ts` — **dynamic** `await import('xlsx')`,
  mirroring the intake importer's parse pattern + typed error class. **Do not** refactor or relocate the shipped
  intake components (research R5 — avoids regression in an unrelated tool)
- [X] T046 [US4] Implement `client/src/views/PoTool/sources/confluenceSource.ts` — reuse
  `resolveConfluencePageIdFromReference` + `fetchConfluencePageByReference`; branch on the status from T014; retain
  `pageUrl` as a reference (FR-024). **Client envelope**: read `page.body.storage.value` (contracts/jira-writes.md
  "Envelope trap")
- [X] T047 [US4] Implement `client/src/views/PoTool/drafts/compositionDraftStorage.ts` (reusing T031's envelope)
- [X] T048 [US6] [US7] Implement `client/src/views/PoTool/jira/buildCompositionCommit.ts` (pure) — create-vs-update
  branch; required-field pre-flight; reuse `getProjectIssueTypes`/`getIssueTypeFields` for discovery (FR-037)
- [X] T049 [US4] [US5] [US6] [US7] Implement `client/src/views/PoTool/FeatureCompositionTab.tsx` + `.module.css` —
  the workspace (four source types side-by-side with the draft, each removable + attributable), a dropzone mirroring
  the intake pattern (`.xlsx,.xls,.csv`), paste input, Jira-key references, DoR coaching, live hygiene checklist,
  project picker (create path), and commit via T048. Updates reuse the **instance-correct** field-write helpers so
  both Cloud and DC work (FR-038)
- [X] T050 [US4] [US6] [US7] Verify quickstart **Scenarios F, G, H** — including **SC-019**: `npx vite build`, then
  confirm SheetJS is **absent from the main chunk** (lazy chunk only), and **SC-007**: a Feature composed here opens
  in the Hygiene tool with **zero** flags

**Checkpoint**: 🚢 Shippable. Composition fully usable **with the gate locked**.

---

## Phase 6: User Story 8 — Gated AI assists (Priority: P4)

**Goal**: Optional, passphrase-gated, **propose-only** acceleration on both tabs.

**Independent test**: quickstart Scenario E — including garbage / wrong-`kind` / unknown-key replies, and **zero
Jira writes** across the whole ingest-and-accept cycle.

**Strictly additive**: removing this phase entirely leaves Phases 3–5 fully functional (FR-022, US9, SC-005).

### Tests first ⚠️

- [X] T051 [P] [US8] Write failing test `client/src/views/PoTool/ai/splitAiAssist.test.ts` — `kind`
  `'featureSplitIngest'`; **wrong kind ⇒ whole payload rejected**; a bad **item** ⇒ only that item errors while good
  ones survive (**partial success**, research R6); items land **`isAccepted: false`**; tolerates code fences and
  assistant prose via the shared `extractJsonPayload` (INV-3, FR-018/020, SC-009)
- [X] T052 [P] [US8] Write failing test `client/src/views/PoTool/ai/compositionAiAssist.test.ts` — `kind`
  `'featureCompositionIngest'`; a `fields` id **not** in the prompt's whitelist is **dropped with an error** (the
  assistant may not invent fields — FR-037); `summary` required
- [X] T053 [P] [US8] Write failing test `client/src/views/PoTool/ai/PoAiPanel.test.tsx` — **locked ⇒ renders
  `null`**; unlocked ⇒ prompt out / paste in / per-item accept-reject-**edit**; accepting mutates **only** the local
  draft (SC-005, SC-010, FR-021)

### Implementation

- [X] T054 [P] [US8] Implement `client/src/views/PoTool/ai/splitAiAssist.ts` — `buildSplitPrompt` (embeds the source
  Feature + heuristics + target project; **whitelists valid values verbatim**; ends with its schema inline and
  `Respond ONLY with valid JSON:`) and `parseSplitIngest` returning `{items, errors}` per
  contracts/ai-assist-json.md. **Pin `rationale`** (not `reason`). **No credential ever enters a prompt** (INV-J7)
- [X] T055 [P] [US8] Implement `client/src/views/PoTool/ai/compositionAiAssist.ts` — `buildCompositionPrompt`
  (includes the PO's **own wording** + every referenced source + the hygiene-required field names per FR-031/033)
  and `parseCompositionIngest`
- [X] T056 [US8] Implement `client/src/views/PoTool/ai/PoAiPanel.tsx` — read `useAiAssistStore`'s
  `isAiAssistUnlocked` **directly** and return `null` when locked (do **not** reuse the SnowHub gate hook — its
  `buildPrompt` is change-request-shaped; research R6). Filter unknown Jira keys against live data **in the UI** and
  **report** them (never silently drop)
- [X] T057 [US8] Wire the panel into both `FeatureSplitterTab.tsx` and `FeatureCompositionTab.tsx`; ingested items
  land unaccepted in the **same** controls the PO edits by hand (FR-020, FR-032)
- [X] T058 [US8] Verify quickstart **Scenario E** — the decisive check: **zero POST/PUT in the Dev Panel API log**
  across the entire unlocked ingest-and-accept cycle until Commit (SC-006, INV-J1); and re-locking mid-draft leaves
  the manual draft **fully intact and committable**

**Checkpoint**: 🚢 Shippable. Feature complete.

---

## Phase 7: User Story 9 — The tool works without AI (Priority: P4, verification-only)

**Goal**: Prove that a PO who has never unlocked the gate is never blocked and never sees an AI control.

**Independent test**: the task below — a full split **and** a full composition, start to finish, gate locked.

**No build tasks**: US9 is enforced **by construction** — every phase ships its deterministic half before its AI
half, so the AI can never become load-bearing. This phase only proves it.

- [ ] T059 [US9] Verify in `specs/017-po-feature-tools/quickstart.md` Scenarios B + F with a session that has
  **never** unlocked the gate: complete a full split **and** a full composition end-to-end. **Zero AI affordances**
  visible anywhere; no step blocked. Then unlock, re-lock mid-draft, and confirm the manual draft stays fully intact
  and committable (SC-005, FR-022, spec edge case)

---

## Phase 8: Polish & Cross-Cutting

- [ ] T060 [P] Update `CHANGELOG.md` under `## [Unreleased]` — the PO Tool, both authoring tabs, gated AI assists.
  Note the reused tabs and that **no new dependency** was added (Article VI)
- [ ] T061 [P] Accessibility + large-artifact pass: `PrimaryTabs` id/panel pairing; keyboard paths through the
  dropzone and accept/reject rows; a long Confluence page / multi-thousand-row workbook does not freeze the tab, and
  warns when too large for a prompt (spec edge case)
- [ ] T062 Final gate: full quickstart A–H green; INV-1…INV-6 green; `cd client && npx vitest run` clean;
  `npx vite build` clean; **`npm test` (server) still green — this feature changes no server code**; Team Dashboard
  parity re-checked with its existing tests **unedited** (SC-002)

---

## Dependencies & sequencing

```
Setup (T001–T003)
  └─> Foundational
        Layer 1 shell (T004,T005 [P] → T006,T007 → T008 → T009 → T010)
          ├─> US1 reused tabs (T019,T020 [P] → T021 → T022 → T023 → T024)   [MVP] 🚢
          │     └─ (no dependency on Layer 2 — MAY ship before it)
          └─> Layer 2 seams (T011,T012,T013 [P] → T014,T015,T016 [P] → T017 → T018)
                ├─> US2+US3 Splitter (T025–T029 [P] → T030–T035 → T036)  🚢
                └─> US4–US7 Composition (T037–T042 [P] → T043–T049 → T050)  🚢
                      └─ (US2/US3 ∥ US4–US7 — independent once Layer 2 lands)
                            └─> US8 AI assists (T051–T053 [P] → T054–T057 → T058)  🚢
                                  └─> US9 verify (T059) ─> Polish (T060 [P], T061 [P], T062)
```

- **Blocking**: Layer 1 (T004–T010) blocks **every** story. Layer 2 (T011–T018) blocks US2–US7 but **not US1**.
- **US1 is the MVP** and is deliberately first: it proves the reuse premise (FR-003/004/005) before any authoring
  code exists. Per plan.md's Layer 1 → Layer 2 ordering, **ship Phase 3 before completing Layer 2** if you want the
  earliest possible feedback.
- **Phase 4 ∥ Phase 5** once Layer 2 lands — different files, no shared state (Article: multi-agent for 3+
  independent files).
- **US8 depends on both** authoring tabs existing (it wires a panel into each), which is *why* it is last: the AI can
  never become load-bearing because both tabs are already complete without it.
- **US9 needs no build tasks** — it is enforced by ordering (every deterministic half ships before its AI half) and
  verified at T024/T036/T050, then swept end-to-end at T059.

## Parallel execution examples

- **Setup**: T002 [P] and T003 [P] alongside T001.
- **Layer 1 tests**: T004 [P] and T005 [P] together (different files).
- **Layer 2 tests**: T011, T012, T013 [P] all together (confluenceApi / confluenceStorageText / jiraApi test files).
  Implementations T015 [P] and T016 [P] are parallel; T014 touches the same file as T011's target, and T017 is
  ordered last as the riskiest shared-file refactor.
- **US1 tests**: T019 [P] and T020 [P] together (FeatureReviewTab vs PoToolView test files).
- **Phase 4 tests**: T025–T029 all [P] (coaching / drafts / buildSplitCommit / runCommit / hygiene-context files).
- **Phase 5 tests**: T037–T042 all [P] (six distinct files).
- **Phases 4 and 5 wholesale**: two agents, one per phase, once T018 is green.
- **Phase 6 tests**: T051, T052, T053 [P]; implementations T054 [P] and T055 [P].
- **Polish**: T060 [P] and T061 [P] together.

## Implementation strategy

- **MVP = Phase 1 + Layer 1 + Phase 3** (through T024): the PO Tool exists with Feature Review + PI Review on an
  independently-chosen team, Team Dashboard untouched. **Ship it.** This is the cheapest possible test of the
  feature's central premise — if reuse were harder than research says, it surfaces here, before any authoring code.
- **Increment 2 = Layer 2 + Phase 4**: the Feature Splitter — the spec's stated core value — fully usable with the
  gate locked.
- **Increment 3 = Phase 5**: Feature Composition.
- **Increment 4 = Phase 6**: the gated AI assists, strictly additive.
- **Increment 5 = Phases 7 + 8**: the no-AI sweep, polish, CHANGELOG, full evidence.
- Each increment is independently shippable and independently testable. **Every deterministic half ships before its
  AI half**, so "the tool works without AI" (US9/SC-005) is guaranteed by construction rather than by discipline.

## Total: 62 tasks

- Setup: 3 (T001–T003)
- Foundational: 15 — Layer 1 shell: 7 (T004–T010) · Layer 2 seams: 8 (T011–T018)
- US1: 6 (T019–T024) 🎯 MVP
- US2 + US3: 12 (T025–T036)
- US4 + US5 + US6 + US7: 14 (T037–T050)
- US8: 8 (T051–T058)
- US9 (verification-only): 1 (T059)
- Polish: 3 (T060–T062)

**Test tasks: 21** (every one written before its implementation, per Article V).
