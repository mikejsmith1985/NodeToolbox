# Contract: Capacity Load

**Module**: `views/SprintDashboard/forecast/capacityLoad.ts`

One shape answers two questions — *can dev build it by code freeze?* and *can test absorb it in the two weeks after?*
— because a single computation is the only way US2 and US3 cannot disagree about what "over capacity" means.

---

## Interface

```ts
export interface CapacityPerson {
  personKey: string;          // account id where available, display name otherwise
  displayName: string;
  isOnRoster: boolean;
  canDevelop: boolean;
  canInternalTest: boolean;
}

export interface CapacityItem {
  issueKey: string;
  assigneePersonKey: string | null;   // null = unassigned
  remainingWorkingDays: number | null;
  isEstimated: boolean;
  isInScope: boolean;                 // in the release/window being reported
  chainRole: ChainRole;               // 'dev' | 'sl' | 'unclassified'
}

export interface PersonLoad {
  personKey: string;
  displayName: string;
  isOnRoster: boolean;
  inScopeWorkingDays: number;
  totalAssignedWorkingDays: number;
  availableWorkingDays: number;
  overCapacityWorkingDays: number;
  isOverCapacity: boolean;
  unsizedIssueCount: number;
  inScopeIssueKeys: string[];
}

export interface CapacityAssessment {
  window: ForecastWindow;
  personLoads: PersonLoad[];
  unassignedWorkingDays: number;
  unassignedIssueKeys: string[];
  totalRemainingWorkingDays: number;
  totalAvailableWorkingDays: number;
  shortfallWorkingDays: number;
  shouldRemoveScope: boolean;
  unsizedIssueCount: number;
  undatedIssueCount: number;
}

export function assessCapacity(
  items: readonly CapacityItem[],
  people: readonly CapacityPerson[],
  window: ForecastWindow,
  options: { roleFilter: 'dev' | 'test' | 'all'; undatedIssueCount: number },
): CapacityAssessment
```

---

## Rules

| # | Rule | Requirement |
|---|---|---|
| 1 | `availableWorkingDays = window.workingDayCount` for every person | FR-006 — availability is full; absence is expressed through the holiday list |
| 2 | `inScopeWorkingDays` sums `remainingWorkingDays` over that person's items where `isInScope` | FR-005 |
| 3 | `totalAssignedWorkingDays` sums **all** their items, in scope or not | FR-005 — nobody looks free while drowning elsewhere |
| 4 | `overCapacityWorkingDays = max(0, inScopeWorkingDays − availableWorkingDays)` | US2-1 |
| 5 | Unassigned items are summed into `unassignedWorkingDays` **and** `totalRemainingWorkingDays` | FR-004, US2-3 |
| 6 | Unassigned items are never distributed across a pool | FR-004 |
| 7 | `totalAvailableWorkingDays` sums only people with at least one in-scope item | US2-2 — an idle tester is not release capacity until they hold some of it |
| 8 | `shortfallWorkingDays = max(0, totalRemaining − totalAvailable)`; `shouldRemoveScope` when `> 0` | US2-2 |
| 9 | Unestimated items contribute **0** days and increment `unsizedIssueCount` | FR-003 |
| 10 | `window.hasPassed` ⇒ `availableWorkingDays = 0` for everyone; everything with work is over capacity | US2-5 |
| 11 | `personLoads` sorted by `overCapacityWorkingDays` descending, then `displayName` ascending | Determinism |
| 12 | `roleFilter: 'dev'` keeps items whose `chainRole` is `dev` or `unclassified`, and people with `canDevelop` | FR-023 |
| 13 | `roleFilter: 'test'` keeps items whose `chainRole` is `sl`, and people with `canInternalTest` | US3 |
| 14 | `roleFilter: 'all'` filters nothing | Today tab |
| 15 | An assignee absent from `people` still gets a `PersonLoad` with `isOnRoster: false` | Spec edge case |
| 16 | Zero people with in-scope work | `totalAvailableWorkingDays = 0`; the total is still reported | Spec edge case |

**Rule 7 is the one worth stating out loud.** Counting every roster member as release capacity would let a release
"fit" on the strength of people who are not working on it. Capacity is what is *committed*, not what exists.

---

## Which window feeds which assessment

| Assessment | Window | `roleFilter` | Requirement |
|---|---|---|---|
| Code-freeze / dev | `releaseClock.toCodeFreeze` | `dev` | US2, FR-007 |
| External test | `releaseClock.externalTest` | `test` | US3, FR-008 |

The **deploy buffer window is never used for capacity** — it carries no test capacity by definition (FR-008, US3-2).
It exists in `ReleaseClock` so a surface can label it, not so anything can be scheduled into it.

---

## Tests

| # | Given | Expect |
|---|---|---|
| 1 | 14-day window, one person with 18 in-scope days | `overCapacityWorkingDays` 4, `isOverCapacity` true (US2-1) |
| 2 | 14-day window, one person with 14 days | Not over capacity — the boundary is inclusive |
| 3 | Total remaining 40, total available 30 | `shortfallWorkingDays` 10, `shouldRemoveScope` true |
| 4 | Total remaining 20, total available 30 | Shortfall 0, `shouldRemoveScope` false |
| 5 | Three unassigned items totalling 7 days | `unassignedWorkingDays` 7, keys listed, included in `totalRemaining` |
| 6 | Unassigned work only | No `PersonLoad` rows; totals still reported |
| 7 | Person with in-scope 5 and out-of-scope 9 | `inScope` 5, `totalAssigned` 14 (US2-4) |
| 8 | Two unestimated items | Contribute 0 days; `unsizedIssueCount` 2 |
| 9 | `window.hasPassed` | Everyone's available 0; anyone holding work is over capacity (US2-5) |
| 10 | Assignee not in `people` | Row present, `isOnRoster` false |
| 11 | `roleFilter: 'test'` | Only `sl` items; only `canInternalTest` people |
| 12 | `roleFilter: 'dev'` | `dev` **and** `unclassified` items |
| 13 | Idle roster member with no in-scope work | Excluded from `totalAvailableWorkingDays` |
| 14 | Two people equally over | Sorted by `displayName` |
| 15 | `undatedIssueCount` passed in | Surfaced unchanged on the assessment (FR-034, SC-012) |
| 16 | Empty `items` | Zeroed assessment, no throw |
