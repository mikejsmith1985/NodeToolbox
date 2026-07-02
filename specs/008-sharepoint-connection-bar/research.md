# Phase 0 Research — SharePoint Relay in the Connection Bar

Resolved against the codebase. No open NEEDS CLARIFICATION.

## R1 — Per-system relay status without regressing ServiceNow

- **Decision**: Add `relayStatusBySystem: Partial<Record<RelaySystem, RelayBridgeStatus>>` to
  `connectionStore`. `setRelayBridgeStatus(status)` writes `relayStatusBySystem[status.system] =
  status` for every call, and **additionally** keeps the legacy `relayBridgeStatus` updated **only
  when `status.system === 'snow'`**. Existing SNow consumers (ConnectionBar's snow reads,
  `browserRelay.markSnowRelayDisconnected`) keep working; a SharePoint status update can never
  overwrite the snow value.
- **Rationale**: `RelayBridgeStatus` already carries a `system` field, so routing by it is trivial.
  Keeping the legacy field snow-only is the smallest change that guarantees FR-003/FR-007/SC-005 (no
  ServiceNow regression). New consumers read the map.
- **Alternatives rejected**: Replacing `relayBridgeStatus` outright (touches every SNow consumer,
  higher regression risk); a separate `sharepointRelayStatus` field (works but doesn't generalize and
  duplicates the setter).

## R2 — Polling the SharePoint relay status

- **Decision**: `App.tsx` already calls `useRelayBridge('snow')`; add `useRelayBridge('sharepoint')`
  next to it. Each poll writes its own system's status into the map on the existing 3s cadence.
- **Rationale**: `useRelayBridge(system)` is already parameterized by system and writes via
  `setRelayBridgeStatus` (now per-system). One extra line mounts the SharePoint poll; no new
  polling code. Satisfies FR-004/SC-006.
- **Alternatives rejected**: A bespoke SharePoint poller (duplicates `useRelayBridge`); polling only
  while the intake view is open (the ConnectionBar indicator must reflect status app-wide).

## R3 — SharePoint indicator + panel in the Connection Bar

- **Decision**: Add a `sharepoint` value to the ConnectionBar's `ActivePanel` union, a SharePoint
  `ConnectionIndicatorButton` (shown **always**, like Jira/Confluence — not admin-gated), and a
  `SharePointPanel` mirroring `SnowPanel`: status line + (when disconnected) the draggable
  `BookmarkletInstallLink` with `SHAREPOINT_RELAY_BOOKMARKLET_CODE` + the same "drag to bookmarks,
  click on the SharePoint tab" guidance and click-in-place warning.
- **Rationale**: Reuses the exact indicator/panel pattern and the shared `BookmarkletInstallLink`
  (FR-001/002/008). "Always shown" matches the non-admin intake workflow (recorded assumption).
- **Alternatives rejected**: Admin-gating (intake isn't admin-only); a brand-new bar component.

## R4 — Slimming the intake pull panel

- **Decision**: `SharePointPullPanel` drops the bookmarklet + connect steps entirely. It shows the
  connection status and the **Pull** button; when disconnected, Pull is unavailable with a short
  message pointing to the Connection Bar ("Connect the SharePoint relay from the Connection Bar at
  the top of the app"). The panel's `isConnected` now comes from the shared store
  (`relayStatusBySystem.sharepoint`), the same source as the ConnectionBar dot.
- **Rationale**: Removes the duplicated connect UI (FR-005) while keeping the panel functional; a
  single source of truth for connection status keeps the bar and the panel consistent.
- **Alternatives rejected**: Keeping a second bookmarklet in the intake panel (the duplication this
  feature removes); the panel polling its own status separately from the bar (drift risk).

## R5 — The pull flow stays put

- **Decision**: `useSharePointPull.pull()` is unchanged, including its defensive pre-pull status
  check; only the panel's *displayed* connection state moves to the store. The read → queue → dedup
  (006) → create pipeline is untouched (FR-006/SC-004).
- **Rationale**: This feature is a connect-UX consolidation, not a pull change.
- **Alternatives rejected**: Refactoring `useSharePointPull` to read the store (unnecessary; pull's
  own guard is a correctness backstop independent of the polled indicator).

## R6 — Store back-compat + tests

- **Decision**: Keep `relayBridgeStatus` in the store as the snow mirror; add `relayStatusBySystem`
  and a selector usage in consumers. Unit-test: (a) a snow status updates both legacy + map.snow;
  (b) a sharepoint status updates map.sharepoint and **does not** touch legacy `relayBridgeStatus`;
  (c) clearing resets both.
- **Rationale**: Directly encodes the no-clobber guarantee (SC-002/SC-005) as a test.
- **Alternatives rejected**: Only integration-testing via ConnectionBar (slower, less precise about
  the store invariant).
