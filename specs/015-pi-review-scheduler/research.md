# Research: Scheduled PI Review Save to Confluence

Consolidated Phase 0 findings. Every NEEDS CLARIFICATION from Technical Context is resolved below.

## R1 — Server-side DOM host for the save engine (the one real unknown)

**Decision**: Use **`linkedom`** (new server dependency) and make the existing save engine
(`piReviewTable.ts`) DOM-implementation-agnostic via **two minimal seams**, rather than re-implementing it.

**Findings** (from a full read of `piReviewTable.ts`):
- The module is already pure logic — it never touches a global `document`/`window`. All browser coupling flows
  through **one factory**: `new DOMParser()` in `buildStorageDocument` (`piReviewTable.ts:660-663`). Everything
  downstream operates on the returned `Document`/`Element` via standard methods (`querySelectorAll`, `createElement`,
  `replaceWith`, `insertBefore`, `getAttribute`/`setAttribute`, `.innerHTML`, `.textContent`) that any spec-compliant
  headless DOM implements.
- The only hard part is **three runtime `instanceof` guards**: `HTMLElement` (387, 401, 421, 1097),
  `HTMLTableRowElement` (676), `HTMLTableCellElement` (682, 688, 898). (`HTMLTableElement` appears only as a
  compile-time cast — erased at runtime, so it imposes no requirement.)
- `linkedom` supports every method used, but **does not expose browser-identity global constructors**, and notably
  offers no distinct `HTMLTableRowElement`/`HTMLTableCellElement` classes. So the guards cannot be satisfied by
  importing constructors — they must become tag/`nodeType` predicates.

**Refactor pattern** (least-invasive, keeps one shared engine):
1. Replace the three `instanceof` guards with tiny predicates — `isElementNode(n)` → `n?.nodeType === 1`;
   `isRowElement(n)` → `n?.tagName?.toLowerCase() === 'tr'`; `isCellElement(n)` → `td`/`th`. This makes the module
   DOM-agnostic and removes the bare-global hazard. Safe because each guard only needs "is element/row/cell", which
   `tagName`/`nodeType` express directly.
2. Inject the parser at the single seam: `buildStorageDocument(storageValue, domParser)` — browser passes native
   `DOMParser`, Node passes linkedom's `DOMParser`. No threading through the dozens of downstream helpers.

**Alternatives considered**:
- **jsdom**: fully supports `instanceof` *within one realm* but the module uses bare globals, so it would still need
  `global.HTMLElement = window.HTMLElement` mutation + strict realm discipline. Heaviest dependency tree, optional
  native `canvas`, worst fit for the **`pkg` exe** build. Rejected.
- **Re-implement server-side**: duplicates ~1200 lines of subtle boundary/grouping/capacity-dedup logic → guaranteed
  drift between the manual save and the scheduled refresh. Rejected (this is exactly the fragility to avoid).

**pkg note**: root `package.json` builds the server exe via `@yao-pkg/pkg`. `linkedom` is pure-JS, tiny, no native
modules, no dynamic requires — pkg-safe. `jsdom` is currently a **client devDependency only** (`^29.1.1`, for
vitest's `environment: 'jsdom'`); it is not available to `src/` and must not be shipped in the server exe.

## R2 — Sharing the engine across a CJS server and an ESM/TS client

**Decision**: Extract the pure PI Review save/reconcile/pull core into a form the CommonJS server can consume without
duplicating logic, and keep the browser using the same core. The two mandatory seams (R1) make the core
implementation-agnostic; the server injects linkedom + `makeJiraApiRequest`/`makeConfluenceApiRequest`, the client
injects native DOM + its existing `jiraApi`/`confluenceApi`.

**Rationale**: The existing schedulers already use dependency injection (`scopeChangeScheduler.js:13` imports
`makeConfluenceApiRequest`; tests inject it). A new `src/services/piReviewScheduler.js` fits that pattern exactly:
fetch storage body → transform via the shared engine (linkedom injected) → PUT back.

**Mechanism (pinned during `/speckit-analyze`)**: An **esbuild** bundle. A tiny entry
`client/src/views/ArtView/piReviewEngine.entry.ts` re-exports the pure functions the server needs; the npm script
`build:pi-review-engine` runs `esbuild <entry> --bundle --platform=node --format=cjs --outfile=
src/services/generated/piReviewEngine.cjs`. The generated `.cjs` is **gitignored** and regenerated from the single TS
source on every `build:client` / `build:exe` / `pretest` / `prestart`, so client and server never drift and `pkg`
bundles it automatically (it's `require`d under `src/`). `esbuild` is added as a devDependency; it is already the
bundler Vite uses, so it is pkg-irrelevant (build-time only).

**Alternatives considered**: keeping the engine client-only and re-writing on the server (rejected — drift, see R1); a
hand-written CJS twin of the needed functions (rejected — same drift risk); shipping a TS runtime loader in the exe
(rejected — pkg packages plain JS, no `.ts` at runtime).

## R3 — What "reconcile" actually refreshes (spec correction)

**Decision**: A scheduled run reconciles the **same columns the manual save reconciles** — a faithful port
(confirmed with the requester, 2026-07-14).

**Findings** (`reconcileSinglePiReviewRow`, `piReviewJira.ts:384-451`): the manual reconcile overwrites from Jira:
**Priority** (`fields.priority.name`), **Point Estimate** (`customfield_10111`), **Dependency** (Jira dependency
issue-links), **Risks** (Jira risk issue-links), and migrates prior manual dependency/risk text into **Notes**. It
does **not** touch carry-over, feature title (identity), committed, devWork, testSupport. The PI Review saved table
has **no Status or Target-date column** — status is a live transition picker; dates are display pills + a separate
"paste & update Jira dates" write action.

**Impact**: The spec's earlier "status/estimate/target dates" column set was wrong and has been corrected to
priority/estimate/dependency/risks (FR-007/FR-008, Clarifications).

## R4 — Reusable pure logic vs. client-fetch-bound wrappers

**Decision**: Reuse the pure functions; re-source the I/O and the localStorage-config server-side.

| Reuse as-is (pure) | Replace/re-source server-side |
|---|---|
| `buildDirectFeatureJql` (PO+PI JQL, no project) — `piReviewPullFeatures.ts` | `jiraGet`/`jiraPost`/`jiraPut` (client fetch → `/jira-proxy`) → `makeJiraApiRequest` |
| `reconcilePiReviewRowsWithJira` / `reconcileSinglePiReviewRow` — `piReviewJira.ts` | `fetchPiReviewFeatureIssues` (client fetch) → server batch search via `makeJiraApiRequest` |
| `parsePiReviewTable` / `writePiReviewTable` / `writePiReviewCapacitySummary` / `writeConfidenceVoteTable` — `piReviewTable.ts` (after R1 seams) | `fetchConfluencePage`/`updateConfluencePage` (client) → `makeConfluenceApiRequest` GET-then-PUT |
| `extractPiReviewFeatureKey`, `createEmptyPiReviewRow`, feature-row builder | `readPiReviewPullSettings` (reads `localStorage.tbxARTSettings.piFieldId`) → **scheduler config** |
| capacity-dedupe (`collectCapacityBlocks`) — just shipped | `readConfiguredDependencyLinkTypes` (reads `localStorage`) → **scheduler config** (or config default) |

**Rationale**: the algorithm is identical; only the *sources* differ (browser localStorage/session vs. server config +
`configuration.*` credentials). Capturing the localStorage-derived inputs (PI field id, PO, dependency link types) in
the Admin Hub scheduler config is required because the server cannot read the browser (FR-015).

## R5 — Scheduler mechanism + config placement + auth

**Decision**: Mirror the existing scheduler triad exactly.
- **Tick**: 60-second `setInterval` comparing per-team `HH:MM` to local time; `schedulerFiredState.js` for
  once-per-day + catch-up (same as `standupBriefingScheduler.js`).
- **Config**: a new `configuration.scheduler.piReview` block in `loader.js` (defaults in `buildDefaultConfig`, merge
  in `applyFileConfig`, explicit persist in `saveConfigToDisk`). Read **live** at fire time (FR-005).
- **Auth**: reuse `configuration.jira` and `configuration.confluence` via `makeJiraApiRequest`/
  `makeConfluenceApiRequest` — the same credentials the manual save's proxy uses. **No per-team secret** is stored by
  this feature, so **no `OBFUSCATED_CREDENTIAL_FIELDS` entry** is needed (unlike the webhook schedulers).
- **Concurrency**: an in-memory per-team "run in progress" guard prevents overlap (FR-004).

**Rationale**: consistency with the four existing schedulers; least surprise; reuses proven catch-up + live-config
behavior.

## R6 — Confluence write concurrency (version conflict)

**Decision**: GET page (version + `body.storage.value`) → transform → PUT with `version.number + 1`; on a 409/version
conflict, **retry once** (re-GET, re-apply the transform to the fresh body, re-PUT); if it still conflicts, report the
conflict and leave the page untouched (FR-009). Matches `standupBriefingScheduler.js`'s GET-then-PUT shape and the
manual client's retry.

## R7 — Admin Hub panel

**Decision**: New `PiReviewSchedulerPanel.tsx` copied from `StandupBriefingPanel.tsx` (self-contained, direct `fetch`
to a new `/api/pi-review-scheduler/*` route). Per-team rows: enable toggle, schedule time, and the config inputs
(page URL(s), PO assignee, PI field id, PI name); **Run now** per team; last-run status/timestamp/message. Registered
in `AdminHubView.tsx` (tab union + options + render branch).
