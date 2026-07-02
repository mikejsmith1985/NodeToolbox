---
description: "Task list for SharePoint Relay in the Connection Bar"
---

# Tasks: SharePoint Relay in the Connection Bar

**Input**: Design documents from `specs/008-sharepoint-connection-bar/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/connection-bar-contracts.md, quickstart.md

**Tests**: REQUIRED. Repo mandates TDD (Constitution Article V) + a pre-commit hook blocking any new
source file without a **co-located `*.test.ts(x)`**. Each source task writes its failing test first.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task.
- **[Story]**: US1 / US2 / US3 (spec). Setup, Foundational, Polish carry no story label.
- Paths are repo-relative from `C:\ProjectsWin\NodeToolbox`.

**Scope note**: Client-only. Reuses the ConnectionBar pattern, BookmarkletInstallLink, relay bridge,
and the feature-007 pull. Only the connect UX + per-system status tracking are new.

---

## Phase 1: Setup

- [X] T001 Add an `## [Unreleased]` CHANGELOG entry for unifying the SharePoint relay connect into the Connection Bar in `CHANGELOG.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: per-system relay status in the store (the no-clobber core) and a second relay poll —
shared by every user story.

**⚠️ Each source task: write the failing co-located test FIRST, then implement.**

- [X] T002 Write failing `client/src/store/connectionStore.test.ts` cases (a `snow` status updates BOTH `relayBridgeStatus` and `relayStatusBySystem.snow`; a `sharepoint` status updates `relayStatusBySystem.sharepoint` and does NOT change `relayBridgeStatus`; `clearConnectionState` resets `relayStatusBySystem`), then add `relayStatusBySystem` + route `setRelayBridgeStatus` by `status.system` (legacy field mirrors snow only) in `client/src/store/connectionStore.ts` per data-model §1 / research R1
- [X] T003 Add `useRelayBridge('sharepoint')` alongside the existing `useRelayBridge('snow')` in `client/src/App.tsx` (same hook + cadence) per research R2 / contracts §B

**Checkpoint**: the store tracks per-system relay status and the app polls SharePoint. User stories
can begin.

---

## Phase 3: User Story 1 — Connect SharePoint from the Connection Bar (Priority: P1) 🎯 MVP

**Goal** (spec US1): The Connection Bar shows a SharePoint indicator + inline panel with the
draggable bookmarklet and status, so users connect SharePoint the same way as every other service.

**Independent Test**: quickstart Scenario 1 — disconnected shows a draggable bookmarklet link; after
activating on a SharePoint tab, the dot turns connected.

- [X] T004 [US1] Write failing `client/src/components/ConnectionBar/ConnectionBar.test.tsx` cases (a SharePoint indicator is rendered always; its panel shows a draggable `BookmarkletInstallLink` (role=link) + drag guidance when disconnected; the dot reflects `relayStatusBySystem.sharepoint`), then add the `'sharepoint'` `ActivePanel`, the SharePoint `ConnectionIndicatorButton`, and a `SharePointPanel` (mirroring `SnowPanel`, reusing `BookmarkletInstallLink` + `SHAREPOINT_RELAY_BOOKMARKLET_CODE`) in `client/src/components/ConnectionBar/ConnectionBar.tsx` per contracts §C / FR-001/002/008
- [ ] T005 [US1] Run quickstart Scenario 1 against a real SharePoint tab: disconnected shows the draggable link; activating the relay turns the dot green (Article X evidence)

**Checkpoint**: SharePoint connects entirely from the Connection Bar.

---

## Phase 4: User Story 2 — Intake panel reflects status + points to the Bar (Priority: P1)

**Goal** (spec US2): The intake SharePoint pull panel drops the connect UI; it shows status + Pull +
a pointer to the Connection Bar, and pulling still works when connected.

**Independent Test**: quickstart Scenarios 2 & 3 — the intake panel has no bookmarklet/steps; Pull
works when connected, and points to the bar when not.

- [X] T006 [US2] Update `client/src/views/JiraIntake/components/SharePointPullPanel.test.tsx` (no bookmarklet/connect steps; shows Pull + a "connect from the Connection Bar" pointer when disconnected), then slim `SharePointPullPanel.tsx` — remove the `BookmarkletInstallLink`/steps, keep status + Pull + the pointer per contracts §D / FR-005
- [X] T007 [US2] Update `client/src/views/JiraIntake/JiraIntake.test.tsx` (pull panel `isConnected` comes from the store's `relayStatusBySystem.sharepoint`; pull flow unchanged), then wire `JiraIntake.tsx` to read the SharePoint connection state from `useConnectionStore` and drop the in-view connect wiring, keeping `pull → ingestRows → reconcileExisting → auto-create` per contracts §E / FR-006
- [ ] T008 [US2] Run quickstart Scenarios 2 & 3 (slim intake panel; connected Pull loads the queue with 0 duplicates)

**Checkpoint**: the intake panel is connect-UI-free and still pulls correctly.

---

## Phase 5: User Story 3 — ServiceNow relay unaffected (Priority: P1)

**Goal** (spec US3): ServiceNow relay connect/status/relaying is unchanged, even with SharePoint
also connected; the two indicators are independent.

**Independent Test**: quickstart Scenarios 4 & 5 — both relays connected independently; SNow behaves
as before.

- [X] T009 [US3] Add/confirm regression tests: `connectionStore.test.ts` proves a `sharepoint` update never mutates the snow mirror (from T002); extend `ConnectionBar.test.tsx` to assert the SNow indicator still reflects its own status when both `relayStatusBySystem.snow` and `.sharepoint` are set (no cross-contamination) per FR-003/007 / SC-002/005
- [ ] T010 [US3] Run quickstart Scenarios 4 & 5 against real relays: connect SNow + SharePoint together, confirm each indicator is independent and SNow relaying still works (Article X evidence)

**Checkpoint**: no ServiceNow regression; relays coexist.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T011 Finalize the `CHANGELOG.md` entry; run gates: `cd client && npx vitest run src/store/connectionStore.test.ts src/components/ConnectionBar src/views/JiraIntake` + `npm run build`
- [ ] T012 Release with `scripts\local-release.ps1 patch`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: none.
- **Foundational (P2)**: after Setup; **blocks all stories**. T002 → T003.
- **US1 (P1)**: after Foundational (reads `relayStatusBySystem.sharepoint`).
- **US2 (P1)**: after Foundational; independent of US1 (both read the same store status).
- **US3 (P1)**: after Foundational (the store invariant from T002 is the substance); ConnectionBar
  assertion after US1's T004.
- **Polish (P6)**: after the stories you intend to ship.

### Within each story / TDD

- Failing co-located test precedes implementation.
- Store (T002) → App poll (T003) → ConnectionBar (T004) / intake panel (T006) / view (T007).

### Parallel opportunities

- US1's ConnectionBar work (T004) and US2's intake-panel work (T006/T007) touch different files and
  can proceed in parallel once Foundational is done.

---

## Parallel Example: after Foundational

```bash
Task: "ConnectionBar SharePoint indicator + panel + test"   # T004 (US1)
Task: "Slim SharePointPullPanel + test"                     # T006 (US2)
```

---

## Implementation Strategy

### MVP first (US1)

Setup → Foundational → US1 → **STOP and validate** with a real SharePoint tab (Scenario 1: connect
from the Connection Bar). That delivers the unified connect experience.

### Incremental delivery

US1 (connect in the bar) → US2 (slim intake panel, still pulls) → US3 (verify SNow unaffected) →
Polish (gates, release). Each is independently testable.

---

## Notes

- `[P]` = different files, no incomplete dependency.
- Every new source file ships with a co-located `*.test.ts(x)` or the pre-commit hook blocks the commit.
- Reuse (do not reimplement): ConnectionBar indicator/panel pattern, `BookmarkletInstallLink`, the
  SharePoint bookmarklet, `useRelayBridge`, the relay bridge, and the feature-007 pull + feature-006 dedup.
- The legacy `relayBridgeStatus` stays snow-only — the guard that protects ServiceNow.
- Live scenarios (T005/T008/T010) run against real relays. Commit format `type: description`;
  release via `local-release.ps1` only.
