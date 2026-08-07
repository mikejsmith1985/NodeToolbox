# Contract: Status Move (the write path)

**Module**: `statusMoveWriter.ts`

Covers FR-020 to FR-023. This is the only place the board writes issue state, and the only place where a half-applied
change is possible. The honesty rule in §4 is the reason this contract exists.

---

## 1. What a move must achieve

Dropping a card into a column must leave the issue in Jira with **exactly** that column's mapped `jiraStatusName`
**and** `subStatusValue` (FR-020).

Reused primitives, all shipped:

| Need | Function | File |
|------|----------|------|
| Available transitions + screen fields | `fetchFeatureReviewTransitions(issueKey)` | `featureReviewFixes.ts:310` |
| Perform transition, optionally with screen field values | `saveFeatureReviewTransition(key, transitionId, fields?)` | `:415` |
| Set a field directly | `saveFeatureReviewOptionField` / `saveFeatureReviewSimpleField` | `:389` / `:380` |
| Render required screen fields | `TransitionRequiredFields` | `components/TransitionRequiredFields/` |

---

## 2. Required additive change to `featureReviewFixes.ts`

`fetchFeatureReviewTransitions` requests `expand=transitions.fields` — which returns **every** field on each
transition screen — and then discards all but `required === true` (`:319-320`). The writer needs to know whether the
sub-status field is *available* on the screen, not whether it is *required*.

```ts
export interface FeatureReviewTransition extends JiraTransition {
  requiredFields: TransitionRequiredField[];
  /** Every field id on this transition's screen, required or not. Enables an atomic status+field write. */
  screenFieldIds: string[];
}
```

Purely additive. Every existing caller reads `requiredFields` and is unaffected. Its existing tests must pass
unmodified.

---

## 3. Decision table

```ts
function planStatusMove(input: {
  item: RollupBoardItem;
  targetMapping: ColumnStatusMapping;
  transitions: FeatureReviewTransition[];
  subStatusFieldId: string;
}): StatusMovePlan
```

| Current vs target | Sub-status on the transition screen | Plan | Atomic? |
|---|---|---|---|
| Status differs | yes | `transition-with-substatus` — one POST carrying both | ✅ |
| Status differs | no | `transition-then-field` — POST transition, then PUT sub-status | ❌ |
| Status differs | target sub-status is null | `transition-only` | ✅ |
| Status same, sub-status differs | n/a | `field-only` — one PUT | ✅ |
| Status same, sub-status same | n/a | `no-op` — succeed silently, no request | ✅ |
| No transition reaches the target status | n/a | `refused` | — |

**`refused` is decided before any write** (FR-023): the drop is rejected up front, naming the transition Jira does not
permit. Nothing is attempted and the card does not move.

`transition-only` and `field-only` being distinct plans matters — a column that differs from the current one *only*
in sub-status must not attempt a status transition that does not exist.

---

## 4. Failure and partial-failure — the honesty rule

| Outcome | Card | Message |
|---|---|---|
| Success | Rests in the target column | none |
| `refused` (no legal transition) | **Never leaves** its origin column | Names the disallowed transition (FR-023) |
| Atomic write fails | **Returns** to its origin column (FR-022) | The Jira error |
| Required screen fields incomplete | Does not move; the field prompt is shown | Existing `TransitionRequiredFields` behaviour (FR-021) |
| **Two-step: transition succeeded, sub-status PUT failed** | **Does NOT revert.** Re-read the issue and render its true state | *"Moved to `<status>`, but the sub-status could not be set to `<value>`: `<reason>`."* |

### Why the last row does not revert

**FR-022** covers a move that is refused or fails **as a unit** — there the card returns to origin. **FR-022a** covers
this row: in the `transition-then-field` plan the status change **did** happen in Jira, so snapping the card back
would draw a state Jira does not hold. The board would be lying, which is the one thing this feature exists to stop.
The card therefore lands where the issue truly is, with the shortfall stated plainly.

**FR-022b** is why this row is rare: the atomic plan is preferred whenever the transition screen carries the
sub-status field, so the two-step path is taken only when Jira leaves no alternative.

> Reconciled in the spec on 2026-08-07 following `/speckit-analyze` finding I1. No conflict remains between this
> contract and FR-022.

---

## 5. Optimistic movement

- The card moves optimistically on drop, with a pending indicator.
- On `refused` or an atomic failure it returns to origin (FR-022).
- On partial success it settles at the **re-read** truth, not at the optimistic guess.
- The affected item is re-read individually — the board is **not** wholly reloaded (FR-049's spirit).

---

## 6. Contract tests

| Given | Then |
|---|---|
| Target status reachable; sub-status on the screen | **One** request; `fields` carries the sub-status |
| Target status reachable; sub-status not on the screen | Two requests, in order: transition, then PUT |
| Target status equals current, sub-status differs | **No** transition request; one PUT |
| Target status and sub-status both equal current | **Zero** requests; reported as success |
| No transition reaches the target | Zero requests; `refused`; card never leaves origin |
| Transition requires screen fields the user has not filled | Zero requests; the field prompt renders |
| A required field's type is unsupported | The existing "must be completed in Jira" note renders; no write |
| Atomic write rejects | Card returns to origin; the Jira reason is shown |
| Two-step: transition resolves, PUT rejects | Card does **not** return to origin; the issue is re-read; the message names what applied and what did not |
| Sub-status field id is `''` (instance has none) | Plans degrade to `transition-only`; no PUT is ever attempted |
