# NodeToolbox client

The `client` folder contains the React + TypeScript frontend for NodeToolbox. It is the user-facing application shell for the Jira, ServiceNow, GitHub, and Confluence-backed workflows described in the root `README.md`.

## What lives here

| Path | Purpose |
| --- | --- |
| `src/main.tsx` | Browser entry point and root render |
| `src/App.tsx` | Top-level routing and shared application shell |
| `src/views` | Tool workspaces such as Team Dashboard, ART View, SNow Hub, and Admin Hub |
| `src/components` | Reusable UI building blocks used across many views |
| `src/services` | API helpers for proxy-backed Jira, ServiceNow, GitHub, and Confluence calls |
| `src/store` | Shared Zustand-backed settings and app state |
| `src/types` | Shared TypeScript models for external systems and internal view state |
| `src/lib` | Small reusable utilities and pure helper logic |

## Main product areas

### Delivery and planning workspaces

- **Team Dashboard** — team-level sprint execution, blockers, defects, metrics, feature review, PI Review, releases, and settings
- **ART View** — cross-team train visibility, PI review readout, dependencies, blueprint hierarchy, and monthly reporting
- **My Issues** — personal Jira work queue, hygiene checks, and linked ServiceNow visibility
- **Reports Hub** — leadership and portfolio reporting views

### Operational and utility workspaces

- **Business Helper** — simple Jira search and stabilization funding workflow
- **Dev Workspace** — time tracking, Git sync, hygiene, and repo monitor
- **SNow Hub** — change, problem, release, and sync workflows for ServiceNow
- **Text Tools** — formatting and transformation utilities
- **Admin Hub** — integration setup, standards, diagnostics, and backup/restore
- **Code Walkthrough** — built-in technical documentation

## Frontend architecture

### Routing

NodeToolbox uses React Router for tool-level navigation. Most routes map directly to a workspace view under `src/views`.

### View pattern

Most tool areas follow the same structure:

1. a top-level `*View.tsx` component that owns layout and tab composition
2. one or more focused tabs, panels, or helper components
3. a dedicated state hook that follows a `{ state, actions }` style contract
4. API helpers in `src/services` or view-local hooks for remote data access

This keeps dense tool areas readable and makes it easier to test stateful workflows independently from their layout.

### State management

- **Local component state** is used for view-only interactions such as open panels and filters.
- **Zustand stores** handle durable cross-view settings such as theme, text size, selected modules, and other user preferences.
- **Browser storage** is used for some POC-era persisted settings, drafts, and cached configuration where a server-backed database does not yet exist.

### Styling

- CSS Modules are the default styling pattern for workspace-specific UI.
- Shared sizing, spacing, and color tokens are reused across dense workspaces to keep behavior consistent at different screen sizes and text scales.

## Data and integration flow

The browser does not call Jira, ServiceNow, GitHub, or Confluence directly with raw secrets. Instead:

1. a view or hook calls a client service helper
2. the helper calls a localhost proxy route
3. the Node/Express backend injects credentials and forwards the request
4. the typed response comes back into the view hook and then into the UI

This pattern keeps credentials out of browser code while letting the client stay strongly typed and modular.

## Tool map

| View folder | Primary responsibility |
| --- | --- |
| `src/views/SprintDashboard` | Team-level sprint execution and feature/release review |
| `src/views/ArtView` | ART-level planning, reporting, dependencies, and PI review |
| `src/views/MyIssues` | Personal work queue and linked issue management |
| `src/views/ReportsHub` | Leadership and portfolio reporting |
| `src/views/BusinessHelper` | Business-friendly Jira and stabilization workflows |
| `src/views/DevWorkspace` | Time tracking, Git sync, hygiene, and repo monitor |
| `src/views/SnowHub` | ServiceNow workflows and synchronization |
| `src/views/TextTools` | Text transformation utilities |
| `src/views/AdminHub` | Configuration, standards, diagnostics, and support tools |
| `src/views/CodeWalkthrough` | In-app technical documentation |
| `src/views/PersonalToolbox` | User-composed workspace shell |

## Feature map by workspace

### `src/views/SprintDashboard`

- Overview, assignee, blockers, defects, standup, metrics, pipeline, planning, pointing, Feature Review, PI Review, releases, and settings
- team-focused editing surfaces such as feature hygiene fixes, direct status transitions, and release-note workflows
- workflow guidance lives in the root `README.md` tool guide and the `CodeWalkthroughView` feature sections

### `src/views/ArtView`

- overview, impediments, predictability, releases, PI Review, blueprint, dependencies, board prep, SoS, monthly reporting, and settings
- cross-team reporting and Confluence-backed PI Review readout features
- update both the root `README.md` and `CodeWalkthroughView` when train-level workflows change

### `src/views/MyIssues`

- report sourcing from mine, JQL, saved filters, and board views
- bulk comments, export formats, linked ServiceNow context, hygiene, and user defaults
- keep source-selection and export behavior documented because they change how one user interprets the same queue

### `src/views/ReportsHub`

- leadership-facing dashboard, feature, defect, risk, flow, impact, quality, sprint health, throughput, and individual views
- copy-friendly reporting surfaces with built-in report explainers

### `src/views/BusinessHelper`

- Simple Search, Stablization, and Settings
- search-to-table mapping, local funding drafts, custom columns, dropdown management, and grouped Jira result browsing
- document both the user flow and the field-mapping behavior when updating this workspace

### `src/views/DevWorkspace`

- hygiene, time tracking, Git sync, repo monitor, and settings
- issue timers, work-log history, commit-to-Jira automation, and scheduler-backed monitoring
- workflow notes should explain setup order because Git Sync and Repo Monitor depend on correct settings first

### `src/views/SnowHub`

- change generation, configuration, problem conversion, sync monitoring, and release management
- operational workflows that bridge Jira release inputs with ServiceNow records
- changes here should update both the feature map and the step-by-step workflow docs because the wizard flow matters as much as the fields

### `src/views/TextTools`

- smart formatter, JSON formatter, case conversion, URL transforms, Base64 transforms, and element extraction
- fast copy-paste utilities rather than long-lived workflows
- concise usage guidance is still important because the wrong mode produces confusing output quickly

### `src/views/AdminHub`

- proxy setup, ART settings, standards, diagnostics, backup/restore, demo mode, and tool visibility
- support and troubleshooting surfaces used by admins and POC owners
- document setup order and recovery paths whenever admin-facing behavior changes

### `src/views/CodeWalkthrough`

- guided-tour, searchable documentation, workspace guide, and platform reference topics
- keep this file aligned with the root `README.md` so in-app and repo documentation tell the same workflow story

### `src/views/PersonalToolbox`

- module selection, module ordering, and combined-tab workspace composition
- document module behavior whenever a major tool is added, removed, or renamed in the personal workspace

## Working in this frontend

### Install dependencies

```powershell
Set-Location client
npm install
```

### Run the dev server

```powershell
Set-Location client
npm run dev
```

### Run validation

```powershell
Set-Location client
npm run lint
npm test -- --run
npm run build
```

## Testing notes

- View tests mostly live beside the workspace they cover or in the same `src/views/...` area.
- Vitest + React Testing Library are the main client-side test tools.
- Favor tests that describe the user workflow or business rule being protected, especially in the larger hub views.

## Documentation expectations

- The root `README.md` is the main product and workflow guide.
- This file focuses on frontend structure and how to work inside `client`.
- `Code Walkthrough` in the app is the best place to document technical behavior that users can inspect without opening the repository.
