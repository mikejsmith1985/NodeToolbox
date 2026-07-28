# Contract — Bottleneck Detection (`piPlanBottlenecks.ts`)

Deterministic. The engine flags bottlenecks with hard figures; the AI may only attach a mitigation to a flagged one.

## Function

```ts
detectBottlenecks(planResult: PlanResult, factSheet: PiPlanningFactSheet,
  scheduledStories: ScheduledStory[]): Bottleneck[]
```

Pure. No AI. Returns a stable, ordered list; each `Bottleneck.id` is deterministic so an AI mitigation can reference it.

## What it flags

| Kind | Source (mostly reuse) | Figures |
|------|------------------------|---------|
| `slTestThroughput` | `PlanResult.bottleneck` (`limitingRole==='internalTest'`) + per-sprint SL loads vs SL capacity | `{ devPoints, slCapacity, additionalTesters }` per affected sprint |
| `keyPerson` | roster: a repo only **one** member is capable of | `{ capableCount: 1 }`, `subjectKey = repo` |
| `dependencyOrder` | a Story's `dependencyKeys` scheduled **after** the dependent Story | `{ }`, `subjectKey = story` |
| `prodCarry` | a Story whose PROD/Due date falls **after** the PI end (`dueIso > piEndIso`) | `{ }`, `subjectKey = story` |

- `slTestThroughput` is the **primary** constraint (the named pain) and reuses the planner's already-computed
  `BottleneckReport` — never recomputed from scratch (agree-by-construction with the schedule).
- Over-commitment (`sprintsBeyondPiEnd > 0`) and unschedulable items remain surfaced through the engine's honest
  states, not duplicated here.

## AI-mitigation attachment (FR-026)

- The AI narrative supplies `{ bottleneckId, mitigation }` items. On ingest, a mitigation is attached **only** when
  `bottleneckId` matches an existing `Bottleneck.id`; an unmatched mitigation is **rejected** (never shown as advising
  a real bottleneck).
- Mitigations are advisory text (e.g. "add dev unit-testing to cut SL load", "time-box SL test to N pts/sprint",
  "ensure a minimum SL touch on every issue"); they change **no** engine number.

## Test obligations (vitest, TDD)

- A sprint where dev-completed points exceed SL capacity → one `slTestThroughput` bottleneck with the figures — SC-007.
- A repo with exactly one capable roster member → a `keyPerson` bottleneck for that repo.
- A Story with a dependency scheduled later than itself → a `dependencyOrder` bottleneck.
- A Story whose Due > PI end → a `prodCarry` bottleneck.
- A mitigation with an unknown `bottleneckId` is rejected; a matching one attaches.
