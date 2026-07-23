# Phase 1 Data Model: Issue Flow Analysis

**Feature**: `026-issue-flow-analysis` | **Date**: 2026-07-23 | **Plan**: [plan.md](./plan.md)

Six entities. All client-side and transient. Every duration is in **working days** (research R6) and every field
carrying one says so in its name or its comment — a bare number here is exactly how a mixed-unit error gets in.

---

## 1. `HolderSegment` and `StatusSegment`

The two reconstructed timelines. Both are instantiations of the **same** generic span type the existing engine
already uses (research R1) — which is what makes NFR-001 structural rather than aspirational.

```ts
/** Who held the issue, over one contiguous period. */
type HolderSegment = StateSegment<IssueHolder>;

/** What status the issue was in, over one contiguous period. */
type StatusSegment = StateSegment<string | null>;   // Jira status id; null before the first known status

/** A holder is a person or, explicitly, nobody. */
interface IssueHolder {
  /** The machine id Jira stores (account id, username or user key). Null when unassigned. */
  holderId: string | null;
  /** Display name, or the literal "Unassigned". */
  holderName: string;
}
```

**Validation rules**:
- Segments are contiguous and non-overlapping, and together cover the whole span from origin to completion. A gap
  would silently lose time from the totals.
- `holderId: null` is the **Unassigned holder** (FR-002) — a real value, not an absence. Queue time is expected to be
  one of the largest buckets, so representing it as missing data would hide the headline finding.
- Zero-length segments are dropped; a same-value re-assignment merges rather than splitting a span in two.

---

## 2. `FlowStage`

The atomic unit of the whole analysis: one contiguous period during which **both** the status and the holder were
constant. Every figure in the feature is a sum over stages.

```ts
interface FlowStage {
  fromIso: string;
  toIso: string;
  statusId: string | null;
  statusName: string;
  holder: IssueHolder;
  flowClass: StatusFlowClass;
  /** Monday–Friday days credited to this stage. */
  workingDays: number;
}
```

**How it is built**: by intersecting the two timelines. A status change *or* a holder change ends the current stage
and starts the next — so an issue that changed hands mid-status produces two stages with the same status and
different holders, which is precisely the detail the feature exists to surface.

**Validation rules**:
- Stages are ordered, contiguous, and non-overlapping.
- `Σ stage.workingDays` over all stages **equals** the issue's lead time (FR-003). This is not a coincidence to be
  hoped for — lead time is *defined* as that sum (research R9).
- A stage whose span falls entirely on a weekend has `workingDays: 0` and is still retained: it happened, and
  dropping it would leave a hole in the timeline a reader could see.

---

## 3. `StatusFlowClass`

What a stage's status *means* — the distinction that turns "where does time go" into "where is flow lost".

```ts
type StatusFlowClass = 'active' | 'waiting' | 'unclassified' | 'not-started' | 'completed';
```

| Class | Meaning |
|---|---|
| `active` | Being worked on |
| `waiting` | In a queue, blocked, or awaiting someone |
| `unclassified` | Genuinely uncertain — counted, never guessed into a bucket (FR-008c) |
| `not-started` | Before work began (Jira `new` category) — this is the backlog wait |
| `completed` | After completion (`done` category) — outside both clocks |

**Validation rules**:
- Classification is by **name pattern, with user override** (FR-008a) — Jira's categories cannot supply it, since
  every in-flight status shares one.
- The classification actually used MUST be reportable (FR-008b). A wrong guess that silently moves real work into the
  waiting bucket would invert the conclusion, which is the worst failure available to a report about where delay
  lives.
- `unclassified` time still counts toward totals. Excluding it would make the parts stop summing to the whole.

---

## 4. `IssueFlow`

One delivered issue, whole.

```ts
interface IssueFlow {
  issueKey: string;
  issueSummary: string;
  storyPoints: number | null;
  completedIso: string;          // last entry into a done-category status (FR-000b)
  stages: FlowStage[];
  /** Every stage, summed. */
  leadTimeWorkingDays: number;
  /** Stages from the first active/waiting stage onward. */
  cycleTimeWorkingDays: number;
  /** The gap: time before work began. Reported in its own right (FR-005a). */
  preWorkWaitWorkingDays: number;
}
```

**Validation rules** — the three that make the figures checkable:
1. `leadTimeWorkingDays === Σ stages.workingDays`
2. `cycleTimeWorkingDays === Σ stages from first started stage`
3. `preWorkWaitWorkingDays === leadTimeWorkingDays − cycleTimeWorkingDays`

All three are **derived by summation, never computed in parallel** (research R9). Computing a total independently of
the stages it is supposed to sum is the only way FR-003's reconciliation can fail, so the design removes the
possibility rather than testing for it.

- An issue that never entered a started status has `cycleTimeWorkingDays: 0` and its whole lead time as pre-work
  wait — reported honestly, not as an error.
- `completedIso` is the **last** done entry (FR-000b), so a reopened-and-refinished issue is counted once, dated by
  its real completion, with the rework included.

---

## 5. `StageRollup`

The aggregate across issues for one status — the "where is flow lost" answer.

```ts
interface StageRollup {
  statusName: string;
  flowClass: StatusFlowClass;
  totalWorkingDays: number;
  /** Typical case — resistant to one extreme issue (FR-010). */
  medianWorkingDays: number;
  /** Spread, so a single outlier cannot read as the norm. */
  p85WorkingDays: number;
  issueCount: number;
  /** The issues behind this row, for the evidence link (FR-011). */
  issueKeys: string[];
}
```

**Validation rules**:
- Reported with **both** a typical value and a spread (FR-010). A mean alone lets one three-month outlier define the
  team's apparent review time.
- `issueKeys` populates the evidence link, so every aggregate is traceable in one action (FR-011).
- Roll-ups partition the same stage set, so summing every roll-up's `totalWorkingDays` returns the total across all
  issues — another reconciliation a reader can perform.

---

## 6. `DeliveryTotals`

The honest team-level figures (FR-012, FR-013) — the direct answer to the double-count found in review.

```ts
interface DeliveryTotals {
  /** Distinct issues completed. Each counted ONCE, however many people held it. */
  deliveredIssueCount: number;
  /** Each issue's points counted ONCE. */
  deliveredStoryPoints: number;
}
```

**Validation rules**:
- Counted over the **distinct issue set**, never by summing per-person figures. In review, one issue through a dev
  and a PO produced 1 issue + full points credited to *each* — so a per-person sum reports stints, not issues.
- Displayed **beside** the per-person columns (FR-014a), not on a separate screen. A label alone does not survive a
  copy into a document; supplying the number the reader wanted removes the reason to add the column up.

---

## Entity relationships

```
changelog ──► HolderSegment[]  ─┐
          └─► StatusSegment[]  ─┴─(intersect)─► FlowStage[]
                                                    │
                            ┌───────────────────────┼───────────────────────┐
                            ▼                       ▼                       ▼
                        IssueFlow            StageRollup[]           DeliveryTotals
                   (lead / cycle / wait)   (per status, across    (distinct issues,
                    all summed from stages)      issues)           counted once)
```

Everything descends from one stage list. No figure in the feature is computed on a second path, so nothing can
disagree with anything else — the same discipline that makes the reconciliation checkable makes the whole analysis
internally consistent.
