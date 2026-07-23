# Phase 0 Research: Issue Flow Analysis

**Feature**: `026-issue-flow-analysis` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

Nine questions settled before design. The first is the one that decides the whole shape of the work, and the answer
is better than the spec assumed.

---

## R1 — Can both analyses share one history reconstruction? (NFR-001) ✅ YES

**Decision**: Extract the timeline machinery into a shared pure module. Both analyses consume it; neither owns it.

**Why this is possible at all**: `buildStateSegments` (`personalFlow.ts:415`) is already **generic**:

```ts
function buildStateSegments<TValue>(
  originMs: number, initialValue: TValue,
  changePoints: { atMs: number; value: TValue }[], todayMs: number,
): StateSegment<TValue>[]
```

It reconstructs "a timeline held value X from t1 to t2" for **any** value type. The person-centric engine happens to
instantiate it with `boolean` (was-this-mine); the flow analysis instantiates it with an **assignee identity**. The
reconstruction logic — sorting change points, clamping to the origin, closing the final segment at today — is
identical and already written.

**Consequence**: NFR-001 ("a person's hands-on time must match between the two analyses") becomes true by
construction rather than by discipline, because there is one segment builder and one definition of a span.

**What must be extracted**: `buildStateSegments`, `buildStatusIdSegments`, `resolveOriginMs`, `isWorkday`, and the
already-exported `businessMillisBetween`. All are currently **internal** to `personalFlow.ts`.

**Alternatives considered**: exporting them in place and importing across (rejected — leaves the shared core owned by
the person-centric module, so a change made for one analysis silently reaches the other); duplicating the logic
(rejected outright — it is the exact "two independent reconstructions" NFR-001 forbids, and the two would drift).

**Risk and its mitigation**: this refactors shipped code. `personalFlow.test.ts` has 35 tests over that behaviour and
must stay green **without modification** — that is the regression guard, and if the extraction is behaviour-preserving
it costs nothing to satisfy.

---

## R2 — Where the assignee identity is lost, and how to keep it

**Decision**: A parallel reader that retains the assignee, feeding the same generic segment builder.

`readOwnershipHistory` (`PersonalFlowTab.tsx:214`) walks the changelog and, for each assignee change, collapses it:

```ts
const assignedToTarget = identityMatches(identity, item.to, readChangeItemText(item, 'toString'));
ownershipTransitions.push({ assignedToTarget, atIso: history.created ?? '' });
```

The raw `item.to` (machine id) and `item.toString` (display name) **are** the assignee. The information is present in
the changelog and discarded at this one mapping step — nothing upstream needs to change to recover it.

**Consequence**: the flow analysis needs its own reader producing `{ assigneeId, assigneeName, atIso }`, not a new
fetch. Both readers consume the same raw changelog already being requested.

**Unassigned is a real value, not an absence** (spec FR-002): a change to `to: null` becomes the explicit
`Unassigned` holder, so it flows through the generic builder like any other identity.

---

## R3 — Which issues to fetch (FR-000)

**Decision**: `assignee WAS in (<roster query values>)` restricted to the window, then filtered to completed issues by
the engine.

`buildStandupRosterAssigneeClause` (`useStandupRosterStore.ts:313`) already builds `assignee in (…)` from the roster,
with quote escaping. This feature needs the **`WAS`** form — an issue the team *held at some point*, not one they
hold now — so that helper needs a `WAS` variant or a parameter.

**Why `WAS` and not `=`**: the analysis is about issues that passed through the team. An issue a developer built and
handed to a PO outside the roster would be invisible under `assignee =`, and that hand-off is precisely the delay the
feature exists to find.

**Completion filtering happens in the engine, not the JQL** (FR-000b): "last entry into a done-category status inside
the window" depends on the changelog, which JQL cannot express. As with the existing report, the fetch is a
deliberate **superset** and the engine does the exact filtering — with the same consequence recorded in feature 025:
a link to the fetch query returns more issues than the analysis counted, so the two must never be presented as the
same set.

---

## R4 — Paging and ceilings (NFR-006)

**Decision**: Reuse `flowAuditFetch.ts` from feature 025 as-is.

It already provides `fetchAllPersonIssues(fetchPage, { remainingRunBudget, isCancelled })` with `ISSUE_PAGE_SIZE`, a
per-unit ceiling, an overall budget, and cancellation between pages — exactly the two-ceiling pattern the spec asked
for, already tested (13 tests).

**Rename, do not rewrite**: the function is not person-specific; only its name is. Generalising the name (and keeping
the person-scoped call site working) is a smaller change than a second implementation, and NFR-006a explicitly
requires both analyses to bound themselves the same way.

---

## R5 — Classifying waiting versus active work (FR-008a–c)

**Decision**: Name-pattern defaults, evaluated case-insensitively, with the classification reported.

Jira's `statusCategory` cannot supply this: every in-flight status is `indeterminate`, which is why the existing
engine treats them all as hands-on time. The distinction must come from outside.

| Default class | Name patterns |
|---|---|
| **Waiting** | `ready for…`, `waiting`, `blocked`, `on hold`, `pending`, `in review`, `to be…`, `queue` |
| **Active** | any other `indeterminate` status |
| **Not counted as flow** | `new` category (before start) and `done` category (after completion) |

**Two rules keep this honest.** The report states the classification it used (FR-008b), so a wrong guess is visible;
and a status matching **no** pattern with confidence is reported as *unclassified* with its time still counted
(FR-008c), rather than being pushed into whichever bucket happens to be the default.

**Why not infer from behaviour** (e.g. "statuses where issues sit unassigned"): it is circular. The analysis exists
to discover where work waits; deriving the definition of waiting from the same data would make the finding
unfalsifiable.

---

## R6 — Calendar time or working time? (FR-006)

**Decision**: **Working days throughout**, stated at every figure.

`businessMillisBetween` (already exported) counts Monday–Friday only, and the existing report's cycle time is in
working days. NFR-001 requires a person's hands-on time to match between the two analyses — so the shared unit must
be working days, or the two reports would disagree about the same issue by every weekend it spanned.

FR-006 additionally requires the unit to be **consistent across the analysis**, which rules out mixing calendar lead
time with working-day stages.

**The tradeoff, recorded honestly**: a customer waiting for a feature waits over weekends too, so working-day lead
time understates the real wait. This is accepted because internal consistency and agreement with the existing report
matter more for a report whose purpose is being checkable — and because a mixed-unit report invites exactly the kind
of quiet arithmetic error this feature is meant to eliminate. Every duration must be labelled *working days* so no
reader assumes otherwise.

---

## R7 — Publishing through the existing document (FR-011a/b)

**Decision**: Extend `flowAuditMetrics.ts` with flow metric definitions and add sections to `flowAuditDocument.ts`.

The document generator is pure, section-ordered, and already carries meanings, formulas, worked examples and evidence
links. Flow metrics are more metric definitions; flow sections are more sections. No new document machinery.

**FR-011b needs its own wording, not the existing notice.** Feature 025's redistribution warning covers throughput.
Naming individuals against **waiting** time reads as blame unless the reader is told a queue is usually a property of
the system. That sentence has to be written for this feature specifically.

---

## R8 — Where it lives

**Decision**: A new **Flow Analysis** tab in Reports Hub, beside Personal Workflow.

Reports Hub already hosts tabbed reports with a shared team filter, and feature 025's fix made that filter scope the
Personal Workflow roster. The same filter scopes this analysis, so the two tabs answer their different questions
about the same team without the user reselecting anything.

**Not a section inside Personal Workflow** (rejected): the spec is explicit that the two coexist and answer different
questions. Nesting one inside the other would imply the flow view is a detail of the person view, which inverts their
relationship — the issue-centric analysis is the broader one.

---

## R9 — Making the reconciliation checkable (FR-003)

**Decision**: Compute stages first, derive every total from them by summation — never in parallel.

FR-003 requires stages to reconcile to lead time in full, and post-start stages to cycle time. The only way that can
fail is if totals are computed independently of the stages they are supposed to sum to.

**So the data flow is one-directional**: reconstruct segments → intersect status × holder into stages → sum stages
into totals. Lead time is the sum of all stages; cycle time is the sum from the first active stage onward; the
pre-work wait is the difference. Each is arithmetic over one list, so the reconciliation cannot drift — and the
document can show the sum beside the total as proof rather than assertion.

---

## Resolved summary

| # | Question | Status |
|---|----------|--------|
| R1 | One shared reconstruction | ✅ **Yes — `buildStateSegments` is already generic**; extract to a shared module |
| R2 | Retaining assignee identity | ✅ A parallel reader; the changelog already carries it |
| R3 | Which issues to fetch | ✅ `assignee WAS in (roster)`; completion filtered in the engine |
| R4 | Paging and ceilings | ✅ Reuse feature 025's fetcher; rename, do not rewrite |
| R5 | Waiting vs active | ✅ Name patterns, stated in output, unclassified when unsure |
| R6 | Time unit | ✅ Working days throughout; tradeoff recorded |
| R7 | Publishing | ✅ Extend the existing document; new wording for the waiting-time notice |
| R8 | Placement | ✅ New Reports Hub tab, sharing the team filter |
| R9 | Reconciliation | ✅ Totals derived from stages by summation, never in parallel |

**No NEEDS CLARIFICATION remain.** R1's answer materially reduces the estimate the spec's checklist carried forward —
the shared core exists and is generic; what is new is one reader, one aggregation, and the presentation.
