# Phase 1 Data Model — SharePoint Relay Pull (Phase 2B)

Adds config fields + a few in-memory shapes for the relay read. Reuses feature-005 submission/queue
shapes unchanged (List items are mapped into `RawRow` → `normalizeSubmission`).

## 1. IntakeConfig additions (persisted)

Added to the existing `IntakeConfig` (Confluence content property; schema stays v3, fields optional).

| Field | Type | Rules |
|-------|------|-------|
| `sharePointSiteRelativeUrl` | `string?` | e.g. `/sites/CUCIntake`; the site path REST calls are built under. Absent = SharePoint pull not configured. |
| `sharePointListName` | `string?` | The List title (default `Jira-Intake`). |

*(All existing fields — default project, project mappings, AC field id, auto-create — unchanged.)*

## 2. RelaySystem (widened)

`RelaySystem` gains `'sharepoint'` (client type) and `SUPPORTED_SYSTEMS` gains `'sharepoint'`
(server). No shape change to `RelayRequest`/`RelayResult` — the SharePoint path reuses them.

## 3. ColumnFieldMap (in-memory)

Built from the List `/fields` response; drives reading item values by internal name.

| Field | Type | Notes |
|-------|------|-------|
| `byDisplayName` | `Map<string,string>` | display title (e.g. `id`, `submittedAt`) → internal field name |
| `missingColumns` | `string[]` | expected display columns not found in the List (drives FR-010) |

Expected display columns: `id, submittedAt, status, submitterDisplayName, submitterEmail, summary,
description, acceptanceCriteria, issueType, priority, project`.

## 4. SharePointListItem (in-memory, from REST)

The raw item as returned by `/items` — a record keyed by **internal** field names plus SharePoint
system fields (e.g. `Id`, `Title`). Only the mapped columns are read; the rest are ignored.

## 5. Pull result (in-memory)

`pullSubmissions()` outcome the panel/hook surfaces.

| Field | Type | Notes |
|-------|------|-------|
| `rows` | `RawRow[]` | Each List item mapped to the flat display-keyed row (fed to `normalizeSubmission`). |
| `missingColumns` | `string[]` | Non-empty → surface which expected columns were absent (FR-010). |
| `itemCount` | `number` | Total items pulled (all pages). |

## 6. Relay connection state (in-memory)

From `fetchRelayStatus('sharepoint')`: `{ isConnected, lastPingAt }` — drives the panel's connect
prompt and whether Pull is enabled (FR-006/008).

## 7. Reused shapes (unchanged)

- `RawRow`, `IntakeSubmission`, `QueueEntry`, `ProcessedEntry`, `IntakeConfig` (extended in §1) —
  feature 005/006.
- `RelayRequest`, `RelayResult` — existing relay types.
- The pulled rows are normalized and deduped by the **exact** feature-005/006 code (no new queue,
  mapping, or dedup logic).
