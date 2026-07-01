---
description: "Task list for Intake Deduplication (Phase 2A)"
---

# Tasks: Intake Deduplication (Phase 2A)

**Input**: Design documents from `specs/006-intake-dedup/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/dedup-contracts.md, quickstart.md

**Tests**: REQUIRED. Repo mandates TDD (Constitution Article V) + a pre-commit hook blocking any new
source file without a **co-located `*.test.ts(x)`**. Each source task writes its failing test first.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task.
- **[Story]**: US1 / US2 / US3 (spec). Setup, Foundational, Polish carry no story label.
- Paths are repo-relative from `C:\ProjectsWin\NodeToolbox`.

**Scope note**: Additive to the feature 005 `client/src/views/JiraIntake/` importer. No server changes.

---

## Phase 1: Setup

- [X] T001 Add an `## [Unreleased]` CHANGELOG entry for the intake dedup (label stamp + Jira existence check) in `CHANGELOG.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the label helper, the Jira label-search wrapper, the reconcile logic, and stamping on
create — shared by every user story. **No user-story work starts until this phase is complete.**

**⚠️ Each source task: write the failing co-located test FIRST, then implement.**

- [X] T002 [P] Write failing `client/src/views/JiraIntake/lib/intakeLabel.test.ts` (`buildIntakeLabel(id)` → `intake-<id>`; blank/whitespace id → null; `isStampableId`; `extractSubmissionId(labels)` strips the prefix / returns null when absent), then implement `intakeLabel.ts` per contracts §A + data-model §1
- [X] T003 [P] Write failing `client/src/services/jiraApi.test.ts` cases for `searchIssuesByLabels(labels, maxResults?)` (builds `GET /rest/api/2/search?jql=labels in ("l1","l2")&fields=labels&maxResults=…`; returns `[{key,labels}]`; empty input → `[]` with no fetch; chunks a large label list into multiple queries), then implement `searchIssuesByLabels` in `client/src/services/jiraApi.ts` per contracts §B + research R2
- [X] T004 [P] Write failing `client/src/views/JiraIntake/lib/reconcileExisting.test.ts` (`buildFoundIdToKey` maps `intake-<id>` labels → key and flags ids matched by >1 issue as ambiguous; `reconcileExisting(entries, idToKey, ambiguousIds)` sets matched rows `imported`+key, ambiguous rows `invalid`+reason, leaves others; returns `newLedgerEntries` for matches), then implement `reconcileExisting.ts` per contracts §C + data-model §4
- [X] T005 Write the failing case in `client/src/views/JiraIntake/lib/buildIntakeFields.test.ts` (create payload includes `labels: ['intake-<id>']`; unstampable id omits the label / flags upstream), then update `buildIntakeFields.ts` to attach the stamp via `buildIntakeLabel` (depends on T002) per research R6 / FR-001

**Checkpoint**: label build/extract, batched label search, reconcile mapping, and stamp-on-create all
exist and are unit-tested. User stories can begin.

---

## Phase 3: User Story 1 — No duplicates even without the local ledger (Priority: P1) 🎯 MVP

**Goal** (spec US1): With an empty/reset ledger or on another machine, a submission that already has
a stamped issue is never created again — it reconciles to the existing key.

**Independent Test**: quickstart Scenarios 1 & 2 — a created issue carries `intake-<id>`; clearing
the ledger and re-importing creates **0** new issues and shows the existing keys.

- [X] T006 [US1] Write failing `useCreateFromSubmission.test.ts` cases for the per-row existence guard (before create, `searchIssuesByLabels(['intake-<id>'])`: unique match → return `imported`+key, call `recordProcessed`, do NOT call `createIssue`; no match → `createIssue` with the `intake-<id>` label present), then implement the guard in `client/src/views/JiraIntake/hooks/useCreateFromSubmission.ts` (depends on T002–T005) per FR-002/004/008
- [X] T007 [US1] Write failing `useCreateFromSubmission.test.ts` cases for `reconcileExisting(entries)` batched pre-scan (collects `state==='new'` ids → one `searchIssuesByLabels` → matched rows become `imported`+key and are recorded to the ledger; returns updated entries), then implement `reconcileExisting` on the hook in `client/src/views/JiraIntake/hooks/useCreateFromSubmission.ts` (depends on T003, T004) per FR-003/005/006
- [X] T008 [US1] Write failing `JiraIntake.test.tsx` case (on import: `ingestFile` → `reconcileExisting` runs → already-stamped rows show Imported → only the remainder auto-creates), then wire `handleFile` in `client/src/views/JiraIntake/JiraIntake.tsx` to run the pre-scan before auto-create and `updateEntry` each result (depends on T007)
- [ ] T009 [US1] Run quickstart Scenarios 1 & 2 against real Jira: confirm the created issue carries `intake-<id>`, then clear the ledger, re-import, and confirm **0** new issues + existing keys shown (Article X evidence)

**Checkpoint**: MVP — stamp on create + pre-scan + per-row guard make duplicates impossible even
with no ledger.

---

## Phase 4: User Story 2 — Recover from a mid-create failure (Priority: P1)

**Goal** (spec US2): An issue created but not recorded locally (crash/ledger-write failure) is not
duplicated on the next run — the guard reconciles it to the existing key.

**Independent Test**: quickstart Scenario 3 — a stamped issue absent from the ledger reconciles on
next create with no duplicate.

- [X] T010 [US2] Extend `useCreateFromSubmission.test.ts`: submission whose stamped issue exists but is absent from the ledger → the per-row guard returns `imported`+existing key AND calls `recordProcessed` (self-heals the cache), with no `createIssue`; adjust `useCreateFromSubmission.ts` if the guard did not already record on reconcile (depends on T006) per FR-003 / SC-003
- [ ] T011 [US2] Run quickstart Scenario 3 (stamped-but-unrecorded → reconciles, no duplicate)

**Checkpoint**: the created-but-not-recorded gap is closed.

---

## Phase 5: User Story 3 — Fast path for already-known submissions (Priority: P2)

**Goal** (spec US3): Re-importing a mostly-processed file stays responsive — ledger-known rows need
no Jira call; unknown rows are checked in one batched query.

**Independent Test**: quickstart Scenario 4 — ledger rows resolve from cache with no lookup; unknown
rows trigger a single batched search.

- [X] T012 [US3] Extend `useCreateFromSubmission.test.ts`: `reconcileExisting` sends **only** ids of rows not already `imported`/known-in-ledger (rows resolved by the queue's ledger cache incur no Jira call), and unknown ids go out in a single (chunked) `searchIssuesByLabels` call — assert call args/count; refine the hook if needed (depends on T007) per FR-005/006 / SC-004
- [ ] T013 [US3] Run quickstart Scenario 4 (cache-first, batched unknowns)

**Checkpoint**: dedup guarantee stays cheap at scale.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T014 [P] Fail-safe on check error: in both the pre-scan and the per-row guard, a `searchIssuesByLabels` rejection MUST leave rows uncreated and surface a clear retry reason (never blind-create); add tests in `useCreateFromSubmission.test.ts` per FR-007 / SC-005
- [X] T015 [P] Ambiguous match: when >1 issue carries the same `intake-<id>`, flag the row `invalid` with the matching keys and do not create; add tests (`reconcileExisting.test.ts` + hook) per spec edge case
- [X] T016 Verify the guard applies on every create path (auto-create, bulk "Create N", per-row Create, Retry) — add/confirm `useCreateFromSubmission.test.ts` + `JiraIntake.test.tsx` coverage; run quickstart Scenario 6
- [X] T017 Finalize the `CHANGELOG.md` entry; run the full quickstart and gates: `cd client && npx vitest run src/views/JiraIntake src/services/jiraApi.test.ts` + `npm run build` (all green)
- [ ] T018 Release with `scripts\local-release.ps1 patch`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: none.
- **Foundational (P2)**: after Setup; **blocks all stories**. T005 depends on T002.
- **US1 (P1)**: after Foundational. MVP. T006 depends on T002–T005; T007 on T003–T004; T008 on T007.
- **US2 (P1)**: after US1 (extends the guard from T006).
- **US3 (P2)**: after US1 (refines the pre-scan from T007). Independent of US2.
- **Polish (P6)**: after the stories you intend to ship.

### Within each story / TDD

- Failing co-located test precedes implementation.
- `lib/` pure helpers (T002/T004) → service wrapper (T003) → stamp (T005) → hook logic (T006/T007) →
  view wiring (T008).

### Parallel opportunities

- Foundational: **T002, T003, T004 are [P]** (distinct files). T005 waits on T002.
- Polish: **T014, T015 are [P]**.

---

## Parallel Example: Foundational

```bash
Task: "intakeLabel.ts + test"            # T002
Task: "jiraApi searchIssuesByLabels + test"  # T003
Task: "reconcileExisting.ts + test"      # T004
```

---

## Implementation Strategy

### MVP first (US1)

Setup → Foundational → US1 → **STOP and validate** with real Jira (Scenarios 1 & 2: stamp present,
empty-ledger re-import creates 0). That alone delivers the core no-duplicate guarantee.

### Incremental delivery

US1 (stamp + pre-scan + guard) → US2 (mid-failure recovery test/behavior) → US3 (cache-first
batching) → Polish (fail-safe, ambiguous, all-paths, release). Each is independently testable.

---

## Notes

- `[P]` = different files, no incomplete dependency.
- Every new source file ships with a co-located `*.test.ts(x)` or the pre-commit hook blocks the commit.
- Reuse (do not reimplement): the `/rest/api/2/search?jql=` GET pattern (via `jiraGet`), `createIssue`,
  `recordProcessed`, and the entire feature-005 create/queue/ledger stack.
- Commit format: `type: description` (no scope — the hook rejects `type(scope):`).
- Live Jira scenarios (T009/T011/T013) are the real proof and run against the enterprise instance.
