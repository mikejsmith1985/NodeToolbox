# Contract: Effort and Windows

**Modules**: `client/src/utils/workingDays.ts`, `views/SprintDashboard/forecast/effortModel.ts`,
`views/SprintDashboard/forecast/forecastWindows.ts`, `views/SprintDashboard/forecast/forecastSettings.ts`

These four are the foundation: every other module in the feature calls into them and none of them calls back.

---

## 1. `utils/workingDays.ts` — relocated, behaviour frozen

**This module must be byte-equivalent in behaviour to the four functions it moves.** `piPlanDates.test.ts` passes
**unmodified** or the move is reverted (plan Drift 1).

```ts
export interface WorkingCalendar { weekendDays: number[]; holidayIsoDates: string[] }

export function isWorkingDay(iso: string, calendar: WorkingCalendar): boolean
export function rollToWorkingDay(iso: string, calendar: WorkingCalendar): string
export function addWorkingDays(iso: string, count: number, calendar: WorkingCalendar): string
export function workingDaysBetween(startIso: string, endIso: string, calendar: WorkingCalendar): number
```

**New sibling** — the backwards direction, which no caller needed until now:

```ts
/** The date `count` working days BEFORE `iso` (count = 0 returns `iso` unchanged). */
export function subtractWorkingDays(iso: string, count: number, calendar: WorkingCalendar): string
```

| Rule | Behaviour |
|---|---|
| Semi-open interval | `workingDaysBetween` counts `(start, end]` — unchanged from today |
| Weekend/holiday landing | `subtractWorkingDays` steps back one calendar day at a time, decrementing only on working days — the exact mirror of `addWorkingDays` |
| Negative `count` | Returns `iso` unchanged, matching `addWorkingDays`'s existing `while (remaining > 0)` guard |

`piPlanDates.ts` re-exports all five so no PI-planner import path changes.

### Tests

| # | Given | Expect |
|---|---|---|
| 1 | Fri 2026-08-21, subtract 1 | Thu 2026-08-20 |
| 2 | Mon 2026-08-24, subtract 1 | Fri 2026-08-21 |
| 3 | Mon 2026-08-24, subtract 5 | Mon 2026-08-17 |
| 4 | Subtract 0 | Same day, unchanged |
| 5 | Holiday 2026-08-20 listed; Fri 2026-08-21 subtract 1 | Wed 2026-08-19 |
| 6 | `addWorkingDays(subtractWorkingDays(d, n), n)` for n = 1..10 from a working day | Returns `d` (round-trip) |

---

## 2. `forecastSettings.ts`

```ts
export interface ForecastConfig {
  pointsPerWorkingDay: number;
  calendar: WorkingCalendar;
  featureSizingTolerancePercent: number;
  todayIso: string;
}

export interface RejectedSetting { name: string; storedValue: string; reason: string }

export interface ForecastConfigResult { config: ForecastConfig; rejectedSettings: RejectedSetting[] }

/** Builds the validated config from ART settings. `todayIso` is injected — never read from the clock. */
export function buildForecastConfig(artSettings: ArtSettingsLike, todayIso: string): ForecastConfigResult
```

`ArtSettingsLike` is a structural subset (`pointsPerWorkingDay`, `holidayIsoDates`,
`featureSizingTolerancePercent`) so the module never imports the store and stays pure.

| Rule | Behaviour |
|---|---|
| `pointsPerWorkingDay <= 0` | Falls back to `1`, **and** appends a `RejectedSetting` (FR-001) |
| `pointsPerWorkingDay` non-finite / NaN | Same |
| `featureSizingTolerancePercent < 0` | Falls back to `0`, appends a `RejectedSetting` |
| A holiday not matching `YYYY-MM-DD` | Dropped, appends a `RejectedSetting` naming the value |
| Everything valid | `rejectedSettings` is `[]` |

**The rule this encodes**: a bad setting is never silently corrected. A surface that prints
`rejectedSettings` tells the operator why the numbers are not what they expected; one that swallows them produces a
forecast nobody can reconcile with the settings screen.

### Tests

| # | Given | Expect |
|---|---|---|
| 1 | Rate `0` | Config rate `1`; one rejection naming `pointsPerWorkingDay` |
| 2 | Rate `-3` | Same |
| 3 | Rate `0.5` | Config rate `0.5`; no rejection |
| 4 | Tolerance `-1` | Config `0`; one rejection |
| 5 | Holidays `['2026-12-25', 'Christmas']` | Calendar holds only `2026-12-25`; one rejection naming `Christmas` |
| 6 | All valid | `rejectedSettings` empty |
| 7 | `weekendDays` | Always `[0, 6]` — not configurable in this feature |

---

## 3. `effortModel.ts`

```ts
export interface RemainingEffort {
  storyPoints: number | null;
  columnCredit: number;
  remainingPoints: number | null;
  remainingWorkingDays: number | null;
  isEstimated: boolean;
  basis: string;
}

/** How much work is LEFT in one issue, given how far its column says it has got. */
export function computeRemainingEffort(
  storyPoints: number | null,
  columnId: string,
  orderedColumnIds: readonly string[],
  isComplete: boolean,
  pointsPerWorkingDay: number,
): RemainingEffort
```

`columnCredit` comes from `readColumnCredit` in `rollupBoard/featureProgress.ts` — **imported, never reimplemented**
(FR-002, plan reuse ledger).

| Rule | Behaviour |
|---|---|
| `isComplete` | `columnCredit = 1`, `remainingPoints = 0`, `remainingWorkingDays = 0` |
| `storyPoints === null` | `remainingPoints` and `remainingWorkingDays` are `null`; `isEstimated = false` |
| `storyPoints === 0` | Treated as estimated at zero: `remainingWorkingDays = 0`. Zero is a measurement; `null` is its absence. |
| Unmapped column | `readColumnCredit` returns `0` — full size remains |
| `orderedColumnIds.length <= 1` | `readColumnCredit` returns `0`; the forecast still works, at full size |
| Rounding | `remainingWorkingDays = max(1, ceil(remainingPoints ÷ rate))` for unfinished estimated work |
| `basis` | Always populated, e.g. `"5 pts, 60% column credit, 2.0 pts left → 2 working days"` |

**Why the floor of 1**: a story 96% through its columns still has a person's day left in it. Rounding to zero makes the
forecast promise free work, and the arithmetic then claims a release fits when it does not.

### Tests

| # | Given | Expect |
|---|---|---|
| 1 | 5 pts, first of 5 columns, rate 1 | credit 0, 5 remaining points, 5 days |
| 2 | 5 pts, third of 5 columns (credit 0.5), rate 1 | 2.5 points, **3** days (ceil) |
| 3 | 5 pts, complete | 0 points, 0 days, credit 1 |
| 4 | `null` pts | `remainingWorkingDays` null, `isEstimated` false |
| 5 | `0` pts | `isEstimated` **true**, 0 days |
| 6 | 8 pts, rate 2 | 4 days |
| 7 | 5 pts, credit 0.96, rate 1 | **1** day, not 0 |
| 8 | Column not in list | credit 0, full size |
| 9 | Empty `orderedColumnIds` | credit 0, full size, no throw |
| 10 | Any input | `basis` non-empty |

---

## 4. `forecastWindows.ts`

```ts
export type ForecastWindowKind = 'to-code-freeze' | 'external-test' | 'deploy-buffer' | 'to-pi-end';

export interface ForecastWindow {
  kind: ForecastWindowKind;
  startIso: string;
  endIso: string;
  workingDayCount: number;
  hasPassed: boolean;
}

export interface ReleaseClock {
  releaseDateIso: string;
  codeFreezeIso: string;
  externalTestStartIso: string;
  externalTestEndIso: string;
  deployBufferStartIso: string;
  toCodeFreeze: ForecastWindow;
  externalTest: ForecastWindow;
  deployBuffer: ForecastWindow;
}

export interface PiClock { piEndIso: string | null; toPiEnd: ForecastWindow | null; isConfigured: boolean }

export function buildReleaseClock(releaseDateIso: string, config: ForecastConfig): ReleaseClock
export function buildPiClock(piEndDate: string, config: ForecastConfig): PiClock
```

### The release calendar

| Boundary | Derivation | Requirement |
|---|---|---|
| `codeFreezeIso` | `releaseDateIso − 21 calendar days` | FR-007 — the same lead the date policy uses |
| `externalTestStartIso` | `codeFreezeIso + 1 calendar day` | FR-008 |
| `externalTestEndIso` | `externalTestStartIso + 13 calendar days` (a 14-day span) | FR-008 |
| `deployBufferStartIso` | `externalTestEndIso + 1 calendar day` | FR-008 |
| `deployBuffer.endIso` | `releaseDateIso` | FR-008 |

21 = 1 + 14 + 6, so the three spans tile the three weeks exactly with no gap and no overlap. **This is an invariant a
test must assert**, because a change to any one boundary would otherwise silently open a hole in the calendar.

### Window rules

| Rule | Behaviour |
|---|---|
| `toCodeFreeze` span | `todayIso` → `codeFreezeIso`, inclusive of both when both are working days |
| `codeFreezeIso < todayIso` | `hasPassed = true`, `workingDayCount = 0` — never negative (FR-007, US2-5) |
| `piEndDate` blank / unparseable | `{ piEndIso: null, toPiEnd: null, isConfigured: false }` (FR / research R-12) |
| Holidays | Excluded from every `workingDayCount` (FR-006) |
| `startIso` after `endIso` | `workingDayCount = 0`, `hasPassed = true` |

### Tests

| # | Given | Expect |
|---|---|---|
| 1 | Release 2026-10-02 | codeFreeze 2026-09-11 |
| 2 | Release 2026-10-02 | externalTest 2026-09-12 → 2026-09-25 |
| 3 | Release 2026-10-02 | deployBuffer 2026-09-26 → 2026-10-02 |
| 4 | Any release date | The three spans tile `codeFreeze+1 … releaseDate` with no gap or overlap |
| 5 | Today 2026-08-20, code freeze 2026-09-11 | `workingDayCount` = 16 working days |
| 6 | Today 2026-09-20, code freeze 2026-09-11 | `hasPassed` true, count 0 |
| 7 | Holiday 2026-09-07 inside the window | Count is one lower than without it |
| 8 | `piEndDate` `''` | `isConfigured` false, `toPiEnd` null |
| 9 | `piEndDate` `'2026-11-06'` | `isConfigured` true, window today → that day |
| 10 | `piEndDate` `'not-a-date'` | `isConfigured` false — never a guess |
