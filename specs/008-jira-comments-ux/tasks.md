---
description: "Task list for Consistent Jira Comment History & Themed Field Depth"
---

# Tasks: Consistent Jira Comment History & Themed Field Depth

**Input**: Design documents from `specs/008-jira-comments-ux/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/comment-thread.md, quickstart.md

**Tests**: INCLUDED — the plan mandates TDD (Constitution Article V). Test tasks precede the code they cover.

**Organization**: Grouped by user story. The shared comment layer (Phase 2) is the blocking
prerequisite for US1 and US2; US3 (visual depth) is independent of it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (setup, foundational, polish have no story label)

## Path Conventions

Single frontend project. All source under `client/`. Paths are repo-relative.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the directories for the shared comment layer. No new dependencies (React 19,
Vitest, Testing Library already installed).

- [X] T001 Create shared directories `client/src/hooks/` (if absent) and `client/src/components/CommentThread/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the shared `useIssueComments` hook and `CommentThread` component by **extracting**
the working logic from `IssueDetailPanel`, and prove the extraction by refactoring the panel to use
them. This encodes on-demand fetch, newest-first ordering, and the consistent presentation that US1
and US2 both rely on.

**⚠️ CRITICAL**: No user-story swap (Phase 3+) can begin until this phase is complete.

- [X] T002 [P] Write FAILING unit tests for the fetch hook in `client/src/hooks/useIssueComments.test.ts` (mock `services/jiraApi.jiraGet`): success returns the complete thread ordered newest→oldest by `created`; unordered response gets sorted descending; failure sets `loadError` and empties `comments`; `refresh()` re-fetches; changing `issueKey` fetches the new key and a late old-key response does not overwrite state (per contracts/comment-thread.md §1)
- [X] T003 [P] Write FAILING render tests for the presentation component in `client/src/components/CommentThread/CommentThread.test.tsx`: renders ALL comments (not a capped subset) in given order; shows shared loading, error, and empty states; a very long body uses the wrapping/scroll container (per contracts §2)
- [X] T004 Implement `client/src/hooks/useIssueComments.ts` to make T002 pass — on-demand `GET /rest/api/2/issue/{issueKey}/comment` via `jiraGet`, sort descending by parsed `created`, `isLoading`/`loadError`/`refresh`, mounted-guard against stale results; file purpose comment + hook doc comment; named constant for the load-error message (extracted from IssueDetailPanel)
- [X] T005 Implement `client/src/components/CommentThread/CommentThread.tsx` + `CommentThread.module.css` to make T003 pass — move the `CommentHistory` markup and the `.commentList/.commentItem/.commentMeta/.commentAuthor/.commentDate/.commentBody/.commentEmpty` styles out of `IssueDetailPanel`; keep bounded `max-height` + `overflow-y:auto`; author/date(`slice(0,10)`)/normalized body; shared empty/loading/error labels as named constants
- [X] T006 Refactor `client/src/components/IssueDetailPanel/index.tsx` to consume `useIssueComments(issue.key)` and render `<CommentThread />`, removing its private comment-fetch effect, `existingComments`/`isLoadingComments`/`commentsLoadError`/`commentsRefreshToken` state, and the local `CommentHistory`; wire post-comment success to the hook's `refresh()`. **Intended behavior change**: comment order flips from the panel's current oldest→newest to newest-first (FR-004) — this is deliberate, not a regression. Update `client/src/components/IssueDetailPanel/index.test.tsx`: keep the existing single-comment/fetch/post/empty tests green, and extend it with a multi-comment case asserting newest-first DOM order. (Validates US1 AS4 / SC-007: full scrollable history still shown, fetch/post behavior unchanged.)
- [X] T007 Remove the now-migrated comment styles from `client/src/components/IssueDetailPanel/IssueDetailPanel.module.css` (keep field/input/textarea/panel styles), confirming no duplicate comment CSS remains

**Checkpoint**: Shared hook + component exist and are green; `IssueDetailPanel` uses them with no
behavior change. All Phase 2 tests pass.

---

## Phase 3: User Story 1 - Full comment history everywhere (Priority: P1) 🎯 MVP

**Goal**: Every comment-display location shows the complete, on-demand-fetched thread in a scrollable
window — replacing "latest only" and "last 3".

**Independent Test**: Open an issue with many comments in Story Pointing, the Sprint Dashboard
pointing row, and the DSU board overlay; each shows all comments in a scroll window (no cap, no
single-latest line).

- [X] T008 [US1] Replace the "Latest comment" block in `client/src/views/StoryPointing/StoryPointingView.tsx` (the `contextBlock` at the latest-comment `<p>`) with `useIssueComments(pointingState.currentIssue.key)` + `<CommentThread />`
- [X] T009 [US1] Remove the now-dead `latestComment` derivation from `client/src/views/StoryPointing/hooks/useStoryPointingState.ts` — delete `readLatestComment`, the `latestComment` state field/type, and its assignment (depends on T008 so the view no longer references it)
- [X] T010 [US1] Replace the "Latest comment:" line in `client/src/views/SprintDashboard/SprintDashboardView.tsx` (the `detail.comments[detail.comments.length - 1]` render in the expanded pointing row, ~L3831) with `useIssueComments(issueKey)` + `<CommentThread />` — `issueKey` is already in scope in that row component (used by `onSave(issueKey, …)`, ~L3807); drop the now-unused inline latest-comment logic and, if no longer referenced elsewhere, `normalizeCommentBody` for that row
- [X] T011 [US1] Replace the "Recent comments" (last-3) block in `client/src/views/DsuBoard/DsuBoardView.tsx` with `useIssueComments(issue.key)` + `<CommentThread />`; remove `MAX_OVERLAY_COMMENT_COUNT`, `recentComments = slice(-3)`, and `createCommentPreview` if no longer referenced
- [X] T012 [P] [US1] Add render smoke tests (mock `useIssueComments`) asserting each swapped view renders `CommentThread` with the full list — `StoryPointingView`, `SprintDashboardView`, `DsuBoardView` (co-located `*.test.tsx`)

**Checkpoint**: All four locations render the full scrollable history via the shared layer.

---

## Phase 4: User Story 2 - Consistent presentation & newest-first (Priority: P1)

**Goal**: Every comment window looks/behaves identically and shows the newest comment first without
scrolling. Ordering and layout are guaranteed by the shared layer (Phase 2); this phase locks it in
and covers edge cases.

**Independent Test**: Compare the same issue across three locations — identical author/date/body
layout and ordering; newest on screen at open; a long body wraps and the window (not the page)
scrolls.

- [X] T013 [P] [US2] Extend `client/src/components/CommentThread/CommentThread.test.tsx` with an explicit "newest comment appears first / at top" assertion and an empty-vs-one-comment consistency assertion (one comment uses the same window style, no bespoke layout)
- [X] T014 [US2] Confirm/adjust `CommentThread.module.css` so long single comments wrap (`white-space:pre-wrap`, `overflow-wrap`) and the bounded window scrolls without growing the parent (US2 AS3); add a failing-then-passing test hook if needed
- [ ] T015 [US2] Verify cross-view consistency per quickstart checks 5–8 (layout, ordering, newest-visible, shared empty state) across Story Pointing, Sprint Dashboard, DSU overlay, and a panel view; record results

**Checkpoint**: Comment windows are consistent everywhere; newest-first confirmed by tests and manual pass.

---

## Phase 5: User Story 3 - Clear field boundaries in both themes (Priority: P2)

**Goal**: Text boxes, inputs, and comment windows are visually separated from the window background
via subtle gradient/elevation, correct and AA-legible in both light and dark themes.

**Independent Test**: In both themes, a text box / comment window is clearly bounded against the page
without a heavy border; text meets WCAG 2.1 AA; theme switch updates the treatment live.

- [X] T016 [US3] Add purpose-named depth tokens to `client/src/styles/tokens.css` under BOTH `:root` and `[data-theme="light"]` (e.g. `--field-elevation-bg`, `--field-elevation-border`, `--field-elevation-shadow`, `--comment-window-bg`), reusing existing gradient/shadow tokens where they fit (per data-model.md)
- [X] T017 [US3] Apply the depth tokens to the comment window in `client/src/components/CommentThread/CommentThread.module.css` so it reads as raised/distinct from its containing panel in both themes
- [X] T018 [US3] Apply the depth tokens to fields (`.textarea`, `.select`, `.pointsInput`) in `client/src/components/IssueDetailPanel/IssueDetailPanel.module.css`, replacing flat `--color-input-bg` usage with the elevation treatment (tokens only, no hardcoded colors)
- [X] T019 [US3] Add a reduced-transparency / `prefers-contrast: more` fallback (solid field background + clear border) in `tokens.css` and/or the relevant module CSS (spec edge case)
- [X] T020 [US3] Measure and record WCAG 2.1 AA contrast (≥4.5:1 body, ≥3:1 large/boundary) for treated fields in BOTH themes; adjust token endpoints until AA passes (SC-005, FR-010)

**Checkpoint**: Field/comment-window depth is clear and AA-compliant in both themes and switches live.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalize, verify, and document.

- [X] T021 [P] Update `CHANGELOG.md` (Unreleased) — unified full scrollable comment history across all views + newest-first ordering + themed field/comment depth; include the measured contrast ratios
- [X] T022 Dead-code sweep — grep for lingering `latestComment`, `readLatestComment`, `recentComments`, `MAX_OVERLAY_COMMENT_COUNT`, `createCommentPreview` and remove any orphans (Article XI restraint)
- [X] T023 Run `cd client && npm test` (all green, unit <10ms), `npm run lint`, and `npm run build` (tsc + vite) clean
- [ ] T024 Run `specs/008-jira-comments-ux/quickstart.md` full manual matrix (checks 1–12) in BOTH themes; confirm all pass (Article X proof)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: after Setup — **BLOCKS US1 and US2**. (T002,T003 → T004,T005 → T006 → T007)
- **US1 (Phase 3)**: after Phase 2. T009 depends on T008; T010, T011 independent of the StoryPointing pair.
- **US2 (Phase 4)**: after Phase 2 (ordering/consistency live in the shared layer); best confirmed after US1 swaps land.
- **US3 (Phase 5)**: after Phase 2 (needs `CommentThread` to exist for T017) but otherwise **independent of US1/US2** — can run in parallel with Phase 3/4.
- **Polish (Phase 6)**: after all desired stories complete.

### User Story Dependencies

- **US1 (P1)** — the MVP: full history everywhere. Depends only on the foundational shared layer.
- **US2 (P1)** — consistency/ordering: delivered by the shared layer; verified once sites are swapped.
- **US3 (P2)** — visual depth: independent styling track; only needs `CommentThread` to exist.

### Parallel Opportunities

- T002 and T003 (foundational tests) run in parallel.
- After Phase 2: US1 swaps T010 and T011 touch different files (parallel); the StoryPointing pair (T008→T009) is sequential.
- US3 (Phase 5) can proceed in parallel with US1/US2 once T005 exists.
- T012 (view smoke tests) and T013 parallel with their sibling implementation once the swaps land.

---

## Parallel Example: Foundational tests

```bash
# Write both failing test suites together:
Task: "Failing hook tests in client/src/hooks/useIssueComments.test.ts"
Task: "Failing component tests in client/src/components/CommentThread/CommentThread.test.tsx"
```

## Parallel Example: after Foundational

```bash
# US1 site swaps on different files:
Task: "Swap SprintDashboardView latest-comment line for CommentThread"
Task: "Swap DsuBoardView last-3 overlay for CommentThread"
# US3 styling track in parallel:
Task: "Add field-elevation depth tokens to tokens.css (both themes)"
```

---

## Implementation Strategy

### MVP First (US1)

1. Phase 1 Setup → 2. Phase 2 Foundational (shared hook+component, panel refactored, tests green) →
3. Phase 3 US1 (swap all sites) → **STOP & VALIDATE**: every location shows the full scrollable
history (quickstart checks 1–4). This is the demonstrable MVP.

### Incremental Delivery

1. Foundational ready (panel unchanged behavior, shared layer proven).
2. US1 → full history everywhere → demo.
3. US2 → confirm consistency + newest-first → demo.
4. US3 → themed field/comment depth (AA in both themes) → demo.
5. Polish → CHANGELOG, build/lint, quickstart, dead-code sweep.

---

## Notes

- [P] = different files, no incomplete dependency.
- TDD: T002/T003 (and T013) MUST fail before their implementation tasks.
- Unit tests mock `jiraApi`; keep them <10ms (Article V).
- All colors via `tokens.css` custom properties — never hardcode per-component (Article VII).
- Commit after each task or logical group; update `CHANGELOG.md` before the final build check.
