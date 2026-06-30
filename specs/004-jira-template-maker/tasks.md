# Tasks: Jira Template Maker

**Input**: Design documents from `/specs/004-jira-template-maker/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: INCLUDED — the constitution (Article V) mandates TDD (red → green → refactor), so
each pure helper and story carries test tasks written before implementation.

**Organization**: By user story. US1 (build & save) is the MVP; US2 (create from template) and
US3 (clean labels) layer on independently.

**Story map** (from spec.md): US1 = Story A + Story C (guardrails) · US2 = Story B · US3 = Story D.

**Jira flavor**: **Server/Data Center** confirmed (research.md D1) → classic `createmeta` +
wiki-markup text fields.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different file, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (omitted for Setup, Foundational, Polish)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffolding.

- [X] T001 Create the view directory structure `client/src/views/JiraTemplateMaker/` with `hooks/`, `components/`, `lib/`, and `__tests__/` subfolders per plan.md
- [X] T002 [P] Register the Jira Template Maker view in the client navigation/view registry, mirroring how `ArtView`/`SnowHub` views are registered (e.g. `client/src/App.tsx` or the view registry)
- [X] T003 ✅ RESOLVED — Jira flavor confirmed **Server/Data Center** (research.md D1): use the classic `/rest/api/2/issue/createmeta` endpoint and the **wiki-markup** text serializer throughout. No further action; downstream tasks assume this.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, services, the pure field model, the template store, and the wizard
shell that every user story builds on.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [X] T004 [P] Add createmeta, field-schema, and create-issue TypeScript types (`CreateMetaResponse`, `CreateMetaProject`, `CreateMetaIssueType`, `CreateMetaField`, `CreateMetaFieldSchema`, `CreateIssueRequest`, `CreateIssueResponse`) to `client/src/types/jira.ts` per contracts/jira-metadata.md
- [X] T005 [P] Write failing unit tests for the createmeta→field model mapping (each `schema` shape → `internalType`; `isSupported` gate for cascading/unknown) in `client/src/views/JiraTemplateMaker/__tests__/fieldModel.test.ts` per data-model.md §3
- [X] T006 Implement `client/src/views/JiraTemplateMaker/lib/fieldModel.ts` (createmeta field → `FieldDescriptor`, supported-type classification) to make T005 pass
- [X] T007 Add `getCreateMeta` (classic Server/DC endpoint) and `createIssue` typed wrappers to `client/src/services/jiraApi.ts` (using `jiraGet`/`jiraPost`), with unit tests mocking `fetch`, per contracts/jira-metadata.md C2/C3 (both wrappers added here so US1 and US2 don't edit this file in parallel)
- [X] T008 [P] Write failing unit tests for the template store (load-absent→empty default, `schemaVersion` gate, save round-trip, 3-way merge by template id) in `client/src/views/JiraTemplateMaker/__tests__/templateStore.test.ts` per contracts/template-store.md
- [X] T009 Add `JIRA_TEMPLATES_PROPERTY_KEY`, `loadJiraTemplates`, `saveJiraTemplates`, and the merge helper to `client/src/services/confluenceApi.ts` (reusing `fetchConfluenceDatabasePropertyByKey`/`upsertConfluenceDatabaseProperty`) to make T008 pass
- [X] T010 Create the wizard state skeleton `client/src/views/JiraTemplateMaker/hooks/useTemplateMakerState.ts` (currentStep, goToStep, draft `JiraTemplate` model with `TemplateFieldEntry[]`) mirroring `useCrgState.ts`
- [X] T011 Create the wizard shell `client/src/views/JiraTemplateMaker/JiraTemplateMaker.tsx` (step indicator + navigation) mirroring `client/src/views/SnowHub/tabs/CreateChgTab.tsx`, wired to `useTemplateMakerState`

**Checkpoint**: Types, field model, Jira wrappers, template store, and an empty wizard render — user stories can begin.

---

## Phase 3: User Story 1 — Build & save a valid template (Priority: P1) 🎯 MVP

**Goal**: A non-technical user picks Project → Issue Type → Fields (only-valid choices, real
dropdown options, unsupported fields shown-not-addable), enters type-aware values, marks each
field fixed or prompt-at-launch, and saves a named template (with its author) to the shared
library.

**Independent Test**: With a live Jira, build a template choosing a project, an issue type, and
several fields; confirm only valid issue types/fields/options are offered, the template persists
to the shared store with the author recorded, and reloads.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [X] T012 [P] [US1] Component test: project→issuetype→field dependent narrowing, and unsupported field types appear marked and non-addable, in `client/src/views/JiraTemplateMaker/__tests__/wizard.pickers.test.tsx`
- [X] T013 [P] [US1] Component test: a dropdown field offers only `allowedValues` and rejects free-typed values, in `client/src/views/JiraTemplateMaker/__tests__/fieldValueInput.test.tsx`
- [X] T014 [P] [US1] Test: saving persists the template via the store with `authorName` recorded, and a template referencing a now-missing option is flagged stale (drift, FR-7.3), in `client/src/views/JiraTemplateMaker/__tests__/templateLibrary.test.ts`

### Implementation for User Story 1

- [X] T015 [US1] Implement `client/src/views/JiraTemplateMaker/hooks/useJiraCreateMeta.ts` (load createmeta per project+issuetype via `getCreateMeta`, map through `fieldModel`, surface a plain-language error with no guessed data on failure — FR-7.2), with unit tests
- [X] T016 [P] [US1] Implement `client/src/views/JiraTemplateMaker/components/IssueTypePicker.tsx` (issue types from createmeta for the chosen project — FR-1.2)
- [X] T017 [P] [US1] Implement `client/src/views/JiraTemplateMaker/components/ScopedFieldPicker.tsx` (supported fields addable; unsupported shown-not-addable — FR-1.3, FR-2.1)
- [X] T018 [P] [US1] Implement `client/src/views/JiraTemplateMaker/components/FieldValueInput.tsx` dispatcher for choice/multiChoice/user/date/datetime/number/components/versions inputs sourced from `allowedValues` (FR-2.2); labels & text handled in later stories/tasks
- [X] T019 [US1] Implement pure `client/src/views/JiraTemplateMaker/lib/wikiMarkup.ts` (editor doc → Jira wiki markup: bold, italic, headings, lists, links, inline/code blocks — Q3=A) with unit tests
- [X] T020 [US1] Implement `client/src/views/JiraTemplateMaker/components/WikiMarkupEditor.tsx` (minimal core-formatting editor emitting via `wikiMarkup`) and wire it as the `text` input in `FieldValueInput`
- [X] T021 [US1] Implement `client/src/views/JiraTemplateMaker/hooks/useTemplateLibrary.ts` (list/save/edit/delete shared templates via `load/saveJiraTemplates`; drift detection per FR-7.3)
- [X] T022 [US1] Resolve the current author via `GET /rest/api/2/myself` (reuse the mention-state identity approach) and record `authorName` on save; fall back to `unknown` without blocking the save (FR-4.3, research.md D8)
- [X] T023 [US1] Re-scope downstream pickers when the project or issue type changes, and warn the user about any previously added fields that are no longer valid, in `useTemplateMakerState`/the wizard (FR-1.4)
- [X] T024 [US1] Add a pre-flight create-permission check (e.g. createmeta returning the issue type / a permission probe) so a project the user cannot create issues in is surfaced before they build a template (spec Edge Cases)
- [X] T025 [US1] Add the per-field fixed vs prompt-at-launch toggle (FR-2.5, with optional default) and required-field indicators (FR-2.4) to the wizard form
- [X] T026 [US1] Wire the project step to the reused `client/src/components/JiraProjectPicker`, assemble the full build→save flow in `JiraTemplateMaker.tsx`, and apply plain-language labels/errors (FR-6, human field names not IDs)

**Checkpoint**: A user can build and save a valid template (author recorded); invalid choices are impossible. MVP demoable.

---

## Phase 4: User Story 2 — One-click reuse / create issue (Priority: P2)

**Goal**: Launch a saved template to create a real Jira issue: prompt only for prompt-at-launch
fields (pre-filled with defaults), validate required fields, create in a single confirm, and
offer an open-in-Jira link.

**Independent Test**: Given a saved template, launch it; a zero-prompt template creates in one
confirm (<10s), a template with one prompt asks only that field, and a missing required field
blocks creation by name.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [X] T027 [P] [US2] Test: launch prompts only prompt-at-launch fields (defaults pre-filled) and applies fixed values without re-entry, in `client/src/views/JiraTemplateMaker/__tests__/launch.test.tsx`
- [X] T028 [P] [US2] Unit test: `buildCreatePayload` maps every supported field type to the correct `POST /issue` `fields` shape (data-model §1 table), in `client/src/views/JiraTemplateMaker/__tests__/buildCreatePayload.test.ts`
- [X] T029 [P] [US2] Test: a missing required field blocks create, names the field, and creates nothing (FR-5.2), in `client/src/views/JiraTemplateMaker/__tests__/launch.validation.test.tsx`

### Implementation for User Story 2

- [X] T030 [US2] Implement pure `client/src/views/JiraTemplateMaker/lib/buildCreatePayload.ts` (template fixed entries + launch answers → `{ fields: {...} }`, per-type mapping, optional reporter) to make T028 pass
- [X] T031 [US2] Implement the launch flow in `JiraTemplateMaker.tsx`/a `LaunchDialog` component: prompt for prompt-at-launch fields with defaults, single confirm (FR-5.1)
- [X] T032 [US2] Add pre-create required-field validation surfacing all missing fields in plain language before any POST (FR-5.2)
- [X] T033 [US2] Call `createIssue`; on success render an open-in-Jira link built from the configured base URL (FR-5.3) and ensure no stray issue links/parent relationships are created (FR-5.4)
- [X] T034 [US2] Implement reporter handling (FR-5.5): Reporter as a templatable/prompt field (`{ name }` on Server/DC); when unset, default to the integration account and clearly tell the user

**Checkpoint**: A saved template creates a real, valid Jira issue in one action.

---

## Phase 5: User Story 3 — Clean labels (Priority: P3)

**Goal**: Labels are case-sensitive, de-duplicated within a template, never duplicated when
written to Jira, and invalid labels are surfaced clearly.

**Independent Test**: Add `Ops`, `Ops`, `ops` to a template's Labels field; the template stores
`Ops` and `ops` once each; the created issue's labels are exactly `Ops` and `ops`.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [X] T035 [P] [US3] Unit test `lib/labels.ts`: case-sensitive dedupe (`Ops`≠`ops`, collapse duplicate `Ops`), reject space-containing labels with a message, union-dedupe on create, in `client/src/views/JiraTemplateMaker/__tests__/labels.test.ts`
- [X] T036 [P] [US3] Component test: the Labels field input dedupes case-sensitively and the create payload's labels are deduped, in `client/src/views/JiraTemplateMaker/__tests__/labelsInput.test.tsx`

### Implementation for User Story 3

- [X] T037 [US3] Implement pure `client/src/views/JiraTemplateMaker/lib/labels.ts` (case-sensitive dedupe, invalid-label detection, union-on-create) to make T035 pass (FR-3.1–3.4)
- [X] T038 [US3] Implement the Labels variant in `FieldValueInput.tsx` using `lib/labels` (case-sensitive add/dedupe; reject invalid with a clear message — FR-3.4)
- [X] T039 [US3] Wire deduped labels through `buildCreatePayload` so created-issue labels are never duplicated (FR-3.3)

**Checkpoint**: All three stories work independently.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T040 [P] Update `CHANGELOG.md` (`[Unreleased]`) with the Jira Template Maker feature entry
- [X] T041 [P] Accessibility & plain-language pass across the wizard (FR-6): step clarity, human field names, no Jira jargon in labels/errors
- [X] T042 Run the full client suite `cd client && npx vitest run` and `npx tsc --noEmit`; resolve any regressions
- [ ] T043 Execute the quickstart.md scenarios S1–S9 against a live Jira and record evidence (Article X — verify a created issue in Jira, not just HTTP 200) — BLOCKED: requires a running Jira Server/DC instance; not runnable in this environment.

---

## Dependencies & Execution Order

### Phase dependencies
- **Setup (P1)**: T001–T003 first (T003 is already resolved — Server/DC).
- **Foundational (P2)**: depends on Setup; **blocks all stories**.
- **US1 (P3)** → **US2 (P4)** → **US3 (P5)**: each depends only on Foundational and is
  independently testable. US2 reads templates saved by US1 but is testable with any saved
  template; US3 is testable via its helper + a labels template.
- **Polish (P6)**: after the desired stories.

### Within each story
- Tests written first and failing → models/helpers → components → integration.
- Pure `lib/` helpers (T006, T019, T030, T037) before the components that consume them.

### Parallel opportunities
- Foundational: T004 ∥ T005 ∥ T008 (different files); then T006/T007/T009/T010/T011.
- US1 tests T012 ∥ T013 ∥ T014; components T016 ∥ T017 ∥ T018 after T015; T022/T023/T024 touch
  shared wizard state so run sequentially relative to T026.
- US2 tests T027 ∥ T028 ∥ T029.
- US3 tests T035 ∥ T036.
- Polish: T040 ∥ T041.

---

## Parallel Example: User Story 1

```bash
# Tests first (parallel):
Task: "Component test: dependent picker narrowing + unsupported gate (wizard.pickers.test.tsx)"
Task: "Component test: dropdown offers only allowedValues (fieldValueInput.test.tsx)"
Task: "Test: save persists + author recorded + drift flag (templateLibrary.test.ts)"

# Then components (parallel) after useJiraCreateMeta (T015):
Task: "IssueTypePicker.tsx"
Task: "ScopedFieldPicker.tsx"
Task: "FieldValueInput.tsx"
```

---

## Implementation Strategy

### MVP (US1 only)
1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 (through T026) → **stop &
validate** (build+save a valid template against live Jira) → demo.

### Incremental delivery
Foundation → US1 (build & save, MVP) → US2 (create from template) → US3 (clean labels). Each
story adds value without breaking the prior ones; run quickstart scenarios as each lands.

---

## Notes
- [P] = different files, no incomplete-task dependency.
- All Jira/Confluence I/O flows through existing proxy routes (no server changes, Article IX).
- No new npm dependencies (Article VII): the editor is in-house emitting wiki markup.
- Commit after each task or logical group; keep functions < 40 lines (Article IV).
- Jira target is **Server/DC** (classic createmeta + wiki markup); the `lib/wikiMarkup.ts` seam
  keeps a future Cloud/ADF path cheap.
