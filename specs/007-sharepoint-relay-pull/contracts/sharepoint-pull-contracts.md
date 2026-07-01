# Contracts — SharePoint Relay Pull (Phase 2B)

Internal module/hook contracts + the reused relay endpoints. No new server HTTP surface beyond
adding `sharepoint` to the existing bridge's supported systems.

## A. Relay bridge (existing, extended)

```text
Server (src/routes/relayBridge.js): SUPPORTED_SYSTEMS += 'sharepoint'
Client type (relay.ts): RelaySystem = 'snow' | 'sharepoint' | ...
```
No endpoint changes — register / poll / request / result / status / deregister already take `?sys=`.

## B. Bookmarklet (browserRelay.ts)

```ts
export const SHAREPOINT_RELAY_BOOKMARKLET_CODE: string
//   hostname guard: *.sharepoint.com; sys='sharepoint';
//   request headers Accept: application/json;odata=nometadata; credentials:'include';
//   executes fetch(location.origin + request.path) and posts result back (same loop as SNow).
export function openSharePointRelayTab(): void   // focus/open helper, mirrors the SNow one
```

## C. SharePoint REST reader (sharepointIntakeApi.ts, via the relay)

```ts
interface SharePointSource { siteRelativeUrl: string; listName: string }

/** Reads the list's fields and returns display-title → internal-name (plus any missing expected). */
resolveListFieldMap(source: SharePointSource): Promise<{ byDisplayName: Map<string,string>; missingColumns: string[] }>
//   GET <site>/_api/web/lists/getbytitle('<list>')/fields?$select=Title,InternalName&$filter=Hidden eq false
//   through the relay (sys:'sharepoint')

/** Reads all list items (following pagination) using the resolved internal names. */
fetchListItems(source: SharePointSource, fieldMap: Map<string,string>): Promise<Record<string, unknown>[]>
//   GET <site>/_api/web/lists/getbytitle('<list>')/items?$select=<internal...>&$top=N
//   follows odata.nextLink / __next until exhausted

/** Errors: a relay disconnect / non-2xx / permission error rejects with a clear message; callers ingest nothing. */
```

## D. Item mapper (mapSharePointItem.ts, pure)

```ts
mapSharePointItem(item: Record<string, unknown>, fieldMap: Map<string,string>): RawRow
//   reads each expected display column via its internal name → flat RawRow with display-name keys,
//   ready for the existing normalizeSubmission (no SheetJS)
```

## E. Pull hook (useSharePointPull.ts)

```ts
useSharePointPull(config): {
  isConnected: boolean;                 // from fetchRelayStatus('sharepoint')
  refreshStatus(): Promise<void>;
  pull(): Promise<{ rows: RawRow[]; missingColumns: string[]; itemCount: number }>;
  isPulling: boolean;
  errorMessage: string | null;          // relay disconnect / permission / missing config
}
//   pull(): resolveListFieldMap → fetchListItems → mapSharePointItem[]; requires config
//   sharePointSiteRelativeUrl + listName and a connected relay, else a clear error and no rows.
```

## F. Queue integration (useIntakeQueue.ts, extended)

```ts
ingestRows(rows: RawRow[]): QueueEntry[]
//   same normalize → dedup-cache → newest-first logic as ingestFile, but from already-parsed rows.
//   ingestFile is refactored to call the shared row→entries helper.
```

## G. View wiring (JiraIntake.tsx)

```text
Pull flow: useSharePointPull.pull() → useIntakeQueue.ingestRows(rows) →
           reconcileExisting (feature 006 pre-scan) → auto-create remainder (if enabled)
           → updateEntry each.  Identical downstream to the drag-and-drop handleFile path.
```

## Behavior contract (invariants)

- Pull uses the user's SharePoint session via the relay — no stored creds, no app reg (FR-002).
- Internal column names resolved automatically, incl. reserved `id` (FR-004).
- All pages fetched; a cap (if any) is surfaced with counts (FR-005).
- Pull blocked with a clear message when the relay is disconnected; drag-and-drop still works
  (FR-006/009).
- Any error ingests **0** rows, no partial/duplicate state (FR-008); missing expected column
  reported by name (FR-010).
- Downstream (normalize, dedup, create) is byte-for-byte the existing pipeline (FR-003, SC-004).
