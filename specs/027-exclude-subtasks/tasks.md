# Tasks: Exclude Sub-tasks from Flow and Throughput Figures

**Feature**: `027-exclude-subtasks` | **Plan**: [plan.md](./plan.md)

---

## Phase 1: Foundational — the shared predicate

- [X] T001 [P] RED — create `client/src/views/ReportsHub/issueScope.test.ts` per `contracts/issue-scope.md`:
      `subtask: true` → `sub-task` whatever the type is named; a type **named** "Sub-task" but with `subtask: false`
      → `countable` (the name must not decide); a custom sub-task type with `subtask: true` → `sub-task`; missing
      `issuetype`, missing `subtask`, and a non-boolean `subtask` → `unknown-type`; purity.
- [X] T002 GREEN — create `client/src/views/ReportsHub/issueScope.ts` exporting `classifyIssueScope` and
      `IssueScopeVerdict`. Read `issuetype.subtask` — **never the name** (R1).

---

## Phase 2: US1 + US2 — Personal Workflow figures, and what was removed 🎯

- [X] T003 RED — extend `client/src/views/ReportsHub/personalFlow.test.ts` **additively**: an issue carrying
      `scopeVerdict: 'sub-task'` is excluded with reason `'sub-task'`; one carrying `'unknown-type'` is credited
      normally; **an issue with no `scopeVerdict` at all is credited exactly as before** (the optional-field guard,
      R4). Do not edit existing tests — if one needs changing, the field was not optional enough.
- [X] T004 GREEN — in `client/src/views/ReportsHub/personalFlow.ts` add optional `scopeVerdict?: IssueScopeVerdict`
      to `PersonalFlowIssue`, add `'sub-task'` to `PersonalFlowExclusionReason`, and test it in `evaluateIssue`
      **after `not-owned`, before `wip-open`** (R5), so the count reads as "sub-tasks that were actually yours".
- [X] T005 GREEN — in `client/src/views/ReportsHub/PersonalFlowTab.tsx` add `issuetype` to the fetched field list and
      set `scopeVerdict` in `toPersonalFlowIssue` via `classifyIssueScope`.
- [X] T006 [US2] Add the `sub-task` explanation to `EXCLUSION_EXPLANATIONS` in
      `client/src/views/ReportsHub/flowAuditDocument.ts` so it joins `fetched = credited + excluded` with its own
      count and Jira link (FR-008). No new link machinery — `buildExcludedIssuesLink` already takes a reason.
- [X] T007 [US2] RED+GREEN — show the excluded sub-task count **on screen** beside the figures, not only in the
      document (FR-011), in `client/src/views/ReportsHub/PersonalFlowTab.tsx`. A reader who never copies the report
      must still see what was removed.
- [X] T008 [US2] RED+GREEN — a person whose credited work was **entirely** sub-tasks is named explicitly with the
      count (FR-010), never rendered as an empty row implying idleness. This is the guard against repeating the
      "person scores nothing for real work" failure that feature 026 fixed.

**Checkpoint**: 🎯 the report she read is correct AND says what it removed.

---

## Phase 3: US3 — Flow Analysis stops double-counting

- [X] T009 RED — extend `client/src/views/ReportsHub/IssueFlowTab.test.tsx`: a delivered parent Story with two
      sub-tasks contributes **one** issue to the delivery totals and one set of stages to the roll-ups; the fetch
      requests `issuetype`.
- [X] T010 GREEN — in `client/src/views/ReportsHub/IssueFlowTab.tsx` add `issuetype` to the field list and filter
      sub-tasks in `toIssueFlow` **before** `buildIssueFlow` (R6), so they never become stages.
- [X] T011 Disclose the excluded count in the Flow Analysis results, in the same place the ceiling notice appears.

---

## Phase 4: US4 — configurable, and the basis stated

- [X] T012 RED+GREEN — a setting to count sub-tasks, defaulting to **excluded** (FR-012), applied through the same
      predicate in both tabs.
- [X] T013 State the basis used in the audit document (FR-013), once, near the other scope facts.

---

## Phase 5: Polish

- [X] T014 `CHANGELOG.md` under `## [Unreleased]`. **Must say figures move** (NFR-003): counts fall, cycle times
      rise, and anyone holding a prior report has different numbers. Credit the reviewer's catch.
- [X] T015 Prove SC-005 — one fixture issue, both reports, same verdict. This is the assertion that justifies a
      shared predicate instead of two checks.
- [X] T016 Gates: `cd client && npx vitest run && npx tsc -b`. `personalFlow.test.ts`'s existing tests must pass
      **unmodified** (R4).
