# Feature Specification: SharePoint Relay in the Connection Bar

**Feature Branch**: `008-sharepoint-connection-bar`

**Created**: 2026-07-01

**Status**: Draft

**Input**: Unify the SharePoint intake relay connection into the app's Connection Bar, instead of
the connect UI living inside the Jira Intake view.

## Summary

The SharePoint intake relay (feature 007) currently exposes its **connect** experience — the
draggable bookmarklet + connection status — inside the Jira Intake view. Every other service
connection (Jira, ServiceNow, Confluence, GitHub) lives in the app's **Connection Bar**, the shared
status strip with per-service indicators and inline connect panels. This feature moves the
SharePoint relay connect there too, so there is **one consistent place to connect everything**.

After this change: the Connection Bar gains a **SharePoint** indicator (green/red dot) and an inline
panel showing relay connection status plus the draggable bookmarklet with drag-to-bookmarks
guidance (the same pattern ServiceNow uses). The Jira Intake pull panel **stops** showing the
bookmarklet/connect steps and instead shows just the connection status and the **Pull** button, with
a short pointer to connect from the Connection Bar.

This is a **consolidation of the connect experience only** — it does not change how the pull reads
the List or how issues are created (feature 007 pull + feature 006 dedup are untouched), and it must
**not** change ServiceNow's existing relay behavior.

## Scope Boundary (explicit non-goals)

- **In scope**: a SharePoint indicator + inline connect panel in the Connection Bar (status +
  draggable bookmarklet + guidance); tracking SharePoint relay connection status so both the
  Connection Bar and the intake pull panel reflect it; slimming the intake pull panel to
  status + Pull + a pointer to the Connection Bar.
- **Out of scope**: how the pull reads the List, column mapping, and issue creation (feature 007/006
  unchanged); write-back to the List; fully-unattended polling.
- **Out of scope / must not regress**: ServiceNow's relay connect + status must keep working exactly
  as today (this feature must not clobber it).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect SharePoint from the Connection Bar (Priority: P1)

A Toolbox user connects the SharePoint relay from the same Connection Bar they use for every other
service: they open the SharePoint indicator's panel, drag the bookmarklet to their bookmarks bar,
open SharePoint, click the bookmark, and the indicator turns connected.

**Why this priority**: This is the feature — one unified connect experience. It replaces the
in-view connect UI.

**Independent Test**: With the relay disconnected, the Connection Bar SharePoint dot is red and its
panel shows the draggable bookmarklet + steps; after activating the relay on a SharePoint tab, the
dot turns green.

**Acceptance Scenarios**:

1. **Given** the SharePoint relay is not connected, **When** the user opens the SharePoint indicator
   panel in the Connection Bar, **Then** it shows the draggable bookmarklet (an actual drag-to-
   bookmarks link, not raw text) and the same step guidance the ServiceNow panel uses.
2. **Given** the user activates the relay from a SharePoint tab, **When** the next status check runs,
   **Then** the Connection Bar SharePoint dot shows **connected**.
3. **Given** the relay later disconnects, **When** status refreshes, **Then** the dot returns to
   not-connected.

### User Story 2 - Intake pull panel reflects status and points to the Bar (Priority: P1)

In the Jira Intake view, the SharePoint pull area no longer duplicates the connect steps. It shows
the current connection status and the **Pull** button, and tells the user to connect from the
Connection Bar if not connected.

**Why this priority**: Removing the duplicated connect UI is half the point; the intake panel must
still work (status + pull) after the move.

**Independent Test**: With the relay connected, the intake panel enables **Pull** and pulling still
works; with it disconnected, Pull is blocked with a pointer to the Connection Bar — and **no**
bookmarklet/connect steps appear in the intake panel.

**Acceptance Scenarios**:

1. **Given** the relay is connected, **When** the user views the intake pull panel, **Then** Pull is
   enabled and pulling behaves exactly as in feature 007 (queue → dedup → create).
2. **Given** the relay is not connected, **When** the user views the intake pull panel, **Then** Pull
   is unavailable with a short message pointing to the Connection Bar, and the panel shows **no**
   bookmarklet or connect steps.

### User Story 3 - ServiceNow relay is unaffected (Priority: P1)

A user who relies on the ServiceNow relay sees no change: SNow connects, shows status, and relays
requests exactly as before, even while the SharePoint relay is also connected.

**Why this priority**: Regression protection for a heavily-used existing capability sharing the same
bridge/store.

**Independent Test**: Connect both SNow and SharePoint relays; confirm each indicator reflects its
own system's status independently and neither overwrites the other; SNow request relaying still
works.

**Acceptance Scenarios**:

1. **Given** the ServiceNow relay is connected, **When** the SharePoint relay also connects, **Then**
   the ServiceNow indicator still shows connected (its status is not overwritten) and vice-versa.
2. **Given** only ServiceNow is connected, **When** the SharePoint status is checked, **Then**
   SharePoint shows not-connected without affecting the ServiceNow indicator.

### Edge Cases

- **Both relays connected at once**: each indicator reflects its own system; statuses are tracked
  independently (no single shared flag that one system overwrites).
- **SharePoint relay tab closed**: the SharePoint dot returns to not-connected on the next check;
  the ServiceNow indicator is unaffected.
- **Admin-gating**: the Connection Bar hides ServiceNow/GitHub behind admin-unlock; the SharePoint
  indicator's visibility must be decided (see Assumptions) and applied consistently.
- **Intake view without a saved SharePoint config**: the intake pull panel still renders sensibly
  (Pull unavailable) and points to the Connection Bar to connect; the Connection Bar indicator does
  not depend on the intake config.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Connection Bar MUST show a **SharePoint** indicator whose dot reflects the
  SharePoint relay connection status (connected / not connected).
- **FR-002**: The SharePoint indicator's inline panel MUST show the connection status and, when not
  connected, the **draggable bookmarklet install link** plus the same drag-to-bookmarks guidance the
  ServiceNow panel provides.
- **FR-003**: SharePoint relay connection status MUST be tracked **independently** of other systems'
  relay status, so ServiceNow and SharePoint never overwrite each other.
- **FR-004**: The app MUST keep the SharePoint relay status reasonably current (a periodic check on
  the same cadence used for the existing relay status), so the indicator and the intake panel reflect
  connect/disconnect without a manual refresh.
- **FR-005**: The Jira Intake pull panel MUST NO LONGER show the bookmarklet or connect steps; it
  MUST show the connection status + the **Pull** button, and — when not connected — a short pointer
  directing the user to the Connection Bar.
- **FR-006**: When connected, the intake **Pull** MUST behave exactly as in feature 007 (read List →
  existing queue → feature-006 dedup → create); this feature changes only where the user *connects*.
- **FR-007**: ServiceNow relay connect, status, and request relaying MUST remain unchanged and MUST
  NOT regress as a result of this change.
- **FR-008**: The bookmarklet in the Connection Bar MUST be a genuine drag-to-bookmarks link (not
  raw script text) and MUST warn if clicked in place rather than dragged (matching the ServiceNow
  panel behavior).

### Key Entities *(include if feature involves data)*

- **Per-system relay status**: The connection state (connected, last check time) tracked **per
  relay system** (at least ServiceNow and SharePoint), replacing a single shared relay-status value
  so multiple relays coexist.
- **SharePoint connection indicator**: The Connection Bar element (dot + label + inline panel)
  representing the SharePoint relay's status and connect affordance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can connect the SharePoint relay entirely from the Connection Bar (draggable
  bookmarklet + status) without opening the Jira Intake view.
- **SC-002**: The SharePoint and ServiceNow indicators each reflect their own relay's status
  correctly when **both** are connected — neither overwrites the other (0 cross-contamination).
- **SC-003**: The Jira Intake pull panel shows **no** bookmarklet/connect steps after this change;
  it shows status + Pull + a Connection-Bar pointer.
- **SC-004**: When connected, pulling from the intake panel yields the same result as before this
  change (feature 007/006 behavior unchanged; 0 duplicates).
- **SC-005**: ServiceNow relay connect/status/relaying continues to work with **0** regressions.
- **SC-006**: The SharePoint indicator reflects a connect or disconnect within one status-check
  cycle, with no manual refresh.

## Assumptions

- The Connection Bar, `BookmarkletInstallLink`, the SharePoint bookmarklet, the relay bridge (already
  supporting the `sharepoint` system), `sharepointIntakeApi`, and the feature-007 pull flow all exist
  and are reused unchanged except for the connect-UI relocation and the per-system status tracking.
- The **SharePoint indicator shows always** (like the Jira and Confluence indicators), not gated
  behind admin-unlock — intake is a non-admin workflow. (If the team prefers gating, that is a small
  toggle.)
- Relay status is polled on the **same cadence** the app already uses for the existing relay status.
- Jira is **Data Center**; feature-006 dedup and the create pipeline are unchanged.
- One active SharePoint List source (matches the single active intake configuration).

## Dependencies

- The existing Connection Bar + connection store (to be extended to per-system relay status).
- The relay bridge, SharePoint bookmarklet, and `BookmarkletInstallLink` (reused).
- Feature 007 (SharePoint pull) and feature 006 (dedup) — unchanged, only the connect UI moves.
