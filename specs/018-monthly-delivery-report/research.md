# Research: Monthly Delivery Report — Scheduled AI-Prompt Generator

**Feature**: `018-monthly-delivery-report` · **Date**: 2026-07-16
**Method**: three parallel codebase investigations (server scheduler infrastructure, Admin Hub panel patterns,
delivery-classification/changelog/fixVersion code). All decisions below cite the concrete precedent found.

## D1 — Delivery ladder source of truth: bundle `workflowDelivery.ts` server-side

- **Decision**: Reuse `client/src/utils/workflowDelivery.ts` on the server by bundling it with esbuild into
  `src/services/generated/monthlyDeliveryEngine.cjs`, via a new entry file and a `build:monthly-delivery-engine`
  npm script mirroring `build:pi-review-engine` (wired into `prestart`, `prebuild:exe`, `pretest`).
- **Rationale**: The ladder (`Ready for QA` = delivered threshold, `Ready to Accept`, `DONE_CATEGORY_STATUS_NAMES`)
  and the carry-over rule (`resolveDeliveryDateIso` tracks the *current uninterrupted delivered run*) already exist,
  tested, in `workflowDelivery.ts`. Grep confirms **no server-side JS equivalent exists**. Spec A3 forbids a new
  status mapping; Article VII (framework-first) forbids a reimplementation when a bundling precedent (feature 015)
  already ships. New month-attribution helpers (entry-into-done date) are added to `workflowDelivery.ts` itself
  (pure, vitest-tested) so the ladder stays in one file.
- **Alternatives considered**: (a) Reimplement ~80 lines in server JS — rejected: duplicates the exact logic whose
  drift caused the statusCategory bug documented in `workflowDelivery.ts`; (b) extend the existing
  `piReviewEngine.entry.ts` bundle — rejected: couples this feature to the 015 standing constraint
  (`npm run test:dom`) for no benefit; a separate entry keeps blast radius zero.
- **Constraint recorded**: like 015, changes to `workflowDelivery.ts` (and the new entry) must keep the server
  bundle building and server Jest green — this becomes a standing note in `CLAUDE.md`.

## D2 — Monthly firing on the daily-scheduler chassis

- **Decision**: Copy the `piReviewScheduler.js` chassis (60-second tick, injectable tick options, overlap guard,
  `schedulerFiredState` persistence) and add two pure helpers: `computeSecondTuesdayDate(year, month)` and a
  once-per-month guard comparing the stored fired date's `YYYY-MM` prefix to the current month. Fire when
  `today > secondTuesday` (catch-up, any time of day) or `today === secondTuesday && isScheduledTimeReached(...)`.
- **Rationale**: `schedulerFiredState` stores arbitrary `configKey → "YYYY-MM-DD"` strings and never interprets
  them — the once-per-day semantics live in each caller. A `stored.slice(0, 7) === currentMonth` compare gives
  once-per-month with **zero changes** to the shared module. `isScheduledTimeReached` is reused unchanged for the
  time-of-day gate. Catch-up within the month satisfies spec FR-002 exactly.
- **Alternatives considered**: extending `schedulerFiredState` with month-granularity API — rejected: unnecessary;
  the module is deliberately value-agnostic. A cron library — rejected: Article VII; the house chassis exists.

## D3 — Jira query strategy (accuracy per spec FR-008)

- **Decision**: Two queries per team against `/rest/api/2/search` with `expand=changelog`, deduped by issue key:
  - **Query A (status path)**: `project = "<projectKey>" AND issuetype in (Story, Task) AND status CHANGED DURING
    ("<yyyy/MM/dd first>", "<yyyy/MM/dd last>")`.
  - **Query B (released-version path)**: fetch `GET /rest/api/2/project/<projectKey>/versions`, select versions with
    `released === true` and `releaseDate` inside the covered month, then `project = "<projectKey>" AND issuetype in
    (Story, Task) AND fixVersion in (<those versions>)`.
  - Fields: `summary,status,issuetype,fixVersions,customfield_10108,customfield_10014,parent`.
  - Classification walks each candidate's changelog: **Production** when the most recent transition into a
    done-category status falls inside the month, or the issue is delivered and one of its fix versions released
    inside the month; **External Test** when the current delivered run's entry date (`resolveDeliveryDateIso`)
    falls inside the month and Production doesn't apply. Production wins ties (FR-010/FR-011).
- **Rationale**: `status CHANGED DURING` is the JQL-native way to pre-filter to in-month transitions; the changelog
  walk then gives exact attribution (spec chose accuracy over cheapness). Query B covers FR-010's
  "released fix version with no in-month transition" edge case. The changelog-walk template is
  `featureChangeScheduler.js` `collapseFeatureFieldChanges`; the versions-fetch template is
  `sprintReleaseScheduler.js:205` (which reads `releaseDate`; reading `released` is new but trivial —
  `releaseStats.ts` `classifyVersion` is the client read-model to mirror).
- **Pagination**: existing schedulers stop at `maxResults=200` with no paging. A month of Stories/Tasks per team can
  plausibly exceed that, and silent truncation would violate SC-004's honesty guarantee — so this scheduler adds a
  `startAt` loop (drift justification recorded at the component per Article VII).
- **Alternatives considered**: one wide `updated >= <month start>` query filtered entirely client-side (scopeChange
  style) — rejected: much larger result sets for no accuracy gain; `resolutiondate`-based JQL — rejected by spec
  (FR-008 forbids resolution-date attribution).

## D4 — Feature grouping server-side

- **Decision**: Bundle the pure helpers from `client/src/utils/featureLink.ts` (`featureLinkCandidateFieldIds`,
  `extractFeatureKeyFromIssueFields`, `extractIssueKeyFromLinkValue`) into the same engine `.cjs`. Group issues by
  resolved Feature key (configured field → `customfield_10108` → `customfield_10014` → native `parent.key`), then
  batch-fetch Feature summaries with one `key in (...)` search per run. Unresolvable issues go to "No Feature".
- **Rationale**: `featureLink.ts` is the declared single source of truth for child→Feature resolution; the batched
  `key in (...)` summary fetch is the established pattern (`blueprintHierarchy.ts`, `piReviewJira.ts`).
- **Caveat handled**: `loadConfiguredFeatureLinkFieldId()` reads browser localStorage, so the server cannot call it.
  Instead the Admin Hub panel snapshots the configured field id into scheduler config (`featureLinkFieldId`,
  default `customfield_10108`) at save time — same moment the team list is snapshotted.

## D5 — Config, routes, persistence

- **Decision**:
  - Config block `configuration.scheduler.monthlyDelivery = { isEnabled, scheduleTime: "08:00",
    featureLinkFieldId, teams: [{ teamName, projectKey, boardId }] }`, **added to the whitelist serializer in
    `src/config/loader.js` (`saveConfigToDisk`, scheduler block at lines 155–183)** — without this the config
    silently fails to persist (confirmed gotcha).
  - New router factory `createMonthlyDeliveryRouter(configuration)` in `src/routes/monthlyDelivery.js`:
    `GET/POST /api/monthly-delivery/config`, `POST /api/monthly-delivery/run-now` (whole run, all teams),
    `GET /api/monthly-delivery/status` (returns the persisted last run **including promptText**). Mounted in
    `server.js` beside the PI Review router (~line 146); scheduler started in the startup block (~line 665).
  - Last-run persistence: own JSON file `%APPDATA%\NodeToolbox\monthly-delivery-last-run.json` with env override
    `TBX_MONTHLY_DELIVERY_RESULTS_PATH` (the `piReviewScheduler.js` results-file pattern, lines 53–88).
- **Rationale**: exact mirror of the 015 route/persistence shape — the Admin Hub client already knows this idiom.
  A single-prompt artifact means Run Now is whole-run (no `teamIndex`), simpler than the per-team precedents.
- **Alternatives considered**: `reportDeliveryStatus.recordDeliveryOutcome` ledger — rejected: that contract models
  per-destination delivery (Confluence/webhook); this feature has no delivery destination, only a stored artifact.

## D6 — Admin Hub panel

- **Decision**: New tab `monthly-delivery` in `AdminHubView.tsx` (union type + `ADMIN_HUB_TAB_OPTIONS` + tabpanel
  block) hosting a self-contained `MonthlyDeliveryPanel.tsx`, modeled on `StandupBriefingPanel.tsx`: enable toggle,
  time input (validated `HH:MM`), snapshotted team list display, **Snapshot Teams** button reading
  `useSettingsStore((s) => s.sprintDashboardTeamProfiles)` and mapping to `{teamName: name, projectKey, boardId}`,
  Save (POST config), Run Now (disabled while dirty, per the `PiReviewSchedulerPanel` gating precedent), last-run
  status line, readonly `<textarea>` with the prompt, and a **📋 Copy Prompt** button (`navigator.clipboard.writeText`
  + transient `✓ Copied!` label, disabled when empty — the `StandupBriefingPanel` idiom).
- **Rationale**: `StandupBriefingPanel` is a near-exact functional precedent (generated text artifact + copy).
  Reading the settings store from Admin Hub for a server snapshot is a **new flow** (no precedent found) but uses
  only an established read-only selector; it never writes the store.
- **Alternatives considered**: auto-syncing team profiles to the server — rejected by spec A7 (explicit
  snapshot-on-save only).

## D7 — Prompt format

- **Decision**: Plain text, two parts: (1) fixed agent instructions containing the exact question from the spec and
  the required output shape (bulleted analysis per team, business-benefit/technical-improvement focus); (2) data
  sections per team → per bucket (Production, External Test) → per Feature group → issue lines
  `- KEY: summary (reached <bucket> YYYY-MM-DD)`. Empty teams render "No recorded deliveries this month."; failed
  teams render "DATA UNAVAILABLE: <reason>". Format is a contract (`contracts/prompt-format.md`); exact instruction
  wording is tunable post-launch (spec A6) as long as the structure holds.
- **Rationale**: FR-013–FR-015; the standup briefing's plain-text artifact proves the copy/paste workflow.

## Resolved unknowns

| Unknown | Resolution |
|---|---|
| Once-per-month on a day-based fired-state | Caller-side `YYYY-MM` prefix compare; no shared-module change (D2) |
| Ladder availability server-side | Not available today; esbuild bundle, 015 precedent (D1) |
| `released` flag precedent | None reads `.released` today; `/project/{key}/versions` fetch template exists (D3) |
| Feature-link field configurability server-side | Snapshot `featureLinkFieldId` into config at panel save (D4) |
| Client→server team snapshot precedent | None exists; new read-only flow from settings store (D6) |
| Config persistence | Must extend `saveConfigToDisk` whitelist or config is silently dropped (D5) |
