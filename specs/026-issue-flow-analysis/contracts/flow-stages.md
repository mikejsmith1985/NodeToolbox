# Contract: Flow Stages and Totals

**Modules**: `client/src/views/ReportsHub/issueFlow.ts` + `issueFlowStatusClass.ts` (new, pure)
**Feature**: `026-issue-flow-analysis` | **Satisfies**: FR-001..FR-003, FR-005..FR-008c, FR-000a/b

---

## `buildIssueFlow(input): IssueFlow`

Turns one issue's raw history into stages, then derives every total from them.

```ts
export function buildIssueFlow(input: {
  issueKey: string;
  issueSummary: string;
  storyPoints: number | null;
  createdIso: string | null;
  statusTransitions: Array<{ toStatusId: string; atIso: string }>;
  /** Assignee changes WITH identity retained — the whole point of this feature. */
  holderTransitions: Array<{ holder: IssueHolder; atIso: string }>;
  initialHolder: IssueHolder;
  initialStatusId: string | null;
  statusCategoryByStatusId: Readonly<Record<string, string>>;
  statusNamesById: Readonly<Record<string, string>>;
  statusClassifier: (statusId: string, statusName: string) => StatusFlowClass;
  todayIso: string;      // injected — never read from the clock
}): IssueFlow | null;
```

Returns `null` when the issue never entered a done-category status, so it is not in scope (FR-000b).

### The pipeline — deliberately one-directional

```
holderTransitions ──► buildStateSegments<IssueHolder>  ─┐
statusTransitions ──► buildStateSegments<string|null>  ─┴─► intersect ─► FlowStage[] ─► totals
```

**Totals are summed from stages. They are never computed in parallel** (research R9). That is the only way FR-003's
reconciliation can fail, so the design removes the possibility rather than testing for its absence:

| Total | Definition |
|---|---|
| `leadTimeWorkingDays` | Σ over **all** stages |
| `cycleTimeWorkingDays` | Σ over stages from the first `active`/`waiting` stage onward |
| `preWorkWaitWorkingDays` | `leadTime − cycleTime` |

### Guarantees

| # | Guarantee | Requirement |
|---|---|---|
| S1 | Stages are ordered, contiguous, non-overlapping | FR-001 |
| S2 | A status change **or** a holder change ends a stage | FR-001 |
| S3 | `Σ stages.workingDays === leadTimeWorkingDays`, exactly | FR-003 |
| S4 | Stages from the first started stage sum to `cycleTimeWorkingDays`, exactly | FR-003 |
| S5 | Unassigned periods carry the explicit `Unassigned` holder, never dropped, never charged to the next holder | FR-002 |
| S6 | Every stage after `completedIso` is excluded from both clocks | FR-000b |
| S7 | Pure — same input, same output; `todayIso` injected | — |

**S5 is the one with an ethical edge.** Attributing queue time to whoever picked the issue up next would produce a
tidier timeline in which every stage has a person. The spec rejected it because it bills someone for a queue they
did not control — and a report that does that to a named individual is worse than no report.

---

## `classifyStatusFlow(statusId, statusName, overrides): StatusFlowClass`

Decides what a status *means*, since Jira cannot: every in-flight status shares the `indeterminate` category.

**Default patterns** (case-insensitive, applied to the status name):

| Class | Patterns |
|---|---|
| `waiting` | `ready for`, `waiting`, `blocked`, `on hold`, `pending`, `in review`, `to be`, `queue` |
| `active` | any other `indeterminate` status |
| `not-started` | any `new`-category status |
| `completed` | any `done`-category status |

**User overrides win** over every pattern (FR-008a).

### Guarantees

| # | Guarantee | Requirement |
|---|---|---|
| C1 | An override always beats the default | FR-008a |
| C2 | The classification used is **reportable**, so a wrong guess is visible | FR-008b |
| C3 | Genuine uncertainty yields `unclassified`, and that time still counts toward totals | FR-008c |
| C4 | Classification never changes a duration — only its label | FR-003 |

**C3 exists because the alternative inverts the finding.** A status wrongly pushed into `waiting` moves real work
into the queue bucket, and the report then blames a queue that does not exist. Reporting "we could not classify
these three statuses" is a smaller failure than confidently reporting the wrong conclusion.

**C4 keeps the two concerns separate**: durations come from the timeline, meaning comes from the classifier.
Reclassifying a status must never move a number, only which bucket it appears in — which is what makes the
classification safely revisable later.

---

## Required unit tests (red first — Article V)

**Stage construction**
- A status change mid-holder produces two stages, same holder, different statuses.
- A holder change mid-status produces two stages, same status, different holders. *(The core of the feature — the
  existing engine cannot represent this at all.)*
- An issue held by three people in turn produces their stages in order.
- Unassigned periods appear as the `Unassigned` holder, not as gaps and not merged into a neighbour (S5).

**Reconciliation — the checkable property**
- For a fixture spanning several statuses and holders: stages sum **exactly** to lead time (S3).
- Stages from first-started sum **exactly** to cycle time (S4).
- `leadTime − cycleTime === preWorkWait`.
- An issue that never started: cycle time `0`, whole lead time as pre-work wait, no error.

**Completion and scope**
- An issue with no done transition returns `null` (out of scope).
- An issue reopened and re-completed uses the **last** done entry, counted once, rework included (FR-000b).
- Stages after completion are excluded from both clocks (S6).

**Classification**
- Each default pattern maps as documented; matching is case-insensitive.
- An override beats the pattern (C1).
- An unmatched `indeterminate` status is `active`; a genuinely ambiguous one is `unclassified` and still counted (C3).
- Reclassifying a status changes its bucket and **not** its duration (C4).

**Purity**
- Two calls with identical input are deeply equal; output does not vary with wall-clock time.
