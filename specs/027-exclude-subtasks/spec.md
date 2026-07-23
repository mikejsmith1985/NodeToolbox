# Feature Specification: Exclude Sub-tasks from Flow and Throughput Figures

**Feature**: `027-exclude-subtasks` | **Branch**: `fix/027-exclude-subtasks` | **Created**: 2026-07-23
**Status**: specified — ready for `/speckit-clarify` or `/speckit-plan`

---

## Context

Feedback from a delivery colleague, after reading a v0.91.x Personal Workflow report:

> "It looks like the times and throughput are also including sub-tasks. This is one of the weird things about Jira.
> If you are using the control chart, you would need to create a quick filter to only show user stories and defects,
> then this can be selected from the control chart. So for any queries etc you created, you need to eliminate the
> sub-tasks from the calculations. Not a big deal for this report as not a lot of them are using sub-tasks but I saw
> a few come in."

**She is correct, and it was verified against the code rather than assumed.** Neither report filters issue type:

| Report | JQL today | Sub-tasks |
|---|---|---|
| Personal Workflow | `assignee WAS "x" AND updated >= -Nd` | included |
| Flow Analysis (v0.92.0) | `assignee WAS in (…) AND resolutiondate >= -Nd` | included |

Neither even requests the `issuetype` field, so today the engines **cannot distinguish** a sub-task from a story.
Her control-chart parallel is exact: Jira's own control chart requires a quick filter for precisely this reason, which
makes this standard practice rather than a local preference.

### Why it matters, by figure

| Figure | Effect | Direction |
|---|---|---|
| Issues count | A sub-task and its parent are separate issues; one piece of work is credited twice | **Inflates** |
| Story points | Points normally sit on the parent, so sub-tasks add 0 | Largely unaffected |
| Issues/Week vs Points/Week | Only one of the pair inflates, so the two rates disagree | **Diverge** |
| Avg / median cycle time | Sub-tasks are short-lived, dragging both down | **Flatters** ⚠️ |
| Flow Analysis stage roll-ups | A parent's stages and its sub-tasks' stages cover the same elapsed time | **Double-counts** |

The cycle-time effect is the serious one: it makes delivery look **faster** than it is, which is the worst direction
for an error in a report used for coaching and capacity.

### The trap — why this is not a plain subtraction

If a developer's only assignment is a sub-task while the parent Story sits with a lead or PO, excluding sub-tasks
outright makes that person's work **disappear from the report entirely**. That is the same failure mode as the
"moved to done" defect fixed in feature 026 — a person doing real work scoring nothing. Her own note, *"not a lot of
them are using sub-tasks but I saw a few come in"*, describes exactly the population at risk.

So the requirement is **exclude from the figures, but never silently**.

---

## User Scenarios

### US1 — Figures reflect real deliverables (Priority: P1) 🎯

A delivery manager reads the Personal Workflow report and sees issue counts and cycle times computed over Stories,
Tasks and Defects — not inflated by sub-tasks, and not flattered by their short durations.

**Independent test**: run a window containing a parent Story with two sub-tasks; the person is credited with 1 issue,
not 3, and the cycle-time average does not include the sub-tasks' short durations.

### US2 — Nothing disappears silently (Priority: P1) 🎯

The same reader can see how many sub-tasks were removed, for whom, and open them in Jira to confirm the exclusion was
right. Anyone whose only credited work was sub-tasks is named explicitly rather than vanishing from the roster.

**Independent test**: for a person whose only work in the window was sub-tasks, the report shows them with zero
credited issues **and** an explicit note that N sub-tasks were excluded — never an empty row implying idleness.

### US3 — The Flow Analysis stops double-counting elapsed time (Priority: P1)

Stage roll-ups and delivery totals count a parent Story's time once, without its sub-tasks' overlapping stages.

**Independent test**: a delivered Story with two sub-tasks contributes one issue to the delivery totals and one set of
stages to the roll-ups.

### US4 — The exclusion is configurable (Priority: P3)

A team that genuinely tracks delivery at sub-task level can turn the exclusion off, and the report states which mode
produced the figures.

**Independent test**: toggling the setting changes the counts and the document says which basis was used.

---

## Requirements

### Detection

- **FR-001** Sub-tasks MUST be identified by Jira's `issuetype.subtask` **boolean**, never by matching the type name.
  Name matching breaks on `Sub-task` / `Subtask` / `Sub-Task` and on custom sub-task types, and this instance already
  has naming quirks (it uses "Defect", not "Bug").
- **FR-002** Both reports MUST request the `issuetype` field so the discriminator is available at all.
- **FR-003** An issue whose type cannot be read MUST be treated as **not** a sub-task and reported as unclassified —
  guessing "sub-task" would delete real work from someone's figures.

### Exclusion

- **FR-004** Sub-tasks MUST be excluded from: issue counts, story-point totals, both throughput rates, and the
  cycle-time average and median in the Personal Workflow report.
- **FR-005** Sub-tasks MUST be excluded from delivery totals, stage roll-ups and the per-issue table in the Flow
  Analysis report.
- **FR-006** The exclusion MUST happen in the **engine**, not by narrowing the JQL, so the count of what was excluded
  remains knowable and linkable. (Consistent with feature 025's deliberate-superset fetch.)
- **FR-007** Exclusion MUST NOT alter any retained issue's figures — removing sub-tasks changes which issues are
  counted, never how a counted issue is measured.

### Disclosure

- **FR-008** A new exclusion reason `sub-task` MUST join the existing `fetched = credited + excluded` reconciliation,
  with its own count and its own Jira link.
- **FR-009** The audit document MUST state, once, that figures are computed over non-sub-task issues, and why.
- **FR-010** A person whose credited work was **entirely** sub-tasks MUST be shown explicitly as such, never as an
  empty or absent row.
- **FR-011** The on-screen tables MUST show the excluded sub-task count where the figures are, not only in the
  document — a reader who never copies the report must still see it.

### Configuration

- **FR-012** A setting MUST allow counting sub-tasks, defaulting to **excluded**.
- **FR-013** The audit document MUST state which basis produced the figures.

---

## Non-Functional Requirements

- **NFR-001** Both reports MUST apply the identical rule from **one shared predicate**, so they can never disagree
  about whether an issue counts. (Project rule: surfaces agree by construction.)
- **NFR-002** No additional Jira requests — `issuetype` is added to the existing field list, not fetched separately.
- **NFR-003** ⚠️ **Figures will change.** This is a correction, not a regression: issue counts fall, cycle times rise.
  The release notes MUST say so plainly, because anyone holding a prior report has different numbers.

---

## Success Criteria

- **SC-001** A parent Story with two sub-tasks credits **1** issue, not 3.
- **SC-002** Cycle-time average over a fixture containing sub-tasks **rises** once they are excluded.
- **SC-003** Every fetched issue is still accounted for: `fetched = credited + excluded`, sub-tasks included in the
  right-hand side.
- **SC-004** A person whose only work was sub-tasks appears with an explicit explanation.
- **SC-005** Both reports return identical verdicts for the same issue.

---

## Assumptions

- Sub-tasks in this instance rarely carry story points; the points effect is therefore small but the count effect is not.
- Jira returns `fields.issuetype.subtask` on both Server and Cloud (the repo already models it at
  `client/src/types/jira.ts:223`).
- Epics and Features are **not** in scope here — they are not sub-tasks and are already outside these reports' scope.

---

## Out of Scope

- Rolling a sub-task's time **up into its parent**. That is a defensible alternative model, but it changes what a
  cycle time means and needs its own decision; this feature only stops sub-tasks being counted as peers.
- Changing the hygiene, aging or PI Review reports.
