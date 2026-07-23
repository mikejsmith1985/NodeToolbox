# Contract: Countable Issue Scope

**Module**: `client/src/views/ReportsHub/issueScope.ts` (new, pure)
**Feature**: `027-exclude-subtasks` | **Satisfies**: FR-001..FR-007, NFR-001

---

## The one predicate

Both reports ask the same question through the same function, so they cannot disagree about whether an issue counts.

```ts
/** Why an issue is not counted as a deliverable in its own right. */
export type IssueScopeVerdict = 'countable' | 'sub-task' | 'unknown-type';

export function classifyIssueScope(
  issueTypeFields: { subtask?: boolean; name?: string } | null | undefined,
): IssueScopeVerdict;
```

### Rules

| Input | Verdict | Why |
|---|---|---|
| `subtask === true` | `sub-task` | The authoritative discriminator |
| `subtask === false` | `countable` | A real deliverable |
| missing / null / not a boolean | `unknown-type` | See below |

**The boolean, never the name.** `Sub-task`, `Subtask`, `Sub-Task` and custom sub-task types all exist, and this Jira
instance already renames standard types (it uses "Defect", not "Bug"). A name check would silently fail on exactly the
teams that customise their workflow.

**`unknown-type` counts as countable but is reported.** Treating an unreadable type as a sub-task would delete real
work from a named person's figures on the strength of a missing field. Over-counting is visible and arguable;
silently deleting someone's work is neither.

---

## Guarantees

| # | Guarantee | Requirement |
|---|---|---|
| G1 | Identification uses `issuetype.subtask`, never the type name | FR-001 |
| G2 | An unreadable type is countable, and separately reported | FR-003 |
| G3 | Both reports consume this function; neither reimplements it | NFR-001 |
| G4 | Pure — no clock, no fetch, no I/O | — |
| G5 | Excluding an issue never changes a retained issue's own figures | FR-007 |

**G5 is what makes this correction safe to ship.** Sub-task removal changes *which* issues are counted, never *how* a
counted issue is measured — so the cycle time of any individual retained issue is byte-identical before and after, and
any movement in an average is fully explained by the changed population.

---

## Where it is applied

Exclusion happens in the **engine**, not the JQL. The fetch stays a deliberate superset — the same decision feature 025
made — so the number of excluded sub-tasks stays knowable and linkable. Narrowing the JQL would make the exclusion
invisible and unverifiable, which is precisely the failure this report exists to prevent.

| Report | Applied at | Effect |
|---|---|---|
| Personal Workflow | Issue mapping, before crediting | New `sub-task` exclusion reason in `fetched = credited + excluded` |
| Flow Analysis | Before `buildIssueFlow` | Sub-tasks never become stages, so no double-counted elapsed time |

---

## Required tests (red first — Article V)

**Detection**
- `subtask: true` → `sub-task`, whatever the type is named.
- A type **named** "Sub-task" but with `subtask: false` → `countable` (the name must not decide).
- A custom sub-task type with `subtask: true` → `sub-task`.
- Missing `issuetype`, missing `subtask`, and a non-boolean `subtask` → `unknown-type`.

**Application**
- A parent Story with two sub-tasks credits 1 issue, not 3 (SC-001).
- Cycle-time average **rises** when sub-tasks are excluded from a fixture containing them (SC-002).
- `fetched = credited + excluded` still balances, with sub-tasks on the right (SC-003).
- A retained issue's own cycle time is byte-identical before and after exclusion (G5).
- A person whose only work was sub-tasks yields zero credited issues **and** a stated reason (SC-004, FR-010).
- Both reports return the same verdict for the same issue fixture (SC-005, G3).
