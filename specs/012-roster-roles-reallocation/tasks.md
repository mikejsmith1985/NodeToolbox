---
description: "Task list for Role-Aware Roster + Canvas Work Re-Allocation Plan"
---

# Tasks: Role-Aware Roster + Canvas Work Re-Allocation Plan

**Input**: Design documents from `specs/012-roster-roles-reallocation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: INCLUDED and TDD-ordered — the project constitution (Article V) mandates a failing test before
implementation. Write each test task first, watch it fail, then implement.

**Organization**: Two user-story phases. **US1 = role-aware roster** (spec Stories A, E) — the MVP, standalone
and independently valuable. **US2 = Work Re-Allocation Plan** (spec Stories B, C, D, F) — depends on US1's role
type.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 or US2
- All paths are repository-relative; this is a frontend-only change under `client/`.

---

## Phase 1: Setup (Shared)

**Purpose**: Documentation discipline; no scaffolding or new dependencies (all reuse — see plan.md).

- [x] T001 Add a `## [Unreleased]` entry to `CHANGELOG.md` naming feature 012 (role-aware roster + canvas Work Re-Allocation Plan), to be fleshed out during implementation

---

## Phase 2: Foundational (Blocking Prerequisite)

**Purpose**: The single type shared by both stories — US1's store/UI and US2's model both reference it.

**⚠️ CRITICAL**: US2's model tests cannot compile until this type exists.

- [x] T002 Add and export the `RosterRoleCapabilities` interface (`canDevelop` / `canInternalTest` / `canExternalTest`: boolean) in `client/src/views/SprintDashboard/hooks/useStandupRosterStore.ts` — type only, no behavior yet (per data-model.md §1, contracts/roster-roles.md)

**Checkpoint**: Shared role type available — both user stories can proceed.

---

## Phase 3: User Story 1 — Role-Aware Roster (Priority: P1) 🎯 MVP

**Goal**: Record, edit, and display the three role capabilities (Developer / Internal Tester / External Tester)
on each team-scoped roster member; fully manual, never gated. (Spec Stories A, E.)

**Independent Test**: On the roster, toggle a member's roles → they persist across reload, render as chips, are
independent per member, are team-scoped, and remain fully functional with AI Assist locked (no re-allocation
panel visible anywhere). Verifiable without any Part-2 work.

### Tests for User Story 1 (write first — must FAIL) ⚠️

- [x] T003 [P] [US1] Store test: `roleCapabilities` round-trips through persistence, is preserved across `addRosterMember`/`upsertRosterMembers`/`replaceRosterMembers`/SNow-link, a legacy member (no field) reads as no-roles, and `setRosterMemberRoles` updates one member — in `client/src/views/SprintDashboard/hooks/useStandupRosterStore.test.ts`
- [x] T004 [P] [US1] Component test: `RosterTab` shows three role toggles + role chips per Current-roster member, toggling calls the store, and everything renders/works with `useAiAssistStore` locked — in `client/src/views/SprintDashboard/RosterTab.test.tsx`

### Implementation for User Story 1

- [x] T005 [US1] Extend `StandupRosterMember` and `StandupRosterMemberDraft` with optional `roleCapabilities`; validate it tolerantly in `isStandupRosterMember` (coerce malformed → `undefined`); preserve it in `createRosterMember` and `upsertRosterMembersInList`; add the `setRosterMemberRoles(memberId, capabilities)` action (mirrors `removeRosterMember`) — in `client/src/views/SprintDashboard/hooks/useStandupRosterStore.ts` (depends on T002)
- [x] T006 [US1] Add three role toggle checkboxes + role chips to each Current-roster `RosterCard`, wired to `setRosterMemberRoles`, plus the chip CSS in `client/src/views/SprintDashboard/SprintDashboardView.module.css` — in `client/src/views/SprintDashboard/RosterTab.tsx` (depends on T005)

**Checkpoint**: Role capabilities are settable, visible, persistent, team-scoped, and AI-independent. MVP shippable.

---

## Phase 4: User Story 2 — Work Re-Allocation Plan (Priority: P2)

**Goal**: A passphrase-gated, copy-out AI panel that assembles the active-team roster (with roles), a chosen
target sprint's assigned child work (status + time-in-status + points, grouped by person), the PI runway, the
point-as-days convention, and verbatim operator constraints into one prompt for Copilot to produce a
re-allocation plan + risk assessment. No ingest; no overlay/Jira write. (Spec Stories B, C, D, F.)

**Independent Test**: With AI unlocked, a role-set roster, and a canvas sprint holding assigned child work, open
Work Re-Allocation, pick the sprint, type a constraint → the copied prompt contains roster+roles, per-person
work with status/days-in-status/points, PI start+end+days, the point-as-days convention, the verbatim
constraint, and a plan+risk instruction; copying changes nothing on the overlay or in Jira.

### Tests for User Story 2 (write first — must FAIL) ⚠️

- [x] T007 [P] [US2] Unit test `reallocationModel` — resolved-box grouping (`storyPlacements[key] ?? containerId`) selects only the target sprint's child items, groups by assignee, flags unassigned + off-roster assignees, lists `rosterWithoutWork` spare capacity, and computes `daysInStatus` with an injected `today` (null when `statusChangedIso` absent) — in `client/src/views/FeatureCanvas/ai/reallocationModel.test.ts`
- [x] T008 [P] [US2] Unit test `reallocationPrompt` — the string contains roster members with roles (incl. no-work members), per-person items (key·summary·points·raw status+category·days-in-status), Unassigned/off-roster buckets, PI start+end+days-remaining, the story-point≈one-day convention, verbatim additional-details, and the plan+risk instruction with "reason only from data; invent nothing" guardrails — in `client/src/views/FeatureCanvas/ai/reallocationPrompt.test.ts`
- [x] T009 [P] [US2] Unit test `useReallocationDetailsStore` — persist round-trip + clear-to-empty under the composed key `tbxReallocationDetails:<teamProfileId>:<deriveScopeKey(projectKey,piName)>`, and that a different PI/team yields a different key (no cross-PI bleed) — in `client/src/views/FeatureCanvas/ai/useReallocationDetailsStore.test.ts`
- [x] T010 [P] [US2] Component test `WorkReallocationPanel` — renders `null` when AI locked; target-sprint `<select>` from sprint containers; additional-details persists; Copy invokes the clipboard helper; and each empty/degraded state (no roster / no sprint / no assigned work / no roles / unparseable PI) shows its message — in `client/src/views/FeatureCanvas/ai/WorkReallocationPanel.test.tsx`
- [x] T011 [P] [US2] Extend the blueprint mapping test to assert `statusChangedIso` is carried onto child stories — in `client/src/views/ArtView/blueprintHierarchy.test.ts`

### Implementation for User Story 2 — data thread (time-in-status)

- [x] T012 [P] [US2] Add `statuscategorychangedate` to the child-story fetch field lists and set `statusChangedIso` on `BlueprintStoryNode` — in `client/src/views/ArtView/blueprintHierarchy.ts`
- [x] T013 [P] [US2] Add `statusChangedIso?: string | null` to `CanvasChildStory` — in `client/src/views/FeatureCanvas/logic/canvasTypes.ts`
- [x] T014 [US2] Copy `statusChangedIso` from the blueprint child in `mapChildStories` — in `client/src/views/FeatureCanvas/canvas/nodeMapping.ts` (depends on T012, T013)

### Implementation for User Story 2 — pure logic & store

- [x] T015 [US2] Implement `buildReallocationContext(...)` — resolved-box target-sprint assembly, per-assignee grouping, unassigned/off-roster flags, `rosterWithoutWork`, `daysInStatus` (today injected) per data-model.md §4 — in `client/src/views/FeatureCanvas/ai/reallocationModel.ts` (depends on T002, T013)
- [x] T016 [US2] Implement `buildReallocationPrompt(context, additionalDetails)` — the full copy-out prompt per contracts/reallocation-prompt.md (content items 1–8, guardrails, raw status, no phase inference) — in `client/src/views/FeatureCanvas/ai/reallocationPrompt.ts` (depends on T015)
- [x] T017 [P] [US2] Implement `useReallocationDetailsStore` — persisted under `tbxReallocationDetails:<teamProfileId>:<deriveScopeKey(projectKey,piName)>` (reuse `overlayStorage.deriveScopeKey`; own prefix), scoped exactly like the overlay — in `client/src/views/FeatureCanvas/ai/useReallocationDetailsStore.ts` (independent of other tasks)

### Implementation for User Story 2 — panel & wiring

- [x] T018 [US2] Extract `copyToClipboard` + `fallbackCopy` into `client/src/views/FeatureCanvas/ai/clipboard.ts` and update `AiSuggestionPanel.tsx` to import from it (no behavior change; existing `AiSuggestionPanel.test.tsx` must still pass) — new file + `client/src/views/FeatureCanvas/ai/AiSuggestionPanel.tsx`
- [x] T019 [US2] Implement `WorkReallocationPanel` — `useAiAssistStore` gate (renders `null` when locked), target-sprint `<select>` (default highest-priority/earliest), additional-details textarea bound to the store, read-only prompt preview, Copy via `clipboard.ts`, and all empty/degraded states — in `client/src/views/FeatureCanvas/ai/WorkReallocationPanel.tsx` (depends on T015, T016, T017, T018)
- [x] T020 [US2] Mount `WorkReallocationPanel` beside `AiSuggestionPanel` behind the AI gate, passing canvas nodes, overlay sprint containers, active-team roster, and PI name — in `client/src/views/FeatureCanvas/FeatureCanvasView.tsx` (depends on T019)

**Checkpoint**: Both stories work independently; existing canvas AI analyses are unchanged.

---

## Phase 5: Polish & Cross-Cutting

- [x] T021 [P] Finalize the `CHANGELOG.md` entry for feature 012 (both parts, user-visible behavior)
- [x] T022 Run the `quickstart.md` validation — Part 1 (steps 1–4), Part 2 (5–11), empty/degraded (12–16), and the regression guard (17: existing AI analyses unchanged)
- [x] T023 Run `cd client && npm run build` and `cd client && npx vitest run` for the touched suites (roster store/tab, blueprint mapping, node mapping, reallocation model/prompt/store, both panels) — all green

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001)**: no dependencies.
- **Foundational (T002)**: after Setup; **blocks US1 impl and US2 model**.
- **US1 (T003–T006)**: after T002. The MVP.
- **US2 (T007–T020)**: after T002; consumes US1's `RosterRoleCapabilities` type (T002) and, at runtime, a
  role-set roster (US1 for real value, but US2 compiles/tests against the type alone).
- **Polish (T021–T023)**: after all desired stories.

### Within-story order

- US1: tests T003/T004 → T005 (store) → T006 (UI).
- US2: tests T007–T011 → data thread T012/T013 → T014 → model T015 → prompt T016 (+ store T017 in parallel) →
  clipboard extract T018 → panel T019 → wiring T020.

### Parallel opportunities

- **US1 tests**: T003, T004 together (different files).
- **US2 tests**: T007, T008, T009, T010, T011 together (different files).
- **US2 data thread**: T012 and T013 together (different files); T014 waits for both.
- **US2 impl**: T017 (details store) runs parallel to T015/T016; T018 (clipboard extract) parallel to the model
  work.
- **Cross-story**: once T002 is done, a second developer can take all of US2's pure logic (T007–T017) while the
  first finishes US1 — only T019/T020 truly benefit from US1 being live.

---

## Parallel Example: User Story 2 tests

```bash
# Launch US2's test tasks together (all different files, all expected to fail first):
Task: "Unit test reallocationModel in client/src/views/FeatureCanvas/ai/reallocationModel.test.ts"
Task: "Unit test reallocationPrompt in client/src/views/FeatureCanvas/ai/reallocationPrompt.test.ts"
Task: "Unit test useReallocationDetailsStore in client/src/views/FeatureCanvas/ai/useReallocationDetailsStore.test.ts"
Task: "Component test WorkReallocationPanel in client/src/views/FeatureCanvas/ai/WorkReallocationPanel.test.tsx"
Task: "Blueprint statusChangedIso mapping in client/src/views/ArtView/blueprintHierarchy.test.ts"
```

---

## Implementation Strategy

### MVP first (US1 only)

1. T001 → T002 → US1 tests (T003–T004) → US1 impl (T005–T006).
2. **STOP and VALIDATE**: quickstart Part 1. Role-aware roster is a shippable, standalone enhancement.

### Incremental delivery

1. Setup + Foundational → US1 (MVP: role-aware roster) → demo.
2. US2 (Work Re-Allocation Plan) → demo the copy-out prompt.
3. Polish → CHANGELOG + full quickstart + build/test green.

### Parallel team strategy

After T002: Dev A finishes US1 (T003–T006); Dev B builds US2 pure logic + data thread (T007–T017) against the
role type; they converge on the panel/wiring (T018–T020).

---

## Notes

- `[P]` = different files, no incomplete-task dependency. `[Story]` maps each task to US1/US2.
- TDD is mandatory here (Article V): each test task precedes its implementation and must fail first.
- **SC-8 guard**: US2 is a *separate* panel; T018 touches `AiSuggestionPanel` only to relocate the clipboard
  helper — its existing test must stay green.
- No new dependency, no server change; the only network delta is one extra Jira field (T012).
- Commit after each task or logical group; stop at the US1 checkpoint to validate the MVP independently.
