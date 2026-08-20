# Contract: Surface Wiring

**Files touched**: `MyIssues/Today/*`, `SprintDashboard/rollupBoard/*`, `SprintDashboard/SprintDashboardView.tsx`,
`SprintDashboard/hooks/useSprintData.ts`, `Hygiene/hooks/hygieneScan.ts`, `services/artSettingsStore.ts`

The engine is safe by construction — it is pure and new. **This contract is where the risk is**, because it edits
shipped files, two of them very large. Every edit below is additive, and each names the guard that proves it.

---

## 0. The composition root

```ts
export interface ForecastInput {
  items: readonly RollupBoardItem[];
  masterCards: readonly MasterCard[];
  orderedColumnIds: readonly string[];
  fixVersions: readonly FixVersionLike[];
  people: readonly CapacityPerson[];
  piEndDate: string;
  hasSubStatusField: boolean;
  teamProfileId: string | null;
}

/** The ONE entry point. Every surface calls this and renders a slice of the result. */
export function computeForecast(input: ForecastInput, config: ForecastConfig): ForecastResult
```

**FR-043 / SC-010 are satisfied structurally**: there is exactly one function to call, so no surface can derive its own
verdict. A surface that wanted a different number would have to import a private module — and there are none.

`computeForecast` is pure: no fetch, no storage, no clock. It is the largest unit test in the feature and the cheapest.

---

## 1. `services/artSettingsStore.ts` — three settings

```ts
export interface ArtSettings {
  // ... existing members unchanged ...
  pointsPerWorkingDay: number;          // default 1
  holidayIsoDates: string[];            // default []
  featureSizingTolerancePercent: number; // default 0
}
```

| Rule | Behaviour |
|---|---|
| Style | Required members with defaults, matching every existing member of this store |
| Defaulting policy | Shipped defaults — these are things "this machine has not been told", not things a guess would corrupt (the store's own stated split) |
| `DEFAULT_ART_SETTINGS` | Gains all three |
| `readArtSettings` | Reads each through the store's existing coercion helpers |
| **`SharedArtWorkspaceSettingsRecord`** | **NOT touched** — see below |

> **Why nothing goes in the shared workspace.** Spec 034 recorded that bumping the workspace schema makes
> `loadSharedArtWorkspace` **hard-reject the whole workspace** on older clients (`confluenceApi.ts:375`). No
> requirement asks for these to be shared. Keeping them local costs nothing and avoids the failure entirely.

**Guard**: `artSettingsStore.test.ts` passes unmodified, with new cases appended.

**UI**: three inputs in the Admin Hub ART settings section, using that panel's existing class vocabulary
(`panelCard`, `fieldLabel`, `inputField`, `panelStatusLine`) — the standing UI-styling rule. Holidays entered as a
comma- or newline-separated list of `YYYY-MM-DD` days; rejected entries reported in `panelStatusLine`, never dropped
silently.

---

## 2. `Hygiene/hooks/hygieneScan.ts` — one line

```diff
     ...fieldConfig.targetStartFieldIds,
     ...fieldConfig.targetEndFieldIds,
+    ...fieldConfig.subStatusFieldIds,
   ]);
```

`loadHygieneFieldConfig` **already discovers** `subStatusFieldIds` by name; it is simply never requested. Without it,
Today cannot evaluate INT-ready (research R-5).

| Risk | Mitigation |
|---|---|
| Larger response per issue | One field; the scan already requests ~20 |
| Field absent on an instance | Jira ignores an unknown field id in `fields=` — the existing behaviour for every optional family here |
| Changes a hygiene count | It cannot — no hygiene check reads sub-status |

**Guard**: `hygieneScan.test.ts` passes unmodified.

---

## 3. Today tab

### `hooks/useTodayDashboard.ts`

```ts
export interface TodayDashboardData {
  // ... existing members unchanged ...
  /** The daily forecast across every saved Dashboard Team profile. Null until the first scan lands. */
  forecast: ForecastResult | null;
}
```

| Rule | Behaviour | Requirement |
|---|---|---|
| Scope | Every saved Dashboard Team profile, from the **existing** `teamScanTargets` loop | FR-035 |
| Extra fetches | **Zero.** The forecast is computed over issues the team scan already returned | Performance |
| Column order | `loadTeamVocabulary(teamProfileId)` per team; a team with no saved vocabulary yields zero credit, and `completeness.hasBoardVocabulary` says so | FR-002, SC-012 |
| Attribution | Each `IssueForecast.teamProfileId` set from the scan target it came from | FR-035 |
| Clock | `todayIso` computed once in the hook and injected — never inside the engine | Determinism |

**Guard**: every existing `useTodayDashboard.test.ts` and `TodayDashboard.test.tsx` assertion passes unmodified. The
new field is additive; the nine category cards are untouched.

### `ForecastSection.tsx`

| Rule | Behaviour | Requirement |
|---|---|---|
| Placement | Beneath the category cards, above `SprintFlowSnapshot` | US1 |
| Grouping | `behind` / `start-today` first, then `cannot-fit`, then `ahead`, then `on-track`; `unsized`, `unassignable` and `unforecastable` in their own explicitly-labelled groups | US1-7, SC-002 |
| Per row | Issue key (deep link), summary, team, assignee, latest start, slack, reason | FR-038 |
| Team label | Shown on every row when more than one profile is saved | FR-035 |
| Completeness line | Always rendered: "N unsized · N unassigned · N undated" | SC-012 |
| Styling | `TodayDashboard.module.css` vocabulary; new classes only where none fits | Standing UI rule |
| Empty | "Nothing must start today" — never a blank panel | Honest states |

---

## 4. Roll-Up Board

### `laneVitals.ts` — optional third parameter

```ts
export function buildLaneVitalTiles(
  vitals: MasterCardVitals,
  counts: LaneItemCounts,
  forecast?: FeatureDodAssessment | null,   // NEW, optional
): LaneVitalTile[]
```

Appends two tiles **after** the existing five, in the order the questions are asked:

| Tile id | Label | Value | Tone |
|---|---|---|---|
| `pi-dod` | `PI DoD` | `Ready` / `At risk` / `Not configured` / `Not checked` | `alert` when at risk, `missing` when not configured or not checked |
| `dod-date` | `INT BY` | The `dodDateIso` day, or `—` | `alert` when after PI end |

| Rule | Requirement |
|---|---|
| `forecast` omitted ⇒ the existing five tiles, byte-identical | Existing tests unmodified |
| Release verdict and PI verdict rendered as **separate** tiles, never merged | FR-014, US4-4, SC-005 |
| Colour never the only cue — text always states the verdict | Standing accessibility rule |

**Guard**: `laneVitals.test.ts` passes unmodified.

### `components/ChildCard.tsx` — optional prop

```ts
export interface ChildCardProps {
  // ... existing members unchanged ...
  /** This issue's forecast verdict, shown as a badge. Absent ⇒ the card is exactly as it is today. */
  forecast?: IssueForecast | null;
}
```

| State | Badge | Tone |
|---|---|---|
| `behind` | `BEHIND` | alert |
| `start-today` | `START TODAY` | alert |
| `cannot-fit` | `WON'T FIT` | alert |
| `ahead` | `AHEAD` | positive |
| `unsized` | `UNSIZED` | missing |
| `unassignable` | `NO OWNER` | missing |
| `on-track` / `unforecastable` | no badge | — |

`on-track` draws nothing: a badge on every card is a badge on none, and the board's value is that the exceptions
stand out.

**Guard**: `ChildCard.test.tsx` passes unmodified — the prop is optional and defaults to no badge. This follows the
017/022 optional-prop precedent exactly.

### `RollupBoardTab.tsx` — compute once, pass down

| Rule | Behaviour |
|---|---|
| One `useMemo` calls `computeForecast` over the already-fetched issue set | FR-043 |
| Zero additional Jira requests | The board already holds points, fixVersions, assignee, column, sub-status |
| The result is passed to `MasterCardLane` (tiles) and `ChildCard` (badges) | — |
| **No refactor.** No function moved, renamed, or extracted | Plan constraint |

**Guard**: every existing `RollupBoardTab` test passes unmodified.

### `defaultBoardColumns.ts`

```diff
   ['Code Review', 'Working', 'Code Review'],
+  ['Internal Test Ready', 'Ready for Testing', null],
   ['SL Testing', 'Ready for Testing', 'Testing'],
```

| Rule | Requirement |
|---|---|
| Affects **fresh installs only** — a team with a saved vocabulary never re-consults this file | FR-021, research R-7 |
| The operator adds it to their own vocabulary through `ColumnVocabularyEditor` | FR-021 |
| The chain logic must **not** depend on the column existing | FR-024, research R-7 |
| Column ids shift for fresh installs (`col-6` onwards) | Ids are positional and generated; no saved vocabulary references them |

**Guard**: `defaultBoardColumns.test.ts` updated to expect twelve columns — this is the **one** existing test in the
feature that legitimately changes, because the shipped default genuinely gained a column.

---

## 5. Forecast tab

### `useSprintData.ts`

```diff
 export type DashboardTab =
-  | ... | 'rollupboard' | 'releases' | 'settings';
+  | ... | 'rollupboard' | 'forecast' | 'releases' | 'settings';
```

### `SprintDashboardView.tsx` — two additions, nothing else

```diff
   { key: 'rollupboard', label: 'Roll-Up Board' },
+  { key: 'forecast', label: 'Forecast' },
   { key: 'releases', label: 'Releases' },
```

plus one mount beside the existing `RollupBoardTab` mount.

| Rule | Requirement |
|---|---|
| `ForecastTab` is its **own file**, mounted like `RollupBoardTab` — never an inline function in this file | Plan constraint |
| `ReleasesTab` (inline, line ~5608) is **not** touched | Plan constraint |
| No other line of this 6,800-line file changes | Plan constraint |

### `forecast/ForecastTab.tsx`

| Section | Content | Requirement |
|---|---|---|
| Version picker | `<select>` from `fetchPiWindowFixVersions(projectKey)` — Jira's own list | Standing "pick, don't type" rule |
| Release clock | Release date, code freeze, external-test window, deploy buffer, each with its working-day count | US2, US3, FR-008 |
| Code-freeze capacity | `PersonLoad` table, over-capacity rows first; scope-removal flag when short | US2 |
| External-test capacity | Same table, testers only; the two remedies named | US3 |
| Feature PI DoD | One row per Feature: INT-ready state, blockers, DoD date, PI verdict, `riskCause` | US4, US5 |
| Sizing flags | Over-size and not-sized Features | US6 |
| Date resolutions | Only rows with `hasDisagreement` or `source: 'none'` | US7-3, US7-4 |
| Rejected settings | Rendered whenever non-empty | Honest states |
| Completeness | Always rendered beside the totals | SC-012 |
| AI | `ForecastAiPanel` at the foot | US8 |

**The one presentational rule that carries a requirement**: the release verdict and the PI verdict are rendered in
**adjacent, separately-headed** blocks, never combined into a single figure (FR-014, SC-005). This is the confusion
the whole feature exists to end, and merging them would reintroduce it in the one place it is most visible.

**Styling**: `SprintDashboardView.module.css` class vocabulary, matching `RollupBoardTab`'s sibling usage.

---

## 6. Edit inventory and guards

| File | Edit | Guard |
|---|---|---|
| `services/artSettingsStore.ts` | 3 settings | Existing tests unmodified |
| `Hygiene/hooks/hygieneScan.ts` | 1 line | Existing tests unmodified |
| `Hygiene/checks/issueDateRules.ts` | Optional inputs, 1 precedence step | Existing tests unmodified |
| `Hygiene/derivedDateFix.ts` | Optional context parameter | Existing tests unmodified |
| `MyIssues/Today/hooks/useTodayDashboard.ts` | 1 additive field | Existing tests unmodified |
| `MyIssues/Today/TodayDashboard.tsx` | Render one new section | Existing tests unmodified |
| `rollupBoard/laneVitals.ts` | Optional 3rd parameter | Existing tests unmodified |
| `rollupBoard/components/ChildCard.tsx` | Optional prop | Existing tests unmodified |
| `rollupBoard/components/MasterCardLane.tsx` | Render 2 extra tiles | Existing tests unmodified |
| `rollupBoard/RollupBoardTab.tsx` | 1 memo + 2 prop passes | Existing tests unmodified |
| `rollupBoard/defaultBoardColumns.ts` | 1 column | **Test updated** — the only legitimate change |
| `SprintDashboard/hooks/useSprintData.ts` | 1 union member | Existing tests unmodified |
| `SprintDashboard/SprintDashboardView.tsx` | 1 tab entry + 1 mount | Existing tests unmodified |
| `ArtView/piPlan/piPlanDates.ts` | Re-export relocated primitives | **`piPlanDates.test.ts` unmodified** |
| `utils/workflowDelivery.ts` | **NOT TOUCHED** | `workflowDelivery.test.ts` unmodified |

**One existing test file changes**: `defaultBoardColumns.test.ts`. Any other existing assertion needing an edit means
this feature changed behaviour it promised not to — revert the change, do not adjust the test.
