# Phase 1 Data Model: Delivery Forecast

**Feature**: `specs/036-delivery-forecast` | **Date**: 2026-08-20

Every type here is **plain data**. Nothing holds a Jira field id, a promise, or a React node. That is what makes the
engine testable with no Jira and no browser, and what keeps it inside the field-mapping ratchet (research R-1).

Two conventions run throughout, both inherited from the existing codebase:

- **A day is a `YYYY-MM-DD` string**, never a `Date`. `issueDateRules.ts` documents why: Jira returns date fields as
  UTC-midnight datetimes, and converting one to a local day yields the day before for everyone west of Greenwich.
- **`null` means absent and says so**; it is never a stand-in for zero. A `storyPoints` of `null` is "unestimated",
  which is a different fact from an estimate of nought, and the two must never merge.

---

## 1. Configuration

### `ForecastConfig`

The validated settings every computation runs under. Built once by `forecastSettings.ts`, passed everywhere.

| Field | Type | Default | Validation |
|---|---|---|---|
| `pointsPerWorkingDay` | `number` | `1` | must be `> 0` (FR-001) |
| `calendar` | `WorkingCalendar` | `{ weekendDays: [0, 6], holidayIsoDates: [] }` | each holiday a `YYYY-MM-DD` day |
| `featureSizingTolerancePercent` | `number` | `0` | must be `>= 0` |
| `todayIso` | `string` | — | injected, never read from the clock inside the engine |

### `ForecastConfigResult`

Reading settings can fail, and a failure must be visible rather than corrected.

```
{ config: ForecastConfig; rejectedSettings: Array<{ name: string; storedValue: string; reason: string }> }
```

A rejected setting falls back to its default **and** appears in `rejectedSettings`, so the surface can say
"points-per-day was set to 0 and has been ignored" instead of silently forecasting on a guess.

### `WorkingCalendar` *(relocated, unchanged)*

```
{ weekendDays: number[]; holidayIsoDates: string[] }
```

Moves from `views/ArtView/piPlan/piPlanTypes.ts` to `client/src/utils/workingDays.ts` (plan Drift 1). Shape identical.

---

## 2. Effort

### `RemainingEffort`

What is left in one issue, and how that was worked out.

| Field | Type | Meaning |
|---|---|---|
| `storyPoints` | `number \| null` | The estimate as Jira holds it. `null` = unestimated. |
| `columnCredit` | `number` | `0`–`1`, from `readColumnCredit`. `0` for an unmapped column. |
| `remainingPoints` | `number \| null` | `storyPoints × (1 − columnCredit)`, or `null` when unestimated. |
| `remainingWorkingDays` | `number \| null` | `ceil(remainingPoints ÷ pointsPerWorkingDay)`, or `null`. |
| `isEstimated` | `boolean` | `false` drives the unsized reporting of FR-003. |
| `basis` | `string` | Human-readable workings, e.g. `"5 pts, 60% column credit → 2 working days"`. |

**Rules**

- A completed issue (Jira status category `done`) has `columnCredit = 1` and `remainingWorkingDays = 0`.
- `remainingWorkingDays` is **never** `0` for unfinished estimated work; it floors at `1`. A 0.4-point remainder still
  takes somebody a day to close out, and rounding it to zero makes a forecast claim free work.
- `basis` exists for FR-038: every figure must be checkable.

---

## 3. Windows

### `ForecastWindow`

One span on one clock.

| Field | Type | Meaning |
|---|---|---|
| `kind` | `'to-code-freeze' \| 'external-test' \| 'deploy-buffer' \| 'to-pi-end'` | Which span |
| `startIso` | `string` | First day (inclusive) |
| `endIso` | `string` | Last day (inclusive) |
| `workingDayCount` | `number` | Working days in the span, `0` when it has passed |
| `hasPassed` | `boolean` | `true` when `endIso < todayIso` — reported, never computed as negative |

### `ReleaseClock`

The four spans of one release, derived from its release date.

```
{
  releaseDateIso: string;
  codeFreezeIso: string;         // releaseDateIso − 21 calendar days (= Target End)
  externalTestStartIso: string;  // day after code freeze
  externalTestEndIso: string;    // externalTestStartIso + 14 calendar days − 1
  deployBufferStartIso: string;  // day after external test ends
  toCodeFreeze: ForecastWindow;
  externalTest: ForecastWindow;
  deployBuffer: ForecastWindow;
}
```

**Invariant**: `codeFreezeIso` is produced by the same 21-day lead the date policy already uses. It is imported, not
re-derived (research R-2).

### `PiClock`

```
{ piEndIso: string | null; toPiEnd: ForecastWindow | null; isConfigured: boolean }
```

`isConfigured: false` when `ArtSettings.piEndDate` is blank. Every PI verdict then reports **not configured** rather
than falling back to a guess (spec edge case, research R-12).

---

## 4. Release date resolution

### `ReleaseDateResolution`

| Field | Type | Meaning |
|---|---|---|
| `versionName` | `string` | The fix version's name |
| `fieldDateIso` | `string \| null` | From the version's release-date field |
| `nameDateIso` | `string \| null` | Parsed out of the name |
| `resolvedDateIso` | `string \| null` | `fieldDateIso ?? nameDateIso` (FR-031) |
| `source` | `'field' \| 'name' \| 'none'` | Which one was used |
| `hasDisagreement` | `boolean` | Both present and different (FR-033) |
| `hasAmbiguousName` | `boolean` | The name held more than one date-shaped run |
| `isReleased` | `boolean` | Passed through from Jira |

**State transitions**: none — this is a pure resolution, recomputed each run.

---

## 5. Per-issue verdict

### `IssueForecastState`

```
'ahead' | 'on-track' | 'start-today' | 'behind' | 'cannot-fit' | 'unsized' | 'unassignable' | 'unforecastable'
```

| State | Condition |
|---|---|
| `ahead` | Actual progress is further than the forecast predicted for today |
| `on-track` | `latestStartIso > todayIso` |
| `start-today` | `latestStartIso === todayIso` |
| `behind` | `latestStartIso < todayIso` and work has not started |
| `cannot-fit` | `remainingWorkingDays > windowWorkingDayCount` — no start date saves it |
| `unsized` | `isEstimated === false` |
| `unassignable` | No assignee (FR-004) — reported even when the dates are computable |
| `unforecastable` | No deadline on either clock (undated version and unconfigured PI) |

**Precedence** (exactly one state per issue, satisfying SC-002): `unsized` → `unforecastable` → `cannot-fit` →
`unassignable` → `behind` → `start-today` → `ahead` → `on-track`.

`unsized` outranks everything because a size is what every other verdict is computed from; claiming "on track" for
work nobody has measured is the false comfort FR-003 exists to prevent.

### `IssueForecast`

| Field | Type | Meaning |
|---|---|---|
| `issueKey` | `string` | |
| `summary` | `string` | |
| `teamProfileId` | `string \| null` | Which saved team this came from (FR-035) |
| `assigneeDisplayName` | `string \| null` | |
| `assigneeAccountId` | `string \| null` | |
| `effort` | `RemainingEffort` | |
| `releaseDeadlineIso` | `string \| null` | The code-freeze day for its driving version |
| `piDeadlineIso` | `string \| null` | PI end, when configured |
| `drivingDeadlineIso` | `string \| null` | The **earlier** of the two (FR-010) |
| `drivingClock` | `'release' \| 'pi' \| 'none'` | Which one bit |
| `latestStartIso` | `string \| null` | `drivingDeadline − (remainingWorkingDays − 1)` working days |
| `actualStartIso` | `string \| null` | The day it entered `Working`, when known |
| `state` | `IssueForecastState` | |
| `slackWorkingDays` | `number \| null` | Positive = spare, negative = shortfall |
| `storedTargetStartIso` | `string \| null` | What Jira currently holds |
| `hasStoredDateDisagreement` | `boolean` | Stored ≠ computed (FR-015) |
| `reason` | `string` | One sentence a person can act on |

---

## 6. Capacity

### `PersonLoad`

| Field | Type | Meaning |
|---|---|---|
| `personKey` | `string` | Account id where available, display name otherwise |
| `displayName` | `string` | |
| `isOnRoster` | `boolean` | `false` reported explicitly (spec edge case) |
| `inScopeWorkingDays` | `number` | Remaining effort inside the reported scope |
| `totalAssignedWorkingDays` | `number` | All their open work (FR-005) |
| `availableWorkingDays` | `number` | Working days in the window |
| `overCapacityWorkingDays` | `number` | `max(0, inScope − available)` |
| `isOverCapacity` | `boolean` | |
| `unsizedIssueCount` | `number` | Their share of the unsized caveat |

### `CapacityAssessment`

| Field | Type | Meaning |
|---|---|---|
| `window` | `ForecastWindow` | The span assessed |
| `personLoads` | `PersonLoad[]` | Sorted most-over-capacity first |
| `unassignedWorkingDays` | `number` | Effort with no owner (FR-004) |
| `unassignedIssueKeys` | `string[]` | |
| `totalRemainingWorkingDays` | `number` | Including unassigned |
| `totalAvailableWorkingDays` | `number` | Summed across assigned people |
| `shortfallWorkingDays` | `number` | `max(0, remaining − available)` |
| `shouldRemoveScope` | `boolean` | `shortfallWorkingDays > 0` (FR-004 / US2-2) |
| `unsizedIssueCount` | `number` | Printed beside every total (FR-003, SC-012) |
| `undatedIssueCount` | `number` | Same, for FR-034 |

The same type serves the **code-freeze** window (dev capacity) and the **external-test** window (test capacity),
filtered to testers. One shape, two populations — so US2 and US3 cannot disagree about what "over capacity" means.

---

## 7. INT readiness and the DEV→SL chain

### `IntReadyState`

```
'int-ready' | 'not-int-ready' | 'cancelled' | 'unknown-sub-status'
```

`unknown-sub-status` is returned when the instance has no sub-status field configured. It reports **not checked**
rather than guessing — the honest-states rule this codebase already applies to hygiene families.

### `ChainRole`

```
'dev' | 'sl' | 'unclassified'
```

Resolved by: `[SL]`/`[DEV]` summary prefix (primary) → assignee `roleCapabilities.canInternalTest` (secondary) →
`unclassified`, scheduled as dev (FR-022, FR-023).

### `FeatureDodAssessment`

| Field | Type | Meaning |
|---|---|---|
| `featureKey` | `string` | |
| `intReadyState` | `IntReadyState` | For the Feature as a whole |
| `blockingIssueKeys` | `string[]` | The children not yet INT-ready (FR-017, SC-007) |
| `cancelledIssueKeys` | `string[]` | Counted and named, never dropped (FR-020) |
| `devCompleteIso` | `string \| null` | When the last `[DEV]` story reaches Internal Test Ready |
| `slStartIso` | `string \| null` | The working day after `devCompleteIso` (FR-024) |
| `slWorkingDays` | `number \| null` | Summed across every SL story (FR-025) |
| `dodDateIso` | `string \| null` | When the Feature can reach Integration Test |
| `hasNoSlStory` | `boolean` | Reported, not treated as zero (FR-026) |
| `unclassifiedIssueKeys` | `string[]` | FR-023 |
| `piVerdict` | `'meets' \| 'at-risk' \| 'not-configured'` | Against `PiClock` |
| `riskCause` | `'dev-too-large' \| 'test-squeeze' \| null` | FR-027, SC-008 |
| `shortfallWorkingDays` | `number \| null` | |

**`riskCause` decision rule** — the distinction SC-008 demands:

| Condition | `riskCause` |
|---|---|
| `devCompleteIso > piEndIso` | `dev-too-large` |
| `devCompleteIso <= piEndIso` **and** `dodDateIso > piEndIso` | `test-squeeze` |
| `dodDateIso <= piEndIso` | `null` |

Dev is checked first: when dev alone already overruns, the test window was never the binding constraint.

---

## 8. Feature sizing

### `FeatureSizingFlag`

| Field | Type | Meaning |
|---|---|---|
| `featureKey` | `string` | |
| `featurePoints` | `number \| null` | `null` ⇒ `state: 'not-sized'` |
| `childrenPoints` | `number` | Stories + defects + tasks; **sub-tasks excluded** (FR-029) |
| `overagePoints` | `number` | `max(0, children − feature)` |
| `overagePercent` | `number` | `overagePoints ÷ featurePoints × 100` |
| `state` | `'within' \| 'over' \| 'not-sized'` | |
| `unsizedChildCount` | `number` | The caveat on `childrenPoints` |

---

## 9. The single result

### `ForecastResult`

What `computeForecast` returns, and the **only** thing any surface reads (FR-043).

```
{
  config: ForecastConfig;
  rejectedSettings: Array<{ name: string; storedValue: string; reason: string }>;
  piClock: PiClock;
  releaseClocksByVersionName: Record<string, ReleaseClock>;
  releaseDateResolutions: ReleaseDateResolution[];
  issueForecasts: IssueForecast[];
  featureAssessments: FeatureDodAssessment[];
  sizingFlags: FeatureSizingFlag[];
  codeFreezeCapacityByVersionName: Record<string, CapacityAssessment>;
  externalTestCapacityByVersionName: Record<string, CapacityAssessment>;
  completeness: ForecastCompleteness;
}
```

### `ForecastCompleteness`

The honesty record, printed beside every total (SC-012).

```
{
  totalIssueCount: number;
  unsizedIssueCount: number;
  unassignedIssueCount: number;
  undatedVersionCount: number;
  cancelledIssueCount: number;
  hasSubStatusField: boolean;
  hasBoardVocabulary: boolean;   // false ⇒ column credit is 0 for everything, and it says so
}
```

---

## 10. Entity relationships

```
ForecastConfig ──────────────┐
                             ▼
RollupBoardItem[] ──▶ RemainingEffort ──▶ IssueForecast ──▶ CapacityAssessment
       │                                        ▲                    ▲
       │                                        │                    │
       ├──▶ ReleaseDateResolution ──▶ ReleaseClock ────────────────┘
       │                                        │
       ├──▶ IntReadyState ──▶ FeatureDodAssessment ◀── PiClock
       │                            ▲
       │                            └── ChainRole (dev / sl / unclassified)
       │
       └──▶ FeatureSizingFlag
```

Every arrow is a pure function. There is no cycle, no shared mutable state, and no path from a surface back into the
engine — which is why two surfaces showing one figure cannot disagree (SC-010).

---

## 11. Additions to existing types

Three shipped types gain **optional** members. Optional is load-bearing: omitted, every current caller and every
current test behaves exactly as it does today.

| Type | File | Addition |
|---|---|---|
| `IssueDateInput` | `Hygiene/checks/issueDateRules.ts` | `remainingEffortWorkingDays?: number \| null`; `piDodDeadlineIso?: string \| null`; `workingCalendar?: WorkingCalendar` |
| `DerivedIssueDates` | same | `targetStartBasis?: 'actual-working' \| 'back-calculated' \| 'ready-to-work-lead' \| 'none'` |
| `ArtSettings` | `services/artSettingsStore.ts` | `pointsPerWorkingDay: number`; `holidayIsoDates: string[]`; `featureSizingTolerancePercent: number` |
| `ChildCardProps` | `rollupBoard/components/ChildCard.tsx` | `forecast?: IssueForecast \| null` |
| `buildLaneVitalTiles` | `rollupBoard/laneVitals.ts` | optional 3rd parameter `forecast?: FeatureDodAssessment \| null` |

`ArtSettings` members are **required with defaults** rather than optional, matching the store's existing style — every
member there is required, and `readArtSettings` supplies the default. That is the pattern the module was built on.
