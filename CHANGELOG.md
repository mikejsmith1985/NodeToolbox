# Changelog — NodeToolbox

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **SNow Hub — PRB Generator uses 'Defect' issue type for enterprise Jira**: The primary issue now maps to the enterprise Jira issue type `Defect` instead of `Bug` when the defect checkbox is checked, matching the issue-type name expected on locked-down Jira instances.
- **SNow Hub — PRB Generator surfaces Jira error details on failure**: Jira POST errors now include the structured message from Jira's response body (e.g. "Issue Type is required.") rather than just the HTTP status code, so users can diagnose and fix problems without checking the network tab.
- **SNow Hub — PRB Generator preserves partial success**: If one of the two Jira issues is created and the other fails, the successfully created issue key is now shown alongside the specific error for the failed issue instead of discarding both results.
- **SNow Hub — PRB Generator shows full issue preview before creation**: Both Quick Create and the Wizard review step now display a structured preview card for each Jira issue (issue type, summary, and description) before the user clicks Create, so there are no surprises about what will be submitted.

### Added
- **Reports Hub — Dashboard tab**: Reports Hub now includes a Jira-style dashboard tab with saved-filter-style widgets for critical defects, blocked work, open risks, and unassigned work, plus donut summaries by team, priority, status, and source.
- **CRG — CTASK templates and append flow**: The Review & Create step now supports reusable CTASK templates, selecting CTASKs to create with the new CHG, and appending selected CTASKs to an existing CHG by number.
- **CRG — CTASK templates can be cloned from existing CTASKs**: The CTASK Templates panel can now load an existing ServiceNow CTASK by number and pre-fill the template editor for saving or adjustment.
- **CRG — templates can now be updated in place and include environment schedules**: Saved templates now have an **Update selected** action and preserve Step 5 REL/PRD/PFIX scheduling alongside Change Details and Planning fields.
- **CRG — Clone, Templates & Defaults workspace**: Change Request setup now uses a compact shared workspace for cloning an existing CHG, saving/updating templates, and managing reusable field defaults without bouncing backward through the wizard.

### Fixed
- **Home — Reports Hub is visible again on the launcher**: The React app already had the `/reports-hub` route, but the Home card catalog was missing the Reports Hub card entry, so users had no visible launcher card for the tool. The Reports Hub card is now restored to the Home view.
- **SNow Hub — PRB Generator summaries now support defect-or-story primary issues and incident-aware titles**: The primary Jira issue now uses an **Issue Summary** field with a default-to-defect checkbox, removes the old `Defect for` prefix, pulls the linked incident number from the PRB's related incident list, and formats summaries as `INC########: PRB#######: "Problem Statement"` while the second Jira issue always remains an `[SL] ...` story.
- **CRG — cloned reference fields and environment mapping are now resilient**: Cloned Change Manager/reference values render even when ServiceNow returns display-only or sys_id-only data, Step 5 environment checkboxes are all editable, and selecting REL/PRD/PFIX maps to the live ServiceNow Environment choice when a matching option exists.
- **CRG — blocked live dropdowns now stay editable**: When ServiceNow omits or blocks choice metadata, Change Details, Planning, and Environment fields switch to manual inputs so cloned CHG values and saved template values remain usable.
- **CRG — defaults now flow with the actual change-planning workflow**: Saved field defaults are now reusable inline on the matching inputs instead of collecting in a large pinned-values list, and Config Item mapping moved into Step 5 so it stays aligned with the selected environment instead of living in the earlier basic-details step.
- **CRG — blocked-choice guidance now explains what to do next**: Manual fallback fields now use step-level guidance and compact save/reuse controls so users know when to paste internal ServiceNow values, clone from an existing CHG, or apply known-good defaults instead of guessing from clipped placeholder text.
- **SNow relay — active status now waits for a live bookmarklet poll and session-token readiness**: The relay no longer treats a one-time bookmarklet registration as proof that ServiceNow API calls are ready. The bookmarklet refreshes token readiness when `g_ck` becomes available, the UI warns when the relay is connected but the token is not ready, and SNow write calls are blocked until the token is present.
- **CRG — dropdown loading waits for ServiceNow token readiness and merges metadata sources**: Change Request dropdowns now wait for the relay's `g_ck` signal before fetching choices and merge UI Form and UI Meta results so Step 4 planning fields are not skipped when Step 3 fields load first.
- **CRG — relay resume and successful CHG creation no longer restore stale wizard state**: Relay return routes now expire and ignore old plain-text values, and a successful CHG submission clears the persisted draft so the next SNow Hub visit starts fresh.
- **SNow Hub — PRB lookup now queries by number instead of treating PRB numbers as sys_ids**: The PRB Generator previously called `/api/now/table/problem/PRBxxxxxxx`, which ServiceNow treats as a sys_id lookup and returns 404. PRB loading now uses `sysparm_query=number=PRBxxxxxxx`, normalizes the Table API response, and maps display values into the UI.
- **CRG — dropdown choices no longer query direct `sys_choice` table access**: Change Request dropdowns now use SNow UI metadata endpoints (`/api/now/ui/form/change_request/-1`, then `/api/now/ui/meta/change_request`) and stop before the ACL-blocked `sys_choice` path that produced noisy 403 failures on locked-down instances.
- **CRG — 401 session-expiry now shows actionable recovery guidance**: When the SNow relay is active but a SNow metadata fetch returns HTTP 401, the warning banner now includes a plain-English hint: *"Your ServiceNow session has expired. Go to your SNow tab, log back in, then click Retry."* Similar hints are shown for 403 (permission error) and timeout failures. Unrecognized errors still display the raw message for diagnostics.

- **CRG — Dropdown failure now shows the exact error reason**: When the SNow relay is connected but the `sys_choice` fetch fails, the warning banner in Step 3 (Change Details) and Step 4 (Planning & Content) now displays the underlying error message (e.g., `SNow relay fetch failed: 401`) so the user can diagnose the problem immediately — expired SNow session, timeout, permission error, etc.
- **CRG — Dropdown placeholder distinguishes "not connected" from "load failed"**: Previously both states showed "Connect SNow relay to load options." Now, when the relay IS connected but the fetch failed, dropdowns correctly show "Load failed — click Retry above" so users know the relay is active and they only need to click Retry (not reconnect the relay).
- **CRG — Failure state resets immediately when a new fetch begins**: `isFetchFailed` and `fetchErrorMessage` are now cleared at the start of every fetch attempt (not just on manual Retry). This prevents a stale error banner from showing while a fresh auto-triggered request is already in flight.

- **CRG — Wizard state persists across relay reconnects**: The CRG wizard now saves all non-transient fields (project key, fix version, selected issues, generated descriptions, CHG details, planning content, environments) to `localStorage`. When the user navigates away to activate the SNow relay and returns to the tool, all previously entered data is automatically restored — no re-entry required.
- **CRG — SNow dropdown auto-loads when relay connects**: The `useSnowChoiceOptions` hook now subscribes to the relay connection status. Dropdowns that previously showed a permanent "relay not connected" failure (even after the relay became active) now automatically fetch options as soon as the relay transitions to connected — no page reload needed.
- **CRG — Warning banners show correct context-aware message**: Step 3 (Change Details) and Step 4 (Planning & Content) dropdown warning banners now distinguish between two states: (1) relay not yet connected — amber informational banner, options will load automatically; (2) relay connected but fetch failed — amber actionable banner with a **Retry** button to re-trigger the fetch without reloading the page.
- **Relay activation no longer reloads the NodeToolbox window**: The SNow bookmarklet now calls `window.open("","toolbox")` (empty URL) to focus the NodeToolbox window instead of navigating it. Passing the relay server URL caused Chrome to navigate the window to the root URL, triggering a full React reload that cleared DevTools console logs, reset in-memory state, and delayed dropdown loading. The previous route-restore safety net (`RELAY_RETURN_ROUTE_KEY`) is kept for backward compatibility with older bookmarklet versions already in users' bookmark bars.

### Added
- **Team Dashboard — Capacity tab**: New tab in the Sprint Dashboard for sprint capacity planning. Configure a date range (work days Mon–Fri are counted automatically), add team composition rows by role (Dev, QE, BT, SL, SA, PO, SM) with headcount, weighted allocation %, and total PTO days. Results show 100% and 80% capacity in story points (1 pt = 1 person-day). Supports multiple rows per role (e.g. 5 Devs at 100% + 1 Dev Lead at 50%). Configuration persists to localStorage across sessions.
- **CRG — Named templates**: Save, apply, and delete named presets of step 3 Change Details fields (Basic Info + Planning Assessment + Planning Content). Templates are stored in localStorage and appear in a template picker panel at the top of the Change Details step.
- **CRG — Dynamic SNow choice options**: Planning assessment dropdowns (Impact, Availability Impact, etc.) and Change Details dropdowns now fetch live choice options from the SNow `sys_choice` table in a single batch request. When the SNow relay is unavailable the dropdowns are disabled and an amber warning banner is shown — no hardcoded fallback values are used, preventing invalid data from being submitted to ServiceNow.

### Changed
- **CRG — Fix version dropdown now shows only unreleased versions**: Released versions are excluded from the fix version selector, since a Change Request should target an upcoming release, not one already shipped.
- **CRG — Clone CHG 401 error now shows session-expiry guidance**: When a CHG clone attempt returns HTTP 401, the error message now advises the user to check their SNow session and re-activate the relay.

### Added
- **SNow Hub CRG — 6-step Change Request wizard**: The CRG wizard expands from 5 steps to 6 with a new **Change Details** step (step 3) between "Review Issues" and "Planning & Content". Change Details includes:
  - Clone from existing CHG: enter a CHG number and click "Load CHG" to pre-fill all fields from an existing ticket
  - Basic CHG info: Category, Change Type, Environment, and Is Expedited dropdowns
  - SNow reference lookups via a new `SnowLookupField` component: Requested By, Config Item, Assignment Group, Assigned To, Change Manager, Tester, and Service Manager (all with debounced typeahead search against SNow tables)
- **`SnowLookupField` component**: Debounced typeahead that queries any ServiceNow reference table (`sys_user`, `sys_user_group`, `cmdb_ci`) and resolves the selected record's `sys_id` internally — displays a checkmark badge once a record is resolved
- **CRG Planning step expanded**: Step 4 now includes Implementation Plan, Backout Plan, and Test Plan textareas alongside the existing assessment dropdowns and generated field editors
- **`createChg` full CHG submission**: The Review & Create step (step 6) now posts all basic info, planning assessment, and planning content fields to SNow when creating a Change Request

### Changed
- **SNow Hub CRG — Enhance with AI now generates a copy-paste prompt**: The hidden Rovo AI feature (activated via Ctrl+Alt+Z) no longer calls a server API. Clicking "✦ Enhance with AI" now opens a modal with the generated prompt pre-populated — copy it, paste it into Rovo, and use the output to fill in the four CHG fields manually.

### Removed
- **Admin Hub — Rovo connectivity test removed**: The "🤖 Test Rovo" button and the Atlassian Rovo section have been removed from the Service Connectivity settings. (Atlassian has no public Rovo REST API for programmatic testing.)

### Added
- **CRG — Create CHG action**: The Results step now includes a **Create CHG** button that submits the generated content directly to ServiceNow (requires SNow relay to be active). Also added internal content enhancement capability for the Preview Docs step.

### Added
- **Confluence + Rovo connectivity tests in Admin Hub**: The Service Connectivity section now has a full **Confluence** subsection (Base URL, Atlassian email, Cloud API token, save + Test Connection button) and a **Rovo** subsection with a dedicated "🤖 Test Rovo" button. The Confluence probe hits `/wiki/rest/api/user/current`; the Rovo probe checks reachability of the Atlassian MCP server (`mcp.atlassian.com`). A note in the UI clarifies that Confluence Cloud uses Basic Auth with an Atlassian Cloud API token — not the same as a Jira on-prem PAT.
- **Connection Bar redesign — per-app nodes**: The connection bar now shows four app-specific indicators: **Jira**, **SNow**, **Confluence**, and **GitHub**. The standalone "Relay" node is removed — relay activation UX (bookmarklet install + Open ServiceNow) is now inline in the SNow panel. Confluence and GitHub indicators automatically reflect readiness from the proxy-status health check (credentials configured = ready). Clicking any node opens an inline details panel; clicking an app's node also provides an "Open [App]" shortcut button when a base URL is configured.

- **CRG — Custom JQL fetch mode**: The Change Request Generator's "Fetch Issues" step now supports a **Custom JQL** mode alongside the existing "By Project & Version" flow. A radio group lets users switch between the two modes; selecting Custom JQL reveals a textarea where any valid Jira Query Language expression can be entered. The generated documentation (short description, justification) adapts its label when JQL mode is active.

- **Feature Request in AdminHub**: A new "💡 Request a Feature" section at the bottom of the AdminHub Config tab.Users with a GitHub account can open a pre-filled issue directly (`🚀 Open GitHub Issue`). Users without one can click **📋 Copy Request** to copy the formatted request as plain text and send it via email, Teams, or any other channel.

### Fixed

- **Admin Hub — unlock form now appears at the top of the Config tab**: `AdminAccessSection` was previously rendered after `ServiceConnectivitySection`, so the "🔒 Unlock Admin Access" message was visible with no nearby login form, making it appear that unlocking was broken. The section order is now: Admin Access → Proxy → Service Connectivity → ART Settings.

- **Update Manager — silent failure on slow connections**:The `POST /api/update` route previously responded with `{ ok: true, restarting: true }` *before* starting the download. On any connection where the 21 MB exe-zip took more than 3 seconds to download, the client's `pollUntilServerRestarts()` would poll the still-alive old server, get a 200 OK, and reload the page — silently showing the same version with no error. The server now waits for the download and extraction to complete, *then* responds and spawns the replacement process after a 300 ms flush window. Download errors are now surfaced to the client as HTTP 500 with an error message instead of being silently swallowed.

- **Top bar — duplicate Home navigation removed**: The "⌂ Home" button that appeared next to the "NodeToolbox" title was redundant — clicking the app title already navigates home (standard UX pattern). The separate button has been removed to de-clutter the header.
- **Admin Hub connectivity test messages**: Confluence HTTP 403 now shows an actionable explanation (wrong credential type — use an Atlassian Cloud API token from id.atlassian.com, not a Jira on-prem PAT). Rovo HTTP 400 is now treated as a **successful reachability check** (the MCP protocol requires POST; a GET probe receiving 400 confirms the server is live) — previously this displayed ❌ when it should display ✅.

- **Connectivity test results always showed ❌**: All four test functions in `connectivityConfigApi.ts` used a TypeScript `as` cast instead of actually transforming the server JSON. The server returns `{ ok }` but `ConnectionProbeResult` expects `isOk` — the cast was a compile-time lie, leaving `isOk` as `undefined` (falsy) at runtime regardless of the actual test outcome. Fixed by adding a `parseProbeResponse()` helper that explicitly maps `data.ok → isOk`.


- **ServiceNow issues in My Issues**: The My Issues tool now fetches all SNow work items assigned to the current user — incidents, problems, service-catalog tasks, and change requests — via the SNow relay. A "Fetch SNow Issues" button appears in the toolbar when the source is set to "My Issues".
- **Auto-detected Jira ↔ SNow links**: The app detects bidirectional links between Jira Defects/Stories and SNow Problems using existing field conventions (`customfield_11203` on Jira, trailing Jira key in SNow `problem_statement`). No new fields or configuration required.
- **Health badge on linked pairs**: Linked Jira↔SNow pairs are displayed as collapsible paired cards above the regular issue list. Each pair shows a color-coded health badge — 🟢 green (all mapped fields match), 🟡 yellow (partial mismatch), 🔴 red (no fields match).
- **Status mapping configuration**: A new "Jira → ServiceNow Status Mapping" editor in the My Issues Settings tab lets users define which Jira status names correspond to which SNow state labels. The system mapping (`To Do → New`) is always active. All user-configured mappings persist in `localStorage` and survive app updates — no reconfiguration needed after an update.
- **Unlinked SNow issues section**: SNow issues that are not part of a Jira link appear in a collapsible "ServiceNow Issues" section below the main issue list, so nothing is hidden from the user.

### Changed (Home — removed role/persona filter buttons)
- **Home view — Dev, QA, SM, PO, RTE buttons removed**: The persona filter strip provided no real value; it only reordered cards without unlocking role-specific workflows, data, or views. The Home view now always shows all cards in sectioned layout. Saved drag order is preserved. `homePersona`/`setHomePersona` have been removed from the settings store and from localStorage.

### Fixed (update install — missing version in request body)
- **Auto-update — 400 error fixed**: The "Install Update" button was POSTing to `/api/update` with no body, triggering `{"error":"version is required"}`. The request now sends `{ version: latestVersion }` as JSON so the server can download the correct release.


- **My Issues — color-coded status badges**: Status column now renders pill-shaped badges with zone-appropriate colors — blocked (red glow), in-progress (purple glow), in-review (cyan glow), done (green), todo (gray).
- **My Issues — color-coded priority badges**: Priority column renders colored pills — Highest/Critical (red), High (orange), Medium (amber), Low (indigo), Lowest (slate).
- **My Issues — sticky glass table header**: The table header is now `position: sticky` with `backdrop-filter: blur(8px)` and an accent-blue bottom border line.
- **My Issues — row hover glow**: Table rows highlight with a subtle blue glow and a left accent border bar on hover.
- **My Issues — status zone chips**: Each chip has a zone-colored top border (red/purple/cyan/gray/green) and matching box-shadow glow on hover/active.
- **Issue key links**: Monospace key links (`PROJ-123`) now render in cyan with a text-shadow glow on hover.
- **AppCard — hover glow**: Home view tool cards now have a blue glow + lift shadow on hover.
- **Topbar — gradient accent line**: The top bar border-bottom is now a blue-to-purple gradient accent instead of a flat line.
- **Tokens — added glow vars**: `--color-cyan`, `--color-purple`, `--glow-accent`, `--glow-success`, `--glow-warning`, `--glow-danger`, `--glow-purple`, `--glow-cyan` added to `:root`.

### Fixed (v0.7.8 — Relay bookmarklet install on React 19)
- **Relay bookmarklet — drag-to-bookmarks works again**: React 19 blocks `javascript:` URLs passed through JSX `href` props, which produced the browser error `React has blocked a javascript: URL as a security precaution` and prevented the SNow relay bookmarklet from installing. The relay setup links now assign the bookmarklet URL directly to the DOM anchor after render, preserving drag-to-bookmarks installation without triggering React's sanitizer.

### Fixed (v0.7.6 — Repair Chrome-safe ServiceNow relay)
- **Relay — fixed the Chrome bridge instead of relying on broken tab messaging**: ServiceNow is still opened in the original named `__crg_snow` tab, but the bookmarklet now registers, polls, and returns results through the local HTTP bridge at `http://127.0.0.1:5555/api/relay-bridge/*`, avoiding Chrome/Edge COOP breakage.
- **Relay bridge — added CORS/private-network headers**: `/api/relay-bridge/*` now explicitly allows ServiceNow bookmarklets to call the local NodeToolbox bridge, including `Access-Control-Allow-Private-Network: true` for Chrome/Edge private-network preflight checks.
- **Relay — ServiceNow `g_ck` support restored**: The bookmarklet again extracts ServiceNow's `g_ck` token (`window.g_ck`, `NOW.GlideConfig.g_ck`, or `glide_user_activity`) and sends it as `X-UserToken`, matching the working HTML ToolBox implementation.
- **Relay — proxy no longer masks disconnected state**: Normal SNow app calls no longer silently fall back to `/snow-proxy/*` when the relay is inactive. Direct proxy remains available only for explicit diagnostics/admin probes via `forceDirectProxy`.
- **ConnectionBar — SNow status now means relay-connected**: SNow turns green only after the bookmarklet handshake succeeds, not after a server-side proxy probe.
- **Relay setup — removed Copy Code dead-end**: The relay UI now only exposes the draggable bookmarklet. Clicking it inside NodeToolbox shows a clear instruction to drag it to the bookmarks bar first instead of silently doing nothing.
- **Relay bookmarklet — bridge failures are visible**: If the bookmarklet cannot reach the local NodeToolbox bridge, ServiceNow now shows a red failure badge and an alert instead of silently doing nothing.
- **Relay bridge — disconnects fail fast**: If the ServiceNow tab closes or navigates away while NodeToolbox is waiting for a relay result, the request now fails immediately with a recovery message instead of hanging until the 30-second timeout.

### Fixed (v0.7.5 — Relay connect flow, single-tab launch, update install)
- **Relay — Open ServiceNow button**: A `🔗 Open ServiceNow` button now appears in the Relay panel when a SNow base URL is configured and the relay is not yet active. Click it to open the SNow page, activate the bookmarklet, and the relay indicator turns green.
- **Relay — bookmarklet activation feedback**: The bookmarklet now shows a green confirmation banner on the SNow page after successful registration ("✅ NodeToolbox relay active — keep this tab open") and automatically focuses back to the NodeToolbox tab via `window.open('', 'nodetoolbox')`. The `window.name` is set to `'nodetoolbox'` in the React app so the browser can locate the tab by name.
- **Relay — registration error surfaced**: Bookmarklet now shows a user-visible `alert()` and logs a `console.error` if NodeToolbox is not reachable on port 5555 (previously the error was silent in AdminHub's copy of the bookmarklet).
- **Launch — double browser tab fixed**: The VBS launcher now passes `--no-open` to the exe, preventing both processes from opening the browser simultaneously. The VBS is the sole browser-opener (after its port-ready poll confirms the server is up); the exe only opens the browser when launched directly (without VBS).
- **Update Management — Install Update button**: Admin Hub now shows a `🔄 Install Update` button when an update is available. Clicking it POSTs to `/api/update`, waits up to 60 seconds for the server to restart, then reloads the page to run the new version. Progress ("⏳ Installing and restarting…") and error states are displayed inline.

### Fixed (v0.7.4 — Relay bridge actually works now)
- **Root cause fix — SNow API calls now route through relay**: `snowFetch` was hardcoded to always use the server-side proxy (`/snow-proxy/*`), ignoring the relay bridge entirely. SNow API calls now check `connectionStore.relayBridgeStatus.isConnected` and route through the relay bridge bookmarklet when active. `forceDirectProxy: true` can override this for callers that need direct access.
- **Status type mismatch fixed**: The server `/api/relay-bridge/status` endpoint returned `{ active, sys }` but the React client's `RelayBridgeStatus` type expected `{ isConnected, system }`. The runtime object never had `isConnected`, so the relay indicator was permanently red even when the bookmarklet was running. Server now returns the correct shape: `{ isConnected, system, lastPingAt (ISO string), version }`.
- **Relay polling reduced from 30 s → 3 s**: Indicator now turns green within 3 seconds of bookmarklet activation instead of up to 30 seconds.
- **Bookmarklet registration failure is now visible**: If the bookmarklet can't reach NodeToolbox on port 5555, it now logs a `console.error` and shows an alert, rather than silently doing nothing.

### Fixed (v0.7.3 — Check for Updates)
- **Admin Hub — Check for Updates**: Fixed silent failure where network/server errors made the button appear to do nothing. Errors are now displayed below the button with a clear message. Added missing CSS classes (`updateVersionRow`, `updateStatusAvailable`, `updateStatusSuccess`, `updateStatusError`, `releaseNotesTextarea`) so the result area renders correctly.

### Added (v0.7.2 — Relay Connect panel, Snow/GitHub config UI, expanded diagnostics)
- **ConnectionBar — Relay `Connect` button**: Each indicator (Relay, Snow, Jira) is now a clickable button. Clicking the Relay indicator opens an inline setup panel with a draggable bookmarklet link and step-by-step instructions. Clicking an already-open panel closes it; clicking outside dismisses it.
- **Admin Hub — Service Connectivity section**: New section (unlocked by admin access) with forms to set Snow `baseUrl`, `username`, and `password`, and GitHub `baseUrl` and Personal Access Token. Credentials are saved server-side to `toolbox-proxy.json` (AppData). Includes `Test Connection` buttons for live probes against each service.
- **Diagnostics — expanded payload**: `GET /api/diagnostics` now returns `isPkgExe`, `platform`, `snow` (baseUrl, credential presence, masked username, session state), `relay` (active systems, last registered/polled timestamps), and `github` (baseUrl, PAT presence).
- **API — connectivity config endpoints**: `GET /api/config/connectivity` returns sanitised Snow/GitHub config for the UI; `POST /api/config/connectivity` saves updated config; `POST /api/config/connectivity/test` probes Snow or GitHub and returns `{ ok, statusCode, message }`.

### Fixed (v0.7.1 — VBS launch fix)
- `Launch Toolbox Silent.vbs`: replaced `Chr(8594)` with `ChrW(8594)` — VBScript's `Chr()` only accepts 0–255; the Unicode right-arrow (→, codepoint 8594) caused a `800A0005` runtime error that prevented the timeout-diagnostic dialog from rendering, crashing the launcher on startup.

### Added (v0.6.9 — Home layout polish)
- Header: "NodeToolbox" title and "⌂ Home" button are now grouped flush-left; `ConnectionBar` stays right.
- Home screen: heading and sub-heading are centered; persona filter, recents, and card grid remain left-aligned.

### Removed (v0.6.8 — Mermaid removal)
- Removed `mermaid` npm dependency (was ~2260 modules) — **vite build time drops from ~10 min → ~12 sec**.
- Deleted the `MermaidEditor` view entirely (`MermaidEditorView.tsx`, `useMermaidEditorState.ts`, CSS, and all tests).
- Removed the "🧜 Mermaid" tab from the Text Tools view.

### Added (v0.6.7 — Server process controls)
- **Admin Hub → Proxy & Server Setup**: Added "🔄 Restart Server" and "⛔ Kill Port 5555" buttons.
  - "Restart Server" calls `/api/restart` — spawns a fresh process and exits the current one.
  - "Kill Port 5555" calls `/api/shutdown` — stops the server entirely; relaunch the exe to recover.
  - On every launch, `portManager` already automatically kills any occupant of port 5555 before binding, so relaunching the exe always results in a clean single instance.
  - Confirmation messages appear inline after each action.

### Fixed (v0.6.6 — Connection bar always red bug)
- Root-cause fix: `ProxyStatusResponse` TypeScript type was entirely wrong — it had flat fields (`jiraConfigured`, `snowConfigured`) but the server actually returns a nested structure (`{ jira: { ready, configured, ... }, snow: { ... } }`). This meant `isJiraReady` was always `false` regardless of actual connectivity, keeping every indicator permanently red.
- Updated `ProxyStatusResponse` to the correct nested shape with `ProxyServiceStatus` and `ProxySnowStatus` sub-interfaces.
- Updated `connectionStore.setProxyStatus` to read `status.jira.ready` and `status.snow.ready`.
- Updated `useProxyStatus` to probe Jira/SNow based on `status.jira.configured` and `status.snow.configured`.
- Updated all tests (including `proxyApi.test.ts`) to use the correct nested mock shape.

### Fixed (v0.6.5 — UX polish)
- Made whole issue cards clickable to toggle the inline detail panel in Sprint Dashboard (overview, assignee, blockers, stale), ART View impediments, and My Issues — the caret icon remains as a visual affordance hint.
- Connection status bar now shows a **green** dot when a service is configured, and a **red** dot when it is not — replacing the ambiguous gray that made all services look identical regardless of connectivity.

### Fixed (v0.6.4 — Issue #45 follow-up fixes)
- Replaced Admin Hub browser-native prompts, confirms, and alerts with shared in-app prompt, confirm, and toast components so advanced unlock, reset flows, and backup/restore errors stay inside the app UI.
- Added a visible global Home button outside the landing page so users can return to the dashboard from any tool screen.
- Fixed Snow Hub CRG fix-version loading so unreleased Jira versions populate a dropdown with text-input fallback when metadata is unavailable.
- Added ART team persistence plus project-key filtering so saved teams survive reloads and overview or impediment views can be narrowed by project.
- Reworked My Issues detail expansion to open inline within cards, compact rows, and table rows instead of relying on the old side panel interaction.

### Changed (v0.6.3 — Jira inline issue actions phase 3)
- Added a shared inline `IssueDetailPanel` with status transitions, comment posting, and story-point editing, then wired expandable issue rows into Sprint Dashboard, ART impediments, and My Issues detail workflows for closer parity with the original HTML app.

### Changed (v0.6.3 — Jira picker parity phase 2)
- Replaced Jira field, board, and project ID text inputs in Sprint Dashboard, ART View, and Dev Workspace settings with API-backed dropdown pickers that still fall back to manual entry when Jira metadata cannot be loaded.

### Changed (v0.6.3 — Home card consolidation phase 1)
- Reduced the Home view from 23 cards to the original 8-card layout by keeping sprint-dashboard, art, my-issues, dev-workspace, snow-hub, text-tools, code-walkthrough, and admin-hub.
- Folded Story Pointing into Sprint Dashboard, Mermaid into Text Tools, Hygiene into My Issues, and Dev Panel into a new Admin Hub tab while preserving the legacy standalone routes as redirects.
- Removed the unused Home reports section while keeping legacy recent-view labels so old bookmarks and recent links continue to resolve cleanly.

### Added (v0.6.2 — Deep parity across 8 views)

#### Sprint Dashboard
- **Kanban board support + board picker**: detects Kanban boards (no active sprint), loads issues directly, board selector dropdown with auto-pick and localStorage save/restore (`tbxSprintDashboardBoardId`).
- **Move-issue-to-sprint**: per-card "Move to Sprint" action loads active/future sprints and calls Jira agile API; inline success/error feedback.
- **Advanced settings**: stale-days threshold, story-point scale, sprint window, cycle-time start/done fields, Kanban period, custom story-points and epic-link field IDs — all persisted under `tbxSprintDashboardConfig`.
- **Stale highlighting**: all tabs now use the configurable stale-days threshold instead of a hardcoded value.

#### My Issues
- **Persona Intel Strip** (`PersonaIntelStrip`): clickable zone chips per persona (Dev/QA/SM/PO) derived from issue state. Chips delegate zone filtering to `onZoneClick` so the intel strip integrates with the existing status-zone dashboard.
- **Swimlane Card View** (`SwimlaneCardView`): replaces the flat card list in `cards` mode with five collapsible swimlanes (Needs Attention 🔴 / In Progress 🔵 / In Review 🟣 / To Do ⚫ / Done ✅). `done` lane collapsed by default matching legacy behaviour.
- **Needs Attention badges + aging labels**: blocked/critical/past-due reasons rendered as inline badge chips. Aging label turns amber at >5 days, red at >10 days.
- **xlsx + TSV export**: "Download as Excel (.xlsx)" (SheetJS, lazy-imported) and "Copy as TSV" export options.
- **Bulk select + bulk comment**: toolbar "Bulk" button; sticky `BulkCommentPanel` posts one comment to all selected issues in parallel.
- **Board quick filters** (`BoardPillAndFilters`): dismissible board-name pill + quick-filter chip row after board load.

#### ART View
- **Blueprint Tab** (`BlueprintTab`): PI→Feature→Story hierarchy viewer with 4 view modes, search filter, collapse/expand all, health ring per feature, off-train story detection.
- **Dependencies Table** (`DependenciesTab`): filterable table of cross-team issue links by team and link type.
- **SoS Narrative fields**: 5 editable narrative fields (Yesterday/Today/Blockers/Risks/Dependencies) with auto-generate from live data, localStorage persistence keyed by team + date, revert-to-auto.
- **Monthly Report Tab**: month selector, editable metric cards, Copy All, Export HTML; persisted by team + YYYY-MM.
- **Advanced ART Settings**: PI Field ID, Story Points Field ID, Feature-Link Field ID, Stale Days threshold.

#### DSU Board
- **Multi-criteria filters**: issue type, priority, fix version, PI, and status pills (AND logic).
- **Release override / auto-detect**: auto-detects current unreleased fix version; user can override via dropdown.
- **Standup Notes Panel**: Yesterday/Today/Blockers textareas with auto-fill from Jira activity, copy-to-clipboard, and collapsed-state persistence (`tbxDsuStandupNotes`).
- **Issue Detail Overlay**: full issue detail modal with workflow transitions (load + apply), per-issue comment posting, and per-issue SNow root-cause URL field.
- **SNow release enrichment**: scans issue summaries and remote links for INC/PRB patterns; shows SNow badge on matching cards.

#### SNow Hub — PRB Sync Monitor tab (new tab)
- **Sync engine** (`useSnowSyncEngine`): configurable Jira→SNow polling (1/5/15/30 min interval), localStorage-backed per-issue state, status-change pushes, comment mirroring to SNow work_notes.
- **Settings panel**: JQL template, poll interval, work-note prefix, sync-comments toggle.
- **Status mapping editor**: fetch Jira statuses, map each to a SNow problem state, persist to `tbxPrbSyncMappings`.
- **Run status bar**: Running/Stopped badge, Start/Stop button, last-check time, live countdown, tracked-issue count.
- **Activity log**: colour-coded (info/status/comment/error), 200-entry cap, Clear button.
- **Manual Sync Now** and **Export PS1** (generates standalone PowerShell sync script).

#### Admin Hub
- **Enterprise Standards Rules panel**: view/edit/add custom hygiene rules, reset to defaults (`tbxEnterpriseStandards`).
- **Credential Management section**: GitHub PAT masked input with show/hide/clear; Jira + SNow settings links.
- **Admin lock/unlock gate**: `🔒 Advanced` button gates feature flags, diagnostics, and backup sections.
- **Tool Visibility section** (admin-gated): per-card enable/disable toggles for all 23 home cards, Show All / Hide All.
- **Client Diagnostics panel** (admin-gated): browser UA, localStorage usage estimate, active settings, link to Dev Panel.
- **Backup / Restore** (admin-gated): export all `tbx*` localStorage keys as JSON, import from file, Reset All Data with confirmation.

#### Reports Hub
- **Explainer cards**: collapsible "About this report" card per tab with use-case description; collapsed state persisted per tab (`tbxReportsHubHelp`).
- **Throughput benchmark row**: 6-sprint rolling average reference line, legend, and per-sprint delta column (green/red).
- **Copy Report button**: formats current tab data as plain-text bullet list and copies to clipboard.
- **Last-generated timestamp**: shown below each tab header; persisted per tab (`tbxReportsLastGenerated`).

#### Dev Workspace
- **Full settings surface**: GitHub PAT, sync interval, max commits, commit key pattern, message template, posting strategy (comment vs worklog), branch-prefix stripping — all persisted under `tbxDevWorkspaceConfig`.
- **Real polling engine** (`useGitHubPollingEngine`): start/stop, live countdown, syncNow, proxy→direct→mock fallback chain.
- **Multi-key post preview**: extracted Jira key pills ("Will post to: [ABC-123]") with Post to All.
- **PowerShell hook generator**: post-commit.ps1 + post-merge.ps1 downloads with settings baked in.

### Test coverage
- v0.6.1 baseline: 92 files / 745 tests
- v0.6.2: **115 files / 1,017 tests** (+23 files, +272 tests)


- **Blueprint Tab** (`BlueprintTab`): PI→Feature→Story hierarchy viewer with 4 view modes (flat, grouped-by-feature, grouped-by-team, kanban), search filter, collapse/expand all, conic-gradient health ring per feature, and off-train story detection.
- **Dependencies Table** (`DependenciesTab`): replaces the SVG dependency map with a filterable table of cross-team issue links. Supports team and link-type filters. Fully table-based for accessibility.
- **SoS Narrative fields**: deepened the Stand-of-Stands panel with 5 editable narrative fields (Yesterday / Today / Blockers / Risks / Dependencies), auto-generated from live sprint data, with localStorage persistence (keyed by team + date) and a revert-to-auto action.
- **Monthly Report Tab**: full implementation replacing the stub — month selector, editable metric cards (velocity, quality, delivery confidence, highlights, next priorities), Copy All, and Export HTML. Data persisted in localStorage keyed by team + YYYY-MM.
### Added (v0.6.1 — Toolbox parity completion)
- **Dev Panel view** (`/dev-panel`): live API call inspector ported from legacy `26-dev-panel.js`. Subscribes to a new `toolbox:api` window event so every Jira/ServiceNow request emitted by `jiraApi.ts` is logged with method, URL, status code, duration, and any error message. Pause/resume capture, clear log, and CSV export. Capped at 500 entries to bound memory.
- **Impact Analysis view** (`/impact-analysis`): blast-radius calculator ported from legacy `15-impact-analysis.js`. Enter a Jira issue key, fetch its child issues + linked issues + fix versions + impacted teams (assignee+component union), and render a one-screen summary with severity-coded counts. Pure functions in `utils/blastRadius.ts` keep the math testable.
- **Release Monitor view** (`/release-monitor` — lite): release-readiness dashboard ported from legacy `21-release-monitor.js` (lite scope). Pick a project + fix version; see story-point progress, open defects against the version, and a readiness signal (Green / Amber / Red). ServiceNow CTASK creation, GitHub events, and PR linkage are intentionally deferred — the lite slice covers the daily "is this release ready?" question.
- **PRB Setup Wizard** (`/snow-hub` → PRB tab): four-step wizard UI (Pick PRB → Defect → Story → Review) ported from legacy `25-prb-setup.js`. Wraps the existing `usePrbState` hook unchanged; PrbTab now exposes a Quick Create / Wizard mode toggle so power users keep the dense form and new users get a guided flow.
- **`toolbox:api` event bus** in `client/src/services/jiraApi.ts`: every `jiraGet`/`jiraPost`/`jiraPut` call now dispatches a `CustomEvent('toolbox:api', { detail: { method, url, status, durationMs, errorMessage } })` on `window`. Status code is parsed from the rejected error message on failures. Powers Dev Panel; SSR-safe (no-op when `window` is undefined).
- Three new home cards: Dev Panel 🛰️ (Administration), Impact Analysis 💥 and Release Monitor 🚀 (Reports). Persona-aware ordering across all six personas — RTE/PO/SM see Release Monitor and Impact Analysis promoted; Dev persona keeps Dev Panel near the bottom (admin-style tool).

### Notes — architectural N/A items (will not be ported)
- **Connection Wizard:** legacy ToolBox stored Atlassian PATs in `localStorage` and round-tripped Jira/ServiceNow calls through a per-user Relay. NodeToolbox replaces that entire flow with the server-side `/jira-proxy` and `/snow-proxy` routes plus the existing Settings view. A standalone Connection Wizard would have nothing to configure on the client.
- **AI Chat / Rovo:** legacy `19-ai-chat.js` calls Atlassian Cloud Rovo APIs that this deployment does not have access to. Will be revisited if/when Rovo access becomes available.

### Added (v0.6.0 — Toolbox parity slice 4)
- **Standup Board view** (`/standup`): standalone status-category boardwalk ported from `13-standup-board.js`. Three-column layout (To Do / In Progress / Done) sorted oldest-first to surface stale work, status filter pills per column, optional Hide-Done toggle, age-coloured cards (≤2 days ok / ≤5 days warn / >5 days old), blocked indicator, and a built-in **15-minute standup timer** (start/pause/reset, with `warn` styling at ≤5 min and `urgent` at ≤2 min). Flow stats bar shows WIP / stale / blocked / avg-age. Persists `{jql, hideDone}` to `localStorage` (`tbxStandupJql`).
- **Metrics view** (`/metrics`): standalone sprint-metrics dashboard ported from `10-metrics.js`. Predictability across the last N closed sprints (committed vs completed story points, completion %, 80% target line), throughput trend (issues + SP per sprint), and a simplified resolution-date-based cycle-time card (mean / median / p90). Inputs: board ID, project key, sprint window. Handles Kanban boards gracefully and degrades cleanly when the legacy greenhopper sprint-report endpoint is unavailable. Persists config to `localStorage` (`tbxMetricsConfig`).
- **DSU Daily view** (`/dsu-daily`): standalone daily-standup helper ported from `11-dsu-daily.js`. Auto-fills "Yesterday" (your issues updated yesterday) and "Today" (your open issues) as bullet lists, plus an editable Blockers field. Live preview pane, copy-to-clipboard, and post-as-Jira-comment to any issue key. Persists the editable draft to `localStorage` (`tbxDsuDraft`).
- Three new home cards (Standup Board 🧍 + DSU Daily 🗒️ in Agile & Delivery, Metrics 📐 in Reports) with persona-aware ordering across all six personas (SM/RTE see Standup + Metrics promoted near the top).

### Notes for follow-up versions
- Toolbox v0.24.10 → NodeToolbox parity continues. Remaining slices tracked for `v0.6.1+`: Release Monitor, Dev Panel (API inspector), Connection Wizard, AI Chat / Rovo, PRB Setup Wizard overlay, Impact Analysis, plus partial gaps inside My Issues, ART View, Sprint Dashboard, DSU Board, SNow Hub, and Admin Hub. Standup Board's per-card changelog drill-down, "Post Update" / "Raise Blocker" actions, and personwalk view were intentionally deferred. Metrics' full changelog-based cycle time, status-bottleneck breakdown, and spillover tracking were intentionally deferred.

### Added (v0.5.9 — Toolbox parity slice 3)
- **Defect Management view** (`/defects`): standalone defect tracker ported from `08-defect-management.js`. Project-key + extra-JQL inputs; filters for priority, status category, and unassigned-only; sorts by priority+age, age, or last update. Persists `{projectKey, extraJql, filter, sort}` to `localStorage` (`tbxDefectFilters`).
- **Hygiene view** (`/hygiene`): standalone issue-health checker ported from `22-hygiene.js`. Runs five hygiene checks per active issue (missing story points, stale, no assignee, no acceptance criteria, old-in-sprint), shows summary tiles with click-to-filter behaviour, and a drillable list of flagged issues. Persists project key + active filter to `localStorage` (`tbxHygieneProjectKey`, `tbxHygieneFilter`).
- **Pipeline View** (`/pipeline`): standalone epic pipeline visualization ported from `18-pipeline-view.js`. Lists every epic in a project grouped by status category, with lazy child fetch on expand, story-point rollups, and completion percentage. Falls back from `parent=` JQL to `"Epic Link"=` for older Jira deployments. Persists project + filter state to `localStorage` (`tbxPipelineFilters`).
- Three new home cards (Defect Management 🐛, Hygiene 🧼, Pipeline View 🛤️) all in the Agile & Delivery section, with persona-aware ordering across all six personas (QA leads with defects+hygiene; SM/PO/RTE see pipeline near the top).

### Notes for follow-up versions
- Toolbox v0.24.10 → NodeToolbox parity continues. Remaining slices tracked for `v0.6.0+`: Standup Board (boardwalk + 15-min timer), Release Monitor, Dev Panel (API inspector), DSU Daily, Connection Wizard, AI Chat / Rovo, PRB Setup Wizard, Impact Analysis, Metrics-as-tab, plus partial gaps inside My Issues, ART View, Sprint Dashboard, DSU Board, SNow Hub, and Admin Hub. Several of these (DSU Daily, Connection Wizard, Rovo) need adaptation rather than direct ports because they're tightly coupled to the legacy PAT/Relay/SD_STATE plumbing that NodeToolbox replaces with server-side routing.

### Added (v0.5.8 — Toolbox parity slice 2)
- **Story Pointing view** (`/pointing`): single-user planning poker — load Jira issues by JQL or comma-separated keys, vote with a Fibonacci deck (1, 2, 3, 5, 8, 13, 21, ?), reveal/reset, and optionally save the final estimate back to Jira through the `jiraPut` helper. State persists to `localStorage` (`tbxStoryPointingState`) so refresh never loses the deck. Multi-user/relay voting is intentionally deferred until NodeToolbox has shared real-time session infrastructure.
- **Mermaid Editor view** (`/mermaid`): split-pane editor with live SVG preview, debounced 300 ms render, starter templates (flowchart, sequence, class, gantt, ER), Copy SVG to clipboard, and Download SVG file. Diagram source persists to `localStorage` (`tbxMermaidEditorState`). Adds `mermaid@11.14.0` as a runtime dependency.
- **Pitch Deck view** (`/pitch-deck`): six-slide executive presentation explaining the Toolbox business case, with prev/next buttons, thumbnail strip, slide indicator, and full keyboard navigation (←/→ to step, Home/End to jump). Current slide index persists to `localStorage` (`tbxPitchDeckIndex`).
- Three new home cards (Story Pointing 🎲 in Agile & Delivery, Mermaid Editor 🧜 in Text Tools, Pitch Deck 🎯 in Documentation) with persona-aware ordering across all six personas.

### Notes for follow-up versions
- Toolbox v0.24.10 → NodeToolbox parity continues. Remaining slices tracked for `v0.5.9+`: Defect Management, Pipeline View, Hygiene panel, Standup Board (boardwalk + 15-min timer), DSU Daily, Release Monitor, Impact Analysis, Connection Wizard, PRB Setup Wizard overlay, Dev Panel (API inspector), AI Chat / Rovo, plus partial gaps inside My Issues, ART View, Sprint Dashboard, DSU Board, SNow Hub, and Admin Hub.

### Added (v0.5.7 — Toolbox parity slice 1)
- **Sprint Planning view** (`/sprint-planning`): pull the open backlog for any Jira project, search/filter loaded issues, edit story points inline, and persist all pending edits with one batch save through the existing `/jira-proxy` route. Includes auto-detection between `customfield_10028` and `customfield_10016` for the story-points field, per-issue save error tracking, and a pending-changes counter.
- **Work Log view** (`/work-log`): per-issue stopwatches that persist to `localStorage` (`tbxWorkLogState` — same key as legacy ToolBox so existing data is reused), Start/Pause/Remove timer controls, free-form duration parsing (`1h 30m`, `45m`, bare numbers as minutes), Today/History tabs, and a confirm dialog that POSTs the elapsed time to Jira's `/issue/{key}/worklog` endpoint with optional comment. History is capped at 200 entries to bound localStorage growth.
- New `jiraPut(path, body)` helper in `client/src/services/jiraApi.ts` so views can perform PUT calls through the same `/jira-proxy` passthrough that already supports GET and POST.
- Home cards for Sprint Planning (📋) and Work Log (⏱) added to the Agile & Delivery section, with persona-specific ordering (PO/SM see Sprint Planning prominently; Dev/QA see Work Log promoted near the top).

### Notes for follow-up versions
- Toolbox v0.24.10 → NodeToolbox parity is still ~80% remaining. The remaining missing/partial views are documented in the session plan and tracked for `v0.5.8+`: Mermaid editor, Story Pointing, Defect Management, Pipeline View, Hygiene panel, Standup Board (boardwalk + 15-min timer), DSU Daily, Release Monitor, Impact Analysis, Connection Wizard, PRB Setup Wizard overlay, Dev Panel (API inspector), AI Chat / Rovo, plus partial gaps inside My Issues, ART View, Sprint Dashboard, DSU Board, SNow Hub, and Admin Hub.

### Fixed
- **React build not found on exe launch (root cause fix)**: The pkg `assets` configuration was silently failing to include `client/dist/**/*` in the executable snapshot. End-to-end testing in a clean temp directory containing ONLY the exe (no `client/dist/` on disk) reproduced the "⚠ React build not found" 503 page on `/admin-hub` even after v0.5.4 and v0.5.5 attempted fixes. Verified via diagnostic logging that pkg's snapshot virtual filesystem returned `ENOENT File '...client/dist/index.html' was not included into executable at compilation stage` despite multiple asset configurations (glob, explicit list, CLI `--assets` flag).
  - Solution: bake the entire React build into a JavaScript module (`src/embeddedClient.js`) at release time as base64-encoded `Buffer` literals. pkg always bundles JS source as bytecode, so the SPA now ships *inside* the executable independent of the asset virtualization layer.
  - New script `scripts/generate-embedded-client.js` walks `client/dist/` and emits the embedded module.
  - `scripts/local-release.ps1` runs the generator as new step `[3.5/6]`, after the React build and before pkg.
  - `server.js` static middleware in pkg mode now serves directly from the in-memory embedded map; SPA catch-all returns `embeddedClientFiles['index.html']`.
  - Verified end-to-end: copying ONLY the new exe to a clean temp directory (no `client/dist/` anywhere on disk) → `/admin-hub` returns React HTML with title "NodeToolbox", `/favicon.svg` serves with `image/svg+xml` content-type.

### Fixed (earlier in this Unreleased cycle)
- **VBS launcher — stale old process served instead of new version**: When a previous NodeToolbox instance (e.g., v0.5.3) was still running on port 5555, the VBS launcher short-circuited: it detected the port as listening and opened the browser directly to the old broken server, skipping the launch of the new exe entirely. Fixed by removing the pre-launch short-circuit (`If IsPortListening Then ... Exit Sub`). The VBS now always launches the newest exe — `portManager.js` unconditionally kills any occupant and waits 1500ms for the OS to release the binding, after which the polling loop correctly opens the browser to the new process.
- Also removed the stale "client/dist/ folder missing" bullet from the timeout diagnostic message — `client/dist/` is now bundled in the exe snapshot and shipped in the exe-zip, so it is never missing.

### Fixed
- **Exe distribution — React build not found (readFileSync-based static serving)**: `express.static` (used in v0.5.3) relies on `fs.createReadStream` internally, which does not work reliably with `@yao-pkg/pkg`'s snapshot virtual filesystem. Even with `client/dist/` bundled via `pkg.assets`, the React SPA was never served — the exe still showed "⚠ React build not found". Fixed by:
  - Adding `resolveAppBaseDir()` to `server.js`: probes the snapshot path (`__dirname`) via `fs.readFileSync` first; falls back to `path.dirname(process.execPath)` (real disk next to the exe) if the snapshot is inaccessible.
  - Adding a custom `readFileSync`-based static middleware for pkg exe mode — `fs.readFileSync` is guaranteed by `@yao-pkg/pkg` to work with snapshot virtual paths.
  - Replacing `fs.existsSync + res.sendFile` in the SPA catch-all with a `fs.readFileSync` try-catch, because `fs.existsSync` can falsely return `false` for snapshot paths.
  - Re-adding `client/dist/` to the exe-zip in `scripts/local-release.ps1` as a belt-and-suspenders fallback alongside the exe.

### Fixed
- **VBS launcher — silent failure on corporate PCs (fix/vbs-launcher-corporate-pc)**: `Launch Toolbox Silent.vbs` was fire-and-forget: if the exe was blocked by antivirus/SmartScreen, port 5555 was locked, or the exe's built-in browser-open command was blocked by group policy, nothing visible happened. Fixed by:
  - Adding a post-launch polling loop (up to 30 seconds, 1-second intervals) that uses `netstat` to check when port 5555 becomes ready — `netstat` works on all Windows machines without elevated permissions or PowerShell.
  - Opening the browser directly from the VBS once the port is ready, as a belt-and-suspenders backup when the exe's `start` command is blocked.
  - Short-circuiting to just open the browser if NodeToolbox is already running on port 5555 (prevents double-launch).
  - Showing a diagnostic `MsgBox` after timeout that lists the most likely causes (SmartScreen, port conflict, missing `client/dist/`) and explains exactly how to diagnose via Command Prompt.
  - Defining `SERVER_PORT`, `SERVER_READY_TIMEOUT_SECONDS`, and `POLL_INTERVAL_MS` as named constants instead of magic numbers.

### Fixed
- **Admin Hub — Launcher download buttons were disabled (fix #vbs-launcher)**: The "⬇️ Silent Launcher (.vbs)" and "⬇️ Launcher (.bat)" buttons in the Proxy & Server Setup section were rendered as disabled buttons with a "legacy dashboard" tooltip, making them non-functional. Fixed by:
  - Adding `GET /api/download/launcher-vbs` and `GET /api/download/launcher-bat` endpoints to `src/routes/api.js` that serve the distribution-root launcher files as file downloads.
  - Replacing the disabled `<button disabled>` elements with proper `<a href>` download links pointing to the new endpoints.
  - Removing the legacy `server.py` and `server.js` stubs from DOWNLOAD_ITEMS (not applicable to the Node.js version).
  - Removing the "Download from the legacy dashboard" tooltip.

### Added
- **My Issues — Phase 4: Issue detail panel, inline transitions, SNow cross-reference, export** (issue #44):
  - **Issue Detail Panel**: click any issue card/row to open a slide-in `<aside>` overlay showing full metadata (key, summary, status, priority, assignee, reporter, created/updated dates) and a truncated description (≤300 chars).
  - **Inline Status Update**: detail panel includes a `<select aria-label="Change status">` dropdown populated via `GET /api/jira/issue/:key/transitions`; selecting a transition posts to `POST /api/jira/issue/:key/transitions` and refreshes state.
  - **SNow Cross-Reference**: when a ServiceNow connection is active (`isSnowReady`), the detail panel searches `/api/now/table/incident` for incidents matching the issue key and lists up to 5 results.
  - **Export Menu**: toolbar gains an "Export" button that opens a dropdown with "Copy as CSV" and "Copy as Markdown Table" options; both write the full issue list to the clipboard.
  - All issue cards, compact rows, and table rows are now keyboard-accessible clickable elements (`role="button"`, `tabIndex={0}`).
  - New hook state fields: `selectedIssue`, `isDetailPanelOpen`, `isTransitioning`, `transitionError`, `availableTransitions`, `isLoadingTransitions`, `isExportMenuOpen`.
  - New CSS classes: `.detailPanel`, `.detailPanelClose`, `.detailPanelKey`, `.detailPanelSummary`, `.exportMenuWrapper`, `.exportDropdown`, `.exportDropdownItem`.
  - 28 new TDD tests (46 total passing: 22 hook + 24 view).

- **Admin Hub — Phase 7: 4 depth features** (issue #44):
  - **Diagnostics panel**: collapsible section with "Run Diagnostics" button calling `GET /api/diagnostics`; displays JSON result in a pre-formatted block with a "Copy Report" to clipboard button; shows spinner while running and error message on failure.
  - **Backup & Reset panel**: collapsible section with "Download Backup" (serialises all `toolbox-*` localStorage keys to a dated JSON file), "Restore Backup" (FileReader-based restore with validation), and "Reset All Settings" (confirm dialog + wipe + reload).
  - **Hygiene Rules panel**: collapsible section with Stale Days, Unpointed Warning Days number inputs, and Flag Missing Assignees checkbox — each auto-saves to `localStorage` on change; provides central defaults for DSU Board stale thresholds.
  - **Update Management panel**: collapsible section with "Check for Updates" calling `GET /api/version-check`; shows current/latest versions, "✅ Up to date" or "🆕 Update available" badge, and read-only release notes textarea.
  - New server routes: `GET /api/diagnostics` and `GET /api/version-check` added to `src/routes/api.js`.
  - New hook state and actions in `useAdminHubState`: `DiagnosticsResult`, `HygieneRules`, `UpdateCheckResult` interfaces; 10 new action callbacks.
  - 21 new TDD tests (35 total passing).

- **Dev Workspace — Phase 8: Hook script downloads** (issue #44):
  - Replace `console.log` placeholder with real Blob-based file downloads for Git hook scripts.
  - Added `HOOK_SCRIPT_CONTENTS` map with full bash scripts for `post-commit`, `pre-push`, and `commit-msg` hooks.
  - Added `downloadHookScript()` utility that creates a Blob and triggers a browser download via a temporary anchor element — no server request needed.
  - Each "Download" button in the Hook Generator panel now delivers the correct shell script file.
  - 1 new TDD test (14 total passing).

- **Reports Hub — Phase 2: 6 new report tabs** (issue #44):
  - **Flow tab**: sprint issue throughput over time; issues done per day visualised as a bar chart.
  - **Impact tab**: business impact summary; issues grouped by priority with done/in-progress/blocked breakdowns.
  - **Individual tab**: per-assignee contribution table derived from sprint issues (issues assigned, done count, points).
  - **Quality tab**: defect density panel; defect count vs story count ratio with configurable quality threshold indicator.
  - **Sprint Health tab**: team health scorecard; completion %, at-risk teams (below `HEALTH_AT_RISK_THRESHOLD = 70%`), and blockers count.
  - **Throughput tab**: closed-sprint resolved issue counts loaded via a separate `loadThroughput()` call.
  - `ReportsHubTab` union extended to 9 values; `SprintIssue`, `IndividualEntry`, `QualityMetrics`, `SprintHealthEntry`, `ThroughputEntry` interfaces added.
  - `loadSprintData()`, `loadQuality()`, `loadThroughput()` loaders added; `loadAllReports()` now runs all 6 loaders in parallel.
  - 13 new TDD tests (33 total passing: 21 hook + 12 view).

- **ART View — Phase 6: 4 depth features** (issue #44):
  - **Dependency Map tab**: inline SVG cross-team issue dependency graph; scans issue descriptions for Jira key references, renders team boxes with bezier arrows between referencing issues across teams.
  - **Board Prep tab**: pre-PI Planning backlog review panel; loads issues from each team's board backlog, team filter dropdown, Export to CSV button.
  - **PI Progress Header**: persistent header strip above the tab bar showing PI name, animated completion progress bar, done / in-progress / to-do pills derived live from all loaded sprint issues.
  - **SoS Drawer**: enhanced Scrum of Scrums panel with a Pulse aggregate row (impediment count, completion %, teams at risk) and per-team expandable accordion sections showing assignee lists and impediments.
  - `ArtTab` extended with `'dependencies' | 'boardprep'`; `ArtDataState` extended with `sosExpandedTeams`, `boardPrepIssues`, `isLoadingBoardPrep`, `boardPrepError`, `boardPrepTeamFilter`, `piProgressStats`.
  - New exported types: `ArtBoardPrepIssue`, `PiProgressStats`.
  - New hook actions: `toggleSosTeam`, `loadBoardPrep`, `setBoardPrepTeamFilter`.

- **DSU Board — Phase 5: Issue Detail Overlay & Standup Notes** (issue #44):
  - **Issue Detail Overlay**: clicking any issue key opens a full-screen dialog with issue metadata, a status transition dropdown (fetched live from Jira), a Post Comment textarea, and a SNow root cause URL field. Closes on Escape key or backdrop click.
  - **Standup Notes Panel**: collapsible panel (open by default) with Yesterday / Today / Blockers text areas and an optional SNow URL field. Auto-saved to `localStorage` on each keystroke (debounced 500 ms). "Copy to Clipboard" button formats notes with emoji headers.
  - `StandupNotes` and `JiraTransition` interfaces exported from `useDsuBoardState`.
  - Per-issue SNow root cause URLs persisted to `localStorage` under `toolbox-snow-root-causes`.

- **Sprint Dashboard — Phase 3: 4 new tabs** (issue #44):
  - **Metrics tab**: Sprint completion %, total/done/in-progress/to-do counts, per-assignee velocity with story points.
  - **Pipeline tab**: Kanban-style column per status; lanes exceeding the bottleneck threshold (>3 issues) are highlighted with a warning indicator.
  - **Planning tab**: Unestimated issue list, story-point size distribution (0–1 / 2–3 / 5–8 / 13+ pts), backlog count.
  - **Releases tab**: Issues grouped by fix version with per-version done/total/% complete; unversioned issues appear under "No Version".
- Extended `JiraIssue` type with optional `customfield_10016` (story points) and `fixVersions` fields.
- `SPRINT_ISSUE_FIELDS` now requests `customfield_10016,fixVersions` from the Jira sprint issues API.

### Fixed
- **SNow Hub tab label**: "CRG" corrected to "CHG" (Change Request) in `SnowHubView.tsx`. The internal key remains `crg` to avoid breaking any persisted UI state.
- **No Home navigation**: The NodeToolbox title in the top bar is now a clickable `<Link>` that navigates back to the Home route (`/`) from any tool view.
- **Jira "connected but not working"**: `ConnectionBar` now shows green only when a live API probe (`GET /jira-proxy/rest/api/2/myself`) returns 200 — not merely when credentials are present in the config file. Added `isJiraVerified` / `isSnowVerified` to `connectionStore` alongside the existing `isJiraReady` / `isSnowReady` config-presence flags.
- **SNow 401 on Release Management tab**: `useReleaseManagement.loadMyActiveChanges` now checks `isSnowReady` before firing any SNow fetch. When SNow is not configured, an actionable error message is displayed instead of a silent 401.
- `proxyApi.ts`: added `probeJiraConnection()` and `probeSnowConnection()` — live credential probes via the existing proxy routes that return `ConnectionProbeResult` rather than throwing.
- `useProxyStatus.ts`: after every poll, runs Jira and SNow probes in parallel (via `Promise.allSettled`) when the respective service is configured, then writes the verified flags to the connection store.

### Fixed
- **EXE distribution — 503 "React build not found"**: `express.static` and `fs.existsSync` do not work with `@yao-pkg/pkg`'s virtual snapshot filesystem on Windows. `server.js` now uses `path.dirname(process.execPath)` (the real directory containing the `.exe`) as the asset base when `process.pkg` is truthy, instead of `__dirname` (the virtual snapshot path). `client/dist/` is now shipped alongside the `.exe` in the exe ZIP so it is extracted to the real filesystem on first use.
- `scripts/local-release.ps1`: exe ZIP staging now includes `client/dist/` so users who extract the exe ZIP have the React SPA next to the executable.
- `package.json`: removed `pkg.assets` (`client/dist/**/*`) — assets are no longer bundled into the pkg snapshot since they are shipped as external files in the exe ZIP.
- `test/integration/exe-real-world-flow.test.js`: updated setup to copy `client/dist` alongside the exe, matching the new exe ZIP structure.
- `test/unit/exe-launch.test.js`: added assertions that `server.js` resolves `process.execPath` (not `__dirname`) as the asset base when `process.pkg` is set.
- `Launch Toolbox.bat`: removed unescaped parentheses from `echo` lines inside nested `if` blocks — cmd.exe's block parser was counting them as block delimiters, causing the BAT to exit with code 255 before reaching `node server.js`. The three affected lines were in the `if not exist "node_modules"` error-handling block.
- `scripts/local-release.ps1`: React client build now runs before ZIP creation (was running after, so `client/dist/` was absent from the archive). `client\dist\` is now staged as `client/dist/` in the ZIP (was being flattened to `dist/`), matching the path `server.js` expects.
- `Launch Toolbox.bat`: added auto-build step for React UI — if `client/dist/index.html` is missing but `client/package.json` exists (git-clone install), the launcher runs `npm install && npm run build` automatically before starting the server.
- `test/integration/bat-launch.test.js`: replaced blocking `spawnSync` (60 s timeout) with async `spawn` so the server process stays alive while the test polls for readiness.
- `test/integration/exe-real-world-flow.test.js`: removed legacy `public/toolbox.html` backup/restore logic; updated assertions for React SPA behaviour (503 "NodeToolbox — Build Required" instead of HTML file-not-found).

### Added
- Phase 7 — React SPA cutover: `public/toolbox.html` (49,000-line legacy monolith) permanently retired. `server.js` now unconditionally serves the React SPA from `client/dist/`. Five Playwright E2E smoke tests added (`test/e2e/react-spa.spec.js`). `scripts/local-release.ps1` updated to build the React client and bundle `client/dist/**` into the distributable exe and zip.

### Removed
- `public/toolbox.html` — replaced by the React SPA (`client/src/`)
- `src/utils/staticFileServer.js` — legacy HTML file server utility, no longer needed
- `scripts/generate-dashboard-module.js` — generated the pkg exe HTML snapshot module, replaced by React build step
- `test/unit/toolboxHtml.test.js`, `test/unit/staticFileServer.test.js`, `test/unit/generate-dashboard-module.test.js`, `test/unit/pkg-snapshot.test.js` — tests for deleted legacy code

### Added
- Phase 6 — Text Tools (6-tab text utility: Markdown converter, Plain Text, Structured JSON, JSON Formatter, Case Converter, URL & Base64 encoder/decoder), Reports Hub (3-tab PI reporting dashboard: Features, Defects, Risks across ART teams with hero KPI grid), Admin Hub (proxy URL config, PI field mappings, feature flags, PIN-protected developer tools) — 264 Vitest tests passing across 52 test files, `npm run build` succeeds.

### Added
- Phase 5 — Dev Workspace (time tracking timers, GitHub activity sync, manual Jira poster, hook generator, repo monitor), ART View (multi-team PI planning, 7-tab health dashboard, impediments, predictability, SoS), Code Walkthrough (static architecture documentation with TOC sidebar, search, guided tour), DSU Board (8-section daily standup board with project key, stale filter, cards/table views)

### Added
- Phase 4 — My Issues view(JQL editor, source picker, persona filter, card/compact/table display modes, status zone dashboard) and Sprint Dashboard (6-tab view: Overview with burn-down chart, By Assignee swim lanes, Blockers wall, Defect radar, Standup board walk with 15-min timer, Settings)

### Added
- Phase 3 — SNow Hub view with three tabs: Change Request Generator (5-step CRG wizard), PRB Generator (SNow PRB → Jira issue creation), Release Management (CHG loader, My Active Changes, activity log)
- **React + TypeScript + Vite Home + Settings views (Phase 2)** — Added the first real migrated views in the SPA shell:
  - `client/src/views/Home/` — Persona-aware Home view with static card catalog, recent-view chips, and drag-to-reorder cards powered by dnd-kit.
  - `client/src/components/AppCard/` — Reusable Home card component with route navigation and co-located tests.
  - `client/src/views/Settings/` — Settings view for Jira, ServiceNow, and Confluence URLs, theme switching, and proxy version checks.
  - `client/src/App.tsx` — Home and Settings routes now render real views instead of placeholders, and the app shell keeps `data-theme` in sync with persisted settings.
  - `client/src/store/settingsStore.ts` — Added `addRecentView()` with deduped, max-five recent navigation history.
  - 90/90 Vitest tests passing across 27 test files, and `npm run build` succeeds.
- **React + TypeScript + Vite SPA infrastructure (Phase 1)** — Full React infrastructure layer consumed by all future view phases:
  - `client/src/types/` — TypeScript interfaces for Jira (JiraIssue, JiraUser, JiraBoard, JiraSprint, JiraFilter), ServiceNow (ChangeRequest, SnowUser, SnowApproval, SnowIncident), relay bridge (RelayBridgeStatus, RelayChannel), and proxy config (ProxyConfig, ProxyStatusResponse, Theme).
  - `client/src/store/connectionStore.ts` — Zustand store tracking `isJiraReady`, `isSnowReady`, and relay bridge status for real-time connection indicators.
  - `client/src/store/settingsStore.ts` — Zustand store wrapping all legacy `tbx*` localStorage keys with a migration shim so existing user configuration is preserved.
  - `client/src/services/` — Typed API clients: `proxyApi.ts` (/api/*), `jiraApi.ts` (/jira-proxy/*), `snowApi.ts` (/snow-proxy/*), `relayBridgeApi.ts` (/api/relay-bridge/*).
  - `client/src/hooks/` — `useProxyStatus` (30s polling → connectionStore), `useRelayBridge` (SNow relay lifecycle), `useJiraFetch`, `useSnowFetch`, `useLocalStorage` (all typed, all with loading/error state).
  - `client/src/components/ConnectionBar/` — Live Jira/SNow/relay status indicator bar (replaces `tbxUpdateConnBar`).
  - `client/src/styles/tokens.css` + `global.css` — CSS design token system (dark/light themes via `data-theme`).
  - `client/src/App.tsx` — Replaced Phase 0 foundation screen with layout shell (top bar + ConnectionBar + Routes with placeholders for all 10 views).
  - 70/70 Vitest tests passing across 22 test files.
- **React + TypeScript + Vite SPA foundation (Phase 0)**— Scaffolded `client/` directory containing a full React 18 + TypeScript + Vite application that will replace `public/toolbox.html` over the coming phases. The backend (Express, all proxies, relay bridge) is completely untouched.
  - `client/vite.config.ts` — Vite dev server (port 5173) with proxy rules forwarding `/api/*`, `/jira-proxy/*`, `/snow-proxy/*`, `/github-proxy/*`, `/setup` to Express at port 5555. Also configures Vitest with jsdom environment.
  - `client/src/main.tsx` — React root with `BrowserRouter` for client-side routing.
  - `client/src/App.tsx` — Phase 0 foundation screen that fetches `/api/proxy-status` to prove the proxy is wired correctly.
  - `client/src/test/setup.ts` + `App.test.tsx` — Vitest test suite (4 tests, all passing) using `@testing-library/react`.
  - Dependencies added: `react-router-dom` v7, `zustand`, `@dnd-kit/core/sortable/utilities`, `vitest`, `@testing-library/react`.
- **`npm run build:client`** — Root script that builds the React SPA via `cd client && npm run build`, outputting to `client/dist/`.
- **`npm run test:client`** — Root script that runs Vitest tests for the React SPA.
- **Production SPA serving in `server.js`** — If `client/dist/index.html` exists (i.e., after `npm run build:client`), Express now serves the React SPA and returns `index.html` for all non-API routes. Falls back to `public/toolbox.html` if no React build exists, so existing deployments are unaffected until Phase 7 cutover.

### Fixed
- **App cards unresponsive after SNow relay fix** — An orphaned code fragment (dangling `.push()` / `});` / `}` lines from old request-log rendering) was left in `buildFullReport` during the `tbxFetchDiagReport` rewrite. The stray `)` caused an `Unexpected token` JS syntax error that silently prevented all scripts in toolbox.html from loading, breaking every click handler including app card navigation.

### Tests
- **`toolboxHtml.test.js` — JS syntax guard**: New test parses every `<script>` block in toolbox.html with V8 at test time. Any syntax error that would break app card interactions (or any other JS) is now caught before claiming success.

### Fixed
- **SNow relay "connects then immediately disconnects"** — Three root causes found and fixed:
  1. **`snowReady = false` on SNow 401 (lines `rmCheckConn` and `rmLoadMyCHGs`)**: When ServiceNow returned HTTP 401 via the relay (expired session, SSO re-login needed), the catch handler was clearing `CRG.relay.snowReady`. A 401 from SNow means the *SNow session* is expired — the relay bridge itself is still functional. Clearing the flag meant every failed request also broke the relay routing, sending all subsequent requests back to the Basic Auth proxy (which also returns 401). Both catch handlers now leave `snowReady` intact and surface a clear "SNow session expired — re-login to ServiceNow" message instead.
  2. **`pagehide` deregisters on SNow SPA navigation**: ServiceNow's SPA framework fires `pagehide` during internal page transitions, causing the relay bookmarklet to immediately send a deregister beacon. Added a 1-second grace period before the deregister beacon fires. A `pageshow` listener cancels the timer if the page is restored from bfcache or the SPA bounces back within the grace window.
  3. **Diagnostic showed "SERVER: (not reachable — is toolbox-server.py running?)"**: The general diagnostic report was fetching `/api/diagnostics` — a Python-era endpoint that does not exist in the Node.js server. Changed to `/api/proxy-status` (the real endpoint). Fixed the fallback text from "toolbox-server.py" to "toolbox-server.js". The report now also shows live relay bridge state (snow/jira active flags) alongside server config.
- **Relay bridge registration history not visible**: Added `lastRegisteredAt`, `lastDeregisteredAt`, and `lastPolledAt` timestamps to each bridge channel. Exposed via `GET /api/relay-bridge/status` and `GET /api/snow-diag` so the SNow diagnostic report can show exactly when the bookmarklet last registered, deregistered, and polled — making it possible to diagnose connection drops without guessing.

### Fixed
- **"My Active Changes" showed empty instead of auth error on proxy 401** — When the ServiceNow proxy credentials were invalid or expired, `rmLoadMyCHGs` called `.then(r => r.json())` without checking `r.ok`. A 401 response from SNow still returns a JSON error body (no `result` key), so the code silently treated it as "no changes found" and displayed "No active changes assigned to Smith, Michael." Now checks `r.ok` first and throws a descriptive error that routes through the existing 401 catch handler, surfacing "SNow credentials invalid or expired — update them in Toolbox Settings → ServiceNow Connection."
- **"No change request found: CHGxxxxxxx" on proxy 401** — Same root cause as above: `rmLoadCHG` parsed the 401 JSON response body, found no `result`, and threw a misleading "No change request found" error even though the CHG existed in SNow. Now checks `r.ok` before parsing so the real error is surfaced.
- **SNow Diagnostic Test 3 always used wrong state codes** — `snwDiagRunLiveTests` hardcoded a fallback of `['1','2','-4']` (not valid CHG state codes) and read `rmPrefs.states` instead of `rmPrefs.defaultStateFilter` (the correct key saved by `rmSaveDisplayPreferences`). Additionally, the intermediate `stateCodeMap` tried to translate string labels ("open", "in_progress") when stored values are already SNow numeric codes. Corrected the fallback to `['-2','-1','0']` (Scheduled, Implement, Review — matching the default checked boxes), fixed the localStorage key to `defaultStateFilter`, and removed the unnecessary mapping layer.

— The `snwDiag*` function insertion accidentally dropped the `function tbxFetchProjectStatuses(projectKey) {` declaration, leaving the function body floating at script scope. This caused an `Unexpected token '}'` JS syntax error that silently prevented the entire page script from executing, breaking all card interactions.
- **Browser tab title stuck on v0.0.16** — The `<title>` tag was never updated by the release script, so the tab always showed the old hardcoded version. Fixed in two layers: (1) `document.title` is now set from `TOOLBOX_VERSION` at startup so the tab is always correct at runtime regardless of caching, and (2) the release script now patches `<title>NodeToolbox vX.Y.Z</title>` alongside the `TOOLBOX_VERSION` JS constant. Two unit tests in `toolboxHtml.test.js` guard both requirements.


- **SNow Diagnostics Report in Admin Hub** — New "❄️ ServiceNow Diagnostics" card in the Admin Hub Diagnostics panel. Clicking "❄️ Copy SNow Report" runs three diagnostic layers in parallel and copies a full plain-text report to the clipboard: (1) static snapshot of localStorage SNow identity keys, proxy URL, and RM display preferences; (2) server config from the new `GET /api/snow-diag` endpoint (proxy credentials masked, relay bridge status); (3) three live SNow API calls — a connectivity ping, an identity verification against the cached `sys_id`, and the exact My Changes query that Release Management executes internally. If the live My Changes query returns zero results the report lists the three most likely causes with corrective steps. Backend: `GET /api/snow-diag` added to `api.js`; `getBridgeStatus(sys)` exported from `relayBridge.js`.

### Fixed
- **Release Management "My Changes" empty in proxy mode**— In server/proxy mode (no relay bookmarklet), `miSnowResolveUser()` authenticated as the configured service account, so `gs.getUserID()` returned the service account's `sys_id` instead of the real user's. The "My Changes" query then found nothing because the user's change requests are assigned to their personal account, not the service account. Fixed by adding a **SNow Identity** card to RM Settings where the user can type their SNow username, look it up via the proxy, and pin the result. The pinned identity is shared with the My Issues view via the same `tbxMISnowSysId` localStorage keys. Added `rmRenderIdentityBadge()`, `rmSearchSnowIdentity()`, `rmSelectSnowIdentityFromEl()`, and `rmClearSnowIdentity()`.
- **RM Settings identity badge rendered on every Settings open** — `rmLoadDisplayPreferences()` now calls `rmRenderIdentityBadge()` so the user always sees who "My Changes" is querying as when they open Settings.
- **"My Changes" empty state shows proxy-mode hint** — When the change list is empty and the relay is not active (`IS_NODETOOLBOX_SERVER && !relay.snowReady`), a small inline note now appears with a direct link to RM Settings so the user can check or correct their identity without hunting.
- **"Update & Restart" button threw "Request failed: not valid JSON"** — `adminHubApplyUpdate()` POSTs to `POST /api/update` but that route was never registered in `src/routes/api.js`. Express returned its default HTML 404 page, and `response.json()` failed parsing `<!DOCTYPE`. Added the missing route: accepts `{ version }`, short-circuits if already on that version (`alreadyLatest: true`), otherwise calls `prepareUpdate()` + `spawnReplacementAndExit()` from `src/utils/updater.js` after flushing `{ ok: true, restarting: true }` to the browser.
The SNow identity search in My Issues Settings required `CRG.relay.snowReady` (relay bookmarklet active), blocking use in proxy mode even though `crRelayRequest` falls back to the server proxy for SNow. Changed the guard to `tbxSnowReady()` which returns `true` in both relay and proxy modes.

The `📦 Release Management` tab (`snh-tab-rm`) was always visible in the SNow Hub tab strip regardless of admin status. It is now hidden by default and only revealed after admin unlock (`tbxAdminUnlocked === '1'`). `tbxApplyFeatureFlags()` was updated to control tab visibility; if the RM tab was active when the admin lock was re-engaged, it automatically falls back to the Change Request tab.
- **SNow Hub → Release Management → Settings showed wrong content** — The Settings sub-tab displayed "⚙ Repo Monitor Settings" (GitHub repos, branch pattern, poll interval, Jira transitions on GitHub events, active hours schedule) which has nothing to do with Release Management. Replaced with correct content: a **ServiceNow Connection** notice pointing to Toolbox Settings, and a **My Changes Display Preferences** section with default state filter checkboxes and an auto-load-last-CHG toggle. Added `rmSaveDisplayPreferences()`, `rmLoadDisplayPreferences()`, and `rmGetDisplayPreferences()` to persist and restore these preferences via `tbxRMDisplayPrefs` in localStorage.
- **Repo Monitor settings inaccessible after move to Dev Workspace** — When the Repo Monitor operational panel was moved to Dev Workspace, the settings form (repos, branch pattern, poll interval, Jira transitions, active hours, catch-up mode) was left in the wrong place (SNow Hub RM). The settings card is now correctly placed inside `dw-panel-monitor` (Dev Workspace → Repo Monitor) directly below the activity log. `dwShowTab('monitor')` now also calls `rmLoadSettingsUI()` to populate the form on every open.

### Fixed
- **Admin Hub "DEV_PANEL is not defined"** — `DEV_PANEL` (Network Activity Monitor state) and `OPT_STATS` (cache hit counters) were referenced throughout the Admin Hub and Dev Panel code but never declared. Admin Hub failed to render after unlock. Both objects are now declared with full initial state alongside the other module globals.

### Fixed
- **Admin Hub unlock "Verification error — browser crypto unavailable"** —The unlock dialog relied on `window.crypto.subtle` (Web Crypto API) which is only available in secure contexts (HTTPS or the exact hostname `localhost`). Accessing NodeToolbox over an IP address or a non-localhost hostname caused an immediate `crypto.subtle` failure. Separately, `ADMIN_HUB_CREDENTIAL_HASH` — the value the hash was compared against — was never defined anywhere in the codebase, meaning the unlock would always fail even when `crypto.subtle` worked. Fixed by moving credential verification server-side: `adminHubSubmitCredentials()` now POSTs `{username, password}` to a new `POST /api/admin-verify` endpoint that performs the SHA-256 comparison using Node's built-in `crypto` module. The credential hash is stored in `toolbox-proxy.json` under `admin.credentialHash`. Default credentials: **admin / toolbox** — change by replacing the hash in the config file. No client-side crypto required.

`hgGetGlobalRules()` threw `ReferenceError: HG_BUILT_IN_RULES is not defined` whenever `localStorage` had no saved hygiene rules, which propagated through `adminHubBuildHygieneRulesPanel()` → `adminHubBuildHTML()` and left `admin-hub-body` empty. Fixed by defining `HG_BUILT_IN_RULES` as an array of 11 default enterprise Feature/Risk hygiene rules (6 Feature, 5 Risk) at the hygiene module initialisation block. Also defined `HG_STATE` (runtime hygiene results object) and `HG_FIX_VERSION_CACHE` (per-session version-list cache) which were similarly referenced but never declared, preventing latent crashes in the hygiene tab.

- **Admin Hub shows error message on unexpected failures** — `adminHubRender()` had no error handling, so any uncaught JS exception during panel construction produced a silently blank panel. Added a `try/catch` that renders a visible `⚠️ Admin Hub failed to load.` banner with the error message and logs to the console, making future issues immediately diagnosable.

### Performance
- **Gzip compression for all responses** — Installed the `compression` npm package and mounted `app.use(compression())` as the first Express middleware in `server.js`. The primary beneficiary is `toolbox.html` (2.75 MB uncompressed) which compresses to ~300–400 KB on the wire — roughly an 8× reduction — improving both initial page load time and the in-app update download speed.

### Fixed
- **`jira.configured` returned `false` when only a base URL was set** — `isServiceConfigured()`
  in `loader.js` required both a URL and at least one credential, so the `configured` field in
  `GET /api/proxy-status` was `false` even when the user had typed in a Jira URL but not yet
  added a PAT or API token. Introduced `isServiceBaseUrlSet()` which checks the URL only
  (no credential requirement), and updated the `proxy-status` handler to use it for the
  `configured` and `baseUrl` response fields. `isServiceConfigured()` (requires both URL and
  credential) is retained for the `ready` field and for the setup-wizard guard. Also fixed a
  `TypeError: Cannot read properties of undefined (reading 'baseUrl')` crash in
  `saveConfigToDisk()` when `configuration.confluence` was absent.

- **Chrome proxy 502 with empty error message** — `proxyRequest()` in `httpClient.js` was
  calling `clientReq.pipe(outboundRequest)` for POST/PUT/PATCH/DELETE requests even though
  `express.json()` middleware had already consumed the request stream before the proxy router
  ran. Piping an already-consumed stream sent an empty body to the upstream service (e.g.
  ServiceNow). Some servers respond to an empty POST body by closing the TCP connection with
  RST rather than returning an HTTP error, which Node.js surfaces as a network error with an
  empty `message` string — producing the `{"error":"Proxy error","message":""}` 502 seen in
  Chrome from v0.1.8 onward (Chrome users were newly routed through the SNow server-side
  proxy via the `crRelayRequest()` fallback added in that release). Fix: when `req.body` is
  populated (express.json() parsed it), the body is re-serialized into a Buffer and written
  directly with a correct `Content-Length` header instead of piping. Also improved the error
  handler to fall back to `networkError.code` when `networkError.message` is empty, so the
  502 response always contains a useful diagnostic string.

- **Chrome proxy: wizard no longer shows "Download & Start" steps** — When the user opens
  the setup wizard from the running NodeToolbox server (`IS_NODETOOLBOX_SERVER = true`),
  the proxy setup step (Step 3) now shows a condensed "server is already running" view
  with a single "Test Connection" button instead of the three-step download/unzip/start
  guide that was shown even though the server was already serving the page.
- **Chrome proxy: SNow wizard step no longer opens a relay tab** — In proxy mode the
  ServiceNow wizard step (Step 4) now shows a "Save & Continue" button that saves the
  SNow base URL and advances directly to the done step. The previous "Save & Open SNow Tab"
  button incorrectly opened a relay connection flow that does not work in Chrome.
- **`tbxSnowReady()` uses proxy probe result, not server mode flag** — the initial
  implementation incorrectly returned `true` for all server-mode users, which would
  cause silent 401 failures for Okta/SSO SNow users whose proxy has no Basic Auth
  credentials. Now checks `tbxSnowProxyUrl` in localStorage, which `tbxRunProxyProbe()`
  already sets only when `snow.ready=true` and clears for Okta instances. SNow features
  remain disabled in Chrome for Okta users (correct behavior — relay required).
- **Wizard SNow step in proxy mode shows honest hint** — reads `snow.ready` from the
  cached proxy status to show either "proxy handles SNow automatically" (service account
  configured) or "SNow uses Okta — use Edge with the relay bookmarklet" (no credentials).

### Added
- **Admin Hub: "Server Control" panel** — New panel in the Admin Hub with **Restart Server**
  and **Stop Server** buttons. Both use a two-step inline confirmation to prevent accidental
  clicks. Designed for users running NodeToolbox via the silent VBScript launcher where no
  terminal window is available for Ctrl+C. After restart, the UI polls `/api/proxy-status`
  every 1.5 seconds and shows a "Reload now" link once the server is back online. New backend
  endpoints: `POST /api/restart` (spawns a detached child process then exits) and
  `POST /api/shutdown` (exits the process). New frontend functions:
  `adminHubBuildServerControlPanel()`, `adminHubExecuteServerAction()`,
  `adminHubRevealServerAction()`, `adminHubCancelServerAction()`, `adminHubPollForServerReady()`.

- **Admin Hub: "Check for Updates" panel** — A new "Version & Updates" panel in the Admin
  Hub shows the current version and provides a "Check for Updates" button. Clicking it
  queries the public GitHub Releases API (`/repos/mikejsmith1985/NodeToolbox/releases/latest`)
  and displays whether a newer version is available along with the release notes excerpt and
  a one-click download link. No authentication is required (public repo). New frontend
  functions: `adminHubBuildUpdatePanel()`, `adminHubCheckForUpdates()`,
  `adminHubIsVersionNewer()`.
- **HTTP relay bridge for Chrome (COOP fix)** — Chrome enforces
  `Cross-Origin-Opener-Policy: same-origin` on both ServiceNow and Jira Cloud, which
  silently severs the `window.postMessage` relay channel and sets `window.opener` to
  `null` in the opened tab. The relay now uses an HTTP long-polling bridge through
  `http://localhost:5555` instead of `postMessage`. Because Chrome unconditionally
  treats `http://localhost` as a secure context, bookmarklets on HTTPS SNow/Jira pages
  can fetch the local server without any mixed-content or CORS restrictions. New
  backend route: `src/routes/relayBridge.js` — endpoints `/register`, `/deregister`,
  `/status`, `/request`, `/poll`, `/result/:id`. The postMessage path is preserved for
  `file://` / legacy mode (Edge enterprise where COOP is relaxed via group policy).
  New frontend functions: `crRelayScriptBridge`, `crRelayFetchBridge`, `crAutoPingBridge`.
  All relay-ready flags (`snowReady`, `jiraReady`, `confReady`) are now authoritative
  without a live window reference in server mode.

### Added
- **Confluence Cloud proxy** — New `/confluence-proxy/*` route forwards requests to
  `https://zilverton.atlassian.net` with server-side Basic Auth (Atlassian email +
  Cloud API token). Supports both the v1 API (`/wiki/rest/api/`) and v2 (`/wiki/api/v2/`).
  Credentials are configurable via `toolbox-proxy.json`, environment variables
  (`TBX_CONFLUENCE_URL`, `CONFLUENCE_USERNAME`, `CONFLUENCE_API_TOKEN`), or the Admin Hub.
  The `/api/proxy-status` and `/api/proxy-config` endpoints now include a `confluence`
  section so the dashboard can display connection state.

### Fixed
- **Chrome wizard now auto-assigns Jira URL from proxy server** — When Chrome users
  complete the proxy connection test in the onboarding wizard (`tbxWizTestProxy`), the
  `jira.baseUrl` returned by `/api/proxy-status` is now persisted to `tbxCRGenJiraUrl`
  in localStorage and synced to the Global Settings URL input. This mirrors the Edge
  relay path, which pre-populates the Jira URL from the org default, ensuring Chrome
  proxy users do not need to manually re-enter a URL that is already configured on the
  running server.
- **Edge relay wizard step now works in server mode** — `tbxWizOpenRelay()` was
  sending `window.postMessage` pings to detect when the relay bookmarklet connected.
  In v0.1.5 server mode, `crRelayScript()` generates the HTTP bridge bookmarklet which
  never responds to postMessage. The wizard now calls `crAutoPingBridge('jira')` in
  server mode (mirroring `crOpenJiraRelay()`) and restricts postMessage pings to
  `file://` / Edge legacy mode. This unblocks the wizard relay path for Edge users
  who access Toolbox through the NodeToolbox server.

### Fixed
- **Assignment group member lookup now returns results** —`crLoadGroupMembers` was
  using a SQL-style subquery (`sys_id IN (SELECT user FROM sys_user_grmember...)`)
  that SNow's Table API silently ignores — it returns HTTP 200 with an empty result
  array instead of an error, so the reliable fallback was never reached. The primary
  query is now a direct `sys_user_grmember` lookup with `sysparm_display_value=true`,
  which returns both `user.value` (sys_id) and `user.display_value` (name) in one
  call. An empty result now triggers a dot-walk fallback on `sys_user` as a last
  resort for environments where grmember reads are restricted. Results are sorted
  alphabetically.
- **ServiceNow writes now work with Okta/SSO relay connection** — In NodeToolbox server
  mode, `crSnowFetch` and `tbxSnowRequest` were routing all SNow API calls through the
  Node.js proxy (`/snow-proxy/*`). The proxy can inject `X-UserToken` (g_ck) but cannot
  forward the browser's HttpOnly session cookies that Okta SSO requires. Both functions
  now prefer the browser relay when it is active, routing requests directly from the SNow
  tab with `credentials: "include"` so cookies are sent automatically. The server proxy
  remains as a fallback for Basic Auth service-account setups.
- **CTASK section no longer implies Toolbox creates the SNow auto-CTASKs** — The "CTASKs
  to create" section has been restructured into two clearly labelled sub-sections:
  "Auto-created by SNow — Toolbox will rename & configure" (Implementation CTASK and
  Technical Checkout) and "Additional CTASKs — created by Toolbox" (custom templates).
  The misleading disabled checkboxes have been replaced with a pencil icon. An inline
  "+ Add CTASK" button now opens the template form directly, removing the need to navigate
  to Settings to add a custom CTASK. An empty-state hint is shown when no custom templates
  exist.

### Fixed
- **Connection bar shows correct Jira/proxy status on every page** — Six global variables
  (`TBX_CONN_BARS_REGISTRY`, `TBX_PROXY_AUTH_FAILED`, `_tbxProxyRetryTimer`,
  `_tbxProxyRetryCount`, `TBX_PROXY_MAX_RETRIES`, `TBX_PROXY_RETRY_INTERVAL_MS`) were
  referenced by `tbxInitConnBar()` and `tbxRunProxyProbe()` but never declared. The resulting
  `ReferenceError` crashed every view's `*OnOpen()` callback silently (caught in `showView`'s
  try/catch), which had two cascading effects: (1) connection bar dots stayed grey on all
  non-Home views regardless of proxy state, and (2) `rhShowTab()` was never called in
  `rhOnOpen()`, leaving the Reports Hub blank until a manual Refresh. All six variables are now
  declared with their correct initial values before the connection bar section.
- **Proxy probe reliably repaints connection dots** — `tbxRefreshVisibleAuthWidgets()`,
  `tbxRenderAllAuthBadges()`, and `tbxRenderDataAgeBadges()` were called inside
  `tbxRunProxyProbe` and the relay reconnect handler but never defined, causing the `.then()`
  callback to throw before `tbxUpdateConnBar()` could fire. Stubs for all three functions have
  been added; `tbxRefreshVisibleAuthWidgets()` now also refreshes the Home page status dot.
  `tbxUpdateConnBar()` is now called before the optional widget helpers so dots always turn
  green even if a helper fails in the future.

### Fixed
- **Version badge now reflects the installed release**— `TOOLBOX_VERSION` in `toolbox.html` was
  hardcoded and never updated by the release script, causing the version badge and update-checker
  to always show `0.0.16` regardless of the installed build. The release script now patches the
  literal in `toolbox.html` after bumping `package.json`, and the value has been corrected to
  `0.1.0` for the current release.
- **Proxy connection bar turns green on startup** — `tbxAutoDetectProxy()` was defined but never
  called, so the proxy probe only ran when the user navigated into a view that called
  `tbxInitConnBar()`. A startup IIFE (guarded by `IS_NODETOOLBOX_SERVER`) now calls it immediately
  on page load, so the connection bar dots turn green without any user interaction.
- **Default landing view is now the Home Screen** — `homeInit()` previously redirected every fresh
  browser session to the Reports Hub via a `requestAnimationFrame` + `sessionStorage` one-shot
  guard. That block has been removed; the application now opens directly on the Home Screen as
  intended, giving users immediate access to all tool cards.

### Fixed
- **Reports Hub auto-loads data on every open** — Navigating away from Reports Hub while a fetch
  was in-flight left `RH_STATE.generatingFeatures` (and equivalent flags for other tabs) permanently
  `true`. On re-entry `rhShowTab()`'s guard (`!generating && !loaded`) evaluated to `false` and
  skipped the auto-load, leaving the panel empty until the user manually pressed ↻ Refresh.
  `rhOnOpen()` now resets each active-tab generating flag (only when that tab's data was never
  successfully loaded) before calling `rhShowTab()`, ensuring the auto-load always fires on open.
- **Reports Hub card missing from home screen** — The `📈 Reports Hub` card was absent from
  `#view-home`, making the tool unreachable via the home screen grid. Added the card back in its
  own "Reports" section between "Agile & Delivery" and "SNow Hub", consistent with the existing
  note that Reports Hub is always visible (not controlled by POC Tool Visibility toggles).
- **Reports Hub connection bar: proxy mode fixes** — Four related bugs prevented the conn-bar
  from correctly reflecting proxy status:
  - `tbxUpdateConnBar()` bars array was missing the `rh` (Reports Hub) prefix, so the update loop
    never touched Reports Hub DOM nodes; dots stayed grey even when proxy was connected.
  - `tbxRunProxyProbe()` and `tbxSaveProxyCredentials()` did not call `tbxUpdateConnBar()` after
    storing `tbxProxyStatus`, so bars already on screen never refreshed after a successful probe.
  - `rhOnOpen()` passed no `connectFn` to `tbxInitConnBar`, falling back to `tbxConnect()` which
    opens a relay popup — broken in proxy mode. Added `rhConnect()` that mirrors `snhConnect()`:
    redirects to Toolbox Settings in proxy mode, falls back to relay otherwise.
  - `connectedViaProxy` used `!tbxJiraReady()` which is always `false` in `IS_NODETOOLBOX_SERVER`
    mode (because `tbxJiraReady()` unconditionally returns `true` there), causing the mode label
    to always read "relay" instead of "proxy". Fixed to `isProxyJiraReady || isProxySnowReady`.

## [0.0.19] — Fix: CORS on proxy "Test Connection", relay Open button no-ops without saved URL

### Fixed
- **"Test Connection" in Toolbox Settings caused a CORS error in proxy mode** — `tbxTestJiraPAT()`
  called Jira directly from the browser (`fetch(jiraBaseUrl + '/rest/api/2/myself', ...)`), which
  CORS policy blocked even when the NodeToolbox proxy server was running at `localhost:5555`. In
  proxy mode (`IS_NODETOOLBOX_SERVER === true`) the browser must never call Jira directly — the
  proxy is the intended intermediary. Added an early-return guard: when `IS_NODETOOLBOX_SERVER`,
  the test now calls `/jira-proxy/rest/api/2/myself` (the server-side proxy route) and shows a
  "Proxy connected — authenticated as …" success message instead of a CORS failure.
  (GitHub issue #35)
- **"Open & Connect" relay button in Toolbox Settings did nothing on a fresh install** —
  `crOpenJiraRelay()` reads the Jira URL from `localStorage.getItem('tbxCRGenJiraUrl')`. The
  v0.0.18 fix defaulted the Jira URL input to the org Healthspring instance in `tbxGSOnOpen()`,
  but only set the DOM field value (`ju.value`), never writing to localStorage. First-time relay
  users who opened Settings, saw the correct URL already populated, and clicked "Open & Connect"
  received an empty-URL error because the field value had never been persisted. `tbxGSOnOpen()`
  now also calls `localStorage.setItem('tbxCRGenJiraUrl', ju.value)` and `crSaveUrls()` when
  applying the default, so the relay button works without requiring a manual "Save" step first.
  (GitHub issue #35)

## [0.0.18]— Fix: SNow Hub Connect button, setup redirect loop, relay-mode PAT requirement, default Jira URL

### Fixed
- **SNow Hub "Connect" button did nothing** — `snhOnOpen()` never called `tbxInitConnBar()`,
  so the connection-bar dots were never painted and the Connect button had no bound handler.
  Added `tbxInitConnBar('snh', ['jira', 'snow'], 'snhConnect')` to `snhOnOpen()` and wrote a
  new `snhConnect()` handler: proxy mode sends the user to Toolbox Settings to configure
  service credentials; relay mode opens the Jira + ServiceNow relay popup windows via
  `tbxConnect()`.
- **First-run setup wizard redirected back to `/setup` after saving Jira credentials** —
  `isServiceConfigured()` only checked the base URL, not whether any credentials were
  present. A fresh install (or old install) with a pre-filled Jira URL but no PAT would pass
  the URL check, save to disk, then immediately re-trigger the setup redirect because no
  credentials existed. Updated `isServiceConfigured()` to require at least one usable
  credential (`pat`, `apiToken`, or `password`), preventing the loop. Also added URL
  placeholder validation in `handlePostSetup` (server-side) and the setup wizard pre-fill
  logic (client-side) so placeholder URLs are never silently accepted.
- **Toolbox Settings defaulted to "Personal Access Token" tab in relay mode** — Users running
  the relay build were confronted with the PAT tab, entered their token, got a CORS error,
  and assumed the tool was broken. PATs require a relay to proxy API calls — the relay alone
  is sufficient without a PAT. `tbxGSOnOpen()` now switches to the "Browser Relay" tab
  automatically when running in relay mode and no PAT is already saved.

### Changed
- **Default Jira URL pre-filled to the organisation's Jira instance** in both the first-run
  setup wizard and the Toolbox Settings URL field. Users now only need to paste their PAT —
  the URL is correct out of the box. The config template (`toolbox-proxy.json`) is also
  updated for new installs.

## [0.0.17] — Fix: Reports Hub blank, garbled emoji, relay warning in proxy mode

### Fixed
- **Reports Hub opened blank / showed no content** — `rhOnOpen()` was never wired into
  the `showView()` monkey-patch dispatcher that fires per-view initialization hooks. All
  other views (Sprint Dashboard, My Issues, Work Log, etc.) had their `xOnOpen()` called
  correctly; Reports Hub was simply absent from the list. Added the dispatch so `rhOnOpen()`
  fires on every navigation to the Reports Hub, restoring connection-bar setup, hero render,
  and tab state.
- **72 garbled emoji characters remaining from prior fix** — The previous mojibake fix
  (v0.0.16) corrected 1,595 sequences but missed 72 four-byte emoji (📦, 📈, 🗓, 🚨,
  🟢, 🟠, 💯, 💡, 🔄, 🔍, 🔧, 📋, 📌, 📖, 🌊, 🐛, 🏃, 🏭, 🎯, 🔬, and others).
  The root cause was CP437 encoding of `F0 9F xx xx` UTF-8 byte sequences — the same
  codec corruption that caused the original incident. Applied a full CP437 reverse-lookup
  decode to recover all remaining emoji.
- **"Relay required — PAT saved, not connected" banner shown when connected via proxy** —
  `tbxRenderJiraAuthWidget()` checks `tbxProxyStatus` from `sessionStorage`, but this key
  is populated by an async fetch to `/api/proxy-status` that may not have resolved yet on
  first render. The function would fall through to the relay warning block. Added an
  `IS_NODETOOLBOX_SERVER` guard: when running on localhost and the async probe has not yet
  completed (`tbxProxyChecked` not set), the widget now shows "⏧ Connecting to Jira via
  proxy…" instead of the alarming relay-required banner.

## [0.0.16] — Fix: Garbled characters, version display, Jira relay dependency (issue #31)

### Fixed
- **Garbled / mojibake characters throughout UI** — 1,595 garbled Unicode sequences
  (mojibake from a CP1252→UTF-8 re-encoding incident) replaced with the correct symbols:
  `—`, `•`, `·`, `…`, `↑`, `↓`, `▲`, `▼`, `⚠`, `✓`, `✔`, `→`, `↻`, `✕`, `⚡`, `🐛`,
  `📊`, `❌`, `ℹ️`, `🔒`, and others. Reports Hub copy-text and on-screen labels now
  display correctly.
- **Version shown as v0.0.13 / v0.0.15 instead of v0.0.16** — `TOOLBOX_VERSION` constant
  and the `<title>` tag were stale. Both now reflect `0.0.16` to match `package.json`.
- **Jira operations blocked by "connect relay" message when proxy is connected** — All
  Jira operation guards (`!CRG.relay.jiraReady`) have been replaced with the new
  `tbxJiraReady()` helper which returns `true` immediately when the NodeToolbox proxy
  server is active (`IS_NODETOOLBOX_SERVER = true`). Relay is still required in legacy
  file:// mode. SNow relay guards are unchanged.

## [0.0.14] — Fix: Reports Hub rendering, version display, relay vs proxy status

### Fixed
- **Reports Hub showed unreadable ANSI escape sequences and control characters** — Raw
  Jira ticket descriptions containing ANSI colour codes (e.g. `\x1b[32m`) or other C0/C1
  control bytes were rendered verbatim in the Reports Hub, producing garbled output.
  Added `stripControlCharactersFromText()` which strips full ANSI CSI sequences before
  falling back to lone ESC and remaining non-printable bytes; applied to both ADF and
  plain-text paths inside `miRenderJiraText()`.
- **Version displayed as v0.0.13 instead of v0.0.14** — `TOOLBOX_VERSION` constant and
  the `<title>` tag were both hardcoded to `'0.0.13'`. Updated to `'0.0.14'`. Also fixed
  `server.js` where `APP_VERSION` was permanently hardcoded to `'1.0.0'`; it now reads
  the version from `package.json` at startup so the server and UI always agree.
- **"RELAY dependency" banner shown for all services** — `miSyncRelayStatus()` always
  showed a "Jira relay connected" message regardless of how the user was authenticated.
  It now shows three distinct states: `"Jira connected via proxy"` when authenticated
  with a PAT/proxy, `"Jira relay connected"` when connected via the bookmarklet relay,
  and `"not connected — configure credentials"` when neither is active.

## [0.0.13]— Fix: v0.0.13 UI Issues

### Fixed
- **Relay warnings showed despite proxy being connected** — `TOOLBOX_VERSION` and
  `MIN_PROXY_SERVER_VERSION` were still set to the old standalone HTML Toolbox value
  `'0.24.25'`. The Node.js proxy reports `'0.0.13'` from `package.json`, so the UI
  incorrectly treated the proxy as outdated and showed relay-required banners everywhere.
  Updated constants to match Node.js versioning; `MIN_PROXY_SERVER_VERSION` is now
  `'0.0.1'` so any v0.x proxy is accepted.
- **`tbxUpdateConnBar` only checked relay, not proxy** — All connection status dots
  evaluated only `CRG.relay.jiraReady` / `CRG.relay.snowReady` (bookmarklet relay).
  Now also reads `sessionStorage.tbxProxyStatus` so dots go green when the proxy server
  has Jira / ServiceNow credentials configured. Mode label shows `"proxy"` instead of
  `"relay"` when connected via proxy.
- **`tbxRenderJiraAuthWidget` always showed relay setup steps** — Dev Workspace, Sprint
  Dashboard, ART View, Work Log, DSU, and My Issues all displayed relay instructions even
  when the proxy had Jira ready. Now shows a `"Jira connected via proxy"` green badge
  and returns early when proxy Jira is ready, skipping the relay setup flow entirely.
- **`miSyncRelayStatus` only checked relay** — My Issues connection bar showed a relay
  warning even when the proxy was fully connected. Now ORs proxy Jira ready with relay
  ready so the warning is hidden in both connected modes.
- **AdminHub stuck on "Loading…"** — `adminHubOnOpen()` existed but was never called
  because `admin-hub` was missing from the `showView` dispatch IIFE. Added the missing
  case so AdminHub initialises correctly when the user navigates to it.
- **Text Tools URL Encoder and Base64 panels stacked vertically** — Both tools were
  missing the `<div class="panels">` wrapper that provides the two-column CSS Grid
  layout used by Smart Formatter and JSON Formatter. Wrapped each tool's input/output
  `<div class="panel">` pair in `.panels` so they render side-by-side. The Base64 error
  message div was moved inside the input panel to avoid disrupting the grid.
- **Update checker pointed at old ToolBox repo** — `TOOLBOX_UPDATE_REPO` was
  `'mikejsmith1985/ToolBox'`. Changed to `'mikejsmith1985/NodeToolbox'` so GitHub
  release checks target the correct repository.
- **`<title>` still read "Toolbox v0.24.25"** — Browser tab now shows
  `"NodeToolbox v0.0.13"` to match the Node.js application name and version.

---

### Fixed (v0.0.12 / previous [Unreleased])
- **Root cause of "HTML not found" on corporate PCs** — The `resolvePortConflict`
  function previously detected an existing NodeToolbox on port 5555 and redirected the
  browser to it, then called `process.exit(0)`. If that old stuck session was a
  pre-fix v0.0.9/v0.0.10 instance, the user was silently handed back to a broken server.
  v0.0.13 removes this "reuse" path entirely: any process occupying port 5555 is now
  killed unconditionally so only the newest, fixed version runs.
- **VBS launcher now picks the newest exe** — `Launch Toolbox Silent.vbs` previously
  exited the loop on the first `nodetoolbox-*.exe` match, which was filesystem-order
  dependent. It now iterates all matches and selects the file with the most recent
  `DateLastModified`, ensuring upgrades take effect immediately.
- **`/api/proxy-status` version** — Was hardcoded as `"1.0.0"`. Now reads from
  `package.json` so the version reported to clients is always accurate.

### Added
- **`GET /api/diagnostic`** — New endpoint returning runtime health information:
  `cachedHtmlLoaded`, `htmlLoadMethod` (`'require'` / `'readFileSync'` / `null`),
  `pkgSnapshot`, `nodeVersion`, and `platform`. Enables remote triage of HTML-serving
  failures on corporate PCs without physical access to the machine.
- **`cachedHtmlLoadMethod`** export on `staticFileServer` — Tracks which code path
  successfully populated the HTML cache at startup (`'require'` in the pkg exe,
  `'readFileSync'` in development/ZIP). Consumed by `/api/diagnostic`.

## [0.0.11] — Fix: Dashboard HTML Compiled Into Exe Snapshot

### Fixed
- **"File Not Found" page shown after setup wizard — confirmed root cause and real fix
  (Issue #22, v0.0.10 partial fix)** — The v0.0.10 fix pre-loaded `toolbox.html` via
  `fs.readFileSync` at module startup. This appeared to work on the build machine because
  `C:\...\public\toolbox.html` existed on the build machine's real disk — not from the
  pkg snapshot. On any other machine (including the user's corporate PC) that path does
  not exist, `readFileSync` throws silently, `cachedDashboardHtml` stays `null`, and the
  "File Not Found" page is returned. The real fix converts `toolbox.html` into a JavaScript
  module (`src/generated/dashboardHtmlContent.js`) before the `pkg` build.
  `@yao-pkg/pkg` compiles JS modules directly into the exe snapshot so `require()` always
  works identically on every machine — no filesystem path matching, no build-machine-
  specific absolute paths, no silent failures.

### Added
- **`scripts/generate-dashboard-module.js`** — New pre-build script that reads
  `public/toolbox.html` and writes it as `src/generated/dashboardHtmlContent.js`
  (a `module.exports = "..."` string). `local-release.ps1` runs this automatically
  before the `pkg` build step so the HTML is always compiled into the exe snapshot.
- **`test/integration/exe-real-world-flow.test.js`** — New integration test that
  copies the `.exe` to an isolated temp directory, renames `public/toolbox.html` on
  the build machine (blocking the readFileSync fallback), and validates the full user
  flow: server start → redirect to setup → POST credentials → dashboard returns 200
  with valid HTML. This is the "exact real world scenario" test that would have caught
  the v0.0.10 partial fix before release.

### Changed
- **`src/utils/staticFileServer.js`** — Pre-load priority updated: `require('../generated/
  dashboardHtmlContent')` is now the primary path (pkg snapshot via JS module); `readFileSync`
  is the fallback for development/zip environments where the generated file is absent.
- **`scripts/local-release.ps1`** — Adds step `[4/6]` to run `generate-dashboard-module.js`
  before the `pkg` build; step count updated from 5 to 6 throughout.
- **`src/generated/`** added to `.gitignore` — the generated module is a build artifact,
  not source code.

### Tests
- `test/unit/generate-dashboard-module.test.js` — NEW: 6 tests verifying the generator
  script creates a valid JS module that exactly matches `public/toolbox.html`.
- `test/integration/exe-real-world-flow.test.js` — NEW: 5 integration tests (see above).
- `test/unit/pkg-snapshot.test.js` — Updated descriptions to reflect the JS-module-first
  approach instead of the readFileSync approach.

## [0.0.10] — Fix: Dashboard Loads After Setup, Silent Launch Option

### Fixed
- **"File Not Found" page shown immediately after setup wizard (Issue #22)** — After
  completing the setup wizard in the `.exe` distribution, the browser was redirected to
  `/` but received the "⚠ toolbox.html not found" error page instead of the dashboard.
  Root cause: `@yao-pkg/pkg` patches `fs.readFileSync` for snapshot assets but does NOT
  reliably patch `fs.existsSync`. `findToolboxHtml()` used `existsSync`, which returned
  `false` for every path in the snapshot, so the middleware concluded the file was missing.
  Fix: `toolbox.html` is now pre-loaded at module startup using `readFileSync` (which IS
  intercepted by pkg). Every subsequent `GET /` is served from that in-memory cache —
  no per-request `existsSync` call required, and the fix works identically in zip and
  exe distributions.

### Added
- **`Launch Toolbox Silent.vbs`** — New headless launcher included in both the zip and
  exe-zip distributions. Double-clicking the VBScript starts NodeToolbox without any
  visible console window (`WScript.Shell.Run` with windowStyle `0 = SW_HIDE`). The
  browser auto-opens to the dashboard exactly as with the regular launchers. Works with
  both distribution types: finds `nodetoolbox-*.exe` for the exe-zip and falls back to
  `Launch Toolbox.bat` for the zip distribution. Includes a `MsgBox` error if neither
  launcher is found (e.g. wrong directory). Aimed at corporate users who find the
  terminal window concerning or are worried about accidentally closing it.

### Changed
- **`scripts/local-release.ps1`** — The exe-zip now contains both the `.exe` and the
  new `Launch Toolbox Silent.vbs`. Previously it contained only the `.exe`. The zip
  also includes `Launch Toolbox Silent.vbs` alongside the existing bat launcher.

### Tests
- `test/unit/pkg-snapshot.test.js` — NEW: 4 tests covering `cachedDashboardHtml` export,
  HTML content validity, and that `serveStaticFile` returns 200 when `existsSync` is
  stubbed to `false` (direct simulation of the pkg environment).
- `test/unit/silent-launcher.test.js` — NEW: 7 tests verifying the VBScript file exists,
  is non-empty, uses `WScript.Shell`, passes window style `0` (hidden), searches for
  `nodetoolbox-*.exe` by prefix, falls back to `Launch Toolbox.bat`, and shows a
  `MsgBox` error when nothing is found.

## [0.0.9] — Fix: Startup Errors Now Visible, Corporate SSL Fixed

### Fixed
- **Server crash on port conflict was silent** — Without a `server.on('error')` handler,
  an `EADDRINUSE` error (port 5555 already in use by another process) threw an unhandled
  exception: the console window closed instantly and the user saw nothing. A handler is
  now in place with a clear human-readable message that explains the two recovery options
  (close the conflicting process, or change the port in config). The window is kept open
  via `process.stdin.resume()` so the user can read the message before dismissing it.
- **Unexpected startup panics also kept invisible** — Added `process.on('uncaughtException')`
  to catch module-not-found and other startup throws (e.g. a failed `npm ci`) with plain-
  English guidance, and the same stdin-resume keep-alive so the window stays open.
- **`Launch Toolbox.bat` used `start` — errors always hidden** — The previous `start
  "NodeToolbox Server" node server.js` spawned a detached child window. If the server
  crashed in that child, the child window closed immediately. Changed to running
  `node server.js --open` directly in the bat's own window (POC pattern): the bat
  window IS the server window, stays open until the user closes it, and any crash output
  is fully visible.
- **`npm ci --silent` suppressed install errors** — Removed `--silent` so npm install
  output (including errors) is visible. Added diagnostic hints in the error message:
  corporate proxy hints, registry config command.
- **`sslVerify` defaulted to `true` — broke on corporate SSL inspection** — `toolbox-poc.js`
  line 221 uses `rejectUnauthorized: false` explicitly. This is required for Zscaler /
  Forcepoint / corporate MITM proxies that replace upstream TLS certs. Changed the
  NodeToolbox default to `false` to match the proven POC behaviour. Users who require
  strict cert verification can set `"sslVerify": true` in their config file.

### Tests Added / Updated
- `test/unit/startup-reliability.test.js` — 7 new tests: `server.on('error')` presence,
  EADDRINUSE message, stdin keep-alive, `uncaughtException` handler, bat direct execution,
  `--open` passthrough, `sslVerify: false` default.
- `test/unit/bat-launcher.test.js` — Updated "server process launch" section to assert
  **direct** node execution (no `start`) and scoped the `/b` check to the launch line only.
- `test/unit/loader.test.js` — Updated `sslVerify` default assertion to `false`.

## [0.0.8] — Fix: Exe Auto-Opens Browser, Pkg Asset Path Verified

### Fixed
- **Exe browser auto-open** — Double-clicking `nodetoolbox-vX.Y.Z.exe` no longer leaves the
  user staring at a console window. The server now detects `process.pkg` (truthy in all
  bundled exe builds) and automatically opens `http://localhost:5555` in the default
  browser — identical behaviour to `Launch Toolbox.bat --open`, no command-line flags needed.
- **Static-asset path compatibility with pkg** — Confirmed `staticFileServer.js` derives
  `PUBLIC_DIRECTORY_PATH` from `__dirname`, which `@yao-pkg/pkg` remaps to the virtual
  snapshot filesystem root at bundle time. The `public/**/*` assets declared in
  `package.json → pkg.assets` are therefore resolved correctly inside the `.exe`.

### Tests Added
- `test/unit/exe-launch.test.js` — 5 new tests covering: `process.pkg` presence in the
  auto-open condition, preservation of the `--open` argv path, combined `||` logic in the
  single `if` block, `__dirname` usage in `staticFileServer.js`, and absence of `process.cwd()`
  calls that would break inside the pkg bundle.

## [0.0.7] — Fix: Launcher Window Disappears, Exe Download Blocked

### Fixed
- **`Launch Toolbox.bat`** — Server window disappearing on launch (v0.0.6 regression).
  The `start /b` flag ran Node inside the launcher's console window without creating
  a new one. When the bat file exited, the console closed and killed the Node process
  with it. Changed to `start "NodeToolbox Server"` which opens a dedicated, persistent
  server window — the dashboard stays alive after the launcher closes.
- **Exe download blocked by browser** — The raw `nodetoolbox-vX.Y.Z.exe` triggered
  security warnings in Chrome/Edge that prevented download. The release now ships the
  exe inside a dedicated `nodetoolbox-vX.Y.Z-exe.zip`, bypassing browser exe filters.

### Tests Added
- `test/unit/bat-launcher.test.js` — 9 new tests covering: bat file existence, `npm ci`
  auto-install logic, `start` command structure (no `/b`, has window title `"NodeToolbox
  Server"`, passes `--open`), working-directory anchor via `%~dp0`.
- `test/integration/bat-launch.test.js` — 5 functional tests that **actually execute
  `Launch Toolbox.bat` via `cmd.exe`**, let the bat exit, then verify the server is
  still alive on port 5555. Uses `netstat -ano` + `taskkill /F /PID` for
  environment-agnostic process management (no PowerShell restrictions).

## [0.0.6] — Persistent Config, Credential Obfuscation & Slim Distribution

### Added
- **Persistent config across upgrades**: credentials are now stored in
  `%APPDATA%\NodeToolbox\toolbox-proxy.json` instead of alongside `server.js`.
  Upgrading to a new version no longer requires re-running the setup wizard.
- **Credential obfuscation**: PATs, API tokens, and passwords are base64-encoded
  on disk so they are not visible in plain text to a casual viewer.
- **Automatic migration**: on first launch of v0.0.6+, any existing co-located
  `toolbox-proxy.json` is automatically imported to AppData and the original file
  is removed.
- **Slim distribution zip**: `node_modules` is no longer bundled in the release
  zip. The zip now contains ~30 files instead of ~5 000+, making extraction
  near-instant. Dependencies are auto-installed via `npm ci` on first launch.
- **Single-file Windows exe**: the release now ships a standalone
  `nodetoolbox-vX.Y.Z.exe` built with `@yao-pkg/pkg`. No extraction or Node.js
  install required — download and double-click.

### Changed
- `Launch Toolbox.bat` now auto-installs production dependencies (`npm ci
  --omit=dev`) when `node_modules` is absent, enabling the slim zip workflow.
- Release script (`local-release.ps1`) now publishes the GitHub Release
  directly using `gh release create` — no GitHub Actions required.
  Running the script is the complete release process: build zip, build exe,
  create tag, upload assets.
- Release script (`local-release.ps1`) accepts an optional `patch`/`minor`/`major`
  positional argument to bump the version in `package.json` before building.

## [0.0.5] — Fix: v0.0.4 Issue Resolution (Issue #15)

### Fixed
- **`src/routes/proxy.js`** — All three proxy routes (`/jira-proxy`, `/snow-proxy`, `/github-proxy`) were using `req.path` to build the downstream URL, which strips query strings. Changed to `req.url` so query parameters are correctly forwarded. This was the root cause of: Team Dashboard board search returning all boards regardless of search term, ART View Overview showing blank (JQL filters dropped), and any API call relying on GET query params.
- **`public/toolbox.html`** — Removed 35 embedded BOM (U+FEFF / zero-width no-break space) characters that appeared as garbled glyphs in some browsers.
- **`public/toolbox.html`** — Added the missing **Admin Hub** card to the home page grid. The view existed and was fully implemented, but had no entry point on the home screen. Added under a new "Administration" section.
- **`public/toolbox.html`** — Fixed `crCheckCredWarnings()`: in NodeToolbox proxy mode (`IS_NODETOOLBOX_SERVER = true`), the browser relay is never used so `CRG.relay.jiraReady` is always `false`. This caused a false "Jira not connected" warning to permanently display in SNow Hub. The function now checks `IS_NODETOOLBOX_SERVER` and suppresses the warning in proxy mode.
- **`public/toolbox.html`** — Fixed `devTestJiraPAT()`: direct `fetch()` calls are CORS-blocked in the browser context. When running on NodeToolbox (`IS_NODETOOLBOX_SERVER`), the PAT test now routes through `tbxJiraRequest()` (the server-side `/jira-proxy`), enabling a real connectivity test.
- **`public/toolbox.html`** — Removed Git Hooks references from the Dev Workspace setup wizard. The Git Hooks feature (offline PowerShell scripts) is not supported in the NodeToolbox browser environment. Removed the Git Hooks feature card from the welcome step (devWizS0), removed the Git Hooks method card from the workflow step (devWizS4), and updated the summary step (devWizS5) to reference only supported workflows (GitHub Sync and Manual Post).

### Tests Added
- `test/integration/proxy.test.js` — Three new tests verifying query string parameters are forwarded correctly for Jira, ServiceNow, and GitHub proxy routes.
- `test/unit/toolboxHtml.test.js` — Seven new static-analysis tests covering: BOM character absence, Admin Hub card DOM presence, `crCheckCredWarnings` proxy-mode guard, `devTestJiraPAT` proxy routing, and Dev Workspace wizard Git Hooks removal.

## [0.0.5] — Fix: v0.0.4 Issue Resolution (Issue #15)

## [0.0.4] — Fix: Portable launcher for distributed zip

### Fixed
- **`Launch Toolbox.bat`** (new file) — Replaced the broken `Launch Toolbox.lnk` in the distributable zip with a portable `.bat` launcher. The `.lnk` shortcut embedded absolute paths from the CI build machine (`D:\a\NodeToolbox\...`) which do not exist on the end-user's machine. The `.bat` uses `%~dp0` (the bat file's own directory at runtime) so it works correctly regardless of where the zip is extracted.
- **`scripts/local-release.ps1`** — Updated `$IncludedPaths` to bundle `Launch Toolbox.bat` instead of `Launch Toolbox.lnk`. Removed the `create-launcher.js` step (step 2/4 → now 3 steps total). Updated dry-run output.
- **`.github/workflows/release.yml`** — Removed the `node scripts/create-launcher.js` CI step, which was generating a machine-specific `.lnk` that could never be used on another machine.
- **`test/unit/local-release.test.js`** — Updated dry-run test assertions to verify `.bat` is reported and `.lnk` is not included (2 tests updated, 1 regression guard added).
- **`scripts/local-release.ps1`** — Replaced em dash (`—`) characters inside `Write-Host` double-quoted strings with plain hyphens. Windows PowerShell 5.1 misparses UTF-8 em dashes in string literals, causing `ParserError` failures on the CI runner.

### Notes
- `npm run create-launcher` still works for users who want a machine-specific desktop shortcut after extracting the zip (creates a `.lnk` with correct local paths).

## [0.0.3] — Fix: CI + release script compatibility

### Fixed
- `test/unit/local-release.test.js` — Wrapped all tests in `describeOnWindows` guard (`process.platform === 'win32' ? describe : describe.skip`). Tests were calling `powershell.exe` directly, which does not exist on Linux CI runners, causing 6 test failures on every push to main.
- `scripts/local-release.ps1` — Removed `Set-StrictMode -Version Latest`. Even assigning to automatic variables like `$LASTEXITCODE` throws `VariableIsUndefined` on a fresh `pwsh` session (GitHub Actions `windows-latest`) under latest strict mode. `$ErrorActionPreference = 'Stop'` is sufficient for build script error handling.
- `scripts/local-release.ps1` — Coerced `Where-Object` pipeline results to `[array]` so `.Count` property is always available under strict mode (returns `$null` instead of empty array when no items match).

## [0.0.2] — Phase 7: Proxy Auto-Wire

### Added
- `test/unit/toolboxHtml.test.js` — 10 static analysis tests: verifies `IS_NODETOOLBOX_SERVER` detection is present, Jira/SNow proxy routing in all four request functions, and confirms in-app connection wizard is fully removed

### Changed
- `public/toolbox.html` — Auto-wire NodeToolbox as proxy when served from localhost:
  - Added `IS_NODETOOLBOX_SERVER` detection constant and `NODETOOLBOX_ORIGIN` variable
  - Added `tbxNodeToolboxFetch()` shared helper for all NodeToolbox proxy calls
  - Updated `tbxJiraRequest()` — routes through `/jira-proxy/*` on NodeToolbox, relay fallback for file:// mode
  - Updated `tbxSnowRequest()` — routes through `/snow-proxy/*` on NodeToolbox, relay fallback for file:// mode
  - Updated `crJiraFetch()` — NodeToolbox fast-path with correct `{ ok, status, json(), text() }` response shape
  - Updated `crSnowFetch()` — same pattern
  - Removed in-app connection wizard (556 lines): `var CONN_WIZ` state, `tbxConnWizShow/Render/Go/Step0-4/NeverShow/SaveJiraUrl/OpenJiraTab/TestRelay/VerifyJiraApi/TestProxy/CopyCommand/SetStatus/SkipSession/Relaunch/Confirm/StopPolling` functions, startup trigger, `<div id="tbx-conn-wiz-overlay">` HTML, and all associated CSS rules (43 lines)

## [0.0.1] — Phase 6: Friendly Guided Setup Wizard

### Added
- `src/routes/setup.js` — Fully redesigned as a 5-step guided wizard (Welcome → Jira → GitHub → ServiceNow → Done). Each step uses plain, jargon-free language with skip buttons for optional services. Progress indicator with animated dots. Zero external CDN dependencies — self-contained inline HTML.
- `test/integration/setup.test.js` — Expanded from 9 to 17 tests. New GET tests: welcome step, jira/github/snow/done step presence, skip buttons, progress indicator, `/api/setup` reference, Jira/SNow URL pre-fill, no external CDN URLs. POST contract unchanged.

### Changed
- `public/toolbox.html` — Removed all Python (`toolbox-server.py`) references:
  - Replaced Python wizard steps in `tbxConnWizStep3()` and `tbxWizS3Proxy()` with Node.js download/launch instructions
  - Renamed `tbxWizDownloadServerPy()` → `tbxWizDownloadServerJs()` (opens NodeToolbox releases page)
  - Updated `proxyStartCommand` → `node server.js`
  - Updated `adminHubCopyStartCommand()`, bat launcher, and silent VBScript launcher to reference `node server.js`
  - Updated proxy update banner download link to GitHub Releases page
  - Removed 1,922-line embedded `toolbox-server.py` block (replaced with one-line comment)
- `package.json` — Version bumped from `1.0.0` to `0.0.1` for initial release tag

## [1.4.0] — Phase 5: Release Pipeline

### Added
- `.github/workflows/ci.yml` — CI: runs on every PR and push to main; matrix across Node 18 + 20; `npm ci` → `npm test`; blocks merge on failure
- `.github/workflows/release.yml` — Release: triggered by `v*` tags on `windows-latest`; runs tests, creates launcher, packages zip via `local-release.ps1`, uploads to GitHub Releases via `softprops/action-gh-release@v2`

## [1.3.0] — Phase 4: Distribution Package

### Added
- `scripts/local-release.ps1` — Packages NodeToolbox into a distributable zip (`dist/nodetoolbox-vX.Y.Z.zip`). Steps: `npm install` → `create-launcher` → bundle `server.js`, `package.json`, `public/`, `src/`, `scripts/`, `node_modules/`, and the launcher shortcut. Supports `-DryRun` flag (print plan, write nothing).
- `test/unit/local-release.test.js` — 6 unit tests validating dry-run output (npm install mention, launcher mention, zip path, semver, no dist/ created)
- `package.json` `local-release` script — `npm run local-release` invokes the PowerShell packager

### Audited
- `public/toolbox.html` — Python proxy references (`toolbox-server.py`, connection wizard) are confined to legacy setup help dialogs and the embedded server file. The NodeToolbox `/setup` wizard supersedes the in-app connection wizard. No API surface changes required; all `/api/*` endpoint paths are unchanged.

## [1.2.0] — Phase 3: Windows Launcher

### Added
- `scripts/create-launcher.js` — Creates `Launch Toolbox.lnk` via VBScript helper (cscript). Sets Target = `node.exe`, Arguments = absolute path to `server.js`, WorkingDirectory = repo root, WindowStyle = hidden (no console flash). Supports `--dry-run` (no file written) and `--help` flags.
- `test/unit/createLauncher.test.js` — 7 unit tests covering dry-run output, shortcut config values, no-write guarantee, and `--help` text

### Notes
- `npm run create-launcher` (already in package.json from Phase 0) invokes this script
- The `.lnk` file is gitignored — it is a per-machine artifact

## [1.1.0] — Phase 2: First-Run Setup Wizard

### Added
- `src/routes/setup.js` — Self-contained credential wizard: `GET /setup` returns dark-themed inline HTML (no CDN, no external assets) with three service cards (Jira, GitHub, ServiceNow); `POST /api/setup` validates input, merges credentials into the live config, writes `toolbox-proxy.json`, and returns 302 → `/`
- First-run detection in `server.js` — `GET /` redirects 302 → `/setup` when none of the three services (Jira, GitHub, ServiceNow) have been configured, ensuring new users always reach the wizard instead of a non-functional dashboard
- `test/integration/setup.test.js` — 9 integration tests covering GET /setup HTML structure, config pre-fill, POST validation, trailing-slash stripping, partial-service acceptance, and duplicate-submission resilience

### Changed
- `server.js` — setup router mounted before static file middleware; first-run redirect middleware added
- `test/integration/server.test.js` — `GET /` test updated to accept 302 (setup redirect) alongside 200/404

## [1.0.0] — Phase 1: Express Foundation

### Added
- `src/config/loader.js` — two-layer config loading (file + env vars), `loadConfig()`, `saveConfigToDisk()`, `createConfigTemplate()`, `isServiceConfigured()`
- `src/middleware/cors.js` — Express CORS middleware with preflight (OPTIONS → 204) support
- `src/utils/httpClient.js` — `proxyRequest()` core proxy engine with TLS toggle, `buildAuthHeader()`, `buildBasicAuthHeader()`, `makeGithubApiRequest()`, `makeJiraApiRequest()`
- `src/services/snowSession.js` — in-memory ServiceNow g_ck session store with expiry tracking
- `src/services/repoMonitor.js` — background GitHub repo monitor; detects new branches, commits, and PRs; posts Jira comments and fires workflow transitions
- `src/routes/proxy.js` — Express router factory for `/jira-proxy/*`, `/snow-proxy/*`, `/github-proxy/*`
- `src/routes/api.js` — Express router factory for `/api/proxy-status`, `/api/proxy-config` (GET + POST), `/api/snow-session` (GET + POST + DELETE)
- `src/routes/scheduler.js` — Express router factory for `/api/scheduler/status`, `/config` (GET + POST), `/run-now`, `/results`
- `src/utils/staticFileServer.js` — `findToolboxHtml()` searches public/ then user home dirs; `serveStaticFile()` middleware with directory traversal protection
- `server.js` — Express entry point: wires all middleware + routes, startup banner, `--open` flag, scheduler auto-start
- `public/toolbox.html` — Toolbox dashboard (ported from ToolBox project)
- `.env.example` — documents all `TBX_*` environment variables
- `README.md` — quickstart guide, API surface table, project structure

### Changed
- Forge Workflow initialized with Forge Terminal Workflow Architect
