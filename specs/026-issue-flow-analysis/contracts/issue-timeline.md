# Contract: Shared Issue Timeline

**Module**: `client/src/views/ReportsHub/issueTimeline.ts` (new — **extracted from** `personalFlow.ts`)
**Feature**: `026-issue-flow-analysis` | **Satisfies**: NFR-001

> **The highest-risk contract in the feature, and the only one that touches shipped code.** Everything else is new
> and can only break itself. This one modifies a report people already rely on.

---

## Why extract rather than duplicate

NFR-001 requires a person's hands-on time for an issue to be **identical** in both analyses. Two independent
reconstructions of the same issue history would agree at first and drift the moment either was touched — and the
drift would be invisible, because nothing compares them.

Extraction makes agreement structural: there is one definition of a span, one origin rule, one working-time
calculation, and both analyses consume it.

**This is possible because `buildStateSegments` is already generic** (research R1). It reconstructs "value X held
from t1 to t2" for any value type. The person-centric engine instantiates it with `boolean`; this feature
instantiates it with an assignee identity. No new reconstruction logic is required — only a new caller.

---

## Exports

```ts
/** One contiguous period over which a reconstructed timeline held a single value. */
export interface StateSegment<TValue> {
  startMs: number;
  endMs: number;
  value: TValue;
}

/** Reconstructs a timeline from an initial value plus dated changes. */
export function buildStateSegments<TValue>(
  originMs: number,
  initialValue: TValue,
  changePoints: Array<{ atMs: number; value: TValue }>,
  todayMs: number,
): StateSegment<TValue>[];

/** The anchor both timelines start from: creation, else earliest transition, else today. */
export function resolveTimelineOriginMs(createdIso: string | null, transitionIsos: readonly string[], todayMs: number): number;

/** Monday–Friday milliseconds between two instants. Already exported today; moves here. */
export function businessMillisBetween(startMs: number, endMs: number): number;

/** Milliseconds in one calendar day — the shared conversion for every duration. */
export const MILLISECONDS_PER_DAY: number;
```

---

## Guarantees

| # | Guarantee |
|---|---|
| T1 | Segments are ordered, contiguous, non-overlapping, and cover origin → today |
| T2 | Zero-length segments are dropped; a change to the same value does not split a span |
| T3 | Change points before the origin are clamped to it, never silently discarded |
| T4 | Working time counts Monday–Friday only, and never returns a negative |
| T5 | Every function is pure — no clock read, no I/O. `todayMs` is always injected |

**T5 is what makes the whole feature testable.** The existing engine's determinism comes from injecting `todayIso`;
that property must survive the extraction unchanged.

---

## Acceptance: the existing tests, unmodified

This contract has an unusual acceptance criterion, and it is the important one:

> **`client/src/views/ReportsHub/personalFlow.test.ts` must pass with ZERO modifications.**

Those 35 tests cover the behaviour being moved. If any of them needs adjusting to go green, the extraction has
**changed behaviour** — and the correct response is to revert and redo it, never to edit the test to match. A test
edited to fit a refactor is a silent regression with documentation.

**Additional tests** in `issueTimeline.test.ts` cover the extracted units directly, since they are now a public
surface rather than internals:

- `buildStateSegments` with a `boolean` value type reproduces the ownership behaviour the engine relies on.
- The same function with an **object** value type (an assignee identity) produces the same span structure — proving
  the genericity this feature depends on.
- Change points at, before, and after the origin (T3).
- Consecutive identical values merge rather than splitting (T2).
- A weekend-only span credits zero working days but is still a span (T4).
- Two calls with identical input produce identical output (T5).

---

## What must NOT change

- **The origin rule.** `resolveTimelineOriginMs` keeps the existing precedence — creation, else earliest transition,
  else today. Changing it would move every existing figure.
- **The working-day definition.** Monday–Friday, no holiday calendar. A holiday calendar would be a defensible
  improvement and an undefensible thing to introduce inside a refactor.
- **Function behaviour at boundaries.** Same clamping, same zero-length handling, same treatment of an open final
  segment.

Any of these is a legitimate future change. None of them belongs in the same commit as an extraction, because the
extraction's whole safety argument is that nothing changed.
