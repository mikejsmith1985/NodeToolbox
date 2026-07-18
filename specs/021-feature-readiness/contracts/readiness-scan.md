# Contract: Readiness Scan (single evaluation)

**Module**: `client/src/views/ArtView/readiness/readinessScan.ts` (pure) +
`readinessFeatureQuery.ts` (fetch). Consumers: ReadinessPanel (counts + listing), ReadinessAiPanel
(prompt scope).

## The one-evaluation guarantee (spec FR-010, SC-003)

`runReadinessScan` is the ONLY module that decides lens membership, alert predicates, refinement,
and counts. Its `ReadinessScanResult` is consumed as-is by every renderer. No component may filter,
re-derive, or re-count features from raw data. A lens tile count and its drilled-in listing length
are the same array's length.

## Query contract (`readinessFeatureQuery.ts`)

- Base: `issuetype = Feature AND cf[<piFieldNumber>] <clause>` where `piFieldNumber` derives from
  `tbxARTSettings.piFieldId` (default `customfield_10301`).
- Scope clause precedence: `project in (<featureProjectKeys>)` if configured → else
  `labels in (<roster jiraLabels>)` if any → else none (scopeDescription says which applied).
- NEVER scoped by team projectKey (portfolio-project rule).
- Three scopes per run: current PI (= selected), upcoming PI (next-newer name from the sorted
  available PI list; skipped when absent), carryover (`in` clause over ≤4 next-older names).
- Fields requested include everything the data model reads — status, assignee, labels, issuelinks,
  duedate, updated, created, flagged, and the resolved PO/estimate/PCode/target field ids — so no
  per-row follow-up fetches occur.
- Max 200 results per scope query; hitting the ceiling sets a visible truncation note (no silent
  caps).

## Lens membership (normative)

| Lens | Rule |
|---|---|
| current | PI value equals the selected PI |
| upcoming | PI value equals the next-newer PI name; `isPiConfigured=false` when no newer name exists |
| carryover | PI value among the ≤4 older names AND `statusBucket !== 'done'` |

A feature belongs to exactly one lens (its PI value decides). Rows display their producing lens.

## Alert predicates (normative)

| Alert | Predicate |
|---|---|
| missing-ownership | assignee empty AND (first configured PO field empty OR PO family unconfigured). Family unconfigured for BOTH assignee (system field — always available) never occurs; if the PO family is unconfigured, assignee alone decides. |
| missing-estimate | estimate family configured AND first field value empty |
| missing-pcode | PCode family configured AND first field value empty |
| target-end-missing-or-past | target-end family configured AND (empty OR date < today) AND statusBucket ≠ 'done' |
| due-date-missing-or-past | duedate empty OR date < today, AND statusBucket ≠ 'done' |

Unconfigured families report `alertFamilyStates[family]='notConfigured'`: the column renders
"not checked — no matching field" and contributes nothing to any count (GH #167 doctrine).

## Refinement (upcoming lens)

`unrefined` ⇔ `statusBucket === 'todo'` (status category `new`). Counts: `refinedCount`,
`unrefinedCount`. No hygiene alert feeds refinement (spec clarification Q1).

## Honest states

- Load failure ⇒ `scannedFeatureCount=null`, `loadError` set: render the error; render NO counts.
- All scopes returned zero ⇒ `scannedFeatureCount=0`: render the amber empty-scope message; no
  lens shows a healthy zero.
- Success ⇒ lens tiles show counts plus the scanned total.

## Deep-link contract

- `?readinessLens=carryover|current|upcoming` selects the lens (invalid ⇒ current).
- `?readinessFilter=<statusName-or-alertId>` pre-applies a listing filter (unknown ⇒ ignored).
- `?artTab=readiness` seeds ArtView's initial tab (validated against the tab union; one-time read;
  no persistence side effects). The Agile Hub shell forwards these params untouched (020).

## Test hooks

- `runReadinessScan` is pure — unit tests feed synthetic feature lists and assert membership,
  alerts, refinement, honesty states, and the count/list identity.
- `readinessFeatureQuery` unit tests assert exact JQL strings per scope precedence.
