# Contract: Backlog Remediation Reconciliation (pure)

`client/src/views/SprintDashboard/backlogRemediation/remediationReconcile.ts`

The heart of the feature: merge a freshly-fetched backlog against the saved queue so handled work does not
resurface. Pure, deterministic, clock-injected → fully unit-testable.

## Signature

```text
reconcile(
  savedItems: readonly RemediationItem[],
  fetched: readonly AgingTriageIssue[],   // current NOT-Done backlog for the team scope
  currentFingerprintByKey: ReadonlyMap<string, ItemFingerprint>,  // status-category + assignee now
  todayIso: string,
): RemediationItem[]
```

`currentFingerprintByKey` is derived by the caller from the fetched raw issues (status category + assignee-in-team).

## Rules (each independently unit-tested)

1. **Out-of-scope drop (FR-017)**: an item in `savedItems` whose key is absent from `fetched` is removed from the
   result (it left the NOT-Done backlog / team). Its history is not carried forward.
2. **New item**: a `fetched` key absent from `savedItems` enters as `status: 'pending'`, `verdict: null`,
   `fingerprint: null`.
3. **Snooze elapse (FR-009)**: a `snoozed` item with `todayIso >= snoozeUntilIso` becomes `pending`,
   `snoozeUntilIso: null`.
4. **Terminal hold (FR-010)**: a `canceled` / `kept` / `dismissed` item stays terminal **unless** rule 5 fires.
5. **Material-change re-entry (FR-013)**: a terminal item whose `currentFingerprintByKey[key]` differs from its
   recorded `fingerprint` by **status category** OR **newly-assigned-into-team** becomes `pending`,
   `fingerprint: null`. Any other diff leaves it terminal.
6. **Signal refresh**: a surviving item's `signals` are updated to the latest `fetched` values (so the table shows
   current age/status), regardless of status.
7. **Determinism**: same inputs → same output; ordering is stable (by `fetched` order).

## Non-goals

- No Jira I/O, no React, no `Date.now()` (today is a parameter).
- Does not assign verdicts — those come from a separate AI ingest that updates `verdict`/`rationale` on `pending`
  items.

## Acceptance (unit)

- Drop when key leaves the fetch.
- New key → pending.
- Snoozed past date → pending; snoozed before date → stays hidden.
- Canceled + same fingerprint → stays canceled.
- Canceled + status-category changed → pending.
- Kept + reassigned into team → pending; kept + reassigned to another non-team user → stays kept.
- Cosmetic-only change (same category, same assignee) → stays terminal.
- Two teams' saved sets never interact (function is per-queue; caller passes one team's items).
