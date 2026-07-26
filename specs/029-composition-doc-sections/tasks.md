# Tasks: Structured Feature Documentation in Feature Composition

**Input**: Design documents from `specs/029-composition-doc-sections/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅ (document-structure, ai-prompt-ingest, commit-writes)

**Tests**: INCLUDED — Constitution Article V mandates TDD (red → green → refactor). The pure module, the prompt/ingest changes, and the commit link step each get a failing vitest suite first.

**Organization**: By user story. MVP = US1 + US2 (both P1 — the nine-section structure and the honest validation flagging). All work is client-side TS under `client/src/views/PoTool/`; the composition AI, commit path, AC-field write, and `createIssueLink` are **reused** (plan.md drift ledger) — do NOT re-implement them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task.
- Tests sit beside their module (`*.test.ts(x)`).

## Guardrails (apply to every task)

- **Do NOT** modify the Feature Splitter, PI Review, hygiene, or any other AI surface — scope is Feature Composition only (FR-040).
- Keep the composition AI **propose-only** and gated; nothing writes to Jira without the PO's commit.
- **Never** emit AI self-attribution (FR-003); validation markers are about missing information, not AI authorship.
- **File coordination**: `ai/featureDocSections.ts` is edited across Foundational→US1→US2→US3 (sequence those); `ai/compositionAiAssist.ts` is edited in US1 then US2 (sequence those).

---

## Phase 1: Setup

- [x] T001 [P] Confirm the baseline is green before any change (must stay green throughout): `cd client && npx vitest run src/views/PoTool/ai/compositionAiAssist src/views/PoTool/FeatureCompositionTab src/views/PoTool/jira`.
- [x] T002 [P] Confirm the reuse points resolve: `buildCompositionCommit`/`runCompositionCommit` in `client/src/views/PoTool/jira/buildCompositionCommit.ts`, the AC-field write (`acceptanceCriteriaFieldId`) + AI apply in `client/src/views/PoTool/FeatureCompositionTab.tsx`, and `createIssueLink` in `client/src/services/jiraApi.ts`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The section canon every story builds on. **BLOCKS all user stories.**

- [x] T003 [P] Write failing tests `client/src/views/PoTool/ai/featureDocSections.test.ts` for the canon: `SECTION_LABELS` is the nine labels in the exact spec order; `VALIDATION_MARKER` maps `business`/`technical`/`both` to the three ⚠ strings; `DEFAULT_VALIDATION_KIND` maps each label to its default kind (research R2).
- [x] T004 Create `client/src/views/PoTool/ai/featureDocSections.ts` with `SECTION_LABELS`, `ValidationKind`, `VALIDATION_MARKER`, and `DEFAULT_VALIDATION_KIND` (named constants + types only, no logic). Make T003 green.

**Checkpoint**: The canon exists and is unit-green; the stories can build the functions.

---

## Phase 3: User Story 1 - Complete nine-section document (Priority: P1) 🎯 MVP

**Goal**: The AI-composed description always contains all nine sections, labeled, in order; AC is written to the AC field and also carried in the description's AC section.

**Independent Test**: Ingest a reply whose description omits sections → the returned description has all nine in order (missing ones flagged); committing writes the description and the AC field.

### Tests for User Story 1 (write first, must FAIL)

- [x] T005 [P] [US1] Failing tests in `client/src/views/PoTool/ai/featureDocSections.test.ts`: `normalizeFeatureDescription` returns all nine sections in canonical order, preserves existing content, inserts a marker-flagged placeholder for a missing section, and is idempotent (`normalize(normalize(x)) === normalize(x)`); `buildValidationPlaceholder(label)` emits the correct marker and no AI attribution.
- [x] T007 [P] [US1] Failing tests in `client/src/views/PoTool/ai/compositionAiAssist.test.ts`: `buildCompositionPrompt` output contains the nine section labels and the "put the full AC in both the description's Acceptance Criteria section and the acceptanceCriteria field" instruction; `parseCompositionIngest` runs the reply's `description` through `normalizeFeatureDescription` (a reply missing sections yields a proposal whose description has all nine).

### Implementation for User Story 1

- [x] T006 [US1] Implement `normalizeFeatureDescription` + `buildValidationPlaceholder` in `client/src/views/PoTool/ai/featureDocSections.ts` per contracts/document-structure.md. Make T005 green. (depends T004)
- [x] T008 [US1] Modify `buildCompositionPrompt` (nine-section + AC-in-both instructions) and `parseCompositionIngest` (pass `description` through `normalizeFeatureDescription`) in `client/src/views/PoTool/ai/compositionAiAssist.ts`. Make T007 green. (depends T006)
- [x] T009 [US1] Confirm the AC-field write still fires and the AC text remains in the description's AC section after normalization; add/adjust an assertion in `client/src/views/PoTool/FeatureCompositionTab.test.tsx` (no behavior change to the AC-field path — it already exists).

**Checkpoint**: Every AI-composed description is a complete, ordered nine-section document with AC in both places.

---

## Phase 4: User Story 2 - Flag under-supported sections; never attribute to AI (Priority: P1)

**Goal**: Sections the material can't substantiate are proposed but marked `⚠ REQUIRES BUSINESS / TECHNICAL / BUSINESS & TECHNICAL VALIDATION`; no output ever says it was written by AI.

**Independent Test**: With thin material, sections the AI couldn't substantiate carry the correct marker; a well-supported section carries none; no AI-authorship phrasing survives ingest.

### Tests for User Story 2 (write first, must FAIL)

- [x] T010 [P] [US2] Failing tests in `client/src/views/PoTool/ai/featureDocSections.test.ts`: `stripAiAttribution` removes AI-authorship phrasing (e.g. "generated by AI", "as an AI language model") but leaves `⚠ REQUIRES … VALIDATION` markers and normal prose intact.
- [x] T012 [P] [US2] Failing tests in `client/src/views/PoTool/ai/compositionAiAssist.test.ts`: `buildCompositionPrompt` instructs the three ⚠ markers for under-supported sections and forbids any AI self-attribution; `parseCompositionIngest` applies `stripAiAttribution` so an AI-authorship sentence in the reply's description is removed while sections/markers remain.

### Implementation for User Story 2

- [x] T011 [US2] Implement `stripAiAttribution` in `client/src/views/PoTool/ai/featureDocSections.ts`. Make T010 green. (file coord with T006)
- [x] T013 [US2] Modify `buildCompositionPrompt` (marker + never-say-AI instructions) and `parseCompositionIngest` (apply `stripAiAttribution` before returning the proposal) in `client/src/views/PoTool/ai/compositionAiAssist.ts`. Make T012 green. (file coord with T008)

**Checkpoint**: MVP complete — honest, complete, non-AI-attributed nine-section documents.

---

## Phase 5: User Story 3 - Link risks that already have a ticket (Priority: P2)

**Goal**: On commit, a risk whose material references an existing Jira key is linked "relates to"; others are documented; a failed link never blocks the commit.

**Independent Test**: Compose with two risks (one referencing an existing key, one not) → committing links the first ("Relates") and documents the second; a bad key fails non-fatally.

### Tests for User Story 3 (write first, must FAIL)

- [x] T014 [P] [US3] Failing tests in `client/src/views/PoTool/ai/featureDocSections.test.ts`: `extractRiskLinkKeys(description)` returns the distinct Jira keys found **only** in the Risks section, in first-seen order; a key in another section (e.g. Dependencies) is not returned.
- [x] T016 [P] [US3] Failing tests `client/src/views/PoTool/jira/buildCompositionCommit.test.ts` (mocked deps): `buildCompositionCommit` puts the Risks-section keys (and only those) into `riskLinkKeys`; `runCompositionCommit` creates one `{type:{name:'Relates'}, inwardIssue:{key:feature}, outwardIssue:{key:risk}}` link per key; a failing `createIssueLink` is captured in the outcome and does not throw / does not fail the commit; empty `riskLinkKeys` ⇒ `createIssueLink` never called.

### Implementation for User Story 3

- [x] T015 [US3] Implement `extractRiskLinkKeys` in `client/src/views/PoTool/ai/featureDocSections.ts`. Make T014 green. (file coord)
- [x] T017 [US3] Modify `client/src/views/PoTool/jira/buildCompositionCommit.ts` — `buildCompositionCommit` computes `riskLinkKeys` via `extractRiskLinkKeys(draft.description)`; `runCompositionCommit` gains an injected `createIssueLink`, creates the `Relates` links after the Feature exists (key from `createdKeysByLocalId.feature` or `draft.existingIssueKey`), non-fatally, collecting results into the outcome. Make T016 green. (depends T015)
- [x] T018 [US3] Wire `createIssueLink` (from `services/jiraApi.ts`) into `handleCommit`'s `runCompositionCommit` deps in `client/src/views/PoTool/FeatureCompositionTab.tsx` and surface the risk-link results in the commit outcome UI. (depends T017)

**Checkpoint**: Risks link when a ticket exists; the commit never breaks on a bad link.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T019 [P] Update `CHANGELOG.md` with the Feature Composition documentation-sections entry.
- [x] T020 Full verification: `cd client && npx vitest run`, `npx tsc -b`, `npx eslint src/views/PoTool`.
- [x] T021 Regression gate: `cd client && npx vitest run src/views/PoTool` and the composition suites — all green (no reused-surface regression; Splitter/PI Review untouched).
- [x] T022 Record the Framework-First drift one-liner at the head of `featureDocSections.ts`, and confirm by search that no non-composition AI surface was modified.

---

## Dependencies & Execution Order

### Phase dependencies
- **Setup** → no deps.
- **Foundational (T003–T004)** → blocks all stories (the canon).
- **US1** → needs the canon; is the MVP core (normalize + prompt/ingest structure).
- **US2** → extends the same module + prompt/ingest (strip + markers); sequence its file edits after US1's.
- **US3** → needs `extractRiskLinkKeys` (same module) + the commit path; independent of US2.
- **Polish** → after the desired stories.

### Within a story
- Tests (`.test.*`) written first and FAIL, then implementation makes them green (TDD).
- Pure module before prompt/ingest; prompt/ingest before commit wiring.

### Parallel opportunities
- Setup: T001, T002 in parallel.
- Foundational: T003 (test) then T004.
- US1: T005 and T007 (distinct test files) in parallel; implementations T006 → T008 (ordered by dependency + file coord).
- US2: T010 and T012 in parallel; T011 → T013.
- US3: T014 and T016 in parallel; T015 → T017 → T018.
- Cross-file coordination: `featureDocSections.ts` (T004/T006/T011/T015) and `compositionAiAssist.ts` (T008/T013) are each single-file sequences — do not parallelize edits to the same file.

## Parallel Example: User Story 1

```bash
# Write these failing tests together (distinct files):
Task: "normalize/placeholder tests in ai/featureDocSections.test.ts"
Task: "prompt+ingest tests in ai/compositionAiAssist.test.ts"
```

## Implementation Strategy

### MVP first (US1 + US2 — both P1)
1. Setup → Foundational (canon).
2. US1 → complete nine-section, ordered, AC-in-both.
3. US2 → validation markers + no AI attribution.
4. **STOP & VALIDATE** against quickstart steps 2–4; demo.

### Incremental delivery
Add US3 (risk linking) → validate steps 5–7 → polish. Each story keeps the reused composition/PoTool suites green.

## Notes
- [P] = different files, no incomplete-task dependency.
- Verify each test fails before implementing it.
- Commit after each logical group; never commit to `main`; release via `scripts/local-release.ps1` only.
- The two single-file sequences to respect: `featureDocSections.ts` and `compositionAiAssist.ts`.
