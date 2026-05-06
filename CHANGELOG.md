# Changelog — NodeToolbox

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **SNow relay doesn't auto-activate when bookmarklet is clicked on an already-open tab** — `crAutoPingBridge` (which polls the bridge status until the bookmarklet registers) was only started when the user clicked "Open SNow Tab" inside NodeToolbox. If the user already had a ServiceNow tab open and clicked the bookmarklet directly, `crAutoPingBridge` was never started, `CRG.relay.snowReady` was never set to `true`, and all requests fell through to the Basic Auth proxy (returning 401 on SSO-only instances). Three targeted fixes:
  1. `tbxProbeRelay` in server mode now handles the "bridge became active" case — when `/api/relay-bridge/status` returns `active: true` but `snowReady` is still `false`, it sets `snowReady = true` and updates the connection bar immediately.
  2. The 30-second keep-alive interval now probes all *configured* services (not only already-connected ones), so a manually-clicked bookmarklet auto-activates within 30 seconds without any further user action.
  3. On page load, a 2-second deferred probe checks whether any relay bridge is already registered — handles the case where the NodeToolbox server restarts while the bookmarklet tab is still open.

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
