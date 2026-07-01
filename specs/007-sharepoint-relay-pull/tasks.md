---
description: "Task list for SharePoint Relay Pull (Phase 2B)"
---

# Tasks: SharePoint Relay Pull (Phase 2B)

**Input**: Design documents from `specs/007-sharepoint-relay-pull/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/sharepoint-pull-contracts.md, quickstart.md

**Tests**: REQUIRED. Repo mandates TDD (Constitution Article V) + a pre-commit hook blocking any new
source file without a **co-located `*.test.ts(x)`**. Each source task writes its failing test first.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task.
- **[Story]**: US1 / US2 / US3 (spec). Setup, Foundational, Polish carry no story label.
- Paths are repo-relative from `C:\ProjectsWin\NodeToolbox`.

**Scope note**: Additive — reuses the relay bridge + the feature 005/006 `client/src/views/JiraIntake/`
pipeline. Only the ingestion source is new; downstream (normalize/dedup/create) is unchanged.

---

## Phase 1: Setup

- [X] T001 Add an `## [Unreleased]` CHANGELOG entry for the SharePoint relay pull in `CHANGELOG.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: enable the `sharepoint` relay channel, the bookmarklet, the config fields, and a
row-based queue entry point — shared by every user story.

**⚠️ Each source task: write the failing co-located test FIRST, then implement.**

- [X] T002 [P] Enable the SharePoint relay system: add `'sharepoint'` to `SUPPORTED_SYSTEMS` and make the disconnect message per-system/neutral in `src/routes/relayBridge.js`; extend `test/unit/relayBridge.test.js` to assert the `sharepoint` channel registers/polls like the others (per research R1)
- [X] T003 [P] Widen the client relay system type to include `'sharepoint'` in `client/src/types/relay.ts` and assert it in `client/src/types/relay.test.ts`
- [X] T004 [P] Write failing `client/src/services/browserRelay.test.ts` cases for the SharePoint bookmarklet (guards a `*.sharepoint.com` host, uses `sys='sharepoint'`, sends `Accept: application/json;odata=nometadata` + credentials), then add `SHAREPOINT_RELAY_BOOKMARKLET_CODE` + `openSharePointRelayTab` in `client/src/services/browserRelay.ts` (per research R2 / contracts §B)
- [X] T005 Add optional `sharePointSiteRelativeUrl` + `sharePointListName` to `IntakeConfig` in `client/src/views/JiraIntake/lib/intakeTypes.ts` (schema stays v3), surface them in `client/src/views/JiraIntake/components/IntakeConfigPanel.tsx`; update `intakeTypes.test.ts` + `IntakeConfigPanel.test.tsx` (per data-model §1 / research R4)
- [X] T006 Write failing `client/src/views/JiraIntake/hooks/useIntakeQueue.test.ts` case for `ingestRows(rows)` (same normalize → dedup-cache → newest-first result as `ingestFile`, from already-parsed rows), then extract the shared row→entries helper and add `ingestRows` in `useIntakeQueue.ts` (per contracts §F)

**Checkpoint**: the bridge accepts `sharepoint`, the bookmarklet exists, config carries the site/list,
and the queue can ingest rows directly. User stories can begin.

---

## Phase 3: User Story 1 — One-click pull from SharePoint (Priority: P1) 🎯 MVP

**Goal** (spec US1): Connect the relay, click **Pull from SharePoint**, and the List's submissions
fill the queue and flow through the existing dedup/create pipeline — no file export or drag.

**Independent Test**: quickstart Scenarios 1 & 5 — connected relay + Pull fills the queue; a
disconnected relay blocks Pull with a clear message and the dropzone still works.

- [X] T007 [US1] Write failing `client/src/services/sharepointIntakeApi.test.ts` (mock relay: `resolveListFieldMap` reads `/fields` → display→internal map; `fetchListItems` reads `/items` and follows `odata.nextLink`/`__next` across pages), then implement `client/src/services/sharepointIntakeApi.ts` issuing reads through `postRelayRequest`/`waitForRelayResult` (`sys:'sharepoint'`) per contracts §C + research R3
- [X] T008 [P] [US1] Write failing `client/src/views/JiraIntake/lib/mapSharePointItem.test.ts` (SharePoint item keyed by internal names → flat display-keyed `RawRow`), then implement `mapSharePointItem.ts` per contracts §D + research R5
- [X] T009 [US1] Write failing `client/src/views/JiraIntake/hooks/useSharePointPull.test.ts` (mock `sharepointIntakeApi` + relay status: `pull()` = resolve fields → fetch items → map to rows; requires config + connected relay; on error returns no rows + a clear message), then implement `useSharePointPull.ts` per contracts §E (depends on T007, T008)
- [X] T010 [US1] Write failing `client/src/views/JiraIntake/components/SharePointPullPanel.test.tsx` (shows connect affordance + connection status; Pull disabled with a message when disconnected; renders error text), then implement `SharePointPullPanel.tsx` per research R6 / FR-006
- [X] T011 [US1] Write failing `JiraIntake.test.tsx` case (Pull → `ingestRows` → `reconcileExisting` → auto-create remainder), then wire the panel + pull flow into `client/src/views/JiraIntake/JiraIntake.tsx`, keeping the dropzone as fallback (depends on T006, T009, T010) per contracts §G / FR-003/009
- [ ] T012 [US1] Run quickstart Scenarios 1 & 5 against a real connected SharePoint tab: Pull fills the queue with zero duplicates; disconnected Pull shows a clear message and the dropzone still works (Article X evidence)

**Checkpoint**: MVP — one-click pull populates the queue through the existing dedup/create pipeline.

---

## Phase 4: User Story 2 — Column names resolve automatically (Priority: P1)

**Goal** (spec US2): The reader maps every field from display names, including the reserved-`id`
GUID column whose internal name differs — no manual internal-name entry.

**Independent Test**: quickstart Scenarios 2 & 3 — a List whose `id` internal name differs maps
correctly; a multi-page List pulls fully.

- [X] T013 [US2] Extend `sharepointIntakeApi.test.ts` + `mapSharePointItem.test.ts`: the GUID column with a non-`id` internal name (e.g. `_x0069_d`/`id0`) resolves and populates each submission's `id`; an expected display column absent from `/fields` is recorded in `missingColumns`; ensure `useSharePointPull` surfaces `missingColumns` (implement FR-010 reporting if not already) per FR-004/010 / SC-002
- [ ] T014 [US2] Run quickstart Scenarios 2 & 3 (reserved-id resolves; multi-page List pulls all items)

**Checkpoint**: display-name-only mapping works, including reserved `id`, at any List size.

---

## Phase 5: User Story 3 — Refresh without re-clicking (Priority: P2)

**Goal** (spec US3): Re-pull while connected — manual Refresh and an optional auto-refresh interval
that stops on disconnect.

**Independent Test**: quickstart Scenario 6 — Refresh (or the interval) surfaces new submissions
without duplicating imported ones.

- [X] T015 [US3] Write failing tests then add **Refresh** + an optional **auto-refresh interval** to `useSharePointPull.ts` / `SharePointPullPanel.tsx` (interval stops when the relay disconnects); update `useSharePointPull.test.ts` + `SharePointPullPanel.test.tsx` per FR-007
- [ ] T016 [US3] Run quickstart Scenario 6 (Refresh picks up a newly-added submission; no duplicates)

**Checkpoint**: the pull feels live during a session without a background service.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T017 [P] Fail-safe UX: relay disconnect mid-pull / permission error / missing config surface a clear message and ingest **0** rows (no partial/duplicate state); confirm the dropzone fallback is unaffected; add/verify tests in `useSharePointPull.test.ts` + `SharePointPullPanel.test.tsx` per FR-008
- [X] T018 Finalize the `CHANGELOG.md` entry; run gates: `cd client && npx vitest run src/views/JiraIntake src/services/sharepointIntakeApi.test.ts src/services/browserRelay.test.ts` + `npm run build`, and the server `test/unit/relayBridge.test.js`
- [ ] T019 Release with `scripts\local-release.ps1 patch`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: none.
- **Foundational (P2)**: after Setup; **blocks all stories**. T002–T006 are independent files (mostly `[P]`).
- **US1 (P1)**: after Foundational. T007→T009; T008 `[P]`; T010 after none but paired with T009; T011 after T006/T009/T010.
- **US2 (P1)**: after US1 (extends the reader/mapper tests + missing-column reporting).
- **US3 (P2)**: after US1 (adds refresh to the hook/panel). Independent of US2.
- **Polish (P6)**: after the stories you intend to ship.

### Within each story / TDD

- Failing co-located test precedes implementation.
- Service (`sharepointIntakeApi`) + pure mapper (`mapSharePointItem`) → hook (`useSharePointPull`) →
  panel → view wiring.

### Parallel opportunities

- Foundational: **T002, T003, T004 are [P]** (server / type / bookmarklet — distinct files).
- US1: **T008 [P]** (pure mapper) alongside T007.

---

## Parallel Example: Foundational

```bash
Task: "relayBridge SUPPORTED_SYSTEMS += sharepoint + test"   # T002
Task: "widen RelaySystem type + test"                        # T003
Task: "SharePoint bookmarklet in browserRelay + test"        # T004
```

---

## Implementation Strategy

### MVP first (US1)

Setup → Foundational → US1 → **STOP and validate** with a real connected SharePoint tab (Scenario 1:
Pull fills the queue; Scenario 5: disconnected fallback). That delivers one-click ingestion.

### Incremental delivery

US1 (pull) → US2 (reserved-id + pagination hardening) → US3 (refresh/auto-refresh) → Polish
(fail-safe, gates, release). Each is independently testable.

---

## Notes

- `[P]` = different files, no incomplete dependency.
- Every new source file ships with a co-located `*.test.ts(x)` or the pre-commit hook blocks the commit.
- Reuse (do not reimplement): the relay bridge (poll/result), `normalizeSubmission`, `useIntakeQueue`
  (via `ingestRows`), `reconcileExisting`/create, and the feature-006 dedup — the SharePoint path
  diverges only at "get rows".
- Live scenarios (T012/T014/T016) run against a real authenticated SharePoint tab — the true proof.
- Commit format: `type: description` (no scope). Release via `local-release.ps1` only.
