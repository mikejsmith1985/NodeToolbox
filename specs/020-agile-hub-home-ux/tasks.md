# Tasks: Agile Hub Home — honest gating and a job-shaped tool catalog

**Input**: Design documents from `/specs/020-agile-hub-home-ux/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: INCLUDED — Article V (TDD, Red → Green → Refactor) is constitutional; every implementation task is
preceded by its failing test task.

**Organization**: three user stories in priority order — gating (US1), catalog (US2), the thin-shell merge (US3).
Each is an independently releasable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[US1/US2/US3]**: story label on story-phase tasks only
- Exact file paths in every description

---

## Phase 1: Setup

**Purpose**: workspace ready; zero new dependencies (plan).

- [ ] T001 Confirm work happens on `feature/020-agile-hub-home-ux` and the client gates run green pre-change:
      `cd client && npx vitest run && npx tsc -b`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the visibility store is consumed by US1 (gating) AND US2 (catalog filtering), so it lands first.

- [ ] T002 [P] RED — write `client/src/store/toolVisibilityStore.test.ts`: default-visible when unset,
      `admin-hub` pinned visible and un-settable, set/persist round-trip on the existing `tbxToolVisibility`
      localStorage key, corrupt storage degrades to all-visible, subscribers see changes synchronously
- [ ] T003 GREEN — implement `client/src/store/toolVisibilityStore.ts` (zustand; same key + value shape
      `ToolVisibilitySection` writes today; exports `useToolVisibilityStore`, `resolveToolIsVisible`,
      `setToolVisibility` per contracts/home-gating.md)

**Checkpoint**: store green ⇒ US1 and US2 can proceed (US3 is independent of the store).

---

## Phase 3: User Story 1 — Honest gating (Priority: P1) 🎯 MVP

**Goal**: SNow Hub visible/enterable only while admin-unlocked; Tool Visibility toggles actually work
(FR-001..005; contract `home-gating.md`).

**Independent test**: locked tab shows no SNow anywhere and `/snow-hub` lands home; unlocking reveals it live; an
admin toggle hides a card + its recents chip immediately; Admin Hub offers no self-toggle.

- [ ] T004 [P] [US1] RED — extend `client/src/views/Home/HomeView.test.tsx`: with admin locked the SNow card and
      its recents chip are absent (no gap, no empty section); mocked-unlocked shows them; a card toggled off in
      the visibility store disappears (card + recents) and reappears on toggle-on
- [ ] T005 [US1] GREEN — wire `client/src/views/Home/HomeView.tsx` to filter cards and recent chips through
      `resolveToolIsVisible` + per-card `gateKind` against `useAdminStore` (predicate per contracts/home-gating.md)
- [ ] T006 [P] [US1] RED — extend `client/src/views/AdminHub/ToolVisibilitySection.test.tsx`: toggles read/write
      the shared store (not private helpers), `admin-hub` is not listed, retired card ids are not listed
- [ ] T007 [US1] GREEN — rework `client/src/views/AdminHub/ToolVisibilitySection.tsx` to consume
      `toolVisibilityStore` (delete its private load/save/resolve helpers; the "persistence only" note dies)
- [ ] T008 [US1] RED — extend `client/src/App.test.tsx`: `/snow-hub` while locked renders home; while
      mocked-unlocked renders the SNow tool; a visibility-hidden tool's route renders home
- [ ] T009 [US1] GREEN — add the entry-gate wrapper in `client/src/App.tsx` for `/snow-hub` (admin unlock) and
      hideable tools' routes (visibility store), `Navigate replace` to `/`; entry-only — no unmount of an open
      workspace on lapse

**Checkpoint**: US1 shippable — honest gating end to end.

---

## Phase 4: User Story 2 — Job-shaped catalog (Priority: P2)

**Goal**: three sections that describe the job; no single-card or empty sections (FR-006..008).

**Independent test**: default home shows 🙋 My Work / 🏃 Agile Delivery / 📈 Insights & Admin exactly per
data-model.md; hiding every card of a section removes its divider; drag order + recents survive.

- [ ] T010 [P] [US2] RED — extend `client/src/views/Home/HomeView.test.tsx`: the three section headers render
      with their cards per the data-model table; a section whose cards are all hidden renders no divider; a saved
      card order containing retired ids still renders cleanly
- [ ] T011 [US2] GREEN — rewrite the catalog in `client/src/views/Home/homeCardData.ts`: `SectionKey` →
      `'my-work' | 'agile' | 'insights-admin'`; three `APP_SECTIONS`; add the `agile-hub` card (🏉 route
      `/agile-hub`, section agile); remove the `sprint-dashboard`, `po-tool`, `art` cards; `gateKind:
      'admin-unlock'` on `snow-hub`; extend `LEGACY_RECENT_VIEW_CARD_IDS` + `RECENT_VIEW_LABELS` so retired ids
      resolve to the Agile Hub
- [ ] T012 [US2] Reconcile dependent tests/fixtures that pin old sections or cards (`HomeView.test.tsx`,
      `client/src/App.test.tsx` snapshots/labels if any) — expectations updated to the new catalog, never loosened

**Checkpoint**: US2 shippable — new home, old personalization intact.

---

## Phase 5: User Story 3 — Agile Hub thin-shell merge (Priority: P3)

**Goal**: one `/agile-hub` door with Team / Product / Train spaces mounting the existing views unchanged; every
old route redirects with params (FR-009..013; contracts `agile-hub-shell.md`, `route-redirects.md`).

**Independent test**: `/sprint-dashboard?hygieneFilter=stale` lands inside the Team space with the hygiene tab
filtered; spaces keep separate selections across a switch round-trip; all legacy paths land in one hop.

- [ ] T013 [P] [US3] RED — write `client/src/views/AgileHub/AgileHubView.test.tsx`: `?space=` resolution
      (team/product/train), invalid → fallback chain (settings `agileHubLastSpace` → team), switching spaces
      updates the URL param and persists the last space, exactly one space view mounted at a time (mock the three
      heavy views), space strip controls always all present
- [ ] T014 [US3] GREEN — implement `client/src/views/AgileHub/AgileHubView.tsx` +
      `client/src/views/AgileHub/AgileHubView.module.css` (space strip wraps at narrow/A++ — GH #160 rules;
      mounts the real `SprintDashboardView` / `PoToolView` / `ArtView` unchanged; passes no props)
- [ ] T015 [US3] Add `agileHubLastSpace` to `client/src/store/settingsStore.ts` (with test in
      `client/src/store/settingsStore.test.ts` first — RED then GREEN in one task, persisted like the existing
      persisted UI fields)
- [ ] T016 [P] [US3] RED — extend `client/src/App.test.tsx` with the redirect table from
      contracts/route-redirects.md: `/sprint-dashboard?x=1` → `/agile-hub?x=1&space=team` (query preserved),
      `/po-tool` → space=product, `/art` → space=train, spot-check two legacy paths (`/standup`, `/metrics`)
      landing on `/agile-hub?space=team` in ONE hop
- [ ] T017 [US3] GREEN — implement the redirects in `client/src/App.tsx`: `RedirectToAgileHub` element (reads
      `location.search`, overrides only `space`, `Navigate replace`); `/agile-hub` route added; the three retired
      routes + ~8 legacy redirects repointed per the contract table
- [ ] T018 [US3] Verify-only sweep: confirm `client/src/views/SprintDashboard/`, `client/src/views/PoTool/`, and
      `client/src/views/ArtView/` have ZERO diffs in this feature (`git diff --stat main -- <dirs>` empty) — the
      read-only constraint is a deliverable, not a hope

**Checkpoint**: US3 shippable — one door, params intact, internals untouched.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T019 E2E — write and pass `test/e2e/agile-hub-home.spec.js` per the contract gates: (1) locked home has no
      SNow + direct `/snow-hub` lands home, unlock (stub the admin auth route) reveals + admits it; (2) toggling
      a tool in Admin Hub hides its card live; (3) the FR-010 acceptance journey — `/sprint-dashboard?hygieneFilter=stale`
      lands in the Team space with the hygiene tab filtered; (4) space strip holds at A++ in a 900px window
- [ ] T020 [P] CHANGELOG.md entry under [Unreleased] (home reorganization, SNow gating, working visibility
      toggles, the Agile Hub merge + redirects)
- [ ] T021 Capability-parity audit (SC-006): run the quickstart checklist against the built app with stubbed
      data — every enumerated tab of the three retired tools reachable in its space; record the checked list in
      the PR description
- [ ] T022 Full gates: `cd client && npx vitest run && npx tsc -b && npx eslint src && npm run build`, then
      `npx playwright test` — green (3 known pre-existing reports-hub failures excepted)

---

## Dependencies & Execution Order

```text
Phase 1 (T001) ─► Phase 2 (T002–T003)
                     ├─► US1 (T004–T009)
                     └─► US2 (T010–T012)   [independent of US1; both touch HomeView.test — coordinate edits]
Phase 1 ──────────► US3 (T013–T018)        [independent of the store; T016/T017 after T011 defines /agile-hub card]
US1 + US2 + US3 ─► Polish (T019–T022)
```

- RED strictly before GREEN within every pair (Article V).
- T012 runs after T011; T017 after T014 (route needs the view) and after T011 (card exists).

## Parallel Execution Examples

- **Foundational**: T002 alone (single file pair).
- **US1**: T004 and T006 and T008 (three different test files) in parallel; greens serial after their reds.
- **US3**: T013 in parallel with US1/US2 work; T016 in parallel with T013.
- **Polish**: T020 alongside T019.

## Implementation Strategy

**MVP = US1** (the user's explicit ask: honest SNow gating + toggles that work). **US2** lands the visible
reorganization. **US3** is the big move but the thin shell keeps it mechanically small — the risk lives in the
redirect table and is fenced by T016/T019's journey tests plus T018's zero-diff guarantee. Ship as one PR; every
checkpoint leaves the app releasable.
