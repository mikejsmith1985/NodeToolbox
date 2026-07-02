# Contracts — SharePoint Relay in the Connection Bar

Internal module/UI contracts. No new HTTP surface (reuses the relay bridge + status endpoint).

## A. connectionStore (extended)

```ts
interface ConnectionState {
  // ...existing...
  relayBridgeStatus: RelayBridgeStatus | null;                       // snow mirror (back-compat)
  relayStatusBySystem: Partial<Record<RelaySystem, RelayBridgeStatus>>;  // NEW
  setRelayBridgeStatus(status: RelayBridgeStatus): void;             // records by status.system;
                                                                     //   mirrors legacy iff system==='snow'
  clearConnectionState(): void;                                      // also clears relayStatusBySystem
}
```

**Invariants**
- A `sharepoint` status update MUST NOT change `relayBridgeStatus` (snow mirror). (SC-002/SC-005)
- A `snow` status update updates BOTH `relayStatusBySystem.snow` and `relayBridgeStatus`.

## B. Relay polling (App.tsx)

```ts
useRelayBridge('snow');        // existing
useRelayBridge('sharepoint');  // NEW — same hook, same 3s cadence, writes map.sharepoint
```

## C. ConnectionBar (extended)

```text
ActivePanel = 'jira' | 'snow' | 'confluence' | 'github' | 'sharepoint'
+ <ConnectionIndicatorButton label="SharePoint" isReady={sharepointConnected} ... />  (always shown)
+ SharePointPanel: status + (disconnected) BookmarkletInstallLink(SHAREPOINT_RELAY_BOOKMARKLET_CODE)
    with drag-to-bookmarks guidance + click-in-place warning (mirror SnowPanel)
sharepointConnected = relayStatusBySystem.sharepoint?.isConnected ?? false
```

## D. Intake SharePointPullPanel (slimmed)

```ts
interface SharePointPullPanelProps {
  siteConfigured: boolean;
  isConnected: boolean;   // from store relayStatusBySystem.sharepoint (passed by the view)
  isPulling: boolean;
  statusMessage: string | null;
  onPull: () => void;
  // REMOVED: bookmarklet/connect UI, onCheckConnection connect steps
}
// When disconnected: Pull unavailable + "Connect the SharePoint relay from the Connection Bar" pointer.
// No BookmarkletInstallLink here anymore.
```

## E. JiraIntake view

```text
- isConnected for the pull panel comes from useConnectionStore(relayStatusBySystem.sharepoint?.isConnected)
- Pull flow unchanged: pull() → ingestRows → reconcileExisting → auto-create (feature 007/006)
```

## Behavior contract (invariants)

- SharePoint connects entirely from the Connection Bar; intake panel shows no connect UI (FR-001/005).
- Per-system status: SNow and SharePoint indicators are independent; neither overwrites the other
  (FR-003, SC-002).
- ServiceNow relay connect/status/relaying unchanged (FR-007, SC-005).
- When connected, intake Pull behaves exactly as feature 007 (FR-006, SC-004).
- Bookmarklet in the bar is a real drag link + click-in-place warning (FR-008).
