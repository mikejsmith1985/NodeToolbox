# Contract: INT Readiness, the DEV→SL Chain, and Feature Sizing

**Modules**: `views/SprintDashboard/forecast/intReadiness.ts`, `forecast/devSlChain.ts`, `forecast/featureSizing.ts`

This is the PI clock. It is the part the product cannot see at all today, and the part with the highest chance of
silently breaking an existing metric — so the guard is stated first.

---

## 0. The guard that outranks every requirement here

`client/src/utils/workflowDelivery.ts` is **not modified by this feature**, and
`client/src/utils/workflowDelivery.test.ts` must pass **unmodified**.

That module declares the ART-wide rule — *delivered = "Ready for QA" or later* — and drives sprint predictability, the
monthly delivery report, and every flow metric. The rule in this contract is a **different, earlier** line.

`intReadiness.ts` **imports** `INTERNAL_TESTING_STATUS_NAME` from it so the two share one vocabulary, and exports its
own verdict so they never share a conclusion (FR-018, FR-019, SC-006).

> If a `workflowDelivery.test.ts` assertion needs editing to make this feature pass, the delivered rule changed. Revert
> the change; do not adjust the test.

---

## 1. `intReadiness.ts`

```ts
export type IntReadyState = 'int-ready' | 'not-int-ready' | 'cancelled' | 'unknown-sub-status';

/** The sub-status that marks an issue as sitting in Integration Test. */
export const INTEGRATION_TEST_SUB_STATUS = 'Integration Test';
/** The status a completed dev story reaches, with NO sub-status — the SL gate. */
export const INTERNAL_TEST_READY_SUB_STATUS: null = null;

export interface IntReadinessInput {
  statusName: string;
  subStatusValue: string | null;
  hasSubStatusField: boolean;
}

/** Is this one issue at the Integration Test line? */
export function readIntReadyState(input: IntReadinessInput): IntReadyState

/** Is this one issue at Internal Test Ready — dev complete, awaiting SL? */
export function isInternalTestReady(input: IntReadinessInput): boolean
```

| Rule | Behaviour | Requirement |
|---|---|---|
| `status = 'Ready for Testing'` **and** `subStatus = 'Integration Test'` | `int-ready` | FR-016 |
| `status = 'Cancelled'` | `cancelled` — excluded from DoD and capacity, counted and named | FR-020 |
| `hasSubStatusField === false` | `unknown-sub-status` — reports **not checked**, never guesses | Honest-states rule |
| Anything else | `not-int-ready` | FR-016 |
| Matching | Case-insensitive, trimmed, on both status and sub-status | Jira spelling varies |
| `isInternalTestReady` | `status = 'Ready for Testing'` **and** `subStatus` is null or blank | FR-024, research R-7 |

**`isInternalTestReady` reads status and sub-status directly — never a board column.** A team that has not added the
Internal Test Ready column to its saved vocabulary still gets a correct chain forecast; they simply see the card in
Unmapped (research R-7, spec FR-021).

### Feature-level roll-up

```ts
export interface FeatureIntReadiness {
  featureKey: string;
  state: IntReadyState;
  blockingIssueKeys: string[];
  cancelledIssueKeys: string[];
  contributingIssueCount: number;
}

export function rollUpFeatureIntReadiness(
  featureKey: string,
  children: readonly (IntReadinessInput & { issueKey: string })[],
): FeatureIntReadiness
```

| Rule | Behaviour | Requirement |
|---|---|---|
| Every non-cancelled child `int-ready` | Feature `int-ready` | FR-017 |
| Any non-cancelled child not `int-ready` | Feature `not-int-ready`; that key in `blockingIssueKeys` | FR-017, SC-007 |
| All children cancelled | `cancelled` — never `int-ready` by vacuum | FR-020 |
| **No children at all** | `not-int-ready` with empty `blockingIssueKeys` — a gap, not completion | Spec edge case |
| Any child `unknown-sub-status` | Feature `unknown-sub-status` | Honest states |

**"No children ⇒ not ready"** is the load-bearing negative. An all-satisfied check over an empty set returns true, and
that would report an untouched Feature as having met the PI commitment.

### Tests

| # | Given | Expect |
|---|---|---|
| 1 | `Ready for Testing` / `Integration Test` | `int-ready` |
| 2 | `ready for testing` / `integration test` | `int-ready` (case-insensitive) |
| 3 | `Ready for Testing` / `Testing` | `not-int-ready` |
| 4 | `Ready for Testing` / null | `not-int-ready`; `isInternalTestReady` **true** |
| 5 | `Ready for Testing` / `'  '` | `isInternalTestReady` true (blank = none) |
| 6 | `Cancelled` | `cancelled` |
| 7 | `hasSubStatusField` false | `unknown-sub-status` |
| 8 | 3 children, all INT-ready | Feature `int-ready` (US4-1) |
| 9 | 3 children, one in Working | `not-int-ready`; that key blocking (US4-2) |
| 10 | 2 INT-ready + 1 cancelled | `int-ready`; the cancelled key listed separately |
| 11 | All cancelled | `cancelled` |
| 12 | Zero children | `not-int-ready`, no blockers |
| 13 | One child unknown sub-status | Feature `unknown-sub-status` |

---

## 2. `devSlChain.ts`

```ts
export type ChainRole = 'dev' | 'sl' | 'unclassified';

export interface ChainItem {
  issueKey: string;
  summary: string;
  role: ChainRole;
  remainingWorkingDays: number | null;
  isInternalTestReady: boolean;
  isComplete: boolean;
}

export interface ChainRoleSignals {
  summary: string;
  assigneeCanInternalTest: boolean | null;
}

/** Prefix first, roster capability second, unclassified last. */
export function classifyChainRole(signals: ChainRoleSignals): ChainRole

export interface ChainSchedule {
  devCompleteIso: string | null;
  slStartIso: string | null;
  slWorkingDays: number | null;
  dodDateIso: string | null;
  hasNoSlStory: boolean;
  unclassifiedIssueKeys: string[];
}

export function scheduleDevSlChain(
  items: readonly ChainItem[],
  startFromIso: string,
  config: ForecastConfig,
): ChainSchedule
```

### Classification (FR-022, FR-023, research R-15)

| # | Signal | Result |
|---|---|---|
| 1 | Summary starts with `[SL]` (case-insensitive, after trim) | `sl` |
| 2 | Summary starts with `[DEV]` | `dev` |
| 3 | No prefix, `assigneeCanInternalTest === true` | `sl` |
| 4 | No prefix, `assigneeCanInternalTest === false` | `dev` |
| 5 | No prefix, `assigneeCanInternalTest === null` | `unclassified` |

Anchored and bracket-delimited: `[SL] Verify enrolment` matches; `Add SLA banner` does not. `unclassified` items are
**scheduled as dev** and their keys reported (FR-023).

### Scheduling (FR-024, FR-025, FR-026, FR-027)

| Rule | Behaviour |
|---|---|
| `devCompleteIso` | The latest completion across every dev + unclassified item: `addWorkingDays(startFromIso, sum(devDays) − 1)`. Items already `isInternalTestReady` or `isComplete` contribute **0** days. |
| Every dev item already Internal Test Ready | `devCompleteIso = startFromIso` — dev is done, the chain starts now |
| `slStartIso` | `addWorkingDays(devCompleteIso, 1)` — SL cannot begin until the last dev story is Internal Test Ready |
| `slWorkingDays` | **Sum** of every SL item's remaining days (FR-025) |
| `dodDateIso` | `addWorkingDays(slStartIso, slWorkingDays − 1)` |
| No SL item | `hasNoSlStory = true`, `slWorkingDays = null`, `dodDateIso = devCompleteIso` — and the absence is reported, not treated as zero test effort (FR-026) |
| Every SL item already INT-ready | `slWorkingDays = 0`, `dodDateIso = devCompleteIso` |
| Any dev item unestimated | `devCompleteIso = null`; the whole chain is `null` and the caller reports it unsized |

**Dev completion is summed, not maxed.** Two dev stories held by the same person are serial; where they are held by
different people the per-person capacity check (`capacity-load.md` rule 4) surfaces the parallelism. Summing is the
safe direction for a deadline — the same reasoning FR-025 applies to SL.

### `riskCause` (FR-027, SC-008)

Computed by the caller from the chain plus the PI clock:

| Condition | `riskCause` |
|---|---|
| `devCompleteIso > piEndIso` | `dev-too-large` |
| `devCompleteIso <= piEndIso` and `dodDateIso > piEndIso` | `test-squeeze` |
| `dodDateIso <= piEndIso` | `null` |

Dev checked first: when dev alone overruns, the test window was never the binding constraint.

### Tests

| # | Given | Expect |
|---|---|---|
| 1 | `[SL] Verify enrolment` | `sl` |
| 2 | `[sl] verify` | `sl` |
| 3 | `[DEV] Build API` | `dev` |
| 4 | `Add SLA banner` + capability null | `unclassified` |
| 5 | No prefix + `canInternalTest` true | `sl` |
| 6 | 2 dev (3 + 2 days), 1 SL (2 days), from 2026-08-24 | dev 2026-08-28, SL 2026-08-31, DoD 2026-09-01 (US5-1) |
| 7 | 3 SL items 1 + 2 + 1 | `slWorkingDays` 4 (US5-3) |
| 8 | No SL item | `hasNoSlStory` true; DoD = dev complete (US5-5) |
| 9 | Every dev item Internal Test Ready | `devCompleteIso = startFromIso` |
| 10 | Dev item unestimated | Whole chain null |
| 11 | Unclassified item | Scheduled as dev; key in `unclassifiedIssueKeys` (US5-4) |
| 12 | Weekend inside the span | Excluded |
| 13 | Dev fits PI, DoD does not | `riskCause = 'test-squeeze'` (US5-2) |
| 14 | Dev alone overruns PI | `riskCause = 'dev-too-large'` |
| 15 | Both fit | `riskCause = null` |

---

## 3. `featureSizing.ts`

```ts
export interface SizingChild {
  issueKey: string;
  typeBucket: 'story' | 'defect' | 'subtask' | 'other';
  storyPoints: number | null;
}

export interface FeatureSizingFlag {
  featureKey: string;
  featurePoints: number | null;
  childrenPoints: number;
  overagePoints: number;
  overagePercent: number;
  state: 'within' | 'over' | 'not-sized';
  unsizedChildCount: number;
}

export function assessFeatureSizing(
  featureKey: string,
  featurePoints: number | null,
  children: readonly SizingChild[],
  tolerancePercent: number,
): FeatureSizingFlag
```

| Rule | Behaviour | Requirement |
|---|---|---|
| Counted children | `story`, `defect`, `other` (tasks). `subtask` **excluded** | FR-029 |
| `featurePoints === null` | `state: 'not-sized'`; no overage computed | FR-030 |
| `overagePoints` | `max(0, childrenPoints − featurePoints)` | FR-028 |
| `overagePercent` | `overagePoints ÷ featurePoints × 100`, rounded to a whole percent | FR-028 |
| `state: 'over'` | `overagePercent > tolerancePercent` | FR-028 |
| Tolerance `0` | Any excess flags | FR-028 default |
| `featurePoints === 0` | `state: 'over'` when any child carries points; percent reported as `0` rather than infinity | Guard |
| Unsized children | Contribute 0 to `childrenPoints`; `unsizedChildCount` increments | FR-003 |
| Zero children | `childrenPoints` 0, `state: 'within'` | — |

### Tests

| # | Given | Expect |
|---|---|---|
| 1 | Feature 20, children 34, tolerance 0 | `over`, overage 14, 70% (US6-1) |
| 2 | Feature 20, children 20 | `within`, overage 0 |
| 3 | Feature 20, children 22, tolerance 20 | `within` (10% ≤ 20%) (US6-4) |
| 4 | Feature 20, children 26, tolerance 20 | `over` (30% > 20%) |
| 5 | Feature null | `not-sized` (US6-2) |
| 6 | Children include a sub-task with 5 pts | Excluded from the sum (US6-3) |
| 7 | Two unsized children | `unsizedChildCount` 2; they add 0 |
| 8 | Feature 0, children 5 | `over`, percent 0, no infinity |
| 9 | No children | `within` |
| 10 | Percent rounding | Whole numbers only |
