# Tasks: Hygiene Fix Workspace — an issue view worth working in

**Input**: Design documents from `/specs/019-hygiene-fix-ux/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: INCLUDED — Article V (TDD, Red → Green → Refactor) is constitutional; every implementation task is
preceded by its failing test task.

**Organization**: three user stories mapped from the spec's three parts, in priority order. Each story is an
independently shippable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[US1/US2/US3]**: story label on story-phase tasks only
- Exact file paths in every description

---

## Phase 1: Setup

**Purpose**: workspace ready; no new dependencies to install (plan: zero new deps).

- [ ] T001 Confirm work happens on `feature/019-hygiene-fix-ux` (branch exists from planning) and the client gates
      run green pre-change: `cd client && npx vitest run && npx tsc -b`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: none required — the vocabulary module is US1's own first deliverable, and no story depends on another
story's code. Foundation is the existing shared codebase (hygieneScan, IssueDetailPanel, tokens).

**Checkpoint**: Phase 1 done ⇒ all three stories may proceed, US1 first (US2 composes its chips; US3 is
independent).

---

## Phase 3: User Story 1 — Semantic chip vocabulary (Priority: P1) 🎯 MVP

**Goal**: type, status, priority, owner, and age readable at a glance (spec FR-001..005; contract
`issue-meta-chips.md`).

**Independent test**: the 5-second glance test (quickstart §Manual) passes on a hygiene finding header; every chip
carries text + `data-tone`; A++/narrow layouts hold.

- [ ] T002 [P] [US1] RED — write `client/src/components/IssueMeta/issueMetaVocabulary.test.ts`: status-category →
      tone (new/indeterminate/done/unknown), priority name → tone+direction (highest…lowest, unknown), type name →
      icon+tone (bug/defect, story, task, spike, feature/epic, sub-task, unknown), age bands from threshold T
      (<T, T..2T, >2T), initials rules ("Katkar, Rahul (CTR)" → "KR"; single-token; null → unassigned)
- [ ] T003 [US1] GREEN — implement `client/src/components/IssueMeta/issueMetaVocabulary.ts` (pure mappings per
      data-model.md; unknown inputs degrade to neutral + label, never hidden)
- [ ] T004 [P] [US1] RED — write `client/src/components/IssueMeta/IssueMeta.test.tsx`: each component renders its
      text label, `data-tone` attribute, unassigned avatar treatment, AgeBadge day count + tone
- [ ] T005 [US1] GREEN — implement `StatusChip.tsx`, `PriorityBadge.tsx`, `IssueTypeIcon.tsx`,
      `AssigneeAvatar.tsx`, `AgeBadge.tsx` and `IssueMeta.module.css` (tone classes with light + dark values;
      chips wrap, never clip — GH #160 rules) in `client/src/components/IssueMeta/`
- [ ] T006 [US1] RED — extend `client/src/components/IssueDetailPanel/index.test.tsx`: header shows type icon,
      status chip (data-tone), priority badge, avatar initials + FULL display name; existing capabilities
      (transitions, comments, story points) still assert green (FR-010 guard)
- [ ] T007 [US1] GREEN — rework the `IssueDetailPanel` header in
      `client/src/components/IssueDetailPanel/index.tsx` to compose the IssueMeta chips (dates row unchanged)
- [ ] T008 [US1] RED then GREEN — hygiene finding rows use the chips: extend the HygieneView tests
      (`client/src/views/Hygiene/HygieneView.test.tsx`) for chip-rendered meta cells incl. `AgeBadge` wired to the
      configured `staleDaysThreshold`, then implement in `client/src/views/Hygiene/HygieneView.tsx`

**Checkpoint**: US1 shippable — glance test passes; nothing else changed.

---

## Phase 4: User Story 2 — The whole picture in the panel (Priority: P2)

**Goal**: linked issues with statuses, labels, fix versions, sprint, AC block, structured description — nothing
decision-relevant requires opening Jira (FR-006..010; contract `issue-context-panel.md`).

**Independent test**: the reporter's ENCUC-2163 shape (defect + linked INC/PRB) seeded in tests shows the links
block with the linked issue's status chip; empty issues show NO placeholder blocks; SC-005 retest.

- [ ] T009 [P] [US2] RED — write `client/src/utils/richTextStructured.test.ts`: paragraphs, bold run-in headings
      (`*Steps:*`, bare "Day one:"), `-`/`*`/`#` list items, nested level 2, degradation (arbitrary text → one
      paragraph per line group, never empty)
- [ ] T010 [US2] GREEN — implement `client/src/utils/richTextStructured.ts` (`parseStructuredText` →
      `StructuredBlock[]`; normalizes via existing richTextPlainText machinery first; module-head Art VII drift
      justification comment)
- [ ] T011 [P] [US2] RED — extend `client/src/views/Hygiene/hooks/hygieneScan.test.ts`: the issue search requests
      `issuelinks` and `labels` in its field list
- [ ] T012 [US2] GREEN — add `issuelinks` + `labels` to `BASE_HYGIENE_FIELDS` in
      `client/src/views/Hygiene/hooks/hygieneScan.ts`
- [ ] T013 [US2] RED — extend `client/src/components/IssueDetailPanel/index.test.tsx`: links block renders link
      relation + key + summary + the OTHER issue's StatusChip from `fields.issuelinks`; labels + fixVersions chips;
      AC block when prop present; each block ABSENT (not empty) when data missing; description renders headings and
      list items via structured blocks with plain-text fallback
- [ ] T014 [US2] GREEN — implement the context blocks and `StructuredText.tsx` in
      `client/src/components/IssueDetailPanel/` (index.tsx + StructuredText.tsx; omit-when-empty everywhere; no
      fetching inside the panel)
- [ ] T015 [US2] RED then GREEN — hygiene wiring: HygieneView passes the finding's full issue (now carrying
      issuelinks/labels) and resolved AC text to the panel; extend `HygieneView.test.tsx` first, implement in
      `client/src/views/Hygiene/HygieneView.tsx`

**Checkpoint**: US2 shippable — SC-002/SC-005 verifiable; FR-010 regression suite green.

---

## Phase 5: User Story 3 — Guided cleanup session (Priority: P3)

**Goal**: "N of M" traversal with explicit Skip, honest four-bucket summary, keyboard-first (FR-011..015; contract
`cleanup-session.md`; clarifications #1 and #2).

**Independent test**: contract e2e gates — arrow/skip/comment through a seeded 3-finding list → summary
"3 findings — 0 fixed, 1 commented, 1 skipped, 1 untouched"; typing "s" in the comment box does nothing.

- [ ] T016 [P] [US3] RED — write `client/src/views/Hygiene/hooks/useHygieneSession.test.ts`: cursor clamping,
      outcome precedence (fixed > commented > skipped, never downgrade), skip advances, summary buckets sum to M,
      session reset on list change, keyboard guard (events from input/textarea/select/contenteditable ignored)
- [ ] T017 [US3] GREEN — implement `client/src/views/Hygiene/hooks/useHygieneSession.ts` (per data-model.md state
      machine; ←/→/S/Escape; listener attached only while a session is active)
- [ ] T018 [US3] RED — extend `client/src/views/Hygiene/HygieneView.test.tsx`: "Review these findings" entry on
      every surface variant (team/personal/standalone props), "N of M" indicator, Skip button, settled row marks,
      fix-applied keeps cursor (FR-014), four-bucket summary on end
- [ ] T019 [US3] GREEN — implement session UI in `client/src/views/Hygiene/HygieneView.tsx` +
      `client/src/views/Hygiene/HygieneView.module.css` (session bar, settled/untouched row treatments)
- [ ] T020 [US3] RED then GREEN — self-explanatory fix affordances: per-check human sentence above the fix
      controls and a visible label on every fix input (no bare "Choose…"); tests first in `HygieneView.test.tsx`,
      copy map + markup in `client/src/views/Hygiene/HygieneView.tsx` (FR-015)
- [ ] T021 [US3] E2E — write and pass `test/e2e/hygiene-session.spec.js`: the three contract gates (session flow →
      honest summary; typing guard; A++ + narrow-width layout hold) against stubbed proxies on the port-5556
      harness

**Checkpoint**: US3 shippable — SC-003/SC-004 verifiable end-to-end.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T022 [P] Light-theme + dark-theme contrast pass over `IssueMeta.module.css` and the new panel/session styles
      (NFR-004) with Playwright screenshots as Art X evidence in the PR
- [ ] T023 [P] CHANGELOG.md entry under [Unreleased] describing the workspace (user-visible behavior)
- [ ] T024 Full gates: `cd client && npx vitest run && npx tsc -b && npx eslint src && npm run build`, then
      `npx playwright test` (full e2e suite) — all green before the PR
- [ ] T025 Quickstart manual glance test (quickstart.md §Manual) on a real scan; attach findings to the PR
      description; SC-005 retest against the reporter's ticket shape

---

## Dependencies & Execution Order

```text
Phase 1 (T001)
   └─► US1 (T002–T008) ──► US2 (T009–T015)   [US2 composes US1's chips in the links block]
   └─► US3 (T016–T021)                        [independent of US1/US2 code; merge after for one coherent PR]
US1 + US2 + US3 ──► Polish (T022–T025)
```

- Within each story: RED task strictly before its GREEN task (Article V).
- [P] tasks touch disjoint files and may run in parallel once their predecessors are done.

## Parallel Execution Examples

- **US1**: T002 and T004 (two test files) in parallel; T003 then T005 serially after their REDs.
- **US2**: T009 and T011 in parallel (parser tests vs scan-field tests); T013 after T005 (chips exist).
- **US3**: T016 in parallel with any US1/US2 work (hook is standalone); T018+ after T017.
- **Polish**: T022 and T023 in parallel.

## Implementation Strategy

**MVP = US1** (chips everywhere the panel + hygiene rows render): smallest change with the largest share of the
"inviting" gap closed. **Increment 2 = US2** (the decision context — closes SC-002/SC-005, the reporter's concrete
complaint). **Increment 3 = US3** (the session — Toolbox's edge over Jira). Ship as one PR or three; each
checkpoint leaves the app releasable.
