# Contract: useBacklogRemediationStore (per-team persisted)

`client/src/views/SprintDashboard/backlogRemediation/useBacklogRemediationStore.ts`

A Zustand store modeled on `useReallocationDetailsStore`, holding one team scope's `RemediationQueue` and
persisting every mutation to localStorage under the scoped key.

## Storage key

```text
tbxBacklogRemediation:<resolveTeamScopedStorageProfileId(teamProfileId)>:<deriveScopeKey(projectKey, piName)>
```

Built with the same primitives as `tbxReallocationDetails` (feature 012): `resolveTeamScopedStorageProfileId`
(from `teamScopedStorage.ts`) and `deriveScopeKey` (from `overlayStorage.ts`).

## State + actions

```text
interface BacklogRemediationState {
  storageKey: string
  items: RemediationItem[]
  lastRefreshedIso: string | null
  scopeOverrideJql: string | null

  setScope(teamProfileId, projectKey, piName): void        // recompute key, LOAD that scope's blob
  applyReconcile(nextItems, todayIso): void                 // replace items (post-reconcile), stamp lastRefreshed, persist
  ingestVerdicts(suggestions): void                         // set verdict/rationale on matching pending items, persist
  decide(issueKey, status, fingerprint, decidedAtIso): void // pending → terminal; persist
  snooze(issueKey, snoozeUntilIso): void                    // pending → snoozed; persist
  reopen(issueKey): void                                    // manual terminal → pending; persist
  setScopeOverrideJql(jql | null): void                    // per-team override; persist
}
```

## Behavior

- **Team isolation (FR-011)**: `setScope` fully swaps `items`/`scopeOverrideJql` to the target scope's blob;
  mutations only ever touch the currently-loaded scope's key. Switching teams cannot mutate another team's blob.
- **Tolerant load (FR-012)**: a missing/corrupt/oversized blob loads as `{ items: [], lastRefreshedIso: null,
  scopeOverrideJql: null }` — never throws.
- **Write-through**: every action persists synchronously (JSON.stringify) under `storageKey`.

## Acceptance (unit)

- Round-trip: `decide` then reload (new store instance, same scope) → decision present.
- Isolation: set scope A, decide; set scope B → B empty; back to A → decision intact.
- Corrupt blob → empty state, no throw.
- `setScopeOverrideJql` persists per team and does not leak to another scope.
- `ingestVerdicts` updates only matching `pending` items.
