# Tasks: Rebuild an Existing Change From Scratch

**Input**: Design documents from `/specs/033-chg-rescope-rewrite/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **REQUIRED.** Constitution Article V mandates TDD (red → green → refactor) — a failing test precedes every
implementation task. Every contract in `contracts/` names its tests.

**Organization**: Tasks are grouped by user story so each can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US7)
- Exact file paths are included in every task

## Path Conventions

Client-only React/TypeScript feature. All paths are relative to the repository root
(`C:\ProjectsWin\NodeToolbox`). No server changes, no new dependencies.

---

## ⚠️ Read before starting

Phase 0 recon ([research.md](./research.md)) established that **most of this feature already ships**. Many tasks
below are therefore **verification tasks, not construction tasks** — they prove reused machinery behaves correctly
in rebuild mode. If such a test passes on the first run, that is success, not a skipped task: record it and move on.
Do **not** invent work to make a phase feel substantial.

**Two files are edited by ZERO tasks**: `client/src/views/SnowHub/tabs/ChgTab.tsx` and
`client/src/views/SnowHub/tabs/ConfigurationTab.tsx`. If either needs editing, the `mode` prop stopped being
additive — **revert, do not adjust**.

**Existing tests are never modified.** If an existing test needs a change to pass, that is a regression signal.

---

## Phase 1: Setup

**Purpose**: Establish the regression baseline everything is measured against.

- [X] T001 Record the baseline by running `npx vitest run src/views/SnowHub` from `client/` and noting the exact pass count (expected 390 across 23 files); this number is the floor for every later run

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Draft isolation and the mode seam. Both are prerequisites for mounting a rebuild at all — a rebuild
mounted before T005 lands would silently destroy the operator's in-progress Create draft.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

**Contracts**: [draft-isolation.md](./contracts/draft-isolation.md), [rebuild-mode.md](./contracts/rebuild-mode.md)

### Tests first ⚠️

> Write these and confirm they FAIL before writing any implementation.

- [X] T002 [P] Create failing tests in `client/src/views/SnowHub/hooks/crgStorageKeys.test.ts` covering: key normalises trim + uppercase so ` chg0001234 ` and `CHG0001234` resolve to one key; two different change numbers produce different keys; the key never equals `'ntbx-crg-state'` including for `''` and whitespace input
- [X] T003 [P] Add failing tests to `client/src/views/SnowHub/hooks/useCrgState.test.ts` covering storage isolation: a hook mounted with a rebuild key does not hydrate a seeded `ntbx-crg-state`; mutating it leaves `ntbx-crg-state` byte-identical; a rebuild draft survives a remount under the same key; a rebuild draft is not visible under a different change number; environment Enabled ticks still do not survive a rebuild remount (v0.137.1 rule)
- [X] T004 [P] Add a failing test to `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx` asserting `<CreateChgTab mode="rebuild" targetChangeNumber="CHG0001234" />` renders the wizard step chrome (rebuild is not configuration mode)

### Implementation

- [X] T005 [P] Create `client/src/views/SnowHub/hooks/crgStorageKeys.ts` exporting `CRG_REBUILD_STORAGE_KEY_PREFIX` and `buildRebuildStorageKey(changeNumber)` with a file purpose comment and a doc comment on the export (makes T002 green)
- [X] T006 Add the optional `options?: { storageKey?: string }` argument to `useCrgState` in `client/src/views/SnowHub/hooks/useCrgState.ts`, defaulting to `'ntbx-crg-state'`, threading it through `createInitialCrgState`, `loadPersistedCrgState`, the persistence effect, `reset`, and the post-submit clear; record the Article VII drift justification as a one-line comment at the option (makes T003 green)
- [X] T007 Extend `CrgTabProps` in `client/src/views/SnowHub/tabs/CreateChgTab.tsx` with `mode?: 'wizard' | 'configuration' | 'rebuild'` and `targetChangeNumber?: string`, change `shouldShowWizardChrome` to `mode !== 'configuration'`, and pass `buildRebuildStorageKey(targetChangeNumber)` to `useCrgState` when in rebuild mode; fail loudly if rebuild mode is given no target number (makes T004 green)
- [X] T008 Run the existing `CreateChgTab`, `ConfigurationTab`, and `useCrgState` suites **unmodified** and confirm all pass — this is the additive-guarantee proof for T006 and T007

**Checkpoint**: A rebuild can now be mounted without touching the Create wizard's draft. User story work can begin.

---

## Phase 3: User Story 1 — Start over on a loaded change (Priority: P1) 🎯 MVP

**Goal**: Give a loaded change a **Start Over** action that confirms the destruction, then opens the builder blank
and bound to that change number.

**Independent Test**: Load an existing open change, start over, and confirm the builder opens blank and displays the
CHG number it will write to — while ServiceNow still holds the original content.

**Contract**: [rebuild-entry.md](./contracts/rebuild-entry.md)

### Tests first ⚠️

- [X] T009 [P] [US1] Add failing tests to `client/src/views/SnowHub/tabs/ModifyChgTab.test.tsx` for availability: Start Over is absent with no change loaded, present after a fetch by number, and present after a "Load My Open Changes" selection
- [X] T010 [P] [US1] Add failing tests to `client/src/views/SnowHub/tabs/ModifyChgTab.test.tsx` for the confirmation: pressing Start Over clears nothing on its own, the confirmation names the change number and states the content will be discarded, and cancelling leaves the loaded change's field values unchanged with the builder unmounted
- [X] T011 [P] [US1] Add a failing test to `client/src/views/SnowHub/tabs/ModifyChgTab.test.tsx` asserting that confirming mounts the builder with the target number visible and every content field blank
- [X] T012 [P] [US1] Add failing tests to `client/src/views/SnowHub/tabs/ModifyChgTab.test.tsx` for editable state: a closed/cancelled change warns before the rebuild starts, and an unrecognised state value renders no warning

### Implementation

- [X] T013 [US1] Add `rebuildTargetNumber` to `ModifyChgState` and render the Start Over control in `client/src/views/SnowHub/tabs/ModifyChgTab.tsx`, gated on a loaded change, placed beside the existing step chrome without replacing or disabling the existing edit steps (makes T009 green)
- [X] T014 [US1] Implement the destructive confirmation in `client/src/views/SnowHub/tabs/ModifyChgTab.tsx` reusing `CreateChgTab.module.css` (`passphraseOverlay` + modal pattern already used for the assist prompt, plus `errorText` / `primaryButton` / `secondaryButton`), naming the change number, not auto-focusing the confirm action (makes T010 green)
- [X] T015 [US1] On confirm, render `<CreateChgTab mode="rebuild" targetChangeNumber={changeKey} />` in place of the loaded change's body in `client/src/views/SnowHub/tabs/ModifyChgTab.tsx`, and clear `rebuildTargetNumber` when the operator leaves the rebuild (makes T011 green)
- [X] T016 [US1] Derive the editable-state warning in `client/src/views/SnowHub/tabs/ModifyChgTab.tsx` from the change record already fetched by `fetchChangeFromSnow` — no additional request; **resolve the open item in [research.md Finding 7](./research.md#finding-7--editable-state-warning-fr-008)** by confirming this instance's state field and non-editable values, and treat any unrecognised value as editable and silent (makes T012 green)

**Checkpoint**: The destructive entry works end-to-end and is safe. The builder opens blank and bound.

---

## Phase 4: User Story 2 — Build the new scope by fix version and by query (Priority: P1)

**Goal**: Prove the existing scope-fetch machinery works inside a rebuild.

**Independent Test**: In a rebuild, fetch a fix version and confirm the issue list matches it with all issues
selected.

**Reuse note**: `FetchIssuesStep`, `setProjectKey`, `setFixVersion`, `setCustomJql`, and `fetchIssues` all ship
today. Expect T017–T018 to pass without new code; T019 exists only to close a gap if one is found.

### Tests first ⚠️

- [X] T017 [P] [US2] Add failing/verification tests to `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx` asserting that rebuild mode renders the fetch-mode selector, the Project Key + Fix Version inputs, and the Custom JQL textarea, and that fetched issues arrive all-selected
- [X] T018 [P] [US2] Add tests to `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx` asserting an empty result set reports an empty scope rather than a silent blank list, and that a Jira lookup failure is reported as a Jira problem while preserving the rebuild in progress

### Implementation

- [X] T019 [US2] Only if T017 or T018 fails: make the minimal fix in `client/src/views/SnowHub/tabs/CreateChgTab.tsx` or `client/src/views/SnowHub/hooks/useCrgState.ts`; if both pass, record "reuse verified — no change required" and close the task

**Checkpoint**: Scope can be built inside a rebuild.

---

## Phase 5: User Story 3 — Add one more story to the fetched scope (Priority: P1)

**Goal**: Prove the additive path — fetch a fix version, then add one story by key.

**Independent Test**: Fetch a fix version, add a single issue by key, confirm the basket holds both with no
duplicates.

**Reuse note**: `actions.addIssues()` — the **"+ Add to Loaded Issues"** button — ships today for exactly this.

### Tests first ⚠️

- [X] T020 [P] [US3] Add tests to `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx` asserting the "+ Add to Loaded Issues" control appears in rebuild mode once issues are loaded, that a second search unions into the basket rather than clearing it, and that a repeated issue appears once
- [X] T021 [P] [US3] Add a test to `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx` asserting a single issue can be added via a `key = ABC-123` custom-JQL search through the same add path, and that excluding an issue removes it from the selection

### Implementation

- [X] T022 [US3] Only if T020 shows the notice does not report **both** the added count and the already-present count (FR-013), extend the `fetchNotice` message in `client/src/views/SnowHub/hooks/useCrgState.ts`; otherwise record "reuse verified" and close

**Checkpoint**: The operator's stated working pattern — fix version plus a quick key search — works in a rebuild.

---

## Phase 6: User Story 4 — Generate the change's content from the new scope (Priority: P1)

**Goal**: Prove content generation derives from the rebuild's selected issues only.

**Independent Test**: Build a scope, confirm the four content fields populate from those issues, and confirm hand
edits survive to the review step.

### Tests first ⚠️

- [X] T023 [P] [US4] Add tests to `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx` asserting generated content is derived from selected issues only, excluded issues do not appear, hand edits survive to review, and regenerating after a basket change rebuilds rather than accumulates
- [X] T024 [P] [US4] Add a test to `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx` asserting the flow refuses to proceed with an explanation when no issues are selected (FR-021)

### Implementation

- [X] T025 [US4] Only if T023 or T024 fails: make the minimal fix in `client/src/views/SnowHub/hooks/useCrgState.ts`; otherwise record "reuse verified" and close

**Checkpoint**: The rebuilt change describes the new scope.

---

## Phase 7: User Story 5 — Complete the planning and environment steps (Priority: P1)

**Goal**: Prove "blank means blank" — no planning answer, environment tick, or schedule carries over from the
loaded change, while a new change's own reusable defaults still apply.

**Independent Test**: Complete a rebuild's planning and environment steps and confirm none of the loaded change's
original values were pre-filled.

### Tests first ⚠️

- [X] T026 [P] [US5] Add failing tests to `client/src/views/SnowHub/tabs/ModifyChgTab.test.tsx` asserting that after confirming Start Over on a change carrying planning answers, an environment, and dates, the rebuild's planning answers are blank, no environment is pre-selected, and no schedule is pre-filled (FR-005)
- [X] T027 [P] [US5] Add a test to `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx` asserting a saved short-description config still applies in rebuild mode (FR-006)

### Implementation

- [X] T028 [US5] Only if T026 fails: correct the rebuild's initial state derivation in `client/src/views/SnowHub/tabs/CreateChgTab.tsx` so it starts from `createDefaultCrgState()` under the rebuild key; otherwise record "satisfied by Phase 2 draft isolation" and close

**Checkpoint**: A rebuild carries nothing stale from the change it replaces.

---

## Phase 8: User Story 7 — Save the rebuild onto the existing change number (Priority: P1) 🎯 MVP

**Goal**: Write the rebuild to the loaded change number, never creating a second record — and refuse to save when
the environment selection is ambiguous.

**Independent Test**: Rebuild a change, save, confirm the same change number carries the rebuilt content and that no
additional change was created.

**Contract**: [rebuild-save.md](./contracts/rebuild-save.md)

> **This phase contains the feature's main correctness fix.** `createChg` creates one CHG per enabled environment,
> but `updateExistingChg` calls `readPrimaryChangeSubmissionTarget`, which silently keeps only the first. Enabling
> REL + PRD today writes REL and discards PRD without a word.

### Tests first ⚠️

- [X] T029 [P] [US7] Add failing tests to `client/src/views/SnowHub/hooks/useCrgState.test.ts` for the one-environment guard: zero enabled environments is refused with `NO_ENABLED_ENVIRONMENT_MESSAGE` and issues no request; two or more is refused with a message naming the enabled environments; exactly one is permitted
- [X] T030 [P] [US7] Add failing tests to `client/src/views/SnowHub/hooks/useCrgState.test.ts` asserting the rebuild save issues **no POST** to `change_request` under any circumstance (SC-003) and PATCHes the `sys_id` resolved from the target number
- [X] T031 [P] [US7] Add failing tests to `client/src/views/SnowHub/hooks/useCrgState.test.ts` asserting a failed PATCH preserves the rebuild draft for retry (FR-032) and that verification mismatches are reported as "updated with verification warnings (N)" rather than a clean success
- [X] T032 [P] [US7] Add failing tests to `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx` asserting that in rebuild mode the review step renders an **Update `<CHG NUMBER>`** button, does **not** render the Create CHG button at all, and does **not** render the "Existing CHG number" input

### Implementation

- [X] T033 [US7] Add the exported multi-environment refusal message and a `hasExactlyOneEnabledEnvironment` helper to `client/src/views/SnowHub/hooks/useCrgState.ts`, and enforce the guard inside `updateExistingChg` when called in rebuild context; record the Article VII drift justification as a one-line comment at the guard (makes T029 green)
- [X] T034 [US7] Wire the rebuild review step in `client/src/views/SnowHub/tabs/CreateChgTab.tsx`: primary button labelled with the target number calling `actions.updateExistingChg(targetChangeNumber)`, Create CHG and the Existing-CHG-number input not rendered, the guard reason rendered beside a disabled button, and the existing `listEnvironmentDateOrderErrors` check left intact (makes T030 and T032 green)
- [X] T035 [US7] Ensure the rebuild draft key is cleared on a successful save and preserved on failure in `client/src/views/SnowHub/hooks/useCrgState.ts` (makes T031 green)

**Checkpoint**: The full destructive loop works — load, start over, rebuild, save to the same number. **This plus
Phase 3 is the shippable MVP.**

---

## Phase 9: User Story 6 — Re-apply the assisted enhancement (Priority: P2)

**Goal**: Prove the gated assist works from the rebuild's scope, and that the rebuild is fully usable without it.

**Independent Test**: With the assist unlocked, rebuild a change, copy the prompt, paste a well-formed reply, and
confirm the parsed fields are offered for per-field accept.

**Reuse note**: `useAiAssist`, `parseAiAssistChgResponse`, and the copy-out/paste-back modal ship today.

### Tests first ⚠️

- [X] T036 [P] [US6] Add tests to `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx` asserting that with the assist locked the rebuild works in full and no assist affordance is rendered (SC-007)
- [X] T037 [P] [US6] Add tests to `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx` asserting the prompt is built from the currently selected issues and reflects exclusions made in the basket (FR-024)
- [X] T038 [P] [US6] Add tests to `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx` asserting a malformed or empty reply alters nothing and says so, a well-formed reply is applied per field on explicit accept, and no saved field carries AI attribution (FR-025–FR-027)

### Implementation

- [X] T039 [US6] Only if T036–T038 fail: make the minimal fix in `client/src/views/SnowHub/tabs/CreateChgTab.tsx`; otherwise record "reuse verified — no change required" and close

**Checkpoint**: All user stories are independently functional.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T040 Add the feature entry to `CHANGELOG.md` under `## [Unreleased]` → `### Added`, describing the Start Over rebuild and calling out the multi-environment silent-loss fix under `### Fixed` (the pre-commit hook requires a CHANGELOG update in the same commit)
- [X] T041 [P] Verify both Article VII drift justifications are present as one-line comments at their components: the `storageKey` option in `client/src/views/SnowHub/hooks/useCrgState.ts` and the one-environment guard in the same file
- [X] T042 [P] Audit every new and modified function in `client/src/views/SnowHub/hooks/crgStorageKeys.ts`, `client/src/views/SnowHub/hooks/useCrgState.ts`, `client/src/views/SnowHub/tabs/CreateChgTab.tsx`, and `client/src/views/SnowHub/tabs/ModifyChgTab.tsx` against Article IV: verb-first names, `is/has/can/should/was` boolean prefixes, functions under 40 lines, no magic strings, file purpose comment, doc comment per export
- [X] T043 Confirm `client/src/views/SnowHub/tabs/ChgTab.tsx` and `client/src/views/SnowHub/tabs/ConfigurationTab.tsx` show **zero** changes in `git diff`, and that no pre-existing test file was modified
- [X] T044 Run `npx vitest run src/views/SnowHub` from `client/` and confirm the count is at or above the T001 baseline, then run `npx tsc --noEmit` clean
- [ ] T045 Execute [quickstart.md](./quickstart.md) Tests 0–8 against a live disposable change, with **Test 4** (same change number, no second CHG created) as the deciding evidence per Article X

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** — no dependencies
- **Phase 2 (Foundational)** — depends on Phase 1; **BLOCKS every user story**. A rebuild mounted before T006 would
  destroy the operator's Create draft
- **Phase 3 (US1)** — depends on Phase 2. Delivers the entry point every other story runs inside
- **Phases 4–7 (US2–US5)** — depend on Phase 3 (they need a mounted rebuild to test against)
- **Phase 8 (US7)** — depends on Phase 2 for the guard tests; depends on Phase 3 only for its UI wiring (T034)
- **Phase 9 (US6)** — depends on Phase 3; independent of Phases 4–8
- **Phase 10 (Polish)** — depends on all shipped phases

### User Story Dependencies

- **US1 (P1)** — the entry point. Everything else runs inside what it mounts
- **US2, US3, US4, US5 (P1)** — independent of each other; all need US1's mounted builder
- **US7 (P1)** — its guard logic (T029–T031, T033, T035) is independent of US1 and can be built in parallel; only
  its review-step wiring (T034) needs US1
- **US6 (P2)** — independent of US2–US5 and US7

### Within Each User Story

- Tests are written and **fail** before implementation (Article V)
- Pure modules before hooks; hooks before components
- A "reuse verification" test that passes on first run closes its implementation task with a recorded note

### Parallel Opportunities

- **Phase 2**: T002, T003, T004 in parallel (three different files). T005 in parallel with the T003 work
- **Phase 3**: T009–T012 all touch `ModifyChgTab.test.tsx` — write together, then implement T013–T016 in sequence
- **Phases 4–7**: three developers can take US2, US4, and US5 concurrently once US1 lands
- **Phase 8**: T029–T032 in parallel; T033–T035 in sequence
- **Phase 10**: T041, T042 in parallel

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Three failing test files, three different paths — write together:
Task: "T002 crgStorageKeys.test.ts — key normalisation, distinctness, no collision"
Task: "T003 useCrgState.test.ts — rebuild key does not hydrate or write the wizard key"
Task: "T004 CreateChgTab.test.tsx — rebuild mode renders wizard chrome"

# Then implement (T005 is independent; T006 and T007 are sequential on useCrgState/CreateChgTab):
Task: "T005 crgStorageKeys.ts — buildRebuildStorageKey"
```

## Parallel Example: Phase 8 (US7)

```bash
# Four failing test groups, two files — write together:
Task: "T029 one-environment guard refuses 0 and >=2, permits exactly 1"
Task: "T030 no POST to change_request; PATCHes the resolved sys_id"
Task: "T031 failed PATCH preserves the draft; mismatches reported as warnings"
Task: "T032 rebuild review renders Update <CHG>, not Create CHG"
```

---

## Implementation Strategy

### MVP scope — Phase 1 + Phase 2 + Phase 3 (US1) + Phase 8 (US7)

These four phases close the destructive loop: load a change, start over, build it, save it to the same number.
Phases 4–7 are almost entirely **verification of reused machinery** that already works inside the mounted builder —
they will largely pass on the first run, so they add confidence rather than capability. Phase 9 (US6, P2) is the
gated assist.

1. Complete Phase 1 (baseline)
2. Complete Phase 2 (**critical** — draft isolation before anything mounts)
3. Complete Phase 3 (US1)
4. Complete Phase 8 (US7)
5. **STOP and VALIDATE** with quickstart Test 4 — same change number, no second CHG
6. Ship if ready

### Incremental delivery

1. Setup + Foundational → a rebuild can mount safely
2. US1 → the entry point works, nothing saves yet → demo the confirmation and the blank bound builder
3. US7 → the loop closes → **MVP**
4. US2 → US3 → US4 → US5 → each verifies a reused capability inside the rebuild
5. US6 → the gated assist

### Parallel team strategy

1. Everyone on Phase 2 (it blocks all work)
2. Then: Developer A takes US1 (Phase 3), Developer B takes US7's guard and hook tests (T029–T031, T033, T035),
   Developer C takes US6 (Phase 9). US7's T034 waits for US1
3. US2–US5 distribute freely once US1 lands

---

## Notes

- `[P]` = different files, no dependency on an incomplete task
- **Reuse verification tasks that pass immediately are complete** — record the result, do not manufacture work
- `ChgTab.tsx` and `ConfigurationTab.tsx` must show zero diff (T043)
- No existing test may be modified — an existing test that fails is a regression, not a test to update
- Commit after each task or logical group; the pre-commit hook needs a test file per new source file **and** a
  CHANGELOG update in the same commit
- Stop at any checkpoint to validate a story independently
