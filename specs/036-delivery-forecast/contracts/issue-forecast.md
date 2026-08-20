# Contract: Per-Issue Forecast, and the Target Start revision

**Modules**: `views/SprintDashboard/forecast/issueForecast.ts`,
`views/Hygiene/checks/issueDateRules.ts` (extended), `views/Hygiene/derivedDateFix.ts` (extended)

This is the contract behind the sentence the whole feature exists to produce: *"if these issues don't start today we
will be behind."*

---

## 1. `issueForecast.ts`

```ts
export type IssueForecastState =
  | 'ahead' | 'on-track' | 'start-today' | 'behind'
  | 'cannot-fit' | 'unsized' | 'unassignable' | 'unforecastable';

export interface IssueForecastInput {
  issueKey: string;
  summary: string;
  teamProfileId: string | null;
  assigneeAccountId: string | null;
  assigneeDisplayName: string | null;
  effort: RemainingEffort;
  releaseDeadlineIso: string | null;   // the code-freeze day of its driving fix version
  piDeadlineIso: string | null;        // PI end, or null when unconfigured
  actualStartIso: string | null;       // the day it entered Working, when known
  storedTargetStartIso: string | null;
  isComplete: boolean;
}

export function computeIssueForecast(input: IssueForecastInput, config: ForecastConfig): IssueForecast
export function computeIssueForecasts(inputs: readonly IssueForecastInput[], config: ForecastConfig): IssueForecast[]
```

### Driving deadline (FR-010)

```
drivingDeadlineIso = the EARLIER of releaseDeadlineIso and piDeadlineIso, ignoring nulls
drivingClock       = 'release' | 'pi' | 'none'
```

Both null ⇒ `drivingClock = 'none'` and the state is `unforecastable`. A tie resolves to `'release'`, because that is
the clock the team operates on day to day.

### Latest start (FR-009)

```
latestStartIso = subtractWorkingDays(drivingDeadlineIso, remainingWorkingDays - 1)
```

The `− 1` makes the span **inclusive of its own start day**: work needing exactly one day and due today starts today,
not yesterday. This mirrors `piPlanDates.spanEnd`, which the codebase already uses in the forward direction.

### State precedence — exactly one state per issue (SC-002)

| Order | State | Condition |
|---|---|---|
| 1 | `unsized` | `effort.isEstimated === false` |
| 2 | `unforecastable` | `drivingClock === 'none'` |
| 3 | `cannot-fit` | `remainingWorkingDays > workingDaysBetween(todayIso, drivingDeadlineIso)` |
| 4 | `unassignable` | `assigneeAccountId === null && assigneeDisplayName === null` |
| 5 | `behind` | `latestStartIso < todayIso` and `actualStartIso === null` |
| 6 | `start-today` | `latestStartIso === todayIso` |
| 7 | `ahead` | `actualStartIso !== null && actualStartIso < latestStartIso` |
| 8 | `on-track` | everything else |

**Why `unsized` first**: every other verdict is computed *from* a size. Reporting "on track" for work nobody measured
is the false comfort FR-003 exists to prevent.

**Why `cannot-fit` outranks `behind`**: they demand different actions. `behind` says start it now; `cannot-fit` says
starting it now will not help — split it, or cut it.

**Why a started issue is never `behind`**: `behind` means *not started and out of runway*. A started issue that is
running long surfaces through `slackWorkingDays` and, at the Feature level, through `at-risk`.

### Slack

```
slackWorkingDays = workingDaysBetween(todayIso, latestStartIso)   // positive = spare, negative = shortfall
```

`null` when `latestStartIso` is null.

### Stored-date disagreement (FR-015)

`hasStoredDateDisagreement = storedTargetStartIso !== null && storedTargetStartIso !== latestStartIso`

Reported, never auto-corrected. Correction is the operator's explicit action through the date fix.

### Reason (FR-038, SC-007)

Always populated, always naming the arithmetic:

| State | Example |
|---|---|
| `behind` | `"3 days of work left, 1 working day to code freeze (2026-09-11) — should have started 2026-08-18"` |
| `start-today` | `"2 days of work left, due at PI end 2026-11-06 — last day to start"` |
| `cannot-fit` | `"8 days of work left, 5 working days remain — cannot fit regardless of start date"` |
| `unsized` | `"No estimate — cannot forecast"` |
| `ahead` | `"Started 2026-08-11, 4 working days ahead of the latest start"` |

### Tests

| # | Given | Expect |
|---|---|---|
| 1 | 5 pts unstarted, 4 working days to freeze, rate 1 | `behind`, slack −1 |
| 2 | 3 pts unstarted, exactly 3 working days to freeze | `start-today`, slack 0 |
| 3 | 3 pts, 10 working days to freeze | `on-track`, slack positive |
| 4 | 5 pts, credit 0.6 → 2 days, 4 days left | `on-track` (credit applied — US1-4) |
| 5 | Started 2026-08-11, latest start 2026-08-15 | `ahead` |
| 6 | `storyPoints` null | `unsized` regardless of dates |
| 7 | No assignee, dates fine | `unassignable` |
| 8 | 8 days work, 5 days window | `cannot-fit`, not `behind` |
| 9 | Release deadline 2026-09-11, PI end 2026-11-06 | `drivingClock = 'release'` |
| 10 | Release deadline 2026-12-01, PI end 2026-11-06 | `drivingClock = 'pi'` |
| 11 | Both null | `unforecastable` |
| 12 | Both equal | `drivingClock = 'release'` |
| 13 | Weekend between today and the deadline | Excluded from the working-day count |
| 14 | Holiday between today and the deadline | Excluded |
| 15 | Stored Target Start ≠ computed | `hasStoredDateDisagreement` true, value not changed |
| 16 | Every state | `reason` non-empty |
| 17 | Two teams' inputs in one call | Each result keeps its own `teamProfileId` |
| 18 | Started but running long | Never `behind`; slack goes negative |

---

## 2. `issueDateRules.ts` — the Target Start revision (Drift 2)

**Additive only.** Every new input is optional; absent, the output is today's output, and `issueDateRules.test.ts`
passes **unmodified** with new cases appended.

```ts
export interface IssueDateInput {
  // ... every existing member unchanged ...
  /** Remaining effort in working days — enables the back-calculated Target Start. */
  remainingEffortWorkingDays?: number | null;
  /** The PI Definition-of-Done deadline, when configured. */
  piDodDeadlineIso?: string | null;
  /** Weekend/holiday calendar; required for back-calculation, ignored otherwise. */
  workingCalendar?: WorkingCalendar;
}

export interface DerivedIssueDates {
  // ... every existing member unchanged ...
  /** Which rule produced targetStart, so a reader can check it. */
  targetStartBasis?: 'actual-working' | 'back-calculated' | 'ready-to-work-lead' | 'none';
}
```

### Revised precedence (FR-009, FR-010, FR-011)

| # | Rule | Basis | Requirement |
|---|---|---|---|
| 1 | The day it entered `Working` | `actual-working` | FR-011 — a fact beats a prediction |
| 2 | `subtractWorkingDays(min(targetEnd, piDodDeadline), days − 1)` | `back-calculated` | FR-009, FR-010 |
| 3 | `readyToWorkDay + 3` calendar days | `ready-to-work-lead` | unchanged fallback |
| 4 | `null` + `undecidedReasons` | `none` | unchanged |

Rule 2 applies only when **all three** of `remainingEffortWorkingDays`, `workingCalendar` and at least one deadline
are supplied. Any missing ⇒ fall through to rule 3, exactly as today.

**Note on the deadline used**: `targetEnd` here is the derived Target End — i.e. the code-freeze date — not the raw
release date. That is the point of FR-007: code freeze and Target End are one date, computed once.

### Tests (appended, never edited)

| # | Given | Expect |
|---|---|---|
| 1 | No new inputs supplied | Byte-identical to today's output; basis `ready-to-work-lead` or `none` |
| 2 | Working entered + effort supplied | Working day wins; basis `actual-working` |
| 3 | Effort 3 days, target end 2026-09-11, no Working entry | Target Start 2026-09-09; basis `back-calculated` |
| 4 | Effort supplied, PI deadline earlier than target end | PI deadline drives |
| 5 | Effort supplied, target end earlier than PI deadline | Target end drives |
| 6 | Effort supplied but no calendar | Falls through to rule 3 |
| 7 | Effort `null` | Falls through to rule 3 |
| 8 | Neither Working nor Ready to Work, effort supplied | Still back-calculates — a gap today's rule cannot fill |
| 9 | Back-calculated date lands on a weekend | Rolled by the working-day arithmetic |
| 10 | Every path | `mismatchedFieldNames` continues to name only fields a fix would change |

---

## 3. `derivedDateFix.ts` — passing it through

```ts
export interface DerivedDateContext {
  remainingEffortWorkingDaysByKey?: Record<string, number | null>;
  piDodDeadlineIso?: string | null;
  workingCalendar?: WorkingCalendar;
}

export async function planDerivedDateWrites(
  issue: JiraIssue,
  fieldConfig: HygieneFieldConfig,
  context?: DerivedDateContext,      // NEW, optional
): Promise<DerivedDatePlan>

export async function applyDerivedDates(
  issues: readonly JiraIssue[],
  fieldConfig: HygieneFieldConfig,
  context?: DerivedDateContext,      // NEW, optional
): Promise<DerivedDateOutcome>
```

| Rule | Behaviour |
|---|---|
| `context` omitted | Identical behaviour to today — every existing caller (Hygiene, Feature Review) unchanged |
| `context` supplied | Effort looked up by issue key; a key absent from the map is `null`, which falls through to rule 3 |
| Write plan | Unchanged shape; `DerivedDateWrite.fieldName` still `'Target Start'` |
| Reporting | The plan states the basis, so a bulk fix can say *"12 Target Starts back-calculated from effort, 4 from Ready to Work"* (FR-012) |
| Changelog | Still **one** request per issue for both status entries — no extra cost |

### Tests

| # | Given | Expect |
|---|---|---|
| 1 | No context | Existing tests pass unmodified |
| 2 | Context with effort for the issue | Back-calculated Target Start in the write plan |
| 3 | Context missing that issue's key | Falls back to the Ready-to-Work rule; no throw |
| 4 | Changelog fetch fails | Existing catch still yields `{ null, null }`; back-calculation still works |
| 5 | Mixed batch | Per-issue basis reported; `updatedIssueKeys` and `undecided` still disjoint |
