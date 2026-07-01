---
description: "Task list for Teams → Jira Intake (Phase 2, Toolbox importer)"
---

# Tasks: Teams → Jira Issue Intake (Phase 2 — Toolbox importer)

**Input**: Design documents from `specs/005-teams-jira-intake/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/intake-contracts.md, quickstart.md

**Tests**: REQUIRED. This repo mandates TDD (Constitution Article V) and a pre-commit hook that
blocks any new source file lacking a **co-located `*.test.ts(x)`**. Every source task is preceded by
its failing test task.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (maps to spec user stories B / D / C). Setup, Foundational, and Polish
  carry no story label.
- All paths are repo-relative from `C:\ProjectsWin\NodeToolbox`.

**Scope note**: Story A (Teams capture) is Phase 1, built outside this repo — no tasks here.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffolding so the view is navigable and the CHANGELOG entry exists.

- [X] T001 Create the feature folder tree `client/src/views/JiraIntake/{lib,hooks,components}/` and an empty `client/src/views/JiraIntake/JiraIntake.module.css` using only the real theme tokens listed in research.md R7
- [X] T002 [P] Add a `JIRA_INTAKE_ROUTE` route constant and register a placeholder `<Route path={JIRA_INTAKE_ROUTE} element={<JiraIntake />} />` in `client/src/App.tsx` (mirror the `JIRA_TEMPLATE_MAKER_ROUTE` registration)
- [X] T003 [P] Add an `## [Unreleased]` entry in `CHANGELOG.md` describing the Teams→Jira intake importer (feature-level, one line)

**Checkpoint**: App builds and the empty Jira Intake view is reachable from routing.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Types, parsing, persistence, and the Jira user-search wrapper — shared by every user
story. **No user-story work starts until this phase is complete.**

**⚠️ Each `.ts` task = write the failing co-located test FIRST, then implement.**

- [X] T004 [P] Define intake shapes (`IntakeSubmission`, `IntakeConfig`, `IntakeFieldMapping`, `QueueEntry`, `ProcessedLedger`, `ProcessedEntry`, state unions) in `client/src/views/JiraIntake/lib/intakeTypes.ts` with a co-located `intakeTypes.test.ts` asserting the exported type surface compiles (per data-model.md §1–4)
- [X] T005 [P] Write failing `client/src/views/JiraIntake/lib/parseSubmissions.test.ts` (mock SheetJS/`FileReader`: `.xlsx` and `.csv` → header-keyed rows; prefers `Submissions` sheet; unreadable file throws `IntakeParseError`), then implement `parseSubmissions.ts` per contracts §A
- [X] T006 [P] Write failing `client/src/views/JiraIntake/lib/normalizeSubmission.test.ts` (flat keys, nested/dotted keys, extra columns preserved in `extras`, blank `id`/`summary` → `parseErrors`, never throws), then implement `normalizeSubmission.ts` per data-model.md §1 + research R2
- [X] T007 [P] Write failing `client/src/views/JiraIntake/lib/processedLedger.test.ts` (append entry, dedup lookup by `id`, serialize/merge for the store, no duplicate ids), then implement `processedLedger.ts` per data-model.md §4 + research R5
- [X] T008 Write failing `client/src/services/jiraApi.test.ts` case for `searchUsers(query)` (tries `?query=`, retries `?username=` on the DC "username query parameter was not provided" 400), then implement `searchUsers()` in `client/src/services/jiraApi.ts` per research R4 (reuse the SprintDashboard pattern)
- [X] T009 Write failing `client/src/views/JiraIntake/hooks/useIntakeConfig.test.ts` (mock `confluenceApi`/`getMyself`: load returns `{config, ledger}`; save merges-then-persists conflict-safe to property `nodetoolbox.intake.v1`; `recordProcessed` appends+persists), then implement `useIntakeConfig.ts` per contracts §D + research R3

**Checkpoint**: Files parse to normalized records, config+ledger persist and reload, `searchUsers`
resolves against the DC proxy. User stories can now begin.

---

## Phase 3: User Story 1 — Import & auto-create issues (Priority: P1) 🎯 MVP

**Goal** (spec Story B): A Toolbox user configures the intake, drops the exported Excel/CSV, sees the
queue newest-first, and each valid new submission becomes exactly one Jira issue with the reporter
set to the submitter when the email matches a Jira user; re-import never double-creates.

**Independent Test**: quickstart Scenarios 1, 2, 4 — configure, drop the real `Jira-Intake.xlsx`,
verify one issue per row with correct fields + matched reporter, then re-drop and confirm no dupes.

- [X] T010 [P] [US1] Write failing `client/src/views/JiraIntake/lib/mapToTemplateFields.test.ts` (core→Jira mapping produces `TemplateFieldEntry[]`; `fixedValue` overrides; wikiMarkup/choiceByName/raw transforms), then implement `mapToTemplateFields.ts` per contracts §B + data-model §2
- [X] T011 [P] [US1] Write failing `client/src/views/JiraIntake/lib/resolveReporter.test.ts` (unique case-insensitive `emailAddress` match → `{outcome:'matched', reporter:{name}}`; the fallback branch is stubbed here and completed in US2), then implement the matched path of `resolveReporter.ts` over an injected `searchUsers` per contracts §C
- [X] T012 [US1] Write failing `client/src/views/JiraIntake/hooks/useIntakeQueue.test.ts` (ingestFile → parse→normalize→dedup vs ledger→newest-first; counts total/new/imported/invalid; ledger ids render as `imported`), then implement `useIntakeQueue.ts` per contracts §E (depends on T005–T007)
- [X] T013 [US1] Write failing `client/src/views/JiraIntake/hooks/useCreateFromSubmission.test.ts` (validate required fields via `requiredFields` → resolve reporter → `buildCreatePayload` → `createIssue` → `recordProcessed` **before** surfacing success; failure leaves no ledger entry; ledger-guarded), then implement `useCreateFromSubmission.ts` per contracts §E + research R5/R6 (depends on T009–T012)
- [X] T014 [P] [US1] Write failing `client/src/views/JiraIntake/components/SubmissionDropzone.test.tsx` (drag-and-drop + file-picker fire `ingestFile`; non-spreadsheet shows the parse error), then implement `SubmissionDropzone.tsx`
- [X] T015 [P] [US1] Write failing `client/src/views/JiraIntake/components/IntakeQueue.test.tsx` (renders newest-first with submitter/timestamp/core values; per-row state badge + Jira key; paged/limited with visible count), then implement `IntakeQueue.tsx`
- [X] T016 [P] [US1] Write failing `client/src/views/JiraIntake/components/IntakeConfigPanel.test.tsx` (project search-by-key + issue-type pick reusing Template Maker pickers; core→Jira mapping rows; auto-create toggle; save calls `useIntakeConfig`), then implement `IntakeConfigPanel.tsx` per FR-1
- [X] T017 [US1] Write failing `client/src/views/JiraIntake/JiraIntake.test.tsx` (wires config panel + dropzone + queue; auto-create ON path creates on import), then implement the real `JiraIntake.tsx` view shell (depends on T012–T016)
- [ ] T018 [US1] Run quickstart Scenarios 1, 2, 4 against the real exported `Jira-Intake.xlsx`; capture created issue keys as evidence (Article X)

**Checkpoint**: MVP — configure, import, auto-create with matched reporter, dedup-safe re-import.

---

## Phase 4: User Story 2 — Submitter fallback, origin never lost (Priority: P2)

**Goal** (spec Story D): When the submitter email matches no Jira user (or is ambiguous/errors), the
issue is still created with the **integration account** as reporter and the submitter's name/email
recorded at the top of the description.

**Independent Test**: quickstart Scenario 3 fallback branch — a submission with an unmatched email
still creates an issue whose description opens with the origin note and whose reporter is the
integration account.

- [X] T019 [P] [US2] Write failing `client/src/views/JiraIntake/lib/describeSubmitter.test.ts` (builds the wiki-markup origin note from `submitter.displayName`/`email`, handles missing pieces), then implement `describeSubmitter.ts` per contracts §C
- [X] T020 [US2] Extend `resolveReporter.test.ts` for the fallback branch (no match / ambiguous / search error → `{outcome:'fallback', reporter:null}`), then complete the fallback path in `resolveReporter.ts`
- [X] T021 [US2] Extend `useCreateFromSubmission.test.ts` so a `fallback` outcome **omits `reporter`** on the create payload (Jira then attributes the issue to the `/jira-proxy` account `configuration.jira` — the confirmed integration account, per research R4/spec FR-3.2) and prepends `describeSubmitter(...)` to the mapped description; set `reporterOutcome` on the entry — then update `useCreateFromSubmission.ts` (depends on T019, T020)
- [ ] T022 [US2] Run quickstart Scenario 3 (both matched and fallback rows) and capture evidence that the origin is preserved

**Checkpoint**: Every submission creates an issue; attribution is correct or safely falls back.

---

## Phase 5: User Story 3 — Review-and-pick queue (Priority: P3)

**Goal** (spec Story C): With auto-create OFF, imported submissions sit in the queue; the user
creates or dismisses individual rows; created rows show their Jira key; nothing is created twice.

**Independent Test**: quickstart Scenario 5 — with auto-create OFF, import creates nothing until the
user clicks Create on a row; Dismiss marks a row `skipped`.

- [ ] T023 [US3] Extend `useIntakeQueue.test.ts`/`useCreateFromSubmission.test.ts` for review mode (import with auto-create OFF creates nothing; `createFromSubmission(entry)` on demand; `dismiss(entry)` → `skipped`), then implement the review-mode gating (depends on T012, T013)
- [ ] T024 [US3] Extend `IntakeQueue.test.tsx` to render per-row **Create** and **Dismiss** actions in review mode, then update `IntakeQueue.tsx`
- [ ] T025 [US3] Run quickstart Scenario 5 and confirm no issue is created until an explicit per-row Create

**Checkpoint**: Both auto-create and review-and-pick modes work from the same config toggle.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Robustness scenarios that span stories, plus release readiness.

- [ ] T026 [P] Add drift flagging: extend `useIntakeQueue`/queue entry to run `detectDrift` (Template Maker `drift.ts`) so a submission with a stale mapped option is marked `invalid` with reason, not created (FR-2.4, quickstart Scenario 6); update the co-located tests first
- [ ] T027 [P] Add the store/file error path (quickstart Scenario 7): dropzone surfaces a clear non-technical message on `IntakeParseError`; queue state unchanged, nothing created (FR-6.1, SC-5); assert in `SubmissionDropzone.test.tsx`
- [ ] T028 [P] Register one Jira Intake card/shortcut on the home/sidebar surface (mirror the Template Maker card); update the corresponding card-count test
- [ ] T029 Run the full quickstart (Scenarios 1–7) end-to-end and `cd client && npm run build` (tsc -b && vite build) + `npx vitest run src/views/JiraIntake` — all green (Article X)
- [ ] T030 Finalize the `CHANGELOG.md` entry and release with `scripts\local-release.ps1 minor`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: no dependencies.
- **Foundational (P2)**: depends on Setup; **blocks all user stories**.
- **US1 (P1)**: after Foundational. MVP.
- **US2 (P2)**: after US1 (extends `resolveReporter` + `useCreateFromSubmission`).
- **US3 (P3)**: after US1 (extends the queue + create hooks). Independent of US2.
- **Polish (P6)**: after the user stories you intend to ship.

### Within each story

- Failing co-located test precedes its implementation (TDD).
- `lib/` pure helpers → hooks (I/O) → components → view wiring.

### Parallel opportunities

- Foundational: T004–T007 are `[P]` (distinct files); T008/T009 depend on their own files only.
- US1: T010, T011 `[P]`; UI components T014–T016 `[P]` once hooks (T012, T013) exist.
- US2: T019 `[P]`.
- Polish: T026, T027, T028 `[P]`.

---

## Parallel Example: Foundational

```bash
# Distinct files, no interdependencies — run together:
Task: "parseSubmissions.ts + test"        # T005
Task: "normalizeSubmission.ts + test"     # T006
Task: "processedLedger.ts + test"         # T007
Task: "intakeTypes.ts + test"             # T004
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational (blocks everything) → 3. Phase 3 US1 →
4. **STOP and validate** with the real `Jira-Intake.xlsx` (Scenarios 1, 2, 4) → demo the MVP.

### Incremental delivery

US1 (import + auto-create + matched reporter + dedup) → US2 (fallback attribution) → US3
(review-and-pick) → Polish (drift, errors, home card, release). Each increment is independently
testable and adds value without breaking the prior one.

---

## Notes

- `[P]` = different files, no incomplete dependency.
- Every new source file **must** ship with a co-located `*.test.ts(x)` or the pre-commit hook blocks
  the commit.
- Reuse (do not reimplement): `buildCreatePayload`, `requiredFields`, `drift`, `wikiMarkup`,
  `fieldModel`, `templateTypes`, the Template Maker pickers, `confluenceApi` content-property store,
  and the existing `jiraApi` create/createmeta calls.
- Real dropped file confirms header casing / sheet name / date serialization before T005–T006 land —
  request it before implementing the parser.
- Commit format: `type: description` (no scope — the hook rejects `type(scope):`).
