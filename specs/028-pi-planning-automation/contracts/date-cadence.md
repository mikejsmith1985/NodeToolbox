# Contract: Working-Day & Deploy-Cadence Date Engine (`piPlanDates.ts`)

The one genuinely new pure module. Maps a `ScheduledStory` to its five dates, each with a derivation. All arithmetic in working days; clock + calendar injected.

## Types

```ts
interface WorkingCalendar {
  weekendDays: number[];        // e.g. [0,6] (Sun,Sat)
  holidayIsoDates: string[];    // org holidays, honoured where known (may be empty)
}
```

## Signatures

```ts
computeItemDates(story: ScheduledStory, ctx: DateContext): DatedItem
```

`DateContext`: `{ calendar: WorkingCalendar; piStartIso: string; piEndIso: string; releaseSchedule: ReleaseSchedule; todayIso: string }`.

Helper primitives (also exported + unit-tested):
- `addWorkingDays(iso, n, cal): string`
- `rollToWorkingDay(iso, cal): string` — next working day if the date is a weekend/holiday.
- `workingDaysBetween(startIso, endIso, cal): number`.

## Date rules (FR-030–FR-038)

| Date | Rule |
|------|------|
| `targetStartIso` | First working day of the Story's scheduled work (from its `ProjectedSprint.startIso`, respecting dependency ordering), rolled to a working day. |
| `internalTestEndIso` | Start + workingDays(devPoints ÷ rate) + workingDays(internalTestPoints ÷ rate). Null when `hasTestableOutput=false`. **Gates external-test start.** |
| `targetEndIso` = `deployIntIso` | `rollToWorkingDay(internalTestEndIso + 1 calendar day)` — code in INT ≤ 24h after internal-test complete. This is the **PI DoD**; MUST be ≤ `piEndIso`. |
| `deployRelIso` | `addWorkingDays(deployIntIso, 5, cal)` — five **working** days after INT. |
| `deployProdIso` | First `ReleaseEntry.releaseDateIso` on/after `deployRelIso` (existing fixVersion, else a `isSuggested` monthly release). MAY be after `piEndIso`. |
| `dueIso` | = `deployProdIso`. |

`rate` = points-per-working-day from the team's per-sprint velocity (`pointsPerSprint ÷ workingDaysPerSprint`) — the Q1 velocity basis, passed in via `ScheduledStory`/`ctx`.

## Guarantees

- Every returned date is a working day (FR-038).
- `targetEndIso ≤ piEndIso` always; if the schedule pushes INT past the PI end, the item surfaces a `warning` rather than silently producing an out-of-PI DoD (spec Edge Cases).
- `derivations[date]` states the rule and the inputs (e.g. `"REL = INT(2026-08-04) + 5 working days"`) for SC-005.
- No `Date.now()`; `todayIso` injected.

## Test obligations (TDD, vitest)

- `addWorkingDays` skips weekends and listed holidays; boundary at Fri→Mon.
- REL lands exactly 5 working days after INT across a weekend and across a holiday.
- INT rolls off a Saturday internal-test-end to Monday and stays ≤ 24h-equivalent (next working day).
- PROD selects the correct next release; when none exists, a suggested monthly release is used and flagged.
- A Story whose INT would fall after PI end produces a warning and keeps `targetEndIso ≤ piEndIso` semantics per spec.
- Determinism: identical inputs ⇒ identical `DatedItem`.
