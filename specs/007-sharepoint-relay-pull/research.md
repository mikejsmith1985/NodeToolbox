# Phase 0 Research — SharePoint Relay Pull (Phase 2B)

Resolved against the codebase (relay bridge + intake) and SharePoint REST behavior. No open
NEEDS CLARIFICATION.

## R1 — Enable a `sharepoint` relay system

- **Decision**: Add `'sharepoint'` to `SUPPORTED_SYSTEMS` in `src/routes/relayBridge.js` and widen
  the client `RelaySystem` union (`client/src/types/relay.ts`) to include it. The bridge's
  register/poll/request/result/status/deregister endpoints are already generic per `sys`, so no new
  server endpoints are needed.
- **Rationale**: The bridge was built system-agnostic (`snow`/`jira`/`conf` already coexist);
  SharePoint is one more channel. Reuses the entire poll/result long-poll machinery.
- **Note**: The disconnect message string is ServiceNow-worded; generalize it (or make it per-sys)
  so the SharePoint path shows a sensible "reconnect SharePoint" hint.
- **Alternatives rejected**: A separate bespoke bridge (duplicates working infrastructure).

## R2 — SharePoint bookmarklet variant

- **Decision**: Add `SHAREPOINT_RELAY_BOOKMARKLET_CODE` in `browserRelay.ts` mirroring the SNow
  bookmarklet but: hostname check for a SharePoint host (`*.sharepoint.com`), `sys='sharepoint'`,
  and request headers `Accept: application/json;odata=nometadata` + `credentials:'include'`. It
  executes `fetch(location.origin + relayRequest.path)` and posts the response text back, exactly
  like the SNow variant.
- **Rationale**: SharePoint REST returns clean JSON with `odata=nometadata`; the user is on the
  SharePoint tab so `location.origin` is the SharePoint host and the request `path` is the
  site-relative REST path. Reuses the poll/execute/post loop verbatim.
- **Alternatives rejected**: Reusing the SNow bookmarklet (its hostname guard rejects non-ServiceNow
  and its Accept header isn't SharePoint-friendly).

## R3 — Reading the List through the relay (fields + items)

- **Decision**: `sharepointIntakeApi.ts` issues two kinds of GET via the relay (`postRelayRequest` +
  `waitForRelayResult`, `sys:'sharepoint'`):
  1. **Field map**: `GET <site>/_api/web/lists/getbytitle('<List>')/fields?$select=Title,InternalName&$filter=Hidden eq false`
     → build a **display-title → internal-name** map (resolves the reserved-`id` case, FR-004).
  2. **Items (paged)**: `GET <site>/_api/web/lists/getbytitle('<List>')/items?$select=<internal names>&$top=<N>`,
     following the `odata.nextLink`/`__next` skiptoken until exhausted (FR-005).
- **Rationale**: The `/fields` endpoint is the authoritative source for internal names, so the user
  never types them. GET reads only need the session cookie (no form digest — that's writes only).
  Pagination via nextLink guarantees the full List.
- **Alternatives rejected**: Hardcoding internal names (breaks on the reserved-`id` rename); the
  legacy `_vti_bin/listdata.svc` OData (older/less predictable than `/_api/web/lists`).

## R4 — Config: locating the site + list

- **Decision**: Add optional `sharePointSiteRelativeUrl` (e.g. `/sites/CUCIntake`) and
  `sharePointListName` (default `Jira-Intake`) to `IntakeConfig`. The bookmarklet supplies the host
  (`location.origin`); config supplies the site-relative path + list title used to build REST paths.
  Schema stays v3 (new fields optional; absent = SharePoint path not configured).
- **Rationale**: The bookmarklet only knows the origin, not which site/list; the user copies the
  site path once. Keeping the fields optional avoids a store reset and leaves drag-and-drop working
  with no SharePoint config.
- **Alternatives rejected**: Inferring the site from the bookmarklet tab's pathname (fragile across
  SharePoint URL shapes); a schema bump (unnecessary for additive optional fields).

## R5 — Mapping List items to the existing submission shape

- **Decision**: `mapSharePointItem(item, fieldMap)` (pure) reads each known display column via its
  resolved internal name and emits the **same flat `RawRow`** (`{ id, submittedAt, …, project }`)
  that the file path produces, then reuses `normalizeSubmission` verbatim. `useIntakeQueue` gains
  `ingestRows(rows)` that runs the identical normalize → dedup-cache → newest-first logic as
  `ingestFile` (refactored to share it).
- **Rationale**: Maximum reuse — the SharePoint path diverges only at "get rows"; everything after
  (normalize, queue, dedup, create) is identical to the file path, guaranteeing consistent results
  (SC-004). This path skips SheetJS entirely (JSON in, no workbook parse).
- **Alternatives rejected**: A parallel normalize/queue for SharePoint (divergent behavior, double
  maintenance).

## R6 — Connect/refresh UX + failure handling

- **Decision**: A `SharePointPullPanel` shows connection status (`fetchRelayStatus('sharepoint')`),
  a **Connect** affordance (the bookmarklet + open-tab helper), a **Pull from SharePoint** button
  (disabled/blocked with a clear message when disconnected, FR-006), a **Refresh**, and an optional
  **auto-refresh interval** that stops when the relay disconnects (FR-007). Any relay disconnect /
  session / permission / pull error surfaces a clear message and ingests **no** rows (FR-008); the
  dropzone stays as fallback (FR-009). A missing expected column is reported by name (FR-010).
- **Rationale**: Mirrors the trusted SNow relay UX; fail-safe matches the feature-006 principle
  (never a partial/duplicate state).
- **Alternatives rejected**: Auto-pull on connect with no explicit button (less predictable);
  silent truncation on error (violates FR-008/010).

## R7 — Auth / security

- **Decision**: Reads ride the user's SharePoint session cookies (`credentials:'include'`) inside
  the bookmarklet tab; Toolbox stores no SharePoint credentials and never sees them. No app
  registration, no premium connector, no inbound endpoint. Zero-Knowledge preserved (Constitution
  Article IX): Toolbox directs *what* to read; the session in the user's tab does the reading.
- **Rationale**: Same trust model already accepted for ServiceNow/Jira relays.
- **Alternatives rejected**: Server-side Graph/app-only auth (needs an app registration — blocked).
