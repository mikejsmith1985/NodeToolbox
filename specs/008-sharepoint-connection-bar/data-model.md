# Phase 1 Data Model — SharePoint Relay in the Connection Bar

No persisted schema. Extends the in-memory connection store and adds UI-state entities.

## 1. connectionStore additions

| Field / action | Type | Rules |
|----------------|------|-------|
| `relayStatusBySystem` | `Partial<Record<RelaySystem, RelayBridgeStatus>>` | Per-system relay status; keyed by the relay `system`. Default `{}`. |
| `relayBridgeStatus` (existing) | `RelayBridgeStatus \| null` | **Snow mirror** — kept for existing SNow consumers; updated only when a snow status arrives. |
| `setRelayBridgeStatus(status)` (existing, extended) | action | Writes `relayStatusBySystem[status.system] = status`; also sets `relayBridgeStatus = status` **iff** `status.system === 'snow'`. |
| `clearConnectionState()` (existing, extended) | action | Also resets `relayStatusBySystem` to `{}`. |

Selectors used by consumers:
- Snow connected: `relayStatusBySystem.snow?.isConnected ?? relayBridgeStatus?.isConnected ?? false` (unchanged behavior).
- SharePoint connected: `relayStatusBySystem.sharepoint?.isConnected ?? false`.

## 2. ConnectionBar UI state

| Entity | Notes |
|--------|-------|
| `ActivePanel` (extended) | Union gains `'sharepoint'`. |
| SharePoint indicator | Dot reflects SharePoint relay connected state; **shown always** (not admin-gated). |
| SharePoint panel | Status line + (when disconnected) draggable `BookmarkletInstallLink` (`SHAREPOINT_RELAY_BOOKMARKLET_CODE`) + drag-to-bookmarks guidance + click-in-place warning (mirrors `SnowPanel`). |

## 3. Intake SharePointPullPanel (slimmed)

| Aspect | Before (007) | After (008) |
|--------|--------------|-------------|
| Bookmarklet + connect steps | shown in the panel | **removed** |
| Connection status | from `useSharePointPull` local poll | from shared store `relayStatusBySystem.sharepoint` |
| Pull button | present | present (unchanged behavior) |
| Disconnected hint | connect steps | short pointer: "Connect the SharePoint relay from the Connection Bar" |

## 4. Reused shapes (unchanged)

- `RelayBridgeStatus`, `RelaySystem` (already includes `sharepoint`) — relay types.
- `useSharePointPull` / `pull()`, the queue, dedup (006), create pipeline — feature 007/006,
  unchanged. Only the panel's displayed connection state and connect UI change.
