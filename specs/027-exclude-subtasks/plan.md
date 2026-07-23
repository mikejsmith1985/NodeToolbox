# Implementation Plan: Exclude Sub-tasks from Flow and Throughput Figures

**Feature**: `027-exclude-subtasks` | **Branch**: `fix/027-exclude-subtasks` | **Spec**: [spec.md](./spec.md)
**Contract**: [contracts/issue-scope.md](./contracts/issue-scope.md)

---

## Technical Context

| | |
|---|---|
| Language | TypeScript, React 19, client-only |
| Tests | vitest + @testing-library |
| New dependencies | **none** |
| Surfaces touched | `PersonalFlowTab`, `IssueFlowTab`, `personalFlow.ts`, `flowAuditDocument.ts` |
| Server impact | **none** — no engine bundle is affected |

---

## Constitution Check

| Article | Status |
|---|---|
| III Branching | ✅ `fix/027-exclude-subtasks` |
| V Testing (TDD) | ✅ every task is RED → GREEN |
| VI CHANGELOG | ✅ T014, and it must warn that figures move |
| VII Framework-first | ✅ no new infrastructure; Jira supplies the discriminator, we only read it |
| X Evidence | ✅ the claim "sub-tasks are included today" was verified against the JQL, not assumed |
| XI Restraint | ✅ spec tree only; no status docs |

**Art. VII note**: the temptation is to write a sub-task *detector*. There is nothing to detect — Jira already answers
this on every issue as `issuetype.subtask`. The only custom piece is the decision about what to do when that field is
missing, which is a policy question rather than infrastructure.

---

## Phase 0 — Research findings

**R1 — The discriminator.** `fields.issuetype.subtask` is a boolean present on both Server and Cloud, already modelled
at `client/src/types/jira.ts:223`. The type NAME is unusable: this instance renames standard types (it uses "Defect",
not "Bug"), and sub-task types are freely customised.

**R2 — Neither report requests `issuetype` today.** Verified: the field lists in `buildSearchPath`
(`PersonalFlowTab.tsx`) and `buildFlowSearchPath` (`IssueFlowTab.tsx`) are
`summary, created, assignee, status, resolutiondate, <storyPoints>`. So the engines cannot currently tell a sub-task
from a story **at all** — this is a genuine gap, not a mis-set option.

**R3 — Where the exclusion must live.** `computePersonalFlow` already produces the `fetched = credited + excluded`
reconciliation from `evaluateIssue`, which returns a typed reason. FR-008 requires sub-tasks to appear there, so the
exclusion must run **inside the engine** — filtering in the tab would make the count vanish from the very
reconciliation that exists to account for every fetched issue.

**R4 — How to reach the engine without breaking it.** `PersonalFlowIssue` has no type information. Adding a
**required** field would force edits to every fixture in `personalFlow.test.ts` (35 tests). Adding it as
**optional**, defaulting to countable, leaves all existing fixtures valid and all existing tests passing unchanged —
the 017 optional-prop precedent used elsewhere in this codebase. Chosen.

**R5 — Ordering within the reconciliation.** `evaluateIssue` tests `not-owned` → `wip-open` →
`completed-out-of-window`. The new `sub-task` reason goes **after `not-owned`, before `wip-open`**.

Rationale: the fetch JQL is a deliberate superset, so `not-owned` is mostly noise from over-fetching. Testing scope
first would sweep other people's sub-tasks into this person's sub-task count and make it meaningless. Testing it
straight after ownership makes the number read as *"sub-tasks that were actually yours"* — which is the figure FR-010
needs to say "your only credited work in this window was sub-tasks".

**R6 — Flow Analysis is simpler.** `IssueFlowTab` maps raw issues through `toIssueFlow` and already drops issues that
return `null`. Sub-tasks are filtered there, before `buildIssueFlow`, so they never become stages and cannot
double-count elapsed time against their parent.

---

## Phase 1 — Design

### The shared predicate

```
issue.fields.issuetype ──► classifyIssueScope() ──► 'countable' | 'sub-task' | 'unknown-type'
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
      PersonalFlowIssue.scopeVerdict      IssueFlowTab filter
      (engine → excluded reason)          (before buildIssueFlow)
```

One function, two consumers, no reimplementation — NFR-001. This is the same "surfaces agree by construction" rule
that governs `issueTimeline.ts`: two reports that answer "does this issue count?" differently would make both
untrustworthy with nothing to show which was wrong.

### Why `unknown-type` counts

An unreadable issue type yields `unknown-type`, which is **counted** and reported separately. The alternative —
treating it as a sub-task — deletes a named person's real work on the strength of a missing field. Over-counting is
visible and arguable; silent deletion is neither, and this whole report exists to prevent exactly that.

### What deliberately does NOT change

Removing sub-tasks changes **which** issues are counted, never **how** a counted issue is measured (contract G5). A
retained issue's cycle time is byte-identical before and after, so any movement in an average is fully explained by
the changed population — which is what makes this correction safe to ship and easy to explain to someone holding an
older report.

---

## Risks

| Risk | Mitigation |
|---|---|
| ⚠️ Figures move — counts fall, cycle times rise | Intended. CHANGELOG states it plainly (NFR-003); it is a correction, not a regression |
| Someone's work was only sub-tasks and they now read as idle | FR-010 — named explicitly with the count, never an empty row |
| A team genuinely delivers at sub-task level | FR-012 toggle, default excluded, and the document states the basis used |
| The 35 `personalFlow.test.ts` tests churn | Optional field (R4) — they stay untouched |

---

## Sequencing

Foundational predicate → Personal Workflow (the report she read) → Flow Analysis → disclosure → toggle.
US1 and US2 ship together: excluding without disclosing would trade one silent inaccuracy for another.
