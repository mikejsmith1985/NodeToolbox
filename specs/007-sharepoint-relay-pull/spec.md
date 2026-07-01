# Feature Specification: SharePoint Relay Pull (Phase 2B)

**Feature Branch**: `007-sharepoint-relay-pull`

**Created**: 2026-07-01

**Status**: Draft

**Input**: Phase 2B of the Teams→Jira intake: automate ingestion by pulling submissions directly
from the SharePoint "Jira-Intake" List via a browser relay, instead of manually exporting and
drag-dropping a file.

## Summary

Today a Toolbox user gets submissions into the importer by exporting the store and **dragging a
file in**. Phase 2B removes that manual step for the common case: Toolbox **pulls the submissions
directly from the SharePoint `Jira-Intake` List** using the **same browser-relay pattern** already
trusted for ServiceNow/Jira. The user keeps an authenticated SharePoint tab open and clicks a
**bookmarklet**; the bookmarklet reads the List through the user's own session and hands the rows
back to Toolbox, which drops them into the **existing** intake queue → dedup (feature 006) → create
pipeline. No app registration, no premium connector, no credentials stored by Toolbox.

This is **one-click** (a human clicks the bookmarklet on an authenticated tab; an optional
auto-refresh can re-pull while that tab stays connected) — it is **not** a fully unattended
background service, which the tenant's constraints (no app registration/premium) rule out. The
**drag-and-drop file import remains** as a fallback.

Only the **ingestion source** changes. The queue, convention field mapping, per-row project
routing, reporter resolution + fallback origin note, and the feature-006 label-based dedup are all
**reused unchanged**.

## Scope Boundary (explicit non-goals)

- **In scope**: a SharePoint browser-relay ("pull from SharePoint") that reads the `Jira-Intake`
  List through the user's session and feeds the existing queue; automatic resolution of the List's
  internal column names; a clear connect/refresh UX; optional auto-refresh while connected; keeping
  drag-and-drop as a fallback.
- **Out of scope (2B)**: writing `status`/`Imported` (or the Jira key) back to the SharePoint List
  (possible later v2.1).
- **Out of scope**: fully unattended / background polling with no human tab (needs an app
  registration — blocked).
- **Out of scope**: changing the queue, field mapping, project routing, reporter logic, or the
  feature-006 dedup.
- **Out of scope**: any Toolbox-hosted inbound endpoint (Toolbox remains local and pull-only).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One-click pull from SharePoint (Priority: P1)

A Toolbox user opens the intake view, connects the SharePoint relay (clicks the bookmarklet on an
authenticated SharePoint tab), and clicks **Pull from SharePoint**. The current submissions appear
in the queue without exporting or dragging any file.

**Why this priority**: This is the feature — removing the manual export/drag step. Everything else
supports it.

**Independent Test**: With the relay connected, click Pull; confirm the queue fills with the List's
submissions (same rows the file path would have produced), newest-first, with all fields populated.

**Acceptance Scenarios**:

1. **Given** the SharePoint relay is connected and the `Jira-Intake` List has submissions, **When**
   the user clicks Pull from SharePoint, **Then** those submissions appear in the queue (newest-first,
   all core fields + submitter + project populated) — no file export/drag needed.
2. **Given** a pulled submission whose issue already exists (feature-006 stamp), **When** the pull
   completes, **Then** that row shows Imported with its existing key and is not re-created — the
   pulled rows flow through the same dedup + create pipeline as dropped files.
3. **Given** the relay is **not** connected, **When** the user tries to Pull, **Then** Toolbox
   clearly says the relay must be connected and how to connect it (and the drag-and-drop fallback
   still works).

### User Story 2 - Column names resolve automatically (Priority: P1)

The List's displayed columns are `id, submittedAt, status, submitterDisplayName, submitterEmail,
summary, description, acceptanceCriteria, issueType, priority, project`, but SharePoint's internal
field names can differ (notably `id`, since SharePoint reserves `ID`). The user must not have to
discover or enter internal names.

**Why this priority**: If the reader keyed off the wrong internal name (especially the GUID `id`),
dedup and everything downstream would break silently. It must "just work" from the display names.

**Independent Test**: Pull from a List where the `id` column's internal name differs from `id`;
confirm each submission's fields (including the dedup `id`) are populated correctly.

**Acceptance Scenarios**:

1. **Given** the List's GUID column has a non-`id` internal name, **When** Toolbox pulls, **Then**
   each submission's `id` is read correctly (dedup by `intake-<id>` still works).
2. **Given** the standard 11 display columns, **When** Toolbox pulls, **Then** every submission
   field maps from the correct column without the user entering any internal names.

### User Story 3 - Refresh without re-clicking everything (Priority: P2)

While the relay tab stays connected, the user can re-pull to pick up new submissions — manually
(Refresh) or on an optional interval.

**Why this priority**: Makes the automation feel live during a working session without being a true
background service.

**Independent Test**: Connect, pull, add a submission in SharePoint, click Refresh (or wait for the
interval); confirm the new submission appears and already-imported ones are unaffected.

**Acceptance Scenarios**:

1. **Given** the relay is connected and a prior pull was done, **When** the user clicks Refresh (or
   the auto-refresh interval elapses), **Then** newly-added submissions appear and previously
   imported rows are not duplicated.
2. **Given** auto-refresh is enabled, **When** the relay tab is closed/disconnected, **Then**
   auto-refresh stops and Toolbox indicates the relay is disconnected.

### Edge Cases

- **Large List (pagination)**: a List with more items than one page returns must be **fully pulled**
  (all pages), not truncated; if pulling is capped, the user is told the count and how to get the rest.
- **Relay disconnects mid-pull** (tab closed, session expired): Toolbox shows a clear "relay
  disconnected / reconnect" message and makes no partial/duplicate state; the user can reconnect and
  retry. The drag-and-drop fallback remains available.
- **SharePoint permission/auth error** in the user's session: surfaced as a clear message, no rows
  ingested.
- **A List row missing a required field** (e.g. no summary/id): flagged in the queue exactly as a
  malformed file row is today (reuses existing validation).
- **Column renamed/removed in SharePoint**: if an expected display column can't be resolved, Toolbox
  reports which column is missing rather than silently importing blanks.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The tool MUST let the user pull intake submissions directly from the configured
  SharePoint `Jira-Intake` List through the browser relay, without exporting or dragging a file.
- **FR-002**: The pull MUST use the user's existing authenticated SharePoint session via the relay
  (no stored SharePoint credentials, no app registration, no premium connector).
- **FR-003**: Pulled submissions MUST be mapped to the same internal submission shape and fed
  through the **existing** queue → dedup (feature 006) → create pipeline unchanged.
- **FR-004**: The reader MUST resolve the List's **internal** column names automatically from the
  known display names (id, submittedAt, status, submitterDisplayName, submitterEmail, summary,
  description, acceptanceCriteria, issueType, priority, project) — the user never enters internal
  names. In particular the GUID `id` column MUST be read correctly even when its internal name is
  not `id`.
- **FR-005**: The pull MUST retrieve **all** items in the List (handling pagination); if a limit is
  ever applied, the tool MUST show the count and that more remain.
- **FR-006**: The tool MUST expose a clear way to **connect** the SharePoint relay and MUST tell the
  user when it is not connected (with how to connect); Pull MUST be unavailable/blocked with a clear
  message when disconnected.
- **FR-007**: The tool MUST support **re-pull/Refresh** while connected, and MAY offer an optional
  auto-refresh interval that stops when the relay disconnects.
- **FR-008**: Relay disconnect, session/permission errors, or a failed pull MUST show a clear
  message and make no partial or duplicate state; the user can reconnect and retry.
- **FR-009**: The existing **drag-and-drop file import MUST remain** as a fallback path and behave
  exactly as before.
- **FR-010**: If an expected display column cannot be resolved in the List, the tool MUST report the
  missing column rather than importing blank values silently.

### Key Entities *(include if feature involves data)*

- **SharePoint List source**: The `Jira-Intake` List (site + list identity) that holds submissions;
  the live ingestion source for this path.
- **Relay connection (SharePoint)**: The connected-state of the SharePoint browser relay — whether
  Toolbox can currently pull through the user's session.
- **Column mapping**: The resolved map from each known display column to the List's internal field
  name (built automatically), including the reserved-`id` case.
- **Pulled submission**: A List item mapped to the existing intake submission shape (same fields as
  a file-imported row), then handled identically downstream.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from "connected relay" to submissions in the queue with **one click**
  (Pull), with **no** file export or drag step.
- **SC-002**: 100% of the standard columns — including the reserved-`id` GUID — map correctly with
  **zero** manual internal-name entry by the user.
- **SC-003**: Pulling a List larger than one page returns **all** items (0 silently dropped), or the
  user is explicitly told a limit applied and how many remain.
- **SC-004**: Pulled submissions produce the same Jira results as the file path, with **0**
  duplicates (feature-006 dedup unchanged).
- **SC-005**: When the relay is disconnected or a pull fails, **0** rows are ingested and the user
  sees a clear connect/retry message; the drag-and-drop fallback still works.
- **SC-006**: Re-pull/Refresh surfaces newly-added submissions without duplicating previously
  imported ones.

## Assumptions

- Toolbox already has a working browser-relay mechanism (bookmarklet + local bridge with
  poll/result/session-token) used for ServiceNow/Jira; a SharePoint relay target extends it.
- The user can open the SharePoint site in an authenticated browser tab (they built the List there).
- The `Jira-Intake` List exposes its items and field metadata to the user's session via SharePoint's
  standard REST (JSON) — no app registration needed.
- The List uses the standard 11 display columns from Phase-1/2A; `description`/`acceptanceCriteria`
  may be multi-line text; other fields are text/date.
- Jira is **Data Center**; the feature-006 dedup and the create pipeline are unchanged.
- One active SharePoint List source in v1 (matches the single active intake configuration).

## Dependencies

- The existing browser-relay infrastructure (bookmarklet, local bridge endpoints) that
  ServiceNow/Jira use.
- The feature 005 intake queue/create pipeline and the feature 006 label-based dedup (both reused).
- A populated SharePoint `Jira-Intake` List (created by importing the Excel workbook) and the
  Power Automate flow eventually writing new submissions to that List (a Teams-side change tracked
  outside this repo).
