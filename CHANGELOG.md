# Changelog — NodeToolbox

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Setup wizard — prominent API token instructions with step-by-step guides**: The first-install setup wizard now displays API token instructions in visually prominent **token instruction callout boxes** with blue accent borders, key/lock emojis, and numbered step-by-step lists. Jira, GitHub, and Confluence steps all include detailed, easy-to-follow instructions for obtaining API tokens from each service. This change makes it immediately obvious to new users that they need API credentials and provides clear guidance on where to find them, reducing setup friction and support requests.
- **SNow Hub — GET /api/snow-relay/change/:changeKey endpoint**: New API endpoint for fetching ServiceNow CHG (Change Request) records by key from the server. Uses the relay bridge to fetch the change from ServiceNow and returns mapped fields including change details, basic info, planning assessment, and planning content. Returns 404 if the change does not exist and 502 if the relay bridge is not active.
- **SNow Hub — PATCH /api/snow-relay/change/:changeKey endpoint**: New API endpoint for updating ServiceNow CHG records by key. Accepts a request body with change fields and CTASK records, updates the ServiceNow change record, and creates any new CTASKs linked to the change. Returns 204 on success and 502 if the relay bridge is not active.
- **SNow Hub — unified CHG tab with Create/Modify mode toggle**: SNow Hub's CHG tab now features a clean **Create/Modify toggle button** at the top, allowing users to easily switch between creating new changes and modifying existing ones from a single tab. This consolidates the workflow into one logical place, reducing tab clutter while making it immediately clear that both operations are part of the same change management feature. The toggle button uses visual highlighting (teal border and background) to indicate the active mode.
- **SNow Hub — CHG Modify workflow with 5-step wizard UI**: The **Modify mode** provides a clean, guided workflow for editing existing ServiceNow Change Requests. Users enter a CHG key in step 1 to fetch the change from ServiceNow, then progress through steps for editing change details, planning fields, and environments. Step 5 includes a **CTASK template picker dropdown** where users can load pre-filled CTASK templates and add them directly to the change before saving. All CTASKs support **inline field editing** (short description, description, assignment group, assignee, planned dates) with collapsible edit panels. The UI reuses the proven Create CHG styling and layout patterns for consistency and discoverability.
- **SNow Hub — CTASK template picker and inline editing in Modify workflow**: The Modify workflow's final step features a **CTASK template dropdown** with an **Add CTASK** button, allowing users to quickly add templated change tasks to existing changes. Templates are loaded from the same CTASK template library used in Create. Each CTASK appears with a collapsible **Edit** panel that allows users to modify all fields directly before saving, plus a **Remove** button for easy management. When editing, all CTASK fields (short description, full description, assignment group, assignee, planned start/end dates) are updatable in real-time with changes reflected in the save payload.
- **SNow Hub — field validation before save in Modify workflow**: The Modify workflow now validates all required fields (change summary, assignment group, and CTASK short descriptions) before allowing save. If validation fails, an error message clearly indicates which field is missing, preventing incomplete or malformed ServiceNow updates. Validation errors are displayed prominently in red above the save button.
- **SNow Hub — user assignment-group reverse lookup**: SNow Hub now includes an **Assignment Groups** tab where users can search for a person and return all related ServiceNow assignment groups, including the group name and membership record ID for quick auditing.

### Changed
- **SNow Hub — tab label renamed to "CHG Generator"**: The main change management tab is now labeled **CHG Generator** (instead of just "CHG") to align with other major features like **PRB Generator**. This improves visual consistency and clarity across the SNow Hub workspace.
- **Internal refactoring — Create CHG component naming**: Renamed internal component `CrgTab` → `CreateChgTab` for consistency with product branding (Create CHG, Modify CHG, PRB Generator). All imports, tests, and stylesheets updated accordingly. This is a non-breaking change affecting only internal component organization.
- **Team Dashboard — dedicated Hygiene tab with ART-style checks**: Team Dashboard now includes a first-class **Hygiene** tab that embeds the same Hygiene workspace behavior used elsewhere in Toolbox, including summary score tiles, per-check flag drill-down, and issue-level hygiene findings. The Team Dashboard tab now also seeds Hygiene with the active team project key so teams land in a scoped hygiene view without manual re-entry.
- **Team Dashboard — saved multi-team switching**: Team Dashboard now supports multiple saved team profiles instead of one global board setup. Users can save the current project and board as named dashboard teams, switch the active team from the dashboard header, and keep team-specific board selection, scope filters, advanced dashboard config, standup planning, roster data, standup UI state, and PI capacity data isolated per saved team.
- **Documentation — richer tool, feature, and workflow guides across the repo and app shell**: the root README now includes per-tool feature maps plus step-by-step usage and troubleshooting guidance for the major NodeToolbox workspaces, the client README now explains the frontend architecture and workspace documentation ownership, and the in-app Code Walkthrough now includes workflow playbooks and troubleshooting notes alongside the technical platform reference.
- **Feature Review + Blueprint — weighted feature completion**: feature completion percentages now include **all** child records, including off-train work, and no longer rely on a done-only count. Child issues now contribute weighted progress based on workflow state and also weight by **story-point size** when points are present, with a small fallback weight for unpointed items: **0%** for **To Do**, **20%** for statuses containing **work / working / in progress / implementing**, **50%** for statuses containing **test / testing**, **90%** for statuses containing **ready to accept**, and **100%** for items in a **Done** status category.
- **Admin Hub + Hygiene — enforceable enterprise rules and feature schedule gates**: Admin Hub enterprise rules now drive real validation instead of storing names and descriptions only. Built-in rule toggles now control both the standalone Hygiene screen and Team Dashboard Feature Review, custom rules can require a specific Jira field for selected issue types, and Feature Review/Hygiene now include three new default feature date rules that flag features when **Target Start** has arrived but the feature is still **To Do**, when **Target End** has arrived before the feature leaves **To Do** or **Implementing**, and when **Due Date** has arrived before the feature reaches **Done**.
- **Team Dashboard — Feature Review direct status transitions**: Feature Review’s direct-fix panel now loads the valid Jira workflow transitions for each feature and lets teams apply a status change inline, then refreshes the feature card and hygiene badges immediately after the transition succeeds.
- **GitHub App authentication — backend**: The scheduler (Repo Monitor), GitHub debug endpoint, and GitHub proxy now support GitHub App credentials (`appId`, `installationId`, `appPrivateKey`) as an alternative to a Personal Access Token. When all three App credentials are present, installation access tokens are fetched and cached automatically; the PAT path is preserved for existing setups. The `/api/scheduler/run-now`, `/api/scheduler/validate`, and `/api/scheduler/github-debug` endpoints accept either auth method, and diagnostic responses now include an `authType` field (`'pat'`, `'github-app'`, or `'none'`) so operators can confirm which method is active.
- **Team Dashboard — PI carryover remap panel**: the PI Review workspace now includes a dedicated **PI carryover remap** panel where teams can move all non-done child issues from an old feature to a new feature in one action, while updating both the configured Feature Link field and the Program Increment copied from the new feature together. The picker now auto-loads **old features from the prior PI** and **new features from the current PI** using the same PI date-range matching behavior as ART View, and selecting an old feature previews the child records plus status before any re-map runs.
- **Team Dashboard — PI Review capacity planning window now defaults from the selected PI**: the Capacity planner inside PI Review now reads the selected PI label's embedded start and end dates and uses that range as the default planning window for workday calculation. Teams can still switch to **Custom Dates** at any time when the PI naming convention changes or they need to model a different planning period.
- **Team Dashboard — Feature Review tab**: Team Dashboard now includes a dedicated **Feature Review** workspace that rolls up the team’s current-PI features using the same Blueprint-style feature discovery path as ART View, then surfaces per-feature hygiene badges plus child-issue counts so teams can review carryover and cleanup work without leaving the dashboard.

### Added
- **Accessibility — app-wide tool text size control**: NodeToolbox now includes a persistent **Tool text size** control in the header and Settings so users can enlarge routed tool screens without changing the browser or desktop zoom for the rest of the app chrome.
- **Business Helper — new guided Jira Simple Search workspace**: Home and Personal Toolbox now include a new **Business Helper** tool that starts with a **Simple Search** tab for business users. The tab accepts a plain keyword, keeps the generated Jira query hidden, searches across all accessible Jira projects, groups results into **Portfolio**, **ART**, and **Team** sections, supports business-friendly sorting such as prioritizing matches found in **Summary** versus **Description**, and lets users expand a result row to read the description plus clearly separated **Child Records** and **Linked Issues** detail panels.
- **Business Helper — stablization funding table**: Business Helper now includes a new **Stablization** tab with editable funding rows, automatic **Testing** and **Total** formulas, browser-local draft persistence, and footer totals for every USD currency column so a business partner can start rebuilding the spreadsheet workflow inside Toolbox.
- **Business Helper — table settings and Simple Search mapping**: Business Helper now includes a **Settings** tab where users can turn supported Stablization text columns into dropdowns, maintain each dropdown list, and map Simple Search result fields into Stablization destination columns before sending Jira rows into the funding table.
- **Business Helper — nested relationship descriptions in Simple Search**: business users can now expand individual **Child Records** and **Linked Issues** inside a Simple Search result to read each related issue's description without leaving the grouped search workspace.
- **Business Helper — user-defined Stablization columns**: the Stablization table now supports custom columns that business users can add themselves from Settings, with supported data types for **Text**, **Dropdown**, **Currency**, and **Date**. Custom columns persist locally, appear directly in the editable table with resize support, and text or dropdown custom columns can optionally receive mapped values from **Simple Search**.
- **PI Review — capacity now lives inside PI Review instead of a separate tab**: Team Dashboard now embeds the editable capacity planner directly inside the **PI Review** workspace so capacity, Feature Scope, and Confidence stay in one flow, and the same live snapshot continues to drive the shared Confluence save path. ART View also drops the separate **Capacity** tab and keeps the saved capacity snapshot inside each PI Review readout panel, with Team Dashboard as the authoring handoff.
- **PI Review UX split — Team Dashboard authoring and ART View readout**: PI Review authoring now lives in a dedicated **PI Review** tab inside Team Dashboard, where a matched ART team can keep using the shared Confluence-backed editor. ART View now presents PI Review as a readout-first experience with the document, capacity snapshot, confidence history, export actions, and a direct handoff into Team Dashboard when a team needs to edit or save the page.
- **Art View — PI Review Feature column Jira date pills**: PI Review now shows compact **Target Start**, **Target End**, and **Due Date** pills directly inside the Feature cell so teams can scan key scheduling dates without leaving the document view. Due Date comes from Jira's built-in `duedate`, while Target Start and Target End now default to `customfield_10101` and `customfield_10102` and still remain configurable from ART Settings when a Jira instance needs different custom fields.
- **Art View — PI Review high-resolution PNG export**: each team PI Review panel now includes an **Export PI Review PNG** action that captures the live document view as a higher-resolution lossless screenshot, making it easier to zoom in and read small details without blur.
- **Art View — PI Review pasted Jira date updates**: PI Review edit mode now includes a **Paste & Update Jira Dates** action that accepts a pasted markdown table or direct Excel tab paste with **Jira Key**, **Target Start**, **Target End**, and **Due Date**, then writes those dates back to Jira immediately using the same PI Review field IDs already configured in ART Settings and refreshes the in-panel date pills.
- **Art View — PI Review Jira reconciliation, reusable grouping lines, and discard-edit recovery**: PI Review now enriches existing and new Confluence tables from Jira on load so the View screen shows `Feature Key - Summary`, Jira priority, Jira-linked dependencies/risks, and feature estimates from `customfield_10111` when Jira already has a value. Save now backfills Jira feature estimates only when Jira is blank, migrates legacy free-text dependency/risk notes into Implementation Notes, supports unlimited custom grouping lines with editable text/color plus a reserved high-contrast Stretch Goals line, and adds a current-panel **Ignore Edits** action that restores the last loaded PI Review state without affecting other teams.
- **Art View — PI Review now opens in a cleaner View mode with an explicit Edit mode**: each team PI Review panel now defaults to a read-only document view for the table, commitment line, confidence history, and capacity summary. Structural authoring controls such as row movement, import, optional columns, confidence editing, and Save to Confluence are now grouped behind an explicit **Edit PI Review** action so the normal working view feels less like a template builder.
- **Art View — PI Review capacity snapshot sync**: each team PI Review page now shows the current Capacity-tab snapshot above the PI Review table and writes that same capacity summary into Confluence on save, including work days, 100% capacity, 80% target, and role breakdown badges. PI Review now only loads from explicit team page URLs and no longer falls back to a shared default page. Saves also retry automatically when Confluence rejects a stale version number, and Toolbox now rewrites the PI Review table with full-width layout markup to keep the Confluence table from collapsing.
- **Art View — PI Review hard-commit boundary line**: PI Review tables can now place one yellow commitment line between rows so teams can separate hard commits above the line from stretch goals below it, with the marker saved back into the Confluence table. The editor also now includes move-up and move-down row tools so committed work can be reordered above the line before saving.
- **Art View — PI Review XLSX import for Confluence table exports**: each PI Review team section now includes **Import PI Review XLSX**, allowing a Confluence table export such as the issue #60 `26.3 Commit.xlsx` file to populate the editable PI Review rows as an unsaved draft before saving back to Confluence.
- **Admin Hub — first-install demo mode without deleting real settings**: Backup / Restore Settings now includes **Open First-Install Demo**, which launches a separate demo tab via `?demo=1`. Demo mode redirects NodeToolbox localStorage reads and writes into sessionStorage for that tab, shows a visible **Demo mode** badge, and leaves the user's real saved settings untouched for repeat demos and setup testing.
- **Art View — experimental shared ART workspace via Confluence Database**: ART Settings now includes an experimental **Shared ART Workspace** section that can create a real Confluence Database shell, store the ART team roster and advanced ART settings in supported database content properties, publish local changes back to that shared workspace, and load the shared ART into a fresh NodeToolbox instance so teams/settings do not need to be recreated by each user.
- **ART View — PI Review now supports team-specific Confluence pages and confidence tracking**: each ART team can now store its own PI Review Confluence page URL in Settings, the PI Review tab resolves full Confluence URLs instead of requiring a raw page ID, and the tab renders one Confluence-backed section per configured team. Each team section also now includes a week-over-week **fist-of-five** confidence tracker with hand-image vote buttons that saves back to the same Confluence page.
- **ART View — PI Review table tools for local drafts**: starting a Toolbox-owned PI Review draft now opens with one editable blank row under the canonical headers instead of an empty screen. The PI Review editor now treats **Committed to PI?** as a checkbox, keeps notes in a separate **Implementation Notes** column, and includes table tools to add/remove optional **Dev Work** and **Test Support** checkbox columns before saving back to Confluence.
- **Team Dashboard — recovered local parity work and durable dashboard state**: the recovered Team Dashboard branch now includes the newer Team Dashboard experience that had not been present in `v0.9.31`, including board-aware loading, roster and standup workspace additions, and shared settings persistence for project key, board, active tab, and scope selection.
- **Admin Hub — durable settings backup registry**: a shared `persistentSettingsStorage` utility now defines which localStorage keys count as durable NodeToolbox settings so backup, restore, and reset flows can include Team Dashboard and other modern `tbx*` settings consistently.

### Fixed
- **Reports Hub — React error #31 in filter dropdowns**: Global PI and Team filter dropdowns now safely sanitize option values to ensure only valid strings are rendered as `<option>` children. Non-string or empty option values are filtered out before rendering, preventing "Minified React error #31" crashes when filter options arrays contain unexpected data shapes.
- **Team Dashboard — saved-team flow now follows project/board-first setup**: Settings now places **Project Key** and **Board** selection before the saved-team alias/actions, and save actions stay disabled with a clear prompt until both project and board are selected.
- **Reports Hub — malformed ART settings no longer blank the page**: Reports Hub now sanitizes `tbxARTSettings.teams` entries loaded from localStorage, ignoring null or incomplete team records so the view keeps rendering instead of crashing on open.
- **Reports Hub — global report parameters now apply across all tabs**: Reports Hub now shows shared **PI** and **Team** dropdown parameters above the tab content so every report can be scoped the same way, and the selected parameters now filter Dashboard, Features, Defects, Risks, Flow, Impact, Individual, Quality, Sprint Health, and Throughput consistently.
- **Reports Hub — Copy Report now captures the real report as a PNG image**: the copy action now renders the active filtered report section as a high-resolution image and writes it to the clipboard, so pasted output in email and IM tools is a graphical replica of the on-screen report instead of plain text.
- **Team Dashboard — saved-team dropdown now favors team aliases over raw project keys**: dashboard team labels now treat project-key-only profile names as legacy defaults, so the selector prefers the saved board/team label when available, and the Settings alias field now stays synced to whichever saved team is active so renaming one team no longer applies stale text from another profile.
- **Team Dashboard — team-scoped dashboard persistence no longer leaks legacy shared state into new teams**: dashboard config, capacity planning, roster members, standup planning, and standup UI state now perform a one-time migration from the old shared localStorage keys into the first team-scoped key that reads them, then stop consulting those shared keys once any scoped team data exists. Existing single-team users keep their saved data, while newly created teams now start from clean isolated state instead of inheriting another team's dashboard settings or standup roster.
- **Team Dashboard — saved-team removal and switching now stay isolated per profile**: removing a different saved dashboard team no longer bumps the active team over to the first remaining profile, and switching teams no longer briefly autosave the previous team’s board or scope selections into the newly active profile during the handoff.
- **Team Dashboard — Feature Review no-assignee false positive**: Feature Review now explicitly requests each feature’s Jira `assignee` field when loading feature issues for hygiene evaluation, so features that already have an assignee no longer get incorrectly flagged as **No assignee** after reload.
- **Team Dashboard — Feature Review assignee search now supports legacy Jira user APIs**: the direct hygiene-fix user lookup now falls back from Jira’s modern `query` search parameter to the legacy `username` parameter when older Jira instances require it, and the save payload now preserves whether the selected user came from `accountId`, `name`, or `key` so assignee fixes work across both Jira user models.
- **PI Review — confidence edits now expose a save action inside the confidence section**: when a team clicks **Edit Confidence Votes**, the confidence workspace now shows its own **Save Confidence Votes** action alongside the weekly vote controls, so users can persist edited weekly confidence rows without hunting back through the main PI Review toolbar.
- **Team Dashboard — feature remap and Feature Review now stay scoped to the right features**: Team Dashboard now filters remap and Feature Review results down to features that still have current-team child work, optionally limits those features to configured Jira project keys from ART Settings, and drops feature records whose own Program Increment is explicitly set to a different PI.
- **PI Review — decimal confidence votes now show a clearer partial finger**: read-only fist-of-five icons now draw a visible divider on fractional votes so values like `3.7` and `2.5` read as three full fingers plus part of the next finger instead of looking like the next whole vote.
- **PI Review — Confluence saves now keep feature cells clickable in Jira**: when a PI Review Feature cell contains a Jira issue key such as `DENP-1370`, the saved Confluence storage now writes that feature text as a direct Jira browse link instead of plain text.
- **PI Review — save now stays available for Confluence-only upgrades**: the Save to Confluence action no longer stays blocked when Toolbox has a pending storage rewrite, such as upgrading plain-text feature keys into Jira links, even if the user has not made a separate local field edit first.
- **Team Dashboard — Feature Review now includes direct hygiene fixes**: flagged Feature Review cards now expose an in-place fix panel so teams can correct feature metadata such as summary, PI, target dates, due date, parent link, fix version, acceptance criteria, and child story points without leaving the Team Dashboard screen.
- **Team Dashboard — PI carryover remap now finds features outside the team project**: the carryover remap picker no longer assumes features live in the same Jira project as the team board. Instead it now follows the team’s linked child issues using the shared Blueprint-style discovery path, so prior-PI and current-PI feature dropdowns include the real mapped features even when those features live in a separate ART or portfolio project.
- **Hygiene — default feature-attribute rules now use Feature Link wording and validate the full SPC checklist**: the default enterprise hygiene rules now say **Missing Feature Link** instead of **Missing Epic Link**, and the Hygiene validator now tracks the feature-attribute gaps from the SPC checklist, including Feature Name / Summary, Product Owner, Initiative Type, Parent Link, Acceptance Criteria, pointed child stories, Program Increment, Target Start, Target End, Application, Fix Version, and Due Date.
- **Admin Hub, SNow Hub, and Business Helper — top-level responsive sizing now actually expands with the window**: those tool shells now opt into the full-width shared page frame instead of staying constrained to narrow or standard widths, and the Admin Hub’s code/action/form rows now wrap more cleanly on smaller windows so the dynamic sizing tokens can visibly reflow the page.
- **Admin Hub — GitHub App Installation ID lookup now works before the Installation ID is already known**: the **Find my Installation ID** flow no longer waits for full GitHub App auth to be configured. Toolbox now treats **App ID + Private Key** as enough to query the app's installations, can persist those draft values before the lookup, and auto-fills the Installation ID when GitHub returns exactly one installation. The GitHub App **client secret is still not required** for this server-to-server Repo Monitor path.
- **Team Dashboard — tab content no longer collapses below the tab row after the responsive sizing rollout**: the Team Dashboard workspace now uses a safer flex sizing contract for its main tab panel, so the active dashboard content keeps a real render height instead of collapsing to nothing when the surrounding page shell does not provide a hard 100%-height container.
- **App-wide responsive sizing — shared page shells, controls, and dense work views now adapt more cleanly across screen sizes**: Toolbox now uses shared responsive layout tokens and a reusable page frame for top-level views, the app header and connection controls wrap more gracefully on narrower screens, home cards and shared tabs size more fluidly, and dense work areas such as My Issues, Team Dashboard, Art View, and PI Review now clamp key widths instead of relying as heavily on fixed desktop-only sizing.
- **Business Helper — Stablization columns now resize cleanly, blank dropdown rows auto-fill when only one option exists, and imported Jira values keep direct links**: the funding table now uses persistent header drag handles instead of textarea box resizing, keeps wrapping-friendly cells readable at narrower widths, preselects a dropdown's only allowed option for blank starter rows and newly added rows, and preserves an **Open source Jira issue** hyperlink for Jira data sent from Simple Search.
- **Business Helper — Stablization column drags now apply the full requested width instead of snapping within a tiny range**: the funding table now sizes itself from the sum of the user-managed column widths instead of being visually held to the wrapper width, so widening a column produces a real table-width change with horizontal scroll when needed. The resize path also keeps using the same supported width range as saved settings.
- **Business Helper — Simple Search tab bar now stays pinned to the top while scrolling at larger text sizes**: the shared tool text-size layout now uses sticky-safe scaling, so the **Simple Search** tab strip no longer drifts and locks in the middle of the page after switching to **A+** or **A++**.
- **PI Review — Team Dashboard confidence history is editable again**: the Team Dashboard PI Review authoring flow now restores a confidence-specific **Edit Confidence Votes** entry point and a visible **Add Weekly Confidence Vote** action inside the confidence section, so teams can add new weekly records and update existing votes — including decimal fist-of-five values — without hunting through the broader PI Review toolbar. PI Review pages that are missing the canonical Toolbox table now also keep **Save to Confluence** disabled and explain that the local Toolbox template must be loaded first, instead of failing as a silent save dead end.
- **Team Dashboard — release-notes PNG export now starts reliably and captures the full table**: the shared PNG download helper now keeps the generated blob alive long enough for the browser to begin the download and uses a live hidden anchor for stricter browser support. Release-notes exports also now mark the table's horizontal scroll shell as export-expandable so the PNG can capture the whole rendered table instead of only the visible scroll viewport.
- **Art View — Stretch Goals divider now matches the custom-line band styling**: the reserved Stretch Goals row now uses the same subtle band treatment as custom grouping lines instead of the heavier filled row treatment, while keeping the yellow palette exclusive to Stretch Goals so the divider reads cleanly without overpowering the table.
- **SNow Hub — Change Request Generator now creates one CHG per enabled environment and searches Config Items sooner**: CRG review/create now carries the live ServiceNow environment values into submission so each enabled environment creates its own change with that environment's config item, impacted-persons-aware value, and planned start/end window instead of collapsing everything into the last selected environment. The shared lookup field also begins searching after one meaningful character so Config Item search feels active immediately.
- **SNow Hub — Release Management now bypasses relay-only page-context 403s for change_request reads**: the Release Management tab now loads change requests and "My Active Changes" through the direct ServiceNow proxy path, so configured ServiceNow credentials are used for those read-only table calls instead of relying on the current relay page context.
- **Team Dashboard — Release Notes PNG export now preserves themed colors and uses a pill action**: the release-notes export now captures from a real themed card surface instead of a transparent section, which fixes the PNG color mismatch, and the export control now uses a rounded pill-style button that is excluded from the captured image.
- **Art View — PI Review Stretch Goals divider now uses a readable filled yellow band**: the hard-commit / Stretch Goals boundary row now renders with bright yellow top and bottom markers, a slightly darker 80%-opacity yellow fill between them, and dark high-contrast text so the divider reads cleanly in both themes.
- **Art View — PI Review team pages now use tabs instead of one long stack**: multi-team PI Review readout now shows one team at a time behind a shared team tab strip, while still keeping each loaded team panel mounted so switching tabs does not throw away loaded content or in-progress edits.
- **Art View — PI Review Feature column now shows Jira fix version pills**: the Feature cell now includes a **Fix Version** pill alongside **Target Start**, **Target End**, and **Due Date** whenever Jira assigns a fix version to the feature, making release targeting visible without leaving the PI Review view.
- **Art View Settings — Shared ART push now merges safer against newer remote changes**: Shared ART sync now remembers the last workspace snapshot loaded from Confluence and uses that base to three-way merge later pushes. Non-conflicting remote and local edits can now publish together, while same-field conflicts stop the push with a clear message instead of silently overwriting newer workspace changes.
- **Art View Settings — first installs now start pointed at the shared ART backend**: new Toolbox installs now prefill the Shared ART name, short name, Confluence space, parent content, and shared database ID for the Sales to Enrollment workspace so new users land on the central shared backend immediately while still being able to override those values locally afterward.
- **Art View Settings — Shared ART workspace setup and sync are easier to follow**: the experimental Shared ART section now separates first-time Confluence workspace creation from later sync actions, explains which fields matter for each step, and makes the ongoing push/load workflow clearer once a database ID exists.
- **Home View — My Issues card now matches the other tool cards**: the Home grid now gives each sortable card slot a full-height layout path so shorter cards such as **My Issues** stretch to the same visual height as their neighbors instead of looking undersized within the row.
- **Art View — PI Review screenshot export now matches the app more literally**: PI Review exports now use a single PNG screenshot path from an off-screen absolute export host, which avoids tall-page seam artifacts without re-styling the page for export. The old PDF export action is removed, and Stretch Goals/custom grouping lines now keep the same emphasis as the live UI instead of using a second export-only look.
- **Art View — PI Review styling refresh now stays theme-aware and more readable**: PI Review now renders all read-only Yes/No fields as intentional checkmark badges instead of noisy literal text, gives **Target Start**, **Target End**, and **Due Date** pills softer glow-coded treatments, restyles Confluence and export actions as pill buttons that better match the app theme, adds more contrast and card treatment to the table rows, and keeps the fist-of-five confidence icons high-contrast in both dark and light mode without relying on hardcoded dark-only colors.
- **Admin Hub — version check fallback resilience**: update checks now probe the GitHub API and the public GitHub release redirect in parallel instead of relying on a single API call with one timeout path. This keeps version detection working when `api.github.com` is slow or temporarily blocked while still preferring full release notes when the API responds.
- **Art View — fist-of-five raised finger contrast**: the confidence hand icon now de-emphasizes the palm and folded fingers so the raised fingers read first in dark mode, making scores like **4** and **5** much easier to recognize at a glance.
- **Art View — decimal fist-of-five votes**: confidence rows now accept one-decimal values such as **3.7**, preserve them in Confluence, and render the next finger as a partial fill so fractional confidence still reads visually instead of falling back to whole-number hands only.
- **Art View — Monthly Report Jira parity**: The Monthly Report tab now derives metrics and narrative content from each team's already-loaded Jira sprint issues:
  - **Jira stats strip**: Each team card gains a read-only strip showing done/total issues, completion %, velocity/committed story points (when issues carry estimates), and an impediment count with amber highlight when risks exist.
  - **Generate from Jira button**: A single click pre-fills the "Accomplished" field with bullet lines for each done issue (KEY: summary, capped at 10 with an overflow note) and the "Risks" field with bullet lines for every detected impediment (same four-signal detection as the Impediments tab). Existing manual content is preserved when generation returns nothing.
  - **Load hint**: Cards whose team data has not yet been fetched show an italic hint ("Load this team from the Overview tab to enable Jira-driven generation.") instead of an empty stats strip.
  - **Export CSV**: A new "Export CSV" toolbar button exports visible cards with columns for Team, Pillar, Accomplished, Outcomes, Risks, Stakeholders, Velocity Pts, Committed Pts, Completion %, and Impediments — ready for Excel / Google Sheets.
  - **Jira stats in HTML and Text exports**: The existing "Export HTML" and "Export Text" (and "Copy All") outputs now include a progress line per team (e.g. `Progress: 60% complete · 21/35 pts · ⚠️ 2 impediments`) when Jira data is available.
  - 17 new helper-level unit tests covering `computeMonthlyJiraStats`, `generateMonthlyAccomplishedText`, and `generateMonthlyRisksText`, plus 5 new component-level tests for the stats bar, generate button, load hint, and generate-click behaviour.
- **Art View — Advanced Predictability parity**: The Predictability tab now provides significantly richer metrics aligned with the SAFe predictability measure:
  - **ART Predictability Rollup bar**: A summary bar above the per-team table shows overall ART predictability % (total done / total issues across all teams), total issues done/total, optional story-point burndown (shown only when estimates are present), team count, and a Scrum/Kanban split stat when both board types coexist.
  - **Sprint column**: Scrum teams now show their active sprint name in the table so users can see which sprint window the metrics are from.
  - **Throughput column**: Board-type-aware metric column — Scrum teams with estimates show `N pts/sprint`, Scrum teams without estimates show `N issues/sprint`, and Kanban/flow teams show `N issues / Xd` where X is the configured Sprint Window Days.
  - **Scrum/Kanban section sub-headers**: When a mixed ART has both Scrum and Kanban teams, the table splits into labelled sections (`Scrum Teams — velocity per sprint (Nd)` and `Kanban / Flow Teams — throughput per Nd window`). Single-type ARTs render a flat list with no extra headers.
  - **Sprint Window Days integration**: The `sprintWindowDays` setting (configured in Settings → Sprint Window Days) is now used in Throughput labels and section sub-headers so the displayed sprint-window context is always correct.
- **Art View — Overview tab ART Summary Bar**: A new summary bar renders above the team filter row in the Overview tab, providing an instant ART-level health snapshot without needing to scan individual team cards:
  - **Teams loaded**: Shows `loaded / total` teams so the user can see at a glance how much data is available.
  - **Issues done**: Shows `done / total` across all teams when at least one team has data.
  - **Blocked count**: Surfaced with a 🚧 indicator and critical (red) colouring only when impediments exist, keeping the bar clean when the ART is healthy.
  - **Story points rollup**: Shows `done SP / total SP` when any issue carries a story point estimate; omitted entirely when no estimates are present.
  - **Days remaining in PI**: When `piEndDate` is configured in Settings, shows how many days remain until the PI ends. Turns yellow at ≤14 days and red at ≤7 days; displays "Ends today" on the last day and "Overdue" once the date has passed.
- **Art View — PI Progress Header days remaining badge**: The PI progress header (above the tab bar) now shows a days-remaining pill alongside the done/in progress/to-do pills when `piEndDate` is configured. Urgency colouring matches the ART Summary Bar thresholds (yellow ≤14d, red ≤7d, "Overdue" when past).
- **Art View — SoS Jira parity**: The SoS tab now surfaces the per-team `sosIssueKey` and enables direct Jira sync:
  - **Jira issue key badge** appears in each accordion header when a `sosIssueKey` is configured in Settings, so facilitators can see which Jira issue backs each team's SoS entry at a glance.
  - **Post to Jira button** in each expanded accordion section posts the team's current SoS narrative as a Jira comment (`POST /rest/api/2/issue/{key}/comment`) using wiki-markup formatting.
  - **Sync state indicator** ("🔵 Local only" → "✅ Synced · HH:MM:SS") so facilitators know instantly whether the narrative has been pushed to Jira for the selected date.
  - **Error feedback**: If the post fails, an inline error message is shown below the button.

### Fixed
- **Art View — PI Review Confluence fetch failures now explain DNS/config issues better**: when the Confluence proxy cannot resolve the configured Atlassian host, PI Review now shows a clearer error that points users toward the Confluence base URL, VPN/DNS access, and tenant name instead of only surfacing the raw `ENOTFOUND` network message. The panel also now keeps the resolved Confluence page ID visible even when the fetch itself fails.
- **Art View — PI Review fist-of-five icons are easier to see**: the confidence vote hand icons now use stronger neutral outlines, deeper folded-finger contrast, a subtle shadow, and a more visible selected-state background so the weekly fist-of-five controls stay readable in both light and dark themes.
- **Art View — PI Review line editing now stays in the row workflow instead of a separate editor**: Stretch Goals and custom grouping lines now use the same per-row toggle pattern in Edit mode. Clicking the Stretch Goals button again removes that line, custom lines are added/removed from the row they belong to, and custom line text/color can now be edited inline from the inserted line itself with a compact color menu instead of the old top-of-panel line manager.
- **Art View — PI Review custom lines and capacity sync now survive Confluence round-trips**: PI Review now re-detects custom grouping lines and the Team Capacity block from the rendered Confluence markup even when Confluence strips Toolbox-only `data-*` markers. That keeps a saved custom line from reappearing twice, preserves its chosen color after reload, and replaces the existing Team Capacity snapshot instead of appending duplicate copies on later saves.
- **Admin Hub — first-install demo mode now starts from the real setup wizard**: launching demo mode now opens `/setup?demo=1`, hides saved Jira, GitHub, Confluence, and ServiceNow server connectivity from demo requests, and prevents demo setup submissions from mutating the real `toolbox-proxy.json` configuration.
- **Art View — PI Review can now bootstrap a Confluence page from a Toolbox-owned local draft**: when an existing Confluence page cannot be parsed as a PI Review table, the PI Review tab now offers a confirmed **Load Toolbox PI Review template locally** recovery flow. The template opens as an unsaved draft so users can fill it out first, and the Confluence page is only overwritten when they click **Save to Confluence**.
- **Art View — PI Review parsing now tolerates extra Confluence formatting cells**: PI Review table detection no longer requires the matched header row to contain exactly eight cells, so Confluence pages that inject an extra blank spacer/formatting column beside the real PI Review headers can still load and save from Toolbox without being rejected as “table not found.”
- **Reports Hub — reports now generate automatically on open and sprint loading is Jira-safe**: opening Reports Hub now automatically runs the same report refresh that the manual **Refresh** button triggers, so the dashboard and tabs populate on first view instead of waiting for an extra click. Sprint Health and dashboard sprint widgets also no longer inject `issuetype != Epic` into the JQL, which avoids failures in Jira projects that do not expose `Epic` as a valid issue type name.
- **Art View — PI Review now recognizes Confluence tables with title rows above the real headers**: the PI Review parser no longer assumes the first table row is the header row, so Confluence pages that keep spacer/title rows such as "26.3 ask from the Business / PO" above the real 8-column PI Review headers now load and save correctly without deleting those rows.
- **Art View Settings — PI Review page setup and dependency link types are clearer**: the shared PI Review page field is now labeled as the **default** page to better distinguish it from the per-team PI Review URLs above, and Jira dependency link types now render as a cleaner pressed-button grid instead of a long checkbox wall.
- **Art View — PI Review header matching and shared ART naming are more forgiving**: PI Review table detection now accepts practical header variants such as `Candidate Feature`, `Estimate`, `Dependencies`, and `Comments` instead of requiring a single exact label set, the PI Review page summary now still shows the resolved page metadata even when table parsing fails, and the shared ART workspace now treats **ART Short Name** as an optional friendly label rather than a required Jira-like key.
- **SNow Hub — Release Management now finds open CHGs reliably**: the Release Management tab now queries ServiceNow through a proper `sysparm_query` using the current authenticated user plus `active=true`, instead of the previous hard-coded change-state path. The tab also now requests display-value fields and maps raw ServiceNow change records into the UI shape before rendering, so open CHGs assigned to the current user show up consistently in **My Active Changes** and single-change loads stay aligned with the same data contract.
- **ART View PI Review tab — editable Confluence PI review syncing is now available from Toolbox**: ART View now includes a **PI Review** tab that can load the first matching PI review table from a configured Confluence page, let the user edit it in Toolbox, and write the updated table back to Confluence. ART Settings also now includes a **PI Review Confluence Page ID** field so the tab knows which page to sync.
- **ART View Capacity tab — multi-team capacity planning now includes ART totals and new lead-role options**: ART View now includes a **Capacity** tab with a per-team capacity editor plus a **Total Capacity** section when more than one team is configured. The capacity role dropdowns now also include **Dev Lead**, **TPO**, and **Test Lead**, and the ART summary breaks totals down by role across all configured teams.
- **Team Dashboard roster and Admin Hub updates — project-user loading is more resilient and update installs now show visible progress**: the roster bulk loader now falls back from Jira assignable-user search to Jira's multi-project assignable-user search when the first project user list comes back empty, so the **Load users for current project** action is less likely to appear dead. Admin Hub update installs now show a phase message and progress bar while the package download, shutdown wait, and restart wait are in flight.
- **Art View — Blueprint and Dependencies now auto-load, and Dependencies includes a visual legend**: opening the Blueprint or Dependencies tab with a selected PI and configured teams now triggers the load automatically instead of waiting on a manual click. The Dependencies tab also now shows a visual key for node colors, line types, and the off-train outline so users can interpret the graph without guessing.
- **Team Dashboard roster — Jira partial-name search and project-user loading now match modern Jira behavior**: the roster search now uses Jira's `query=` assignable-user matching so partial names return results again, and the roster settings now include a **Load users for current project** flow that pulls assignable Jira users for the selected project, pre-selects them, and lets the user deselect anyone before adding them to the roster.
- **Art View — PI changes now refresh all tabs and keep Scrum sprint names visible in Predictability**: changing the Program Increment now reloads ART team data even when the user is on Predictability, Releases, or other non-Overview tabs, and PI-mode Scrum loads now still fetch the active sprint name so the Predictability sprint column does not collapse to blanks.
- **Admin Hub and Art View — top-of-page reset and automatic ART Overview loading**: Admin Hub now resets the shared app scroll position to the top when it opens or switches tabs, and Art View Overview now loads all configured teams automatically for the active PI instead of waiting on a manual first click. The old **Load All Teams** action has been reduced to a manual **Refresh All Teams** control for retries.
- **Team Dashboard — roster cards now wrap long contact values and support linked Jira + ServiceNow roster views**: roster member cards no longer let long email addresses or Jira identifiers overflow the settings card layout, the roster editor now searches **project-scoped Jira assignable users** instead of the broken global user-search endpoint, the old pasted-roster importer has been removed, each roster member can be linked to a ServiceNow user, and the current roster view can now load Jira sprint work beside active ServiceNow work for each linked person.
- **Team Dashboard — startup now defaults to Settings until setup is complete, and tab changes reset scroll position**: the Team Dashboard now opens on Settings while Jira/project/board setup is still incomplete, falls back to the first tab once a saved project and board exist and Jira is ready, and each tab switch scrolls the shared tab panel back to the top instead of preserving a stale scroll position from the previous tab.
- **Self-update — durable bootstrapper architecture replaces in-place executable surgery**: NodeToolbox releases now publish a single user-facing zip with stable top-level launchers, a `current.txt` active-version pointer, and payloads under `versions\<version>\nodetoolbox.exe`. Admin Hub updates install the new payload beside the old one and flip the pointer instead of overwriting the running executable, so relaunching from the original VBS/BAT or legacy top-level EXE follows the newest installed version after reboot.
- **UI theme system — light and dark mode now share the same surface tokens across the app shell and major views**: the global page background, shared cards, tabs, connection status chrome, dialogs, and several high-traffic screens (Home, Admin Hub, Team Dashboard person-walk panels, My Issues, and Snow lookup inputs) now use semantic theme tokens instead of dark-only colors, so Light mode no longer leaves major sections stuck in dark styling.
- **Art View — dark theme parity and visible theme toggle**: the Blueprint, Dependencies, and shared Art View styling now use shared theme tokens instead of hardcoded white/light palettes, so those panels render correctly in dark mode. NodeToolbox also now exposes a global Light/Dark toggle in the top app header so users can switch themes without leaving the current view.
- **Art View — Program Increment selector now auto-loads and picks the PI covering today**: when the ART roster is already saved, the Program Increment dropdown now fetches PI options on launch and parses date ranges embedded in names such as `PI 26.3 (05/21/26 - 07/29/26)` so the current PI is selected automatically instead of leaving the dropdown blank until "Reload PIs" is clicked.
- **Art View — Dependencies now match the legacy dependency map workflow**: the Dependencies tab no longer uses the simplified cross-team table. It now builds a lane-based SVG dependency graph from the same bottom-up Blueprint hierarchy query chain, supports legacy focus modes and edge filters, preserves dependency filter state in local storage, shows off-train placeholder nodes and a Jira-linked detail drawer, and honors configurable Jira dependency link types from Advanced ART Settings.
- **Art View — Blueprint now uses the legacy bottom-up hierarchy query chain**: the Blueprint tab no longer stops at a flat feature list. It now mirrors the legacy ToolBox flow by collecting team issues, resolving Features through the configured Feature Link field with fallback fields, resolving Program Epics through the Parent Link field, discovering external PE children, scanning all Feature children for off-train work, attaching subtasks, and rendering a Program Epic → Feature → Story hierarchy with off-train badges and external feature markers.
- **Art View — Monthly Accomplishments now matches the required email/Teams template**: the Monthly Report editor now captures the exact rows required by the approved accomplishment format, including initiative/project name, P/T code, product areas, business outcomes, delivered date, and SME/PO. `Copy All` now places the report on the clipboard as an HTML table plus plain-text fallback so users can paste the exact structure into Outlook or Teams, and HTML/Text/CSV exports now use the same row order.
- **Art View — Board Prep now supports Kanban and Simple boards**: the Board Prep loader now checks each team board's Jira type before choosing its data source, using `/backlog` for Scrum boards and `/issue` for Kanban/Simple boards. Teams like SIS no longer fail with Jira's "The backlog is not available on Kanban boards" error when loading Board Prep.
- **Team Dashboard — final recovery cleanup for validation-safe Pointing, Defects, Planning, and Pipeline flows**: `SprintDashboardView` no longer relies on effect-driven synchronous state updates that trip the React hooks lint rule, the Pointing queue now resets through explicit session rebuilds when filters or board context change, and the pipeline checklist loader now uses typed Jira responses that build cleanly without `any`.
- **Self-update — updates now apply back into the original install location instead of relaunching from `%TEMP%`**: ZIP updates stage the full release and dependencies first, then copy the prepared files back into the existing install root after shutdown; EXE updates overwrite the launched executable path in place. Manual relaunches from the original VBS, BAT, or EXE now continue on the updated build instead of reverting to the original downloaded version.
- **Self-update — manual installs now use a staged directory swap instead of mirroring `node_modules` back into place**: ZIP updates are now prepared beside the live install so the detached updater can rename the old install to a backup, move the staged release into the original path, restore only the few install-root artifacts that must survive (`.env`, legacy `toolbox-proxy.json`, and the effectiveness log), and relaunch quickly. The Admin Hub restart detector now waits for the old server to go down before it accepts the replacement server as healthy, matching Forge Terminal's safer restart mechanics.
- **Self-update — Admin Hub restarts now wait for the right version and close the old listener before relaunching**: restart and update handoffs now close the active HTTP server before exit, restarted processes carry a hidden `--restart-handoff` marker so they wait briefly for the old listener and then fail fast instead of hanging on `EADDRINUSE`, and the Admin Hub polling loop now requires the expected version from `/api/proxy-status` before it declares the update successful.
- **Admin Hub update polling now allows longer in-place ZIP updates**: the browser waits up to 180 seconds for restart so a valid update is not marked failed while the updated install is being applied.
- **Self-update — pkg exe installs no longer try to stage updates inside `C:\\snapshot`**: the updater now treats `process.pkg` the same way the rest of the app does, so compiled builds stage and swap updates beside the real installed exe directory instead of trying to create folders inside pkg's read-only virtual snapshot.
- **My Issues status changes no longer fail on Jira transition endpoints that return no body**: the shared Jira POST helper now treats successful empty responses as valid, so changing issue status from My Issues, the Issue Detail panel, and other Jira transition surfaces no longer surfaces `Unexpected end of JSON input`.
- **Team Dashboard — roster settings now live under Settings and respect the active team**: the standalone Roster tab has been folded into Settings, roster members now render as compact contact cards, and roster-scoped standup automatically filters to the persisted active team so multi-team rosters only surface the selected team's people when roster scope is active.
- **DSU Board — issue-link and comment previews now tolerate Jira payloads with partial link/comment metadata**: the client build and overlay rendering no longer assume every linked issue and comment includes fully-populated type, summary, status, author, and created fields.
- **Art View — shared Jira typing now covers PI, impediment, dependency, and release metadata used by the parity views**: the client build no longer fails when Art View tests and release/reason logic reference Jira fields such as alternate story points, flagged state, labels, issue links, parent keys, comments, and fix-version release dates.
- **Release pipeline — fresh-clone releases now install client dependencies before building the React app**: `scripts/local-release.ps1` no longer relies on an already-populated `client/node_modules` folder, so re-running a release from a clean clone now succeeds through the React build step.
- **Art View — Jira board selection metadata now stays accurate when boards reload or the picker falls back to manual entry**: project-filtered board loads no longer leave the picker stuck in a stale loading/error state, and manual board-ID entry now clears any previously selected board metadata instead of preserving the wrong board name.
- **Art View — Monthly Report CSV export now tolerates empty fields**: exporting cards no longer crashes when older saved drafts are missing one or more optional text fields.
- **Art View — Blueprint and Dependencies PI queries now fetch up to 500 issues per team** (was incorrectly capped at 200 while the PI-aware hook path already used 500). Large PIs with more than 200 issues per team no longer silently truncate the Blueprint hierarchy or the cross-team dependency table. Open-sprint fallback queries retain the 200-issue cap.
- **Art View — Settings PI field change no longer triggers noisy Jira reloads on every keystroke**: `handlePiFieldChange` now only calls `loadPiOptions()` when the entered value is a fully-formed Jira custom field ID (`customfield_NNNN+`). This prevents stale/duplicate PI-options reloads while the user is typing in the `JiraFieldPicker` fallback text input (shown when Jira's field metadata API is unavailable).
- **Art View — SoS and Monthly Report parity improvements**:
  - **SoS impediment detection** now uses the same 4-signal logic as the Impediments tab (blocked status, "is blocked by" link, Jira flag `customfield_10021`, and `blocked`/`impediment` labels). The Pulse count and per-team accordion list no longer miss flagged or label-blocked issues that lack "block" in their summary.
  - **SoS date picker**: A date selector above the accordion lets facilitators view and edit narratives for any of the past 14 days — narratives are stored per-team per-date so previous sessions are not overwritten.
  - **SoS Copy Report**: A "Copy SoS Report" button formats all team narratives for the selected date as plain text for pasting into Jira, Confluence, or email.
  - **SoS accordion header badge**: Each team's accordion header now shows issue count and done/total completion at a glance so facilitators can assess team health without expanding every row.
  - **Monthly Report — month persistence**: The selected month is now saved to `localStorage` (`tbxMonthlyReportMeta`) and restored when the tab is re-opened, so users do not need to re-navigate after switching tabs.
  - **Monthly Report — pillar filter**: A "Filter by pillar" dropdown in the toolbar narrows visible cards to a single portfolio pillar (Growth, Affordability, Operating Model) independently of the team filter.
  - **Monthly Report — draft indicator**: Cards that have at least one content field filled show a "✓ Draft" badge in the card header, making it easy to scan which teams have submitted entries.
  - **Monthly Report — Export Text**: An "Export Text" button downloads the visible cards as a plain-text `.txt` file alongside the existing HTML export.
- **Art View — shared data foundation for parity tabs**:
  - `SPRINT_ISSUE_FIELDS` now requests all fields required by Overview, Impediments, SoS, Predictability, and Releases parity paths: `issuelinks`, `fixVersions`, `customfield_10016`, `customfield_10028`, `customfield_10021`, `customfield_10301`, `labels`, and `parent`. Previously these fields were silently absent, causing impediment detection and dependency resolution to fall back to empty data.
  - `BOARD_PREP_FIELDS` now includes `customfield_10028` so the Board Prep panel can resolve story points on Jira instances that use the alternate estimate field.
  - A new shared module `artHelpers.ts` exports pure, reusable helper functions for all ART View tabs: `isIssueDone`, `isIssueInProgress`, `resolveIssueStoryPoints` (dual-field fallback), `computeCommittedStoryPoints`, `computeVelocityPoints`, `detectImpedimentReasons`, and `isImpediment`. Tabs no longer need to duplicate fallback logic or impediment detection inline.
  - `loadBoardPrep` now uses `resolveIssueStoryPoints` for the estimate field so both story-point custom fields are checked automatically.
  - The inline `ImpedimentReason`, `detectImpedimentReasons`, and `isImpediment` definitions previously in `ArtView.tsx` have been removed; `ArtView.tsx` now imports them from `artHelpers.ts`.
  - **SoS impediment detection** now uses the same 4-signal logic as the Impediments tab (blocked status, "is blocked by" link, Jira flag `customfield_10021`, and `blocked`/`impediment` labels). The Pulse count and per-team accordion list no longer miss flagged or label-blocked issues that lack "block" in their summary.
  - **SoS date picker**: A date selector above the accordion lets facilitators view and edit narratives for any of the past 14 days — narratives are stored per-team per-date so previous sessions are not overwritten.
  - **SoS Copy Report**: A "Copy SoS Report" button formats all team narratives for the selected date as plain text for pasting into Jira, Confluence, or email.
  - **SoS accordion header badge**: Each team's accordion header now shows issue count and done/total completion at a glance so facilitators can assess team health without expanding every row.
  - **Monthly Report — month persistence**: The selected month is now saved to `localStorage` (`tbxMonthlyReportMeta`) and restored when the tab is re-opened, so users do not need to re-navigate after switching tabs.
  - **Monthly Report — pillar filter**: A "Filter by pillar" dropdown in the toolbar narrows visible cards to a single portfolio pillar (Growth, Affordability, Operating Model) independently of the team filter.
  - **Monthly Report — draft indicator**: Cards that have at least one content field filled show a "✓ Draft" badge in the card header, making it easy to scan which teams have submitted entries.
  - **Monthly Report — Export Text**: An "Export Text" button downloads the visible cards as a plain-text `.txt` file alongside the existing HTML export.
- **Art View — Settings parity** (`art-settings-parity`):
  - **PI End Date**: A plain-text date input (`YYYY-MM-DD`) in Advanced ART Settings saves the current PI's end date to `tbxARTSettings`. Downstream panels (future Overview burndown, SoS countdown) can read it without an additional API call.
  - **Sprint Window Days**: A number input in Advanced ART Settings stores the sprint length in calendar days (default 14). Used by future burndown and stale-issue projections to determine mid-sprint vs. end-of-sprint thresholds.
  - **Story-Points Auto-detect**: The `isSpAutoDetect` toggle (previously stored in `tbxARTSettings` but never shown in the UI) is now rendered as a labelled checkbox. When checked, the secondary story-point field is tried automatically so teams whose Jira instances use the alternate field see correct counts without manually entering the field ID.
  - **P-Code Field**: A `JiraFieldPicker` for the program/portfolio code field (`pCodeField`) is now present in Advanced ART Settings. This Jira custom field links Features to their parent Capabilities or Epics in the portfolio backlog and is required for future Blueprint cross-hierarchy display.
  - **Per-team SoS Issue Key**: Each team row in the Settings team list now shows an inline text input for the team's SoS Jira issue key (`sosIssueKey`). The value is auto-saved on change (no extra "Save Teams" click needed), persisted in `nodetoolbox-art-teams` via the existing team persistence layer, and available to future SoS sync features.
  - `ArtTeam` now carries `sosIssueKey?: string` and the `addTeam` action accepts it as an optional fifth argument.
  - A new `updateTeamSosKey(teamId, sosIssueKey)` action in `useArtData` allows in-place updates to the SoS key without removing and re-adding a team.
- **Art View — Releases tab advanced parity** (`art-releases-advanced`): The Releases tab now provides a production-quality release-tracking experience:
  - **Urgency badges**: Each fix version shows a colour-coded urgency pill — `Overdue` (red, past due and unreleased), `Critical` (red, ≤7 days remaining), `Warning` (amber, ≤30 days remaining), `Upcoming` (green, beyond warning horizon), `Released` (grey, formally released in Jira), and `No Date` (grey, no release date configured).
  - **Mini progress bars**: A compact horizontal bar alongside each fix version shows the ratio of done-to-total issues at a glance, with `role="progressbar"` and `aria-valuenow` for accessibility.
  - **Expandable issue detail rows**: An expand/collapse button per version reveals a nested sub-table of individual issues (key, summary, status, team). Done issues are dimmed so open work is visually prominent. The button's `aria-expanded` and `aria-label` attributes update dynamically to reflect current state.
  - `classifyReleaseUrgency()` helper encapsulates urgency logic, reusing `computeDaysRemainingInPi()` for consistent date math.
  - `ReleaseIssueSummary` interface captures the slim per-issue snapshot needed for expanded rows without duplicating the full `JiraIssue` payload.
  - `RELEASE_URGENCY_CONFIG` lookup table maps each urgency level to its human label and CSS class, guaranteeing compile-time exhaustiveness.
- **Art View — Impediments tab advanced parity** (`art-impediments-advanced`): The Impediments tab now provides a production-quality blocked/flagged issue tracking experience:
  - **Grouped/collapsible team sections**: Issues are grouped by team under an accordion header button showing the team name and impediment count. Clicking the header collapses or expands the section, so large ARTs can be scanned at a glance. Teams with zero matching impediments after filtering are omitted entirely.
  - **Reason filter dropdown**: A "Filter by reason" `<select>` in the toolbar narrows the view to `Blocked Status`, `Blocked Link`, `Flagged`, or `Label` — or shows all reasons with the default "All Reasons" option. Filtering is additive with the existing project key filter.
  - **Days column with stale-tier badges**: A new "Days" column shows how many days have elapsed since each issue was last updated. The badge is colour-coded green (fresh), amber (stale), or red (critical) using the `staleDays` threshold from ART Settings (default 5 days; critical at 2× threshold). Two new pure helpers in `artHelpers.ts` — `computeDaysSinceUpdate(issue, nowMs?)` and `classifyImpedimentStaleness(days, threshold)` — back the calculation.
  - **Detection Signals legend**: A "Detection Signals" toggle button reveals a compact `<dl>` explaining each of the four impediment detection signals in plain English (collapsed by default so the legend content does not duplicate table reason text).
  - **Actionable prompts per issue**: A small italic prompt appears below the reason text for each issue, nudging the team toward the next concrete action (e.g. "Update status or add a resolution comment" for Blocked Status issues; "Remove the impediment flag once cleared" for Flagged issues).

### Added
- **Admin Hub — "Check Repo Access" button**:A new *📋 Check Repo Access* button in Service Connectivity probes each Scheduler-configured repository at the branches/PRs endpoint level (not just `/user` auth). Results table shows per-repo HTTP status codes with a human-readable diagnosis that distinguishes: IP allow list blocks ("Your IP address is not in the allowed list"), SAML SSO not authorized, generic 403 scope errors, 401 invalid PAT, and 404 wrong repo path. This surfaces the true cause of failures that the existing *Test Connection* probe hides (it tests `/user`, which passes even when org-scoped endpoints are blocked by an IP allow list).
- **Admin Hub — Repo monitor — probeErrorMessage now populated on HTTP errors**: `probeSingleRepoConnectivity` previously left `probeErrorMessage: null` for all HTTP-level failures (403, 404, etc.) — it was only populated for network exceptions. It now extracts `body.message` from GitHub's error response, making the message available in `/api/scheduler/validate` and surfaced by the new "Check Repo Access" UI.

### Changed
- **Art View — Blueprint and Dependencies tabs now use PI-aware queries**: When a PI is selected and team project keys are configured, the Blueprint and Dependencies tabs now query issues using `cf[piField] = "PI name"` instead of `openSprints()`, matching the legacy PI-scoped behavior. This surfaces the full PI backlog (not just the active sprint) for the hierarchy and dependency views. Both tabs fall back to `openSprints()` when no PI is selected or when a team has no project key configured. `DependenciesTab` now accepts a `selectedPiName` prop, and `ArtView` wires the shared PI selection to both tabs.

### Changed
- **Team Dashboard — Roster tab now imports pasted team rosters with saved metadata**: The Team Dashboard roster editor now accepts spreadsheet-style copy/paste input, previews parsed members before import, and supports both **Merge imported members** and **Replace current roster** flows. Imported team, role, email, location/time zone, LAN ID, and working-hours metadata are saved with each roster member and shown on the roster cards, while roster-scope standup reloads immediately when the imported assignee list changes.
- **Team Dashboard — every tab now shares a global Sprint / PI / Fix Version work scope**: Team Dashboard now opens in the active sprint by default, persists the selected scope and scope value across refreshes, and lets every tab switch the loaded work between **Sprint**, **PI**, and **Fix Version** from one shared selector above the tab bar. The header now reads **Team Dashboard** and the summary card shows the Jira board name instead of a numeric board ID, so the page stays readable after reloads and board switches.
- **Team Dashboard / DSU Board — Standup now supports Sprint vs Roster point-and-click planning**: Team Dashboard now includes a real **Roster** tab for building the people list used by standup and DSU. Standup can switch between **Sprint** and **Roster** scopes, persist the selected scope, let each person’s cards be point-and-click selected into today’s plan, carry yesterday’s saved plan forward as the default starting point, and show whether yesterday’s plan held or shifted based on the issues that were actually updated. DSU Board roster sections now read from that shared roster source instead of a placeholder configuration path, so out-of-sprint work can be reviewed by roster without rebuilding the list each session.
- **Team Dashboard — Person Walk now uses visual standup cards again**: The Standup → Person Walk mode now surfaces the richer original-style standup board instead of only a textarea workflow. It adds a follow-through strip for yesterday's updates, per-assignee sprint cards with completion bars, blocker/stale badges, richer issue metadata, and a darker card-based draft composer so the standup reads visually at a glance while keeping copy/post-to-Jira behavior.
- **Team Dashboard / Story Pointing / Pipeline — UX flow overhaul**: The Team Dashboard Planning, Pointing, and Pipeline tabs now share a more coordinated shell with aligned headers, stat strips, filter placement, and empty states so the space reads as one workspace instead of disconnected tools. Pointing in both Team Dashboard and the standalone Story Pointing tool now prioritizes a fast single-issue estimation flow with wider jump controls, compact metadata, and progressive disclosure for description, acceptance criteria, and the latest Jira comment. The standalone Pipeline tool now uses the same higher-signal shell treatment with visible summary cards and clearer filter inputs.
- **Team Dashboard — remaining live ToolBox tab parity completed**: The remaining Team Dashboard tabs now follow the live ToolBox workflows instead of the earlier placeholder implementations. **Defects** now blends sprint bugs with a 90-day project-wide defect sweep, triage-focused sorting, assignee workload, and legacy-style filter modes; **Planning** now uses the project backlog query, release/epic/assignee grouping, inline Jira update actions, follow-up reporting, and backlog-detail expansion; **Pipeline** now uses the REL-centered correlation table with companion story columns, INT-window state, checklist reads, and attention filters; **Pointing** now uses the Team Dashboard sprint queue with role quick filters, bracket/dash role detection, DEV companion point suggestions, inline detail loading, and direct save-to-Jira estimation. This completes the requested Team Dashboard parity sweep while preserving the newer NodeToolbox burnup toggle in Overview.
- **Team Dashboard — Standup now follows the live legacy ToolBox flow**: The Standup tab now matches the live ToolBox path instead of the earlier approximation. **Board Walk** uses the legacy status-category columns, show-done toggle semantics, flow stats, blocker detection from inward blocking links, and per-column status chips; **Person Walk** now uses the live DSU textarea / preview / copy / Jira-post workflow from the current user’s loaded board issues; **DSU Board** now uses the legacy JQL rules (`INC*`/`PRB*`, `statusCategory`, fixVersion auto-detect, watcher-only, and explicit roster error handling) and restores the DSU project key, stale-days, view, collapsed sections, and selected release from the same persistence keys. Team Dashboard project selection now persists across reloads and keeps `tbxDSUProjKey` in sync so users do not have to reload their team board after app restarts or updates.
- **DSU Board — filter bar now uses compact dropdown menus for multi-select filters**: Issue Type, Priority, Status, and Assignee filters now open in cleaner dropdown menus with checkbox choices and active counts instead of rendering long rows of chips. Fix Version and PI keep the expected native dropdown treatment, and the same DSU filter redesign applies both in the standalone DSU Board and in Team Dashboard → Standup → DSU Board.
- **Team Dashboard — dark-mode pointing menu and board-aware settings copy**: The Pointing tab’s **Jump to issue** dropdown now keeps readable dark-mode option colors on Windows, and the Settings tab now uses board-friendly wording (`Board Settings`, `Load Board`) with explicit Scrum/Kanban advanced-setting labels so users switching between team types are not forced through sprint-only language.
- **Admin Hub — Update Management moved to top**: The 🚀 Update Management section now appears immediately after the Admin Access unlock form, making it the first content section visible without scrolling.

### Fixed
- **Art View — PI picker, Kanban loading, and board-name labels restored**: Art View now exposes a reusable Program Increment selector in the header instead of showing an unchangeable *No PI selected* state, loads Kanban boards from the board issue endpoint instead of failing on sprint-only APIs, and shows stored Jira board names on team cards and settings rows instead of only numeric board IDs.
- **Art View — Overview team card parity improvements**: Team cards in the Overview tab now show a board-type badge (SCRUM / KANBAN / SIMPLE), the active sprint name for Scrum boards when not filtered by a PI, a mini completion progress bar, and health-stat chips (done, in-progress, blocked count, stale count). The issue-count label is also context-aware (PI issues vs sprint issues vs board issues) matching the legacy behavior.
- **Settings persistence — Sprint Dashboard selections and legacy tool settings now survive updates reliably**: Sprint Dashboard now keeps the saved project, board, and active tab in the shared settings model, automatically reloads from that saved selection after a browser refresh, and prevents project changes from stranding an old board selection. The Admin Hub backup/reset flow also now includes durable legacy keys (`ntbx-*`, hygiene settings, ART teams, and Snow root causes) so saved tool configuration is not dropped during update/restore workflows.
- **Global navigation — sticky tool tabs now stay visible while content scrolls**: The shared app shell now constrains scrolling to the main content region again, so `PrimaryTabs` stick inside the intended scroll container instead of disappearing behind the top bar. Reports Hub also no longer traps scrolling at the root view level, which restores the same sticky-tab behavior there as the rest of the application.
- **Planning / Pipeline — hierarchy-safe parent lookups**: Team Dashboard Planning no longer assumes `issuetype = Epic`, so projects like ENFCT that use different hierarchy issue types can open the Planning tab without a Jira 400. The standalone Pipeline loader now follows the same hierarchy-safe pattern by deriving parent keys from live issue references before fetching the rollup cards.
- **Global navigation — sticky top tabs restored in affected tools**: Removed root-level overflow traps from Defect Management, Sprint Planning, Release Monitor, DSU Daily, standalone Pipeline, and standalone Story Pointing so the shared `PrimaryTabs` bar stays fixed while the page content scrolls.

### Added
- **GitHub App — "Find my Installation ID" diagnostic**: A new collapsible *🔍 Find my Installation ID* section in Admin Hub queries `GET /app/installations` using the saved App credentials and lists every organisation/account where the App is installed. Each row includes an *✅ Use this ID* button that auto-fills the Installation ID field — eliminates the most common cause of HTTP 404 errors (wrong or missing Installation ID).
- **GitHub App — App ID or Client ID clarification**: The "App ID" field is now labelled *App ID or Client ID* with inline guidance explaining that GitHub recommends the `Iv1.`-prefixed Client ID as the JWT `iss` claim (both are accepted). Installation ID is called out as a separate, distinct value.

### Changed
- **Home card count updated**: `homeCardData.test.ts` now expects 10 cards to match the current catalog after the addition of the GitHub App admin card in a prior release.

### Changed
- **Connection bar — GitHub icon now reflects live connectivity**: The GitHub icon is green only after a successful probe, not simply because credentials are present. A background probe runs at server startup; the cache clears when credentials are saved so the icon turns gray until the next successful *Test Connection*. `GET /api/proxy-status` adds `probeCheckedAt` (ISO timestamp) for "last checked" display in future.

### Added
- **GitHub App authentication**: Alternative to PAT for organisations where SAML SSO enforcement blocks Personal Access Tokens (HTTP 401). Configure a GitHub App in Admin Hub → GitHub → *GitHub App credentials* (collapsible panel). Requires App ID, Installation ID, and RSA private key (PEM). When App credentials are present they take priority over the PAT — installation tokens bypass per-user SSO requirements. Tokens are cached in memory with a 5-minute refresh buffer. All three credentials are base64-obfuscated on disk, same as the PAT. New env vars: `TBX_GITHUB_APP_ID`, `TBX_GITHUB_INSTALLATION_ID`, `TBX_GITHUB_APP_PRIVATE_KEY`. Added 10 unit tests covering JWT structure, RS256 signature, token fetching, cache reuse, and error cases.
- **GitHub App — Test Connection button**: The collapsible GitHub App panel now includes a *Test Connection* button that exercises the same live connectivity probe used by the PAT test, automatically preferring App credentials when configured.
- **GitHub App — PEM file upload**: The Private Key field now has an *Upload .pem file* button that reads the file directly without the key ever appearing in a form field. Avoids clipboard exposure of the RSA key.
- **GitHub App — PEM show/hide toggle**: The PEM textarea is blurred by default and a *Show / Hide* button reveals the content on demand, preventing shoulder-surfing of the private key during input.

### Changed
- **Admin Hub — GitHub connectivity test now uses App auth when configured**: The *Test Connection* button prefers the GitHub App installation token over the PAT and reports which auth method succeeded (e.g. "Connected successfully via GitHub App.").
- **Admin Hub — GitHub status badge now shows three states**: "✅ GitHub App credentials stored (preferred)" / "✅ Personal Access Token stored" / "⚠️ No GitHub credentials configured".
- **Connection bar — GitHub icon now reflects App auth**: The GitHub icon in the top connection bar is now green when either a PAT or a GitHub App is configured (was PAT-only).

### Fixed
- **GitHub App credentials were silently dropped on save**: The `POST /api/config/connectivity` handler only saved `baseUrl` and `pat` — `appId`, `installationId`, and `appPrivateKey` were never written to disk. All three App fields are now persisted correctly and the installation token cache is cleared immediately after save.
- **Dev Panel — GitHub Debug tab now shows accurate connectivity status**: Fixed a critical field-name mismatch where the server returned `httpStatus`/`authenticated`/`message` but the client expected `statusCode`/`success`/`errorMessage`. The status badge now shows three states: **✓ Connected** (probe passed), **✗ PAT configured but probe failed** (probe returned non-200), or **✗ Not Configured** (no PAT). The actual HTTP error (e.g. "HTTP 401 Unauthorized — Bad credentials") now appears in a prominent red banner at the top — not buried in a generic tips list. All probe fields (method, status code/text, response time, authenticated-as) are correctly populated. Added 3 server-side unit tests for `testGitHubConnectivity` and 3 new client rendering tests (success, 401 failure, unconfigured).


- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **Dev Panel — diagnostics migrated and repo-monitor validation added**: Moved diagnostics-focused tooling (CRG debug, runtime diagnostics, backup/restore, client diagnostics, and tool visibility) into the Admin Hub **Dev Panel** tab with in-UI guidance. Added a new **Repo Monitor Validation** tab and a read-only server probe (`/api/scheduler/validate`) that checks GitHub branch/PR endpoints per configured repo, so users can prove “connected with zero events” versus “not connected” without creating test data in production repos.
- **Dev Panel — server logs parser now handles API response shape correctly**: Fixed the server-log crash caused by treating `/api/logs` as an array; the hook now supports both `{ entries: [...] }` and legacy array payloads, preventing `(intermediate value).filter is not a function` runtime failures.
- **Dev Workspace — repo URL add flow restored in Settings**: The GitHub repository field now accepts full GitHub URLs and owner/repo values, includes a visible **Add to Monitor List** action, and surfaces the current monitored-repo list with remove controls directly in Settings.
- **Dev Workspace — monitored repo changes now persist immediately**: Adding/removing repos from the Settings quick-add flow now saves directly to scheduler config so the list survives refresh/navigation and monitor runs use the updated repo set without extra manual save steps.
- **UI polish — translucent surfaces and stronger depth**: Updated the global shell, shared tabs, tool cards, and Admin Hub sections to use softer glass-like panels, reduced hard borders, and restrained accent glow so the interface feels more futuristic and less noisy.
- **Dev Workspace — Settings UX redesigned for readability and responsive layout**: Rebuilt the Settings tab into card-based sections with consistent field blocks, responsive grids, and full-width controls so labels/inputs no longer collide or clip. Repo Monitor action fields and repository editor now render in clear rows with reliable spacing at common desktop widths.
- **Dev Workspace — Event Actions clarified with plain-language guidance**: Repo Monitor Event Actions now explicitly explain that each box expects a Jira status name (leave blank for log-only behavior), with concrete placeholders like `In Progress`, `In Review`, and `Done`.
- **Dev Workspace — Event Actions now use Jira-loaded status options**: Settings now fetch Jira project statuses and present transition targets as dropdown selections (with `No status change` fallback), so users pick valid workflow states instead of typing free-form status text.
- **Dev Workspace — legacy repo monitor settings import path added**: If scheduler repos are empty but legacy browser settings (`tbxRepoMonitorSettings`) exist, NodeToolbox now auto-imports those repos/rules into the monitor settings draft and prompts the user to save.
- **Dev Workspace — repo setup now accepts pasted GitHub URLs**: Repo Monitor repository input now accepts full GitHub URLs (including `.git` and SSH forms like `git@github.com:owner/repo.git`) and auto-normalizes them to `owner/repo`.
- **Dev Workspace — Repo Monitor setup now supports Add Repo + visible monitored list**: Replaced the bulk-only repo textarea flow with an explicit add/remove workflow: paste URL or owner/repo, click **Add Repo**, then manage the normalized monitored repo list directly below.
- **Global navigation — sticky connection bar and sticky tab bars**: The app header/connection bar now remains visible while scrolling, and top-level tab bars across major views are sticky so navigation stays on screen as users move through long pages.
- **Global UX foundation — shared top-level tab component introduced**: Added reusable `PrimaryTabs` and migrated major tools (Dev Workspace, Snow Hub, Sprint Dashboard, My Issues, Text Tools, Reports Hub, Admin Hub, ART View, Dev Panel, and Work Log) to a shared tab system so navigation behavior and visual spec stay consistent as tools expand.
- **Dev Workspace — Repo Monitor now uses legacy scheduler config/results with editable rules**: The Repo Monitor tab now reads real scheduler status/results (`/api/scheduler/*`) and shows event evidence from the legacy monitor service. Settings now auto-load server-side monitor defaults (repos, branch pattern, interval, and event transitions) and save updates back to the scheduler config.
- **Dev Workspace — Hygiene now auto-runs on first launch when a project key is configured**: Opening the Hygiene tab with a saved project key now immediately executes the hygiene query once, so developers land on live issue-health results instead of an empty state.
- **Dev Workspace — simplified tab flow for current usage**: Reordered top-level tabs to **Repo Monitor → Git Sync → Time Tracking → Settings** so monitoring is first and settings stay rightmost. Removed the Git Sync **Manual Post** and **Hook Generator** sub-features to reduce confusion and keep the workspace focused on the primary sync and monitoring workflows.
- **Dev Workspace — proxy-safe sync wiring**: Git Sync now uses existing proxy routes (`/github-proxy` and `/jira-proxy`) so enterprise-restricted environments do not depend on missing `/api/github` or `/api/jira` endpoints.
- **Dev Workspace — primary Hygiene tab restored and monitor score issue corrected**: Added a dedicated top-level **Hygiene** tab as the primary landing tab and kept **Repo Monitor** separate as its own operational tab. Hygiene now defaults queries to `assignee = currentUser()` (plus optional Extra JQL), and the prior monitor-click-based score behavior was removed so monitor actions no longer degrade score.
- **Dev Workspace — Repo Monitor now has verifiable evidence and configurable monitor scope/actions**: Added **Repo Monitor Settings** in Settings to configure monitored repositories and event-action toggles (missing Jira-key events and healthy/empty cycle logging). Repo Monitor now runs real GitHub checks, writes a dedicated monitor log, and shows a **Last Monitor Evidence** summary (repo count, commits scanned, key compliance, and check timestamp) to prove monitor activity.
- **Admin Hub — consolidated debug/diagnostics sections and removed redundant "Advanced" unlock**: CRG submission debug, Client Diagnostics, Tool Visibility, and Backup/Restore sections now appear directly after the single Admin unlock (no separate Advanced unlock). This eliminates the redundant dual-password requirement and streamlines the admin workflow. CRG submission debug data from the wizard is now globally accessible via the new store hook so Admin Hub can display the most recent CHG create/update diagnostics without keeping the debug section in Step 6.
- **SNow Hub CRG — submission debug moved from Step 6 UI to Admin Hub Debugging section**: The "Last SNow submission debug" section no longer clutters the wizard's Review & Create step; all diagnostics are now hidden and accessible in Admin Hub under "CRG Submission Debug" after admin unlock. This keeps the wizard focused on user input while preserving the diagnostic capability for troubleshooting.
- **SNow Hub — planning alias fields and Change Manager now always write to all known field names**: Removed the detection gate that previously blocked planning alias field writes when no fields were pinned or inspected. All known aliases (e.g. `u_assessment_of_success_probability`, `u_implications_of_system_availability`, `u_change_manager`) are now unconditionally included in every create/update payload — ServiceNow silently ignores field names it doesn't recognise, so sending all aliases is safe and guarantees the correct field is populated regardless of instance-specific column names.
- **SNow Hub — Step 6 now captures live submission diagnostics**: Review & Create now stores and displays the exact request payload, ServiceNow response, post-update CHG record, and field-level verification warnings after update/create so mapping failures can be diagnosed without browser devtools.
- **SNow Hub — Change Manager clone/update now handles alias/display-only values**: Clone now reads `change_manager` and `u_change_manager` aliases, and create/update now resolve display-only user names (e.g. `Sharma, Raman`) to `sys_id` before submission so Change Manager persists reliably.
- **SNow Hub — planning dropdown alias fields now sync from current UI values on create/update**: If planning aliases are detected (from pinned custom fields or inspected CHG fields), CRG now writes those alias API names with live wizard values instead of stale pinned values, improving compatibility with instance-specific planning schemas.
- **SNow Hub — Step 6 now supports updating an existing CHG from current UI values**: Added an **Update Existing CHG** action next to **Create CHG**. Enter a CHG number and NodeToolbox PATCHes that ticket with the same payload builder used for create, including planning assessment/content fields and mapped environment impacted-persons-aware.
- **SNow Hub — short-description defaults now persist independently of CRG draft resets**: Application/Team/Change Details Override are now stored in dedicated localStorage and survive CHG success/reset cleanup, preventing fallback regression to generic values like `ENFCT - Team - fixVersion`.
- **SNow Hub — Review & Create now supports CTASK selection directly**: Step 6 now includes a CTASK template picker and **Add CTASK to Change** action so users can queue defined CTASKs before clicking **Create CHG**, without switching back to Configuration.
- **SNow Hub — CHG creation now mirrors legacy auto-created CTASK handling**: After creating a CHG, the flow now fetches ServiceNow’s two auto-created CTASKs (creation-order) and PATCHes them to legacy-aligned defaults (`Implementation` task name as `Enrollment - AWS - [ENV]`, and a `Technical Checkout` task with technical validation description) before creating any additional user-selected CTASK templates.
- **App-wide text cleanliness — encoded rich-text tags are now stripped from Jira/SNow display surfaces**: Added shared rich-text normalization and applied it to Rovo CHG prompt issue details, DSU description/comment previews, My Issues description previews, Issue Detail panel descriptions, and PRB ServiceNow description mapping so HTML/style tag artifacts no longer leak into user-facing text.
- **SNow Hub — hidden Rovo CHG prompt now includes richer Jira context**: The generated prompt now includes each selected issue’s Jira description and acceptance criteria (`customfield_10200`) so prompt-assisted CHG drafting has better deployment context than key/summary alone.
- **SNow Hub — Step 3 can now apply saved templates directly and support a default template**: Change Details now starts with a template selector in wizard mode, including **Apply template**, **Set as default**, and **Clear default** actions. A selected default template is auto-applied when Step 3 opens.
- **SNow Hub — CRG short-description defaults are no longer cleared by blank template values**: Applying a template now keeps existing configured Application/Team/Change Details defaults when the template’s short-description fields are empty, so generated short descriptions continue to use the configured values.
- **SNow Hub — CRG short descriptions are now configurable and context-aware**: Configuration mode now lets users set **Application**, **Team**, and an optional **Change Details Override**. Generated short descriptions now follow `Application - Team - Change Details`, where details default to Fix Version in project mode or selected issue-type counts in custom JQL mode.
- **SNow Hub — Impacted Persons Aware is now environment-specific**: CRG now captures **Impacted Persons Aware** per environment card (REL/PRD/PFIX), places it between Config Item and planned dates, removes it from the Planning grid, and submits the mapped environment value during CHG creation.
- **SNow Hub — CRG planning fields now load from extractor JSON aliases**: Configuration now maps instance-specific ServiceNow planning field names from the Field Extractor (for example `u_implications_of_system_availability` and `u_has_this_change_been_tested`) into the CRG planning fields and applies extracted values, not just dropdown choices.
- **Text Tools — NodeToolbox Extractor now exports ServiceNow form data for SNow Hub import**: The extractor now opens a ServiceNow-page GUI, scans visible form controls plus accessible frames and open shadow roots, captures field values and dropdown options, and lets users select exactly which fields to copy before pasting payloads into CRG Configuration.
- **SNow Hub — CRG now uses extractor JSON for unavailable dropdown choices**: Configuration now supports pasting extractor JSON to load ServiceNow field choices for Change Details, Planning, and Environment fields, so the wizard can render dropdowns even when live metadata is blocked.
- **SNow Hub — CRG save/pin fallback controls removed from field workflow**: The old per-field save/pin controls and payload pinning workflow were removed from the active CHG flow to avoid stale carryover between cloned changes and keep templates driven by clone/template + extractor choice data.
- **SNow Hub — CRG wizard steps are directly navigable**: The step indicator pills are now clickable buttons, so users can jump straight to a specific CHG step instead of backing through the wizard one step at a time.
- **SNow Hub — CRG wizard no longer exposes template/pin management**: The CHG flow now hides saved-value selectors, pin buttons, and saved-option guidance entirely; reusable value and payload pin management stays in the Configuration tab.
- **SNow Hub — CRG cloned custom choices populate from display values**: When ServiceNow returns custom choice fields with blank internal values but populated display values, cloned planning fields now keep the visible value instead of going blank.
- **SNow Hub — CRG Configuration can pin exact ServiceNow payload fields**: Loading a reference CHG now exposes its readable fields in Configuration so instance-specific API fields can be pinned into the create payload, matching the legacy toolbox's ability to preserve custom CHG fields.
- **SNow Hub — CRG live metadata requests preserve display values**: Change Request choice metadata requests now include `sysparm_display_value=all` so live dropdown parsing has the best chance of receiving readable labels on locked-down ServiceNow instances.
- **SNow Hub — PRB Generator uses 'Defect' issue type for enterprise Jira**: The primary issue now maps to the enterprise Jira issue type `Defect` instead of `Bug` when the defect checkbox is checked, matching the issue-type name expected on locked-down Jira instances.
- **SNow Hub — PRB Generator surfaces Jira error details on failure**: Jira POST errors now include the structured message from Jira's response body (e.g. "Issue Type is required.") rather than just the HTTP status code, so users can diagnose and fix problems without checking the network tab.
- **SNow Hub — PRB Generator preserves partial success**: If one of the two Jira issues is created and the other fails, the successfully created issue key is now shown alongside the specific error for the failed issue instead of discarding both results.
- **SNow Hub — PRB Generator shows full issue preview before creation**: Both Quick Create and the Wizard review step now display a structured preview card for each Jira issue (issue type, summary, and description) before the user clicks Create, so there are no surprises about what will be submitted.

### Added
- **Home + Workspace — Personal Toolbox builder**: Added a new **Personal Toolbox** launcher card and `/personal-toolbox` view that brings major tools into one customizable tabbed workspace. Users can include/exclude modules, reorder tab priority, and persist their personal module set/order in browser settings.
- **SNow Hub — CRG Configuration tab**: Change Request setup now has its own dedicated **Configuration** tab for cloning existing CHGs, saving/updating CHG templates, managing saved field defaults, and loading reusable CTASK templates before walking the CHG wizard itself.
- **Reports Hub — Dashboard tab**: Reports Hub now includes a Jira-style dashboard tab with saved-filter-style widgets for critical defects, blocked work, open risks, and unassigned work, plus donut summaries by team, priority, status, and source.
- **CRG — CTASK templates and append flow**: The Review & Create step now supports reusable CTASK templates, selecting CTASKs to create with the new CHG, and appending selected CTASKs to an existing CHG by number.
- **CRG — CTASK templates can be cloned from existing CTASKs**: The CTASK Templates panel can now load an existing ServiceNow CTASK by number and pre-fill the template editor for saving or adjustment.
- **CRG — templates can now be updated in place and include environment schedules**: Saved templates now have an **Update selected** action and preserve Step 5 REL/PRD/PFIX scheduling alongside Change Details and Planning fields.
- **CRG — Clone, Templates & Defaults workspace**: Change Request setup now uses a compact shared workspace for cloning an existing CHG, saving/updating templates, and managing reusable field defaults without bouncing backward through the wizard.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **Home — Reports Hub is visible again on the launcher**: The React app already had the `/reports-hub` route, but the Home card catalog was missing the Reports Hub card entry, so users had no visible launcher card for the tool. The Reports Hub card is now restored to the Home view.
- **SNow Hub — CRG cloning now pulls from the full readable change record**: Loading a CHG no longer limits the ServiceNow query to a hardcoded `sysparm_fields` list, which improves clone coverage on locked-down instances where field ACLs and customized field sets were causing important values to come back blank.
- **SNow Hub — CRG template and pin management moved out of the wizard flow**: The step-by-step CHG wizard now focuses on walking the release, while save/pin/template management lives in the new Configuration tab and the wizard only reuses the saved defaults inline.
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

### Removed

### Added
- **CRG — Create CHG action**: The Results step now includes a **Create CHG** button that submits the generated content directly to ServiceNow (requires SNow relay to be active). Also added internal content enhancement capability for the Preview Docs step.

### Added
- **Confluence + Rovo connectivity tests in Admin Hub**: The Service Connectivity section now has a full **Confluence** subsection (Base URL, Atlassian email, Cloud API token, save + Test Connection button) and a **Rovo** subsection with a dedicated "🤖 Test Rovo" button. The Confluence probe hits `/wiki/rest/api/user/current`; the Rovo probe checks reachability of the Atlassian MCP server (`mcp.atlassian.com`). A note in the UI clarifies that Confluence Cloud uses Basic Auth with an Atlassian Cloud API token — not the same as a Jira on-prem PAT.
- **Connection Bar redesign — per-app nodes**: The connection bar now shows four app-specific indicators: **Jira**, **SNow**, **Confluence**, and **GitHub**. The standalone "Relay" node is removed — relay activation UX (bookmarklet install + Open ServiceNow) is now inline in the SNow panel. Confluence and GitHub indicators automatically reflect readiness from the proxy-status health check (credentials configured = ready). Clicking any node opens an inline details panel; clicking an app's node also provides an "Open [App]" shortcut button when a base URL is configured.

- **CRG — Custom JQL fetch mode**: The Change Request Generator's "Fetch Issues" step now supports a **Custom JQL** mode alongside the existing "By Project & Version" flow. A radio group lets users switch between the two modes; selecting Custom JQL reveals a textarea where any valid Jira Query Language expression can be entered. The generated documentation (short description, justification) adapts its label when JQL mode is active.

- **Feature Request in AdminHub**: A new "💡 Request a Feature" section at the bottom of the AdminHub Config tab.Users with a GitHub account can open a pre-filled issue directly (`🚀 Open GitHub Issue`). Users without one can click **📋 Copy Request** to copy the formatted request as plain text and send it via email, Teams, or any other channel.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.


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

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.
 (update install — missing version in request body)
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

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.
 (v0.7.8 — Relay bookmarklet install on React 19)
- **Relay bookmarklet — drag-to-bookmarks works again**: React 19 blocks `javascript:` URLs passed through JSX `href` props, which produced the browser error `React has blocked a javascript: URL as a security precaution` and prevented the SNow relay bookmarklet from installing. The relay setup links now assign the bookmarklet URL directly to the DOM anchor after render, preserving drag-to-bookmarks installation without triggering React's sanitizer.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.
 (v0.7.6 — Repair Chrome-safe ServiceNow relay)
- **Relay — fixed the Chrome bridge instead of relying on broken tab messaging**: ServiceNow is still opened in the original named `__crg_snow` tab, but the bookmarklet now registers, polls, and returns results through the local HTTP bridge at `http://127.0.0.1:5555/api/relay-bridge/*`, avoiding Chrome/Edge COOP breakage.
- **Relay bridge — added CORS/private-network headers**: `/api/relay-bridge/*` now explicitly allows ServiceNow bookmarklets to call the local NodeToolbox bridge, including `Access-Control-Allow-Private-Network: true` for Chrome/Edge private-network preflight checks.
- **Relay — ServiceNow `g_ck` support restored**: The bookmarklet again extracts ServiceNow's `g_ck` token (`window.g_ck`, `NOW.GlideConfig.g_ck`, or `glide_user_activity`) and sends it as `X-UserToken`, matching the working HTML ToolBox implementation.
- **Relay — proxy no longer masks disconnected state**: Normal SNow app calls no longer silently fall back to `/snow-proxy/*` when the relay is inactive. Direct proxy remains available only for explicit diagnostics/admin probes via `forceDirectProxy`.
- **ConnectionBar — SNow status now means relay-connected**: SNow turns green only after the bookmarklet handshake succeeds, not after a server-side proxy probe.
- **Relay setup — removed Copy Code dead-end**: The relay UI now only exposes the draggable bookmarklet. Clicking it inside NodeToolbox shows a clear instruction to drag it to the bookmarks bar first instead of silently doing nothing.
- **Relay bookmarklet — bridge failures are visible**: If the bookmarklet cannot reach the local NodeToolbox bridge, ServiceNow now shows a red failure badge and an alert instead of silently doing nothing.
- **Relay bridge — disconnects fail fast**: If the ServiceNow tab closes or navigates away while NodeToolbox is waiting for a relay result, the request now fails immediately with a recovery message instead of hanging until the 30-second timeout.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.
 (v0.7.5 — Relay connect flow, single-tab launch, update install)
- **Relay — Open ServiceNow button**: A `🔗 Open ServiceNow` button now appears in the Relay panel when a SNow base URL is configured and the relay is not yet active. Click it to open the SNow page, activate the bookmarklet, and the relay indicator turns green.
- **Relay — bookmarklet activation feedback**: The bookmarklet now shows a green confirmation banner on the SNow page after successful registration ("✅ NodeToolbox relay active — keep this tab open") and automatically focuses back to the NodeToolbox tab via `window.open('', 'nodetoolbox')`. The `window.name` is set to `'nodetoolbox'` in the React app so the browser can locate the tab by name.
- **Relay — registration error surfaced**: Bookmarklet now shows a user-visible `alert()` and logs a `console.error` if NodeToolbox is not reachable on port 5555 (previously the error was silent in AdminHub's copy of the bookmarklet).
- **Launch — double browser tab fixed**: The VBS launcher now passes `--no-open` to the exe, preventing both processes from opening the browser simultaneously. The VBS is the sole browser-opener (after its port-ready poll confirms the server is up); the exe only opens the browser when launched directly (without VBS).
- **Update Management — Install Update button**: Admin Hub now shows a `🔄 Install Update` button when an update is available. Clicking it POSTs to `/api/update`, waits up to 60 seconds for the server to restart, then reloads the page to run the new version. Progress ("⏳ Installing and restarting…") and error states are displayed inline.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.
 (v0.7.4 — Relay bridge actually works now)
- **Root cause fix — SNow API calls now route through relay**: `snowFetch` was hardcoded to always use the server-side proxy (`/snow-proxy/*`), ignoring the relay bridge entirely. SNow API calls now check `connectionStore.relayBridgeStatus.isConnected` and route through the relay bridge bookmarklet when active. `forceDirectProxy: true` can override this for callers that need direct access.
- **Status type mismatch fixed**: The server `/api/relay-bridge/status` endpoint returned `{ active, sys }` but the React client's `RelayBridgeStatus` type expected `{ isConnected, system }`. The runtime object never had `isConnected`, so the relay indicator was permanently red even when the bookmarklet was running. Server now returns the correct shape: `{ isConnected, system, lastPingAt (ISO string), version }`.
- **Relay polling reduced from 30 s → 3 s**: Indicator now turns green within 3 seconds of bookmarklet activation instead of up to 30 seconds.
- **Bookmarklet registration failure is now visible**: If the bookmarklet can't reach NodeToolbox on port 5555, it now logs a `console.error` and shows an alert, rather than silently doing nothing.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.
 (v0.7.3 — Check for Updates)
- **Admin Hub — Check for Updates**: Fixed silent failure where network/server errors made the button appear to do nothing. Errors are now displayed below the button with a clear message. Added missing CSS classes (`updateVersionRow`, `updateStatusAvailable`, `updateStatusSuccess`, `updateStatusError`, `releaseNotesTextarea`) so the result area renders correctly.

### Added (v0.7.2 — Relay Connect panel, Snow/GitHub config UI, expanded diagnostics)
- **ConnectionBar — Relay `Connect` button**: Each indicator (Relay, Snow, Jira) is now a clickable button. Clicking the Relay indicator opens an inline setup panel with a draggable bookmarklet link and step-by-step instructions. Clicking an already-open panel closes it; clicking outside dismisses it.
- **Admin Hub — Service Connectivity section**: New section (unlocked by admin access) with forms to set Snow `baseUrl`, `username`, and `password`, and GitHub `baseUrl` and Personal Access Token. Credentials are saved server-side to `toolbox-proxy.json` (AppData). Includes `Test Connection` buttons for live probes against each service.
- **Diagnostics — expanded payload**: `GET /api/diagnostics` now returns `isPkgExe`, `platform`, `snow` (baseUrl, credential presence, masked username, session state), `relay` (active systems, last registered/polled timestamps), and `github` (baseUrl, PAT presence).
- **API — connectivity config endpoints**: `GET /api/config/connectivity` returns sanitised Snow/GitHub config for the UI; `POST /api/config/connectivity` saves updated config; `POST /api/config/connectivity/test` probes Snow or GitHub and returns `{ ok, statusCode, message }`.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.
 (v0.7.1 — VBS launch fix)
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

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.
 (v0.6.6 — Connection bar always red bug)
- Root-cause fix: `ProxyStatusResponse` TypeScript type was entirely wrong — it had flat fields (`jiraConfigured`, `snowConfigured`) but the server actually returns a nested structure (`{ jira: { ready, configured, ... }, snow: { ... } }`). This meant `isJiraReady` was always `false` regardless of actual connectivity, keeping every indicator permanently red.
- Updated `ProxyStatusResponse` to the correct nested shape with `ProxyServiceStatus` and `ProxySnowStatus` sub-interfaces.
- Updated `connectionStore.setProxyStatus` to read `status.jira.ready` and `status.snow.ready`.
- Updated `useProxyStatus` to probe Jira/SNow based on `status.jira.configured` and `status.snow.configured`.
- Updated all tests (including `proxyApi.test.ts`) to use the correct nested mock shape.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.
 (v0.6.5 — UX polish)
- Made whole issue cards clickable to toggle the inline detail panel in Sprint Dashboard (overview, assignee, blockers, stale), ART View impediments, and My Issues — the caret icon remains as a visual affordance hint.
- Connection status bar now shows a **green** dot when a service is configured, and a **red** dot when it is not — replacing the ambiguous gray that made all services look identical regardless of connectivity.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.
 (v0.6.4 — Issue #45 follow-up fixes)
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

### Added (v0.6.0 — Toolbox parity slice 4)
- **Standup Board view** (`/standup`): standalone status-category boardwalk ported from `13-standup-board.js`. Three-column layout (To Do / In Progress / Done) sorted oldest-first to surface stale work, status filter pills per column, optional Hide-Done toggle, age-coloured cards (≤2 days ok / ≤5 days warn / >5 days old), blocked indicator, and a built-in **15-minute standup timer** (start/pause/reset, with `warn` styling at ≤5 min and `urgent` at ≤2 min). Flow stats bar shows WIP / stale / blocked / avg-age. Persists `{jql, hideDone}` to `localStorage` (`tbxStandupJql`).
- **Metrics view** (`/metrics`): standalone sprint-metrics dashboard ported from `10-metrics.js`. Predictability across the last N closed sprints (committed vs completed story points, completion %, 80% target line), throughput trend (issues + SP per sprint), and a simplified resolution-date-based cycle-time card (mean / median / p90). Inputs: board ID, project key, sprint window. Handles Kanban boards gracefully and degrades cleanly when the legacy greenhopper sprint-report endpoint is unavailable. Persists config to `localStorage` (`tbxMetricsConfig`).
- **DSU Daily view** (`/dsu-daily`): standalone daily-standup helper ported from `11-dsu-daily.js`. Auto-fills "Yesterday" (your issues updated yesterday) and "Today" (your open issues) as bullet lists, plus an editable Blockers field. Live preview pane, copy-to-clipboard, and post-as-Jira-comment to any issue key. Persists the editable draft to `localStorage` (`tbxDsuDraft`).
- Three new home cards (Standup Board 🧍 + DSU Daily 🗒️ in Agile & Delivery, Metrics 📐 in Reports) with persona-aware ordering across all six personas (SM/RTE see Standup + Metrics promoted near the top).

### Notes for follow-up versions
- Toolbox v0.24.10 → NodeToolbox parity continues. Remaining slices tracked for `v0.6.1+`: Release Monitor, Dev Panel (API inspector), Connection Wizard, PRB Setup Wizard overlay, Impact Analysis, plus partial gaps inside My Issues, ART View, Sprint Dashboard, DSU Board, SNow Hub, and Admin Hub. Standup Board's per-card changelog drill-down, "Post Update" / "Raise Blocker" actions, and personwalk view were intentionally deferred. Metrics' full changelog-based cycle time, status-bottleneck breakdown, and spillover tracking were intentionally deferred.

### Added (v0.5.9 — Toolbox parity slice 3)
- **Defect Management view** (`/defects`): standalone defect tracker ported from `08-defect-management.js`. Project-key + extra-JQL inputs; filters for priority, status category, and unassigned-only; sorts by priority+age, age, or last update. Persists `{projectKey, extraJql, filter, sort}` to `localStorage` (`tbxDefectFilters`).
- **Hygiene view** (`/hygiene`): standalone issue-health checker ported from `22-hygiene.js`. Runs five hygiene checks per active issue (missing story points, stale, no assignee, no acceptance criteria, old-in-sprint), shows summary tiles with click-to-filter behaviour, and a drillable list of flagged issues. Persists project key + active filter to `localStorage` (`tbxHygieneProjectKey`, `tbxHygieneFilter`).
- **Pipeline View** (`/pipeline`): standalone epic pipeline visualization ported from `18-pipeline-view.js`. Lists every epic in a project grouped by status category, with lazy child fetch on expand, story-point rollups, and completion percentage. Falls back from `parent=` JQL to `"Epic Link"=` for older Jira deployments. Persists project + filter state to `localStorage` (`tbxPipelineFilters`).
- Three new home cards (Defect Management 🐛, Hygiene 🧼, Pipeline View 🛤️) all in the Agile & Delivery section, with persona-aware ordering across all six personas (QA leads with defects+hygiene; SM/PO/RTE see pipeline near the top).

### Notes for follow-up versions
- Toolbox v0.24.10 → NodeToolbox parity continues. Remaining slices tracked for `v0.6.0+`: Standup Board (boardwalk + 15-min timer), Release Monitor, Dev Panel (API inspector), DSU Daily, Connection Wizard, PRB Setup Wizard, Impact Analysis, Metrics-as-tab, plus partial gaps inside My Issues, ART View, SprintDashboard, DSU Board, SNow Hub, and Admin Hub. Several of these (DSU Daily, Connection Wizard) need adaptation rather than direct ports because they're tightly coupled to the legacy PAT/Relay/SD_STATE plumbing that NodeToolbox replaces with server-side routing.

### Added (v0.5.8 — Toolbox parity slice 2)
- **Story Pointing view** (`/pointing`): single-user planning poker — load Jira issues by JQL or comma-separated keys, vote with a Fibonacci deck (1, 2, 3, 5, 8, 13, 21, ?), reveal/reset, and optionally save the final estimate back to Jira through the `jiraPut` helper. State persists to `localStorage` (`tbxStoryPointingState`) so refresh never loses the deck. Multi-user/relay voting is intentionally deferred until NodeToolbox has shared real-time session infrastructure.
- **Mermaid Editor view** (`/mermaid`): split-pane editor with live SVG preview, debounced 300 ms render, starter templates (flowchart, sequence, class, gantt, ER), Copy SVG to clipboard, and Download SVG file. Diagram source persists to `localStorage` (`tbxMermaidEditorState`). Adds `mermaid@11.14.0` as a runtime dependency.
- **Pitch Deck view** (`/pitch-deck`): six-slide executive presentation explaining the Toolbox business case, with prev/next buttons, thumbnail strip, slide indicator, and full keyboard navigation (←/→ to step, Home/End to jump). Current slide index persists to `localStorage` (`tbxPitchDeckIndex`).
- Three new home cards (Story Pointing 🎲 in Agile & Delivery, Mermaid Editor 🧜 in Text Tools, Pitch Deck 🎯 in Documentation) with persona-aware ordering across all six personas.

### Notes for follow-up versions
- Toolbox v0.24.10 → NodeToolbox parity continues. Remaining slices tracked for `v0.5.9+`: Defect Management, Pipeline View, Hygiene panel, Standup Board (boardwalk + 15-min timer), DSU Daily, Release Monitor, Impact Analysis, Connection Wizard, PRB Setup Wizard overlay, Dev Panel (API inspector), plus partial gaps inside My Issues, ART View, Sprint Dashboard, DSU Board, SNow Hub, and Admin Hub.

### Added (v0.5.7 — Toolbox parity slice 1)
- **Sprint Planning view** (`/sprint-planning`): pull the open backlog for any Jira project, search/filter loaded issues, edit story points inline, and persist all pending edits with one batch save through the existing `/jira-proxy` route. Includes auto-detection between `customfield_10028` and `customfield_10016` for the story-points field, per-issue save error tracking, and a pending-changes counter.
- **Work Log view** (`/work-log`): per-issue stopwatches that persist to `localStorage` (`tbxWorkLogState` — same key as legacy ToolBox so existing data is reused), Start/Pause/Remove timer controls, free-form duration parsing (`1h 30m`, `45m`, bare numbers as minutes), Today/History tabs, and a confirm dialog that POSTs the elapsed time to Jira's `/issue/{key}/worklog` endpoint with optional comment. History is capped at 200 entries to bound localStorage growth.
- New `jiraPut(path, body)` helper in `client/src/services/jiraApi.ts` so views can perform PUT calls through the same `/jira-proxy` passthrough that already supports GET and POST.
- Home cards for Sprint Planning (📋) and Work Log (⏱) added to the Agile & Delivery section, with persona-specific ordering (PO/SM see Sprint Planning prominently; Dev/QA see Work Log promoted near the top).

### Notes for follow-up versions
- Toolbox v0.24.10 → NodeToolbox parity is still ~80% remaining. The remaining missing/partial views are documented in the session plan and tracked for `v0.5.8+`: Mermaid editor, Story Pointing, Defect Management, Pipeline View, Hygiene panel, Standup Board (boardwalk + 15-min timer), DSU Daily, Release Monitor, Impact Analysis, Connection Wizard, PRB Setup Wizard overlay, Dev Panel (API inspector), plus partial gaps inside My Issues, ART View, Sprint Dashboard, DSU Board, SNow Hub, and Admin Hub.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **React build not found on exe launch (root cause fix)**: The pkg `assets` configuration was silently failing to include `client/dist/**/*` in the executable snapshot. End-to-end testing in a clean temp directory containing ONLY the exe (no `client/dist/` on disk) reproduced the "⚠ React build not found" 503 page on `/admin-hub` even after v0.5.4 and v0.5.5 attempted fixes. Verified via diagnostic logging that pkg's snapshot virtual filesystem returned `ENOENT File '...client/dist/index.html' was not included into executable at compilation stage` despite multiple asset configurations (glob, explicit list, CLI `--assets` flag).
  - Solution: bake the entire React build into a JavaScript module (`src/embeddedClient.js`) at release time as base64-encoded `Buffer` literals. pkg always bundles JS source as bytecode, so the SPA now ships *inside* the executable independent of the asset virtualization layer.
  - New script `scripts/generate-embedded-client.js` walks `client/dist/` and emits the embedded module.
  - `scripts/local-release.ps1` runs the generator as new step `[3.5/6]`, after the React build and before pkg.
  - `server.js` static middleware in pkg mode now serves directly from the in-memory embedded map; SPA catch-all returns `embeddedClientFiles['index.html']`.
  - Verified end-to-end: copying ONLY the new exe to a clean temp directory (no `client/dist/` anywhere on disk) → `/admin-hub` returns React HTML with title "NodeToolbox", `/favicon.svg` serves with `image/svg+xml` content-type.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.
 (earlier in this Unreleased cycle)
- **VBS launcher — stale old process served instead of new version**: When a previous NodeToolbox instance (e.g., v0.5.3) was still running on port 5555, the VBS launcher short-circuited: it detected the port as listening and opened the browser directly to the old broken server, skipping the launch of the new exe entirely. Fixed by removing the pre-launch short-circuit (`If IsPortListening Then ... Exit Sub`). The VBS now always launches the newest exe — `portManager.js` unconditionally kills any occupant and waits 1500ms for the OS to release the binding, after which the polling loop correctly opens the browser to the new process.
- Also removed the stale "client/dist/ folder missing" bullet from the timeout diagnostic message — `client/dist/` is now bundled in the exe snapshot and shipped in the exe-zip, so it is never missing.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **Exe distribution — React build not found (readFileSync-based static serving)**: `express.static` (used in v0.5.3) relies on `fs.createReadStream` internally, which does not work reliably with `@yao-pkg/pkg`'s snapshot virtual filesystem. Even with `client/dist/` bundled via `pkg.assets`, the React SPA was never served — the exe still showed "⚠ React build not found". Fixed by:
  - Adding `resolveAppBaseDir()` to `server.js`: probes the snapshot path (`__dirname`) via `fs.readFileSync` first; falls back to `path.dirname(process.execPath)` (real disk next to the exe) if the snapshot is inaccessible.
  - Adding a custom `readFileSync`-based static middleware for pkg exe mode — `fs.readFileSync` is guaranteed by `@yao-pkg/pkg` to work with snapshot virtual paths.
  - Replacing `fs.existsSync + res.sendFile` in the SPA catch-all with a `fs.readFileSync` try-catch, because `fs.existsSync` can falsely return `false` for snapshot paths.
  - Re-adding `client/dist/` to the exe-zip in `scripts/local-release.ps1` as a belt-and-suspenders fallback alongside the exe.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **VBS launcher — silent failure on corporate PCs (fix/vbs-launcher-corporate-pc)**: `Launch Toolbox Silent.vbs` was fire-and-forget: if the exe was blocked by antivirus/SmartScreen, port 5555 was locked, or the exe's built-in browser-open command was blocked by group policy, nothing visible happened. Fixed by:
  - Adding a post-launch polling loop (up to 30 seconds, 1-second intervals) that uses `netstat` to check when port 5555 becomes ready — `netstat` works on all Windows machines without elevated permissions or PowerShell.
  - Opening the browser directly from the VBS once the port is ready, as a belt-and-suspenders backup when the exe's `start` command is blocked.
  - Short-circuiting to just open the browser if NodeToolbox is already running on port 5555 (prevents double-launch).
  - Showing a diagnostic `MsgBox` after timeout that lists the most likely causes (SmartScreen, port conflict, missing `client/dist/`) and explains exactly how to diagnose via Command Prompt.
  - Defining `SERVER_PORT`, `SERVER_READY_TIMEOUT_SECONDS`, and `POLL_INTERVAL_MS` as named constants instead of magic numbers.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **SNow Hub tab label**: "CRG" corrected to "CHG" (Change Request) in `SnowHubView.tsx`. The internal key remains `crg` to avoid breaking any persisted UI state.
- **No Home navigation**: The NodeToolbox title in the top bar is now a clickable `<Link>` that navigates back to the Home route (`/`) from any tool view.
- **Jira "connected but not working"**: `ConnectionBar` now shows green only when a live API probe (`GET /jira-proxy/rest/api/2/myself`) returns 200 — not merely when credentials are present in the config file. Added `isJiraVerified` / `isSnowVerified` to `connectionStore` alongside the existing `isJiraReady` / `isSnowReady` config-presence flags.
- **SNow 401 on Release Management tab**: `useReleaseManagement.loadMyActiveChanges` now checks `isSnowReady` before firing any SNow fetch. When SNow is not configured, an actionable error message is displayed instead of a silent 401.
- `proxyApi.ts`: added `probeJiraConnection()` and `probeSnowConnection()` — live credential probes via the existing proxy routes that return `ConnectionProbeResult` rather than throwing.
- `useProxyStatus.ts`: after every poll, runs Jira and SNow probes in parallel (via `Promise.allSettled`) when the respective service is configured, then writes the verified flags to the connection store.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **App cards unresponsive after SNow relay fix** — An orphaned code fragment (dangling `.push()` / `});` / `}` lines from old request-log rendering) was left in `buildFullReport` during the `tbxFetchDiagReport` rewrite. The stray `)` caused an `Unexpected token` JS syntax error that silently prevented all scripts in toolbox.html from loading, breaking every click handler including app card navigation.

### Tests
- **`toolboxHtml.test.js` — JS syntax guard**: New test parses every `<script>` block in toolbox.html with V8 at test time. Any syntax error that would break app card interactions (or any other JS) is now caught before claiming success.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **SNow relay "connects then immediately disconnects"** — Three root causes found and fixed:
  1. **`snowReady = false` on SNow 401 (lines `rmCheckConn` and `rmLoadMyCHGs`)**: When ServiceNow returned HTTP 401 via the relay (expired session, SSO re-login needed), the catch handler was clearing `CRG.relay.snowReady`. A 401 from SNow means the *SNow session* is expired — the relay bridge itself is still functional. Clearing the flag meant every failed request also broke the relay routing, sending all subsequent requests back to the Basic Auth proxy (which also returns 401). Both catch handlers now leave `snowReady` intact and surface a clear "SNow session expired — re-login to ServiceNow" message instead.
  2. **`pagehide` deregisters on SNow SPA navigation**: ServiceNow's SPA framework fires `pagehide` during internal page transitions, causing the relay bookmarklet to immediately send a deregister beacon. Added a 1-second grace period before the deregister beacon fires. A `pageshow` listener cancels the timer if the page is restored from bfcache or the SPA bounces back within the grace window.
  3. **Diagnostic showed "SERVER: (not reachable — is toolbox-server.py running?)"**: The general diagnostic report was fetching `/api/diagnostics` — a Python-era endpoint that does not exist in the Node.js server. Changed to `/api/proxy-status` (the real endpoint). Fixed the fallback text from "toolbox-server.py" to "toolbox-server.js". The report now also shows live relay bridge state (snow/jira active flags) alongside server config.
- **Relay bridge registration history not visible**: Added `lastRegisteredAt`, `lastDeregisteredAt`, and `lastPolledAt` timestamps to each bridge channel. Exposed via `GET /api/relay-bridge/status` and `GET /api/snow-diag` so the SNow diagnostic report can show exactly when the bookmarklet last registered, deregistered, and polled — making it possible to diagnose connection drops without guessing.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **"My Active Changes" showed empty instead of auth error on proxy 401** — When the ServiceNow proxy credentials were invalid or expired, `rmLoadMyCHGs` called `.then(r => r.json())` without checking `r.ok`. A 401 response from SNow still returns a JSON error body (no `result` key), so the code silently treated it as "no changes found" and displayed "No active changes assigned to Smith, Michael." Now checks `r.ok` first and throws a descriptive error that routes through the existing 401 catch handler, surfacing "SNow credentials invalid or expired — update them in Toolbox Settings → ServiceNow Connection."
- **"No change request found: CHGxxxxxxx" on proxy 401** — Same root cause as above: `rmLoadCHG` parsed the 401 JSON response body, found no `result`, and threw a misleading "No change request found" error even though the CHG existed in SNow. Now checks `r.ok` before parsing so the real error is surfaced.
- **SNow Diagnostic Test 3 always used wrong state codes** — `snwDiagRunLiveTests` hardcoded a fallback of `['1','2','-4']` (not valid CHG state codes) and read `rmPrefs.states` instead of `rmPrefs.defaultStateFilter` (the correct key saved by `rmSaveDisplayPreferences`). Additionally, the intermediate `stateCodeMap` tried to translate string labels ("open", "in_progress") when stored values are already SNow numeric codes. Corrected the fallback to `['-2','-1','0']` (Scheduled, Implement, Review — matching the default checked boxes), fixed the localStorage key to `defaultStateFilter`, and removed the unnecessary mapping layer.

— The `snwDiag*` function insertion accidentally dropped the `function tbxFetchProjectStatuses(projectKey) {` declaration, leaving the function body floating at script scope. This caused an `Unexpected token '}'` JS syntax error that silently prevented the entire page script from executing, breaking all card interactions.
- **Browser tab title stuck on v0.0.16** — The `<title>` tag was never updated by the release script, so the tab always showed the old hardcoded version. Fixed in two layers: (1) `document.title` is now set from `TOOLBOX_VERSION` at startup so the tab is always correct at runtime regardless of caching, and (2) the release script now patches `<title>NodeToolbox vX.Y.Z</title>` alongside the `TOOLBOX_VERSION` JS constant. Two unit tests in `toolboxHtml.test.js` guard both requirements.


- **SNow Diagnostics Report in Admin Hub** — New "❄️ ServiceNow Diagnostics" card in the Admin Hub Diagnostics panel. Clicking "❄️ Copy SNow Report" runs three diagnostic layers in parallel and copies a full plain-text report to the clipboard: (1) static snapshot of localStorage SNow identity keys, proxy URL, and RM display preferences; (2) server config from the new `GET /api/snow-diag` endpoint (proxy credentials masked, relay bridge status); (3) three live SNow API calls — a connectivity ping, an identity verification against the cached `sys_id`, and the exact My Changes query that Release Management executes internally. If the live My Changes query returns zero results the report lists the three most likely causes with corrective steps. Backend: `GET /api/snow-diag` added to `api.js`; `getBridgeStatus(sys)` exported from `relayBridge.js`.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **Release Management "My Changes" empty in proxy mode**— In server/proxy mode (no relay bookmarklet), `miSnowResolveUser()` authenticated as the configured service account, so `gs.getUserID()` returned the service account's `sys_id` instead of the real user's. The "My Changes" query then found nothing because the user's change requests are assigned to their personal account, not the service account. Fixed by adding a **SNow Identity** card to RM Settings where the user can type their SNow username, look it up via the proxy, and pin the result. The pinned identity is shared with the My Issues view via the same `tbxMISnowSysId` localStorage keys. Added `rmRenderIdentityBadge()`, `rmSearchSnowIdentity()`, `rmSelectSnowIdentityFromEl()`, and `rmClearSnowIdentity()`.
- **RM Settings identity badge rendered on every Settings open** — `rmLoadDisplayPreferences()` now calls `rmRenderIdentityBadge()` so the user always sees who "My Changes" is querying as when they open Settings.
- **"My Changes" empty state shows proxy-mode hint** — When the change list is empty and the relay is not active (`IS_NODETOOLBOX_SERVER && !relay.snowReady`), a small inline note now appears with a direct link to RM Settings so the user can check or correct their identity without hunting.
- **"Update & Restart" button threw "Request failed: not valid JSON"** — `adminHubApplyUpdate()` POSTs to `POST /api/update` but that route was never registered in `src/routes/api.js`. Express returned its default HTML 404 page, and `response.json()` failed parsing `<!DOCTYPE`. Added the missing route: accepts `{ version }`, short-circuits if already on that version (`alreadyLatest: true`), otherwise calls `prepareUpdate()` + `spawnReplacementAndExit()` from `src/utils/updater.js` after flushing `{ ok: true, restarting: true }` to the browser.
The SNow identity search in My Issues Settings required `CRG.relay.snowReady` (relay bookmarklet active), blocking use in proxy mode even though `crRelayRequest` falls back to the server proxy for SNow. Changed the guard to `tbxSnowReady()` which returns `true` in both relay and proxy modes.

The `📦 Release Management` tab (`snh-tab-rm`) was always visible in the SNow Hub tab strip regardless of admin status. It is now hidden by default and only revealed after admin unlock (`tbxAdminUnlocked === '1'`). `tbxApplyFeatureFlags()` was updated to control tab visibility; if the RM tab was active when the admin lock was re-engaged, it automatically falls back to the Change Request tab.
- **SNow Hub → Release Management → Settings showed wrong content** — The Settings sub-tab displayed "⚙ Repo Monitor Settings" (GitHub repos, branch pattern, poll interval, Jira transitions on GitHub events, active hours schedule) which has nothing to do with Release Management. Replaced with correct content: a **ServiceNow Connection** notice pointing to Toolbox Settings, and a **My Changes Display Preferences** section with default state filter checkboxes and an auto-load-last-CHG toggle. Added `rmSaveDisplayPreferences()`, `rmLoadDisplayPreferences()`, and `rmGetDisplayPreferences()` to persist and restore these preferences via `tbxRMDisplayPrefs` in localStorage.
- **Repo Monitor settings inaccessible after move to Dev Workspace** — When the Repo Monitor operational panel was moved to Dev Workspace, the settings form (repos, branch pattern, poll interval, Jira transitions, active hours, catch-up mode) was left in the wrong place (SNow Hub RM). The settings card is now correctly placed inside `dw-panel-monitor` (Dev Workspace → Repo Monitor) directly below the activity log. `dwShowTab('monitor')` now also calls `rmLoadSettingsUI()` to populate the form on every open.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **Admin Hub "DEV_PANEL is not defined"** — `DEV_PANEL` (Network Activity Monitor state) and `OPT_STATS` (cache hit counters) were referenced throughout the Admin Hub and Dev Panel code but never declared. Admin Hub failed to render after unlock. Both objects are now declared with full initial state alongside the other module globals.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **Admin Hub unlock "Verification error — browser crypto unavailable"** —The unlock dialog relied on `window.crypto.subtle` (Web Crypto API) which is only available in secure contexts (HTTPS or the exact hostname `localhost`). Accessing NodeToolbox over an IP address or a non-localhost hostname caused an immediate `crypto.subtle` failure. Separately, `ADMIN_HUB_CREDENTIAL_HASH` — the value the hash was compared against — was never defined anywhere in the codebase, meaning the unlock would always fail even when `crypto.subtle` worked. Fixed by moving credential verification server-side: `adminHubSubmitCredentials()` now POSTs `{username, password}` to a new `POST /api/admin-verify` endpoint that performs the SHA-256 comparison using Node's built-in `crypto` module. The credential hash is stored in `toolbox-proxy.json` under `admin.credentialHash`. Default credentials: **admin / toolbox** — change by replacing the hash in the config file. No client-side crypto required.

`hgGetGlobalRules()` threw `ReferenceError: HG_BUILT_IN_RULES is not defined` whenever `localStorage` had no saved hygiene rules, which propagated through `adminHubBuildHygieneRulesPanel()` → `adminHubBuildHTML()` and left `admin-hub-body` empty. Fixed by defining `HG_BUILT_IN_RULES` as an array of 11 default enterprise Feature/Risk hygiene rules (6 Feature, 5 Risk) at the hygiene module initialisation block. Also defined `HG_STATE` (runtime hygiene results object) and `HG_FIX_VERSION_CACHE` (per-session version-list cache) which were similarly referenced but never declared, preventing latent crashes in the hygiene tab.

- **Admin Hub shows error message on unexpected failures** — `adminHubRender()` had no error handling, so any uncaught JS exception during panel construction produced a silently blank panel. Added a `try/catch` that renders a visible `⚠️ Admin Hub failed to load.` banner with the error message and logs to the console, making future issues immediately diagnosable.

### Performance
- **Gzip compression for all responses** — Installed the `compression` npm package and mounted `app.use(compression())` as the first Express middleware in `server.js`. The primary beneficiary is `toolbox.html` (2.75 MB uncompressed) which compresses to ~300–400 KB on the wire — roughly an 8× reduction — improving both initial page load time and the in-app update download speed.

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.
 (v0.0.12 / previous [Unreleased])
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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

- **`Launch Toolbox.bat`** (new file) — Replaced the broken `Launch Toolbox.lnk` in the distributable zip with a portable `.bat` launcher. The `.lnk` shortcut embedded absolute paths from the CI build machine (`D:\a\NodeToolbox\...`) which do not exist on the end-user's machine. The `.bat` uses `%~dp0` (the bat file's own directory at runtime) so it works correctly regardless of where the zip is extracted.
- **`scripts/local-release.ps1`** — Updated `$IncludedPaths` to bundle `Launch Toolbox.bat` instead of `Launch Toolbox.lnk`. Removed the `create-launcher.js` step (step 2/4 → now 3 steps total). Updated dry-run output.
- **`.github/workflows/release.yml`** — Removed the `node scripts/create-launcher.js` CI step, which was generating a machine-specific `.lnk` that could never be used on another machine.
- **`test/unit/local-release.test.js`** — Updated dry-run test assertions to verify `.bat` is reported and `.lnk` is not included (2 tests updated, 1 regression guard added).
- **`scripts/local-release.ps1`** — Replaced em dash (`—`) characters inside `Write-Host` double-quoted strings with plain hyphens. Windows PowerShell 5.1 misparses UTF-8 em dashes in string literals, causing `ParserError` failures on the CI runner.

### Notes
- `npm run create-launcher` still works for users who want a machine-specific desktop shortcut after extracting the zip (creates a `.lnk` with correct local paths).

## [0.0.3] — Fix: CI + release script compatibility

### Fixed
- **Critical: GitHub API authentication header fixed (Bearer → token) + debug endpoint**: Fixed the Repo Monitor connectivity bug where GitHub API requests were using the OAuth2 `Bearer` scheme instead of GitHub's native PAT `token` scheme. The issue affected both the scheduler API calls (makeGithubApiRequest) and the browser proxy (github-proxy and proxy routes). Now correctly sends `Authorization: token <PAT>` for GitHub while preserving `Bearer` for Jira/Confluence. Added `/api/scheduler/github-debug` endpoint to the Admin Hub Dev Panel for diagnosing GitHub connectivity issues: shows the exact auth header format being sent, PAT mask, and detailed probe results. All 270 tests updated and passing.

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
