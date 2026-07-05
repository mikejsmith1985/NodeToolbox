# NodeToolbox

NodeToolbox is a local-first delivery operations workspace built on an Express proxy server and a React client. It centralizes Jira, ServiceNow, GitHub, and Confluence-connected workflows behind a localhost app so teams can use shared tooling without exposing credentials in the browser.

## What NodeToolbox currently supports

### Agile and delivery workspaces

- **Team Dashboard** — board-level workspace for sprint execution, blockers, defects, standup, metrics, pipeline, planning, pointing, Feature Review, PI Review, releases, and settings.
- **ART View** — release-train workspace for overview, impediments, predictability, releases, PI Review, blueprint mapping, dependencies, board prep, SoS, monthly reporting, and ART settings.
- **Feature Canvas** — spatial PI-planning board that recovers a chaotic backlog through five guided phases (Surface → Size → Prioritize → Stabilize WIP → Sequence & Box), with sprint/release/Parking Lot/Complete boxes, an optional AI accelerator, and an explicit Review & Commit before anything is written to Jira.
- **My Issues** — personal issue management with report, hygiene, and settings views plus linked Jira/ServiceNow context.
- **Daily Standup Board** — focused daily status view with filters, grouped sections, and issue detail tools.
- **Reports Hub** — portfolio and leadership reporting across feature delivery, defects, risks, flow, quality, sprint health, throughput, and individual views.

### ServiceNow and release workflows

- **SNow Hub** — change request generation, problem generation, release management, configuration, and sync monitoring.
- **PI Review authoring** — shared PI planning and review workflows, including Confluence-backed synchronization.
- **Release readiness tracking** — release views in both Team Dashboard and ART workflows, with fix-version-aware monitoring.

### Developer and productivity tools

- **Dev Workspace** — hygiene checks, repository monitoring, Git sync support, Jira time tracking, and workspace settings.
- **Business Helper** — simplified Jira search plus stabilization funding workflows for non-technical users.
- **Text Tools** — smart formatting, JSON formatting, case conversion, URL encoding/decoding, Base64 encoding/decoding, and element extraction helpers.
- **Personal Toolbox** — customizable landing area where users can choose and reorder their preferred modules.
- **Code Walkthrough** — built-in technical reference for app architecture, security, data flow, and core services.

### Administration and platform controls

- **Admin Hub** — connectivity configuration, ART settings, access control, hygiene rules, update checks, backup/restore, bookmarklet setup, and diagnostics.
- **Settings** — theme selection, text size controls, service URL settings, and version/update information.
- **First-run setup wizard** — guided onboarding for Jira, ServiceNow, GitHub, and Confluence connectivity.
- **Demo mode** — session-isolated storage mode for safe walkthroughs and demos.

## Tool guide

The sections below explain what each major tool is for, who usually uses it, and which workflows it owns today.

| Tool | Primary audience | Use it when you need to... |
| --- | --- | --- |
| Team Dashboard | Scrum Masters, delivery leads, team members | Run the sprint day-to-day, review feature health, manage PI review inputs, and monitor release readiness for one board |
| ART View | RTEs, ART leads, program stakeholders | Understand cross-team PI health, dependencies, predictability, blueprint rollups, and PI review readouts |
| My Issues | Individual contributors | Work personal Jira and linked ServiceNow items from one place, with hygiene checks and bulk actions |
| Reports Hub | Directors, RTEs, delivery managers | Pull leadership-ready views for delivery, flow, defects, risks, sprint health, and throughput |
| Business Helper | Business users, analysts, product support | Search Jira without JQL and manage the stabilization funding workflow |
| Dev Workspace | Engineers and technical leads | Track time, sync Git activity into Jira, run hygiene checks, and monitor automation status |
| SNow Hub | Release managers and operational support | Generate change requests, convert problem records, monitor sync jobs, and manage release work |
| Text Tools | Any user | Quickly transform, format, encode, decode, or extract structured text payloads |
| Personal Toolbox | Any returning user | Build a custom workspace made from the tools you use most often |
| Admin Hub | Admins, support leads, POC owners | Configure integrations, manage standards and visibility, back up settings, and run diagnostics |
| Code Walkthrough | Developers, auditors, new contributors | Read the built-in technical reference for architecture, security, data flow, and write paths |

### Team Dashboard

**What it covers:** one team board's execution workspace from daily sprint management through feature and release review.

**Feature map**
- **Overview** shows sprint health, burn-down behavior, and board-level execution context.
- **By Assignee** groups visible sprint work by owner so leads can balance load and spot gaps.
- **Blockers** isolates blocked or aging work for triage and follow-up.
- **Defects** surfaces sprint defects with faster priority-based review.
- **Standup** adds a timer-driven facilitation surface for daily walkthroughs.
- **Metrics** highlights delivery trends such as burn and velocity-style signals.
- **Pipeline** gives a kanban-style view of work-in-progress states and bottlenecks.
- **Planning** focuses on unestimated or planning-ready work before a sprint or release.
- **Pointing** supports lightweight story-pointing workflows inside the dashboard.
- **Feature Review** rolls up team features, hygiene flags, child progress, direct field fixes, and direct status transitions.
- **PI Review** provides team-scoped PI authoring tied to shared capacity and Confluence save flows.
- **Releases** groups fix-version readiness, schedule risk, release-note prompts, and export-friendly release summaries.

**Common workflows**
1. **Feature Review cleanup:** open the correct board and scope, move into Feature Review, clear hygiene flags with direct fixes or status transitions, and confirm the badges disappear before moving on.
2. **PI Review update:** refresh capacity first, update feature scope and confidence, then save the team-scoped PI content so ART View can read it back cleanly.
3. **Release-note draft:** review release buckets, build the release prompt, paste the returned notes, then export the final release summary when it is ready to share.

**Troubleshooting**
- If Feature Review looks incomplete, confirm the selected board, project key, and scope mode still point to the intended team.
- If PI Review does not appear, check ART Settings for the matching board mapping and PI Review page URL.
- If release readiness looks stale, refresh after confirming the active sprint or fix version still matches the release you expect to review.

**Use this tool when**
- a scrum team needs one place to manage sprint execution
- the team wants feature hygiene and child rollups without leaving the dashboard
- the board owner needs PI Review authoring for just one team

### ART View

**What it covers:** release-train level coordination across teams, including PI reporting, dependencies, and blueprint rollups.

**Feature map**
- **Overview** summarizes configured teams, PI timing, and ART-level health signals.
- **Impediments** groups blockers by team and stale age so escalation work is easier.
- **Predictability** focuses on train-level forecasting and confidence-style measures.
- **Releases** monitors readiness across teams instead of one board at a time.
- **PI Review** acts as the multi-team readout surface for Confluence-backed PI content, confidence voting, Jira reconciliation, imports, and PNG/CSV exports.
- **Blueprint** explores hierarchy rollups, feature relationships, and completion visibility.
- **Dependencies** highlights cross-team dependency paths and team-to-team linkage views.
- **Board Prep** helps review backlog readiness and planning inputs before events.
- **SoS** supports Scrum-of-Scrums conversations with cross-team summaries.
- **Monthly Report** turns current state into a reusable narrative starting point.
- **Settings** stores team definitions, board links, PI values, and PI Review page references.

**Common workflows**
1. **PI Review readout:** load the configured team pages, confirm Jira reconciliation looks current, review confidence and capacity with the audience, then export PNG or CSV if you need a shareable artifact.
2. **Dependency review:** switch to the dependency lens that matches the conversation, narrow the relationships, and identify the teams that need follow-up before the next planning checkpoint.
3. **Monthly reporting:** refresh the latest ART data, review the generated narrative starter, and copy or refine it before publishing the formal update.

**Troubleshooting**
- If a team PI Review panel is missing, check that the team still exists in ART Settings and that the Confluence page reference is valid.
- If dependency views are unexpectedly thin, review the configured teams and any active filters before assuming the ART is clear.
- If urgency or PI timing looks wrong, verify the active PI name and end date in ART Settings first.

**Use this tool when**
- ART leadership needs a cross-team picture instead of a single board view
- PI Review information must be reviewed, exported, or reconciled with Jira
- you need to inspect dependencies or blueprint relationships above the team level

### Feature Canvas

**What it covers:** a spatial, drag-and-drop planning board for turning a chaotic backlog into a committed PI plan. Features/epics render as movable cards; the work flows through five guided phases and ends at an explicit Review & Commit that is the only thing that writes to Jira.

**The five phases** (the coaching journey on the right, resumable and non-linear):
1. **Surface** — pull the candidate features onto the canvas (blueprint picker, or Add via JQL with a person-finder and hidden NL→JQL helper).
2. **Size** — give each feature a relative t-shirt size (S/M/L/XL) so later phases can weigh effort.
3. **Prioritize** — sort features into MoSCoW buckets (Must/Should/Could/Wont), weighing value against size and PI time.
4. **Stabilize WIP** — set a WIP limit, then move finished work to the **Complete** box and park the lowest-value/least-progressed excess into the **Parking Lot** (never work that is nearly done). Shows both feature and active-story counts.
5. **Sequence & Box** — drag sized features into **sprint** and **release** boxes within capacity. Pull the board's real sprints in with **↧ Pull sprints from board**, or add provisional ones.

**Boxes and cards**
- Boxes are **resizable** (select to reveal handles) and **movable** — dragging a box carries its cards with it, and you can still drag a single card out into another box. Boxes auto-tile so they don't overlap.
- **Parking Lot** and **Complete** boxes auto-create and are canvas-only (never committed to Jira).
- Each card shows a status stripe, a health dot, size/points, MoSCoW, % complete, and hygiene/parked badges. The **❓ Key** explains every marking and lets you click a status/health color to **focus** the canvas on those cards.
- The toolbar has a **Team** selector (swaps the active team, shared with Team Dashboard), a **PI** picker (step 1), the active **days-left in the PI**, **Undo/Redo**, and **Clear canvas** (a full reset).

**AI accelerator (optional, passphrase-gated via Ctrl+Alt+Z)**
- A copy-prompt / paste-JSON round-trip — no data leaves the app automatically, and every suggestion is a proposal you accept or reject.
- Per-phase analyses (Size, Prioritize, Triage, Sequence) plus a **★ Master plan** that returns size + priority + triage + sprint for every feature and applies the whole plan in a single, undoable step.
- Prompts are fed the real signals the canvas already has — description, acceptance criteria, health, completion, story load, blockers, Business Value, PI days-left — and encode the Definition of Done (dev-complete + delivered to integration testing, not production).

**Review & Commit** (the only Jira write)
- Shows an itemized, per-item-toggleable diff. Feature→sprint expands to **per child story** (Jira sprints hold stories, not epics), with a live **per-sprint story-point load** vs capacity so you can uncheck stories that should not ship this sprint.
- Parked features can post their **park reason as a Jira comment**; provisional sprints/releases are created before assignments; Parking Lot/Complete boxes are never written.
- **Plan stories in Sprint Dashboard →** hands off to the Team Dashboard for per-story sequencing, pointing, and capacity.

**Common workflows**
1. **Recover a backlog:** Add features → run the phases (or the Master plan) → arrange into sprint boxes → Review & Commit.
2. **Stabilize a runaway sprint:** set a WIP limit in Stabilize, use Triage to complete/park the excess, and watch the active-story count drop.
3. **Plan a sprint's stories:** at Review & Commit, check the per-sprint load and uncheck stories that overflow, then hand off to the Sprint Dashboard.

**Troubleshooting**
- If the canvas is empty after switching context, confirm the **Team** and **PI** selectors point at the plan you built (each team+PI keeps its own overlay).
- If the AI options are missing, unlock AI Assist with **Ctrl+Alt+Z** (per browser tab).
- If a box looks empty after an AI assignment, the cards move into the box on accept — check you accepted the Sequence/Master-plan suggestions.

**Use this tool when**
- a Scrum Master inherits a chaotic backlog and needs a deliberate way to recover it
- you want a visual PI plan (Now/Next/Later) before touching Jira
- you want AI help sizing, prioritizing, and sequencing without giving up final say

### My Issues

**What it covers:** the personal work queue for one user across Jira and linked ServiceNow work.

**Feature map**
- **Report** supports Mine, JQL, Saved Filter, and Board sources.
- **Cards / Compact / Table** layouts let users switch between scan-heavy and detail-heavy views.
- **Status zones** break work into attention, in progress, in review, to do, and done buckets.
- **Bulk comment posting** lets users update multiple Jira issues in one pass.
- **Linked Jira-ServiceNow context** helps users understand paired records without opening separate tools.
- **Hygiene** adds issue-health checks directly beside the work queue.
- **Settings** stores defaults for source, sort, layout, and status-mapping behavior.

**Common workflows**
1. **Daily queue review:** choose Mine, JQL, Saved Filter, or Board, switch to the layout that fits the task, and work down the status zones from attention to done.
2. **Bulk update:** enable bulk mode, select the issues that need the same comment, then post once instead of opening each issue separately.
3. **Cross-system check:** open linked Jira-ServiceNow context before updating a record so you can see the paired work without changing tools.

**Troubleshooting**
- If the queue looks too small, confirm the current source and filters before assuming issues are missing.
- If linked issue context is empty, verify that the Jira and ServiceNow records still reference each other the way the view expects.

### Reports Hub

**What it covers:** curated reporting views for leadership and program reviews.

**Feature map**
- **Dashboard** summarizes key counts and distribution charts for fast review.
- **Feature Report** tracks feature delivery across teams and PIs.
- **Defect Tracker** centralizes bug visibility by team, status, and priority.
- **Risk Board** gathers open risks and risk-like work for escalation conversations.
- **Flow** focuses on throughput and aging work.
- **Impact** shows team delivery quality and throughput trends.
- **Quality** concentrates on defect mix and defect pressure.
- **Sprint Health** gives a real-time pulse for active sprint execution.
- **Throughput** compares completion output across time.
- **Individual** supports one-person workload and ownership review.
- **About this report** explainers and copy-friendly outputs make each view easier to reuse in meetings and status updates.

**Common workflows**
1. **Leadership review prep:** pick the report tab that matches the meeting outcome, apply PI and team filters, then use the explainer panel to confirm what the numbers mean.
2. **Status update export:** narrow the view to the exact team or PI slice you need, then copy the report output into the meeting notes or status channel.
3. **Individual workload check:** use the Individual view when you need to inspect one contributor's current open ownership before a staffing or priority conversation.

**Troubleshooting**
- If a report feels stale, reload it after confirming the ART team configuration still matches the target scope.
- If counts feel off, check the current PI and team filters before trusting the active tab output.

### Business Helper

**What it covers:** business-friendly Jira utilities with a guided stabilization workflow.

**Feature map**
- **Simple Search** turns plain-language keywords into grouped Jira results without exposing JQL.
- **Portfolio / ART / Team grouping** helps non-technical users understand where a result sits.
- **Expandable child and linked records** keep related context near the main result.
- **Send to Stablization** moves a Jira result into the funding table with mapped values.
- **Stablization** provides an editable funding table with formulas, local persistence, resizable columns, and custom user-defined columns.
- **Settings** manages dropdown options, built-in column behavior, custom columns, and Simple Search field mapping into the funding table.

**Common workflows**
1. **Simple Search to funding table:** search with a plain-language keyword, review the grouped Jira results, then send the chosen item to Stablization so the mapped values populate automatically.
2. **Funding-table refinement:** adjust formulas, custom columns, dropdown-backed fields, and any local draft values directly inside Stablization.
3. **Mapping upkeep:** open Settings when a result should land in a different destination column or when a dropdown-backed column needs new options.

**Troubleshooting**
- If mapped values land in the wrong place, review the Simple Search mapping rules before editing rows manually.
- If a dropdown option is missing, add it in Settings rather than typing inconsistent values into the table.

### Dev Workspace

**What it covers:** developer operations and automation support in one place.

**Feature map**
- **Hygiene** surfaces cleanup checks relevant to developer-owned work.
- **Time Tracking** manages issue timers, today's entries, and history tied to Jira work-log posting.
- **Git Sync** monitors repository activity and turns matching commits into Jira updates using configurable patterns.
- **Repo Monitor** shows scheduler-backed automation status and recent monitor activity.
- **Settings** controls repository identifiers, authentication inputs, polling cadence, commit parsing, and posting behavior.

**Common workflows**
1. **Issue timer flow:** start a timer on the current issue, pause or stop it as work changes, and review Today or History before posting time into Jira.
2. **Git sync setup:** configure repository, Jira key pattern, and posting strategy in Settings before relying on Git Sync to turn commits into Jira updates.
3. **Automation health review:** use Repo Monitor when you need to confirm scheduler status, recent run history, or the current monitor behavior.

**Troubleshooting**
- If Git Sync is silent, verify the repository identifier, authentication, and commit-key pattern before changing the scheduler cadence.
- If time tracking looks inconsistent, check whether multiple timers or stale entries are still open before posting work logs.

### SNow Hub

**What it covers:** the ServiceNow-facing operational workflows inside NodeToolbox.

**Feature map**
- **CHG** guides users through a multi-step change-request workflow based on Jira-backed release inputs.
- **Configuration** stores reusable change-request defaults, mappings, and template-like setup.
- **PRB Generator** turns ServiceNow problem records into paired Jira work.
- **PRB Sync Monitor** watches and runs Jira-ServiceNow synchronization with activity history.
- **Release Management** tracks active changes, state, risk, assignees, and recent activity.

**Common workflows**
1. **Change request creation:** start in CHG, walk through the wizard in order, and confirm the generated planning and environment fields before submitting the change.
2. **Problem-to-Jira conversion:** use PRB Generator when a ServiceNow problem record needs paired Jira work for tracking or remediation.
3. **Sync and release review:** check PRB Sync Monitor and Release Management when you need to understand recent status changes, activity, or manual sync needs.

**Troubleshooting**
- If choice fields do not load, confirm the ServiceNow connection and credentials from Admin Hub or Settings.
- If sync activity looks wrong, review the current mappings and recent monitor log before forcing repeated manual runs.

### Text Tools

**What it covers:** lightweight utility tools for copy-paste transformation work.

**Feature map**
- **Smart Formatter** converts pasted text or HTML into friendlier output.
- **JSON Formatter** cleans up or minifies JSON payloads.
- **Case Converter** generates common naming variants for pasted text.
- **URL Encoder/Decoder** handles component or full-URL transforms.
- **Base64 Encoder/Decoder** supports quick encoding and decoding work.
- **Element Extractor** includes the ServiceNow bookmarklet/install flow for capturing field payloads from the browser.

**Common workflows**
1. **Payload cleanup:** pick the tool that matches the data type, paste the input, review the output, then copy the cleaned result back into the target workflow.
2. **Element extraction:** install or run the ServiceNow bookmarklet, capture the page payload, then filter and copy the fields you need.

**Troubleshooting**
- If the output looks wrong, confirm you selected the correct tool and mode before assuming the source payload is bad.
- If the extractor returns incomplete fields, re-run it on the target page before copying the filtered output.

### Personal Toolbox

**What it covers:** a customizable home workspace built from the app's major modules.

**Feature map**
- choose which major tools appear in your personal tab bar
- reorder modules so the workspaces you use most open first
- keep a lighter workspace without hiding the full tools from the main application
- combine delivery, reporting, utility, and admin surfaces into one personalized view

**Common workflows**
1. **Workspace setup:** enable the modules you actually use, move them into your preferred order, and treat the result as your default daily landing area.
2. **Role-based switching:** keep a smaller set of modules for a focused role, then re-open the full application only when you need less common tools.

**Troubleshooting**
- If a module disappears, check the builder first to confirm it is still selected.
- If the tab order feels wrong after changes, reopen the builder and move the module back into the preferred position.

### Admin Hub

**What it covers:** platform setup, operational controls, governance, and support utilities.

**Feature map**
- **Connection and proxy setup** exposes service endpoints, connection checks, and credential visibility.
- **Server controls** support restart or local shutdown workflows.
- **ART settings** store PI metadata and shared field mappings used by other tools.
- **Enterprise standards** manage built-in and custom hygiene rules.
- **Backup / restore** protects durable browser-side settings and supports demo-mode workflows.
- **Tool visibility** controls which top-level tools appear on the home surface.
- **Diagnostics and embedded Dev Panel** support troubleshooting and support workflows.

**Common workflows**
1. **Environment setup:** configure service endpoints, test connectivity, and confirm the proxy state before deeper tool troubleshooting.
2. **Governance update:** adjust ART settings, enterprise standards, or tool visibility when shared behavior must change for everyone using the repo configuration model.
3. **Safety backup:** export durable settings before a risky config change, demo reset, or troubleshooting session, then restore from the backup if needed.

**Troubleshooting**
- If several tools fail at once, start in Admin Hub and verify connections before debugging each tool separately.
- If a tool vanishes from Home, review Tool Visibility before assuming the feature was removed.

### Code Walkthrough

**What it covers:** the built-in technical reference for how NodeToolbox is structured and why it is safe to use in a local-first environment.

**Feature map**
- search across the in-app documentation
- guided-tour mode for new contributors or reviewers
- workspace guide that explains what each major tool owns
- architecture, security, data-flow, and write-path reference sections

**Common workflows**
1. **New-user orientation:** start the guided tour when a new contributor needs the high-level system story before reading code.
2. **Feature lookup:** search for the tool or workflow name when you want the fastest route to the relevant in-app documentation section.

**Troubleshooting**
- If search returns no results, try the tool name instead of the workflow nickname.
- If a topic is too shallow, update the in-app section alongside the README so both documentation surfaces stay aligned.

### Adjacent focused views

These views are narrower than the major hubs above, but they are still important for day-to-day use:

- **Daily Standup Board** — focused standup surface with issue sections, filters, notes, issue details, and action-oriented review.
- **Release Monitor** — lightweight Jira fix-version readiness monitor for a single release, including overdue and blocker visibility.
- **Settings** — shared service URLs, theme, text size, and version checks.

## Integrations

NodeToolbox currently integrates with:

- **Jira** for issues, boards, sprints, transitions, work logs, fix versions, and planning data
- **ServiceNow** for change, problem, and related operational workflows
- **GitHub** through either a personal access token or GitHub App authentication
- **Confluence** for PI Review and shared planning content

The server injects credentials on the backend so the browser works against localhost routes instead of talking directly to those systems with raw secrets.

## Platform architecture

- **Server:** Node.js + Express proxy
- **Client:** React + TypeScript + Vite
- **State/UI:** Zustand, React Router, Recharts, html2canvas, XLSX, dnd-kit
- **Packaging:** standard Node launch or packaged Windows executable
- **Runtime:** Node.js 18+

Key platform capabilities include:

- Jira, ServiceNow, and GitHub proxy routes
- GitHub App installation-token support with server-side token caching
- ServiceNow browser-session relay support
- repo-monitor scheduler APIs
- diagnostics, restart, shutdown, and update endpoints
- Windows-friendly launcher and packaged `.exe` distribution

## Quick start for distributed builds

1. Extract `nodetoolbox-vX.Y.Z.zip` to a local folder.
2. Double-click **`Launch Toolbox.bat`**.
3. Complete the `/setup` wizard the first time the app opens.

> **Requirement:** Node.js must be installed and available on your `PATH`.

## Optional desktop shortcut

From the extracted folder:

```powershell
npm run create-launcher
```

This creates a machine-specific shortcut that you can move to the Desktop.

## Developer quickstart

```powershell
git clone git@github.com:mikejsmith1985/NodeToolbox.git
Set-Location NodeToolbox
npm install
Set-Location client
npm install
Set-Location ..
npm run build:client
npm start
```

## Validation commands

### Server

```powershell
npm test
```

### Client

```powershell
Set-Location client
npm run lint
npm test -- --run
npm run build
```

## Release workflow

NodeToolbox uses the local PowerShell release pipeline.

Run from the repository root on a feature branch:

```powershell
.\scripts\local-release.ps1 patch
.\scripts\local-release.ps1 minor
.\scripts\local-release.ps1 major
```

If you need to re-run a failed release safely, pass the exact version:

```powershell
.\scripts\local-release.ps1 0.12.21
```

## Configuration and storage

- Supported environment overrides are defined in `.env.example`
- Persisted configuration is stored in `%APPDATA%\NodeToolbox\toolbox-proxy.json` on Windows
- Credentials are kept out of source control and used by the server-side proxy layer

## Repository layout

| Path | Purpose |
| --- | --- |
| `server.js` | Express entry point and static app host |
| `src/routes` | Internal API, setup, proxy, and scheduler routes |
| `src/services` | GitHub auth, repo monitor, ServiceNow session, and related services |
| `client/src` | React application, views, hooks, services, and shared UI |
| `scripts` | Local release and packaging helpers |
| `test` | Server-side integration and unit coverage |

## Notes

- The client includes shared theme controls, text-size controls, toast feedback, and connection-status visibility across the app.
- Legacy routes are redirected into the consolidated React workspaces so older entry points still land in the supported tool areas.
