# Feature Specification: Scheduled PI Review Save to Confluence

**Feature short name**: `pi-review-scheduler`
**Created**: 2026-07-14
**Status**: Draft — clarifications resolved (2026-07-14: row lifecycle = append+reconcile/no-remove; refreshed
columns = priority/estimate/dependency/risks per the manual `reconcilePiReviewRowsWithJira`; version conflict =
retry-once-then-report); planned
**Builds on**: the PI Review tab's manual "Save to Confluence" flow (feature: multi-PI PI Review pages) and the
PO+PI Feature pull (`issuetype = Feature AND assignee = <PO> AND cf[PI] = <PI>`). Mirrors the existing Admin Hub
scheduler pattern (Standup Briefing, Hygiene Monitor, Scope/Feature Change) — 60-second tick, per-team `HH:MM`,
fired-state catch-up, server-side Jira/Confluence writes with configured credentials.

## Summary

Today a PI Review Confluence page only refreshes from Jira when a human opens the PI Review tab, clicks **Pull
Features**/reconcile, and clicks **Save to Confluence**. That keeps the page current only as often as someone
remembers to do it. This feature adds an **optional, per-team schedule** that performs the same refresh **on the
server, without a browser open** — re-pulling the team's Features and reconciling the Jira-sourced columns into the
page — so a PI Review page stays current on its own.

Crucially the scheduled save is **additive and conservative**: it refreshes only the **Jira-owned** data and
**preserves everything a human curated** on the page (manual columns, the Team Capacity snapshot, commitment
boundary, custom grouping lines, confidence votes). The existing **manual Save button is unchanged** and remains the
tool for urgent, out-of-band updates.

The schedule is configured and monitored from a **new Admin Hub panel**, consistent with the other schedulers, with
an enable toggle, a per-team schedule time, a **Run now** action, and clear success/failure feedback.

## Clarifications

### Session 2026-07-14

- Q: On a scheduled run, does it add/remove rows or only refresh existing ones? → A: **Append** newly-matched
  Features not yet on the page (de-duped by key, like the manual pull) **and reconcile** existing rows; **never
  remove** a row (a feature that drops out of the PO+PI query is left in place).
- Q: Which columns does a run refresh from Jira (all else preserved)? → A: **Exactly what the manual reconcile
  refreshes** — **Priority, Point Estimate, Dependency, Risks** (from Jira's priority field, estimate field, and
  dependency/risk issue-links), migrating any prior manual dependency/risk text into **Notes**. **Feature title** is
  preserved on existing rows (only newly-appended rows get Jira's `KEY - summary`); **Carry-over, Committed**, and the
  page's **Capacity snapshot / commitment boundary / grouping lines / confidence votes** are preserved untouched.
  *(Corrected during `/speckit-plan`: the PI Review saved table has no Status or Target-date column — status is a live
  picker and dates are pills + a separate Jira-write action — so those are not saved-table columns. The refreshed set
  is therefore priority/estimate/dependency/risks, i.e. a faithful port of `reconcilePiReviewRowsWithJira`.)*
- Q: What happens on a Confluence version conflict during the write? → A: **Retry once** (re-fetch the page, re-apply
  the refresh onto the newest version, write again); if it still conflicts, report the conflict and leave the page
  untouched — never clobber a newer edit.

## Why this shape (product rationale)

- **A PI Review page is a living dashboard.** During a PI, feature statuses, estimates, and target dates change in
  Jira constantly. Manual save means the page is only as fresh as the last person to remember to sync it.
- **The refresh is mechanical and safe to automate.** The Jira-owned columns are derived, not authored — re-deriving
  them on a timer is low-risk, whereas the human-curated columns must never be touched by a machine.
- **It belongs with the other schedulers.** NodeToolbox already runs server-side schedulers managed from the Admin
  Hub; a PI Review refresh is the same operational shape (per-team time, run-now, status), so it should live there.
- **Keep the human escape hatch.** For an urgent update mid-day, the manual Save button must stay — the schedule is a
  convenience, not a replacement.
- **Reuse the credentials that already work.** The server already authenticates to Confluence with configured
  credentials (the same path the manual save uses through the proxy); the scheduler reuses them with no new account.

## Scope Boundary (explicit non-goals)

- **Out of scope — changing the manual save.** The client-side "Save to Confluence" button and its behavior are
  untouched. This feature is purely additive.
- **Out of scope — overwriting human-curated content.** The scheduled save MUST never modify the manual columns, the
  Team Capacity snapshot, commitment boundary, custom grouping lines, or confidence votes. It only refreshes the
  Jira-owned data.
- **Out of scope — recomputing capacity.** Capacity originates from the Capacity tab (human input); the scheduler
  preserves the page's existing capacity snapshot as-is and never recalculates or clears it.
- **Out of scope — new Jira/Confluence write mechanics.** The scheduler reuses the established GET-page →
  PUT-with-incremented-version pattern and the same Feature-pull/reconcile logic the manual flow uses.
- **Out of scope — creating PI Review pages.** The scheduler only updates pages that already exist and are
  configured; it never creates a new page.
- **Out of scope — multi-user concurrency/merge.** If a human edits the same page between scheduled runs, standard
  optimistic-concurrency (version check) applies; no cross-editor merge is introduced.
- **Out of scope — notifications/webhooks.** Delivery is the page write itself; no email/Teams/webhook notification
  is part of this feature (may be a later addition).

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**US1 — Set-and-forget freshness (the core value).** As a delivery lead, I configure a daily time for my team's PI
Review page, and every day at that time the page's feature list, statuses, estimates, and target dates refresh from
Jira automatically — without me opening the app.

**US2 — My manual work is safe.** As someone who hand-curates priority, carry-over, notes, risks, dependency,
committed flags, capacity, grouping, and confidence on the page, I trust that the scheduled refresh never overwrites
any of that — only the Jira-derived data updates.

**US3 — Urgent update still available.** As an operator, when something changes and I can't wait for the schedule, I
open the PI Review tab and click **Save to Confluence** exactly as before.

**US4 — Per-team control.** As someone who covers multiple teams, each team has its own enable toggle and schedule
time; enabling one team's schedule does not affect another's.

**US5 — Run now + visibility.** As an operator, I can trigger an immediate scheduled-style refresh from the Admin Hub
("Run now") and see whether the last run for each team **succeeded or failed, and when**.

### Acceptance scenarios

1. **Given** a team with a scheduled PI Review page enabled at `HH:MM`, **when** that local time arrives and no
   browser is open, **then** the configured page is refreshed from Jira (features re-pulled, Jira columns
   reconciled) and saved to Confluence.
2. **Given** a page with human-curated manual columns, a capacity snapshot, a commitment boundary, custom grouping
   lines, and confidence votes, **when** a scheduled refresh runs, **then** all of those are byte-for-byte preserved
   and only the Jira-owned columns change.
3. **Given** a team is not enabled (toggle off), **when** its scheduled time arrives, **then** nothing runs for that
   team.
4. **Given** a scheduled run already fired for a team today, **when** the tick re-checks within the same day, **then**
   it does not run again (once-per-day), and **given** the server was down at the scheduled time and starts later the
   same day, **then** it still runs once (catch-up).
5. **Given** the Admin Hub PI Review scheduler panel, **when** I click **Run now** for a team, **then** the refresh
   executes immediately and the result (success/failure + timestamp) is shown.
6. **Given** Jira returns no Features for the configured PO + PI, **when** a scheduled run executes, **then** the page
   is left unchanged (no rows removed) and the run reports "no features found" rather than emptying the table.
7. **Given** the page was edited by a human between runs (version advanced), **when** the scheduled save conflicts on
   write, **then** it retries once against the newest version; if it still conflicts it reports a conflict and leaves
   the page untouched rather than overwriting a newer edit.
8. **Given** the manual Save button, **when** used at any time, **then** it behaves exactly as before the feature was
   added.

### Edge cases

- **PO not configured for a team** in the scheduler config: the team's run is skipped with a clear "no Product Owner
  configured" status rather than pulling every Feature in the PI.
- **PI Review page URL missing or invalid**: the run fails for that page with a descriptive status; other teams/pages
  are unaffected.
- **Confluence credentials not available on the server**: the run fails with a clear "Confluence not configured"
  status (same condition the proxy reports), and does not silently no-op.
- **Feature pull succeeds but reconciliation partially fails** (some issues unreadable): the run applies what it can
  and reports a partial result; it never writes a half-broken table.
- **Page has no recognizable PI Review table** (page was restructured/hand-broken): the run aborts for that page with
  a descriptive status rather than appending a malformed table.
- **Scheduled time equals a run already in progress** (long previous run): a team's runs never overlap; a still-running
  team is not started again.
- **Duplicate Team Capacity blocks already on the page** (legacy): a scheduled save collapses them to one, matching
  the manual save's de-duplication behavior.

## Functional Requirements

### Area 1 — Scheduling & lifecycle

- **FR-001**: The system MUST run a server-side scheduler that, per enabled team, performs a PI Review page refresh at
  a configured local `HH:MM`, mirroring the existing scheduler mechanism (periodic tick, once-per-day fire, catch-up
  after a late start).
- **FR-002**: Each team MUST have an independent **enable toggle** and **schedule time**; a disabled team never runs,
  and one team's settings never affect another's.
- **FR-003**: A team's scheduled run MUST fire at most **once per day** and MUST **catch up** (run once) if the server
  was not running at the exact scheduled minute but starts later the same day.
- **FR-004**: Runs for a single team MUST NOT overlap; if a prior run is still in progress, the next tick MUST NOT
  start a second concurrent run for that team.
- **FR-005**: Scheduler configuration MUST be read **live** so enabling/disabling or changing a time takes effect
  without a server restart, consistent with the other schedulers.

### Area 2 — The refresh (what a run does)

- **FR-006**: A scheduled run MUST re-derive the team's Features using the same query shape as the manual pull —
  `issuetype = Feature AND assignee = <Product Owner> AND cf[<PI field>] = <PI name>`, with **no project clause** —
  using the per-team configured Product Owner, PI field, and PI name.
- **FR-007**: A run MUST **(a) append** Features returned by the query that are not already on the page — de-duplicated
  by feature key, exactly as the manual pull does — and **(b) reconcile** the Jira-owned columns for existing rows by
  applying the **same reconciliation the manual save uses** (`reconcilePiReviewRowsWithJira`). A run MUST **NOT
  remove** rows: a feature that no longer matches the PO+PI query is left in place. The **Jira-owned columns** are
  **Priority, Point Estimate, Dependency, and Risks** (from Jira's priority field, estimate field, and dependency/risk
  issue-links), with any prior manual dependency/risk text migrated into **Notes** — identical to manual behavior. The
  **feature title cell is preserved** on existing rows; only newly-appended rows carry Jira's `KEY - summary`.
- **FR-008**: A run MUST **preserve** unchanged everything outside the reconciled Jira-owned columns: **Carry-over**,
  the **Feature title text on existing rows**, **Committed**, the **Team Capacity snapshot**, the **commitment
  boundary**, **custom grouping lines**, and the **confidence votes** table. (Priority, Point Estimate, Dependency,
  Risks, and Notes are Jira-reconciled per FR-007 — matching the manual save — and are therefore not "preserved".)
- **FR-009**: A run MUST use optimistic concurrency (fetch the page's current version and body, write with the next
  version) so it does not overwrite a newer human edit. On a version conflict the run MUST **retry once** — re-fetch
  the page, re-apply the refresh onto the newest version, and write again; if it **still** conflicts, it MUST report
  the conflict and leave the page untouched. A newer human edit is never clobbered.
- **FR-010**: If the Feature query returns **no** Features, a run MUST leave the page's rows unchanged (it MUST NOT
  empty the table) and report "no features found".
- **FR-011**: A run MUST NOT create a page; it only updates a configured, existing PI Review page. A missing/invalid
  page reference MUST fail that page's run with a descriptive status.
- **FR-012**: A scheduled save MUST collapse any duplicate Team Capacity blocks to a single canonical section, exactly
  as the manual save does.

### Area 3 — Authentication & configuration inputs

- **FR-013**: The scheduler MUST authenticate to Jira and Confluence using the **server's already-configured
  credentials** (the same credentials the manual save uses via the proxy). No new/separate service account is
  required, and no credential is entered as part of this feature's per-team config.
- **FR-014**: If the server has no usable Confluence credentials at run time, the run MUST fail with a clear
  "Confluence not configured" status rather than silently succeeding or no-op'ing.
- **FR-015**: Because the server cannot read the browser's local settings, the per-team scheduler config MUST capture
  everything a run needs that the client currently sources from local storage: the **PI Review page reference(s)**
  (per PI), the **Product Owner** assignee value, the **PI field identifier**, and the **PI name** to match.
- **FR-016**: A team with a **missing Product Owner** in its scheduler config MUST be skipped with a clear status, not
  run with an unscoped (PI-only) query.

### Area 4 — Admin Hub management

- **FR-017**: The schedule MUST be configured from a **new Admin Hub panel**, consistent in look and behavior with the
  existing scheduler panels (per-team rows, enable toggle, schedule time, save).
- **FR-018**: The panel MUST provide a **Run now** action per team that performs the same refresh immediately and
  returns the outcome.
- **FR-019**: The panel MUST surface, per team, the **last run outcome** (success/failure), **when** it ran, and a
  human-readable reason on failure (e.g. no PO configured, page invalid, Confluence not configured, version conflict,
  no features found). This last-run summary MUST **persist** (in the scheduler state store) so it survives a server
  restart rather than being lost from memory.
- **FR-020**: Saving the panel config MUST persist it in the same configuration store the other schedulers use, so it
  survives restarts.

### Area 5 — Coexistence with the manual flow

- **FR-021**: The client-side manual "Save to Confluence" button MUST remain available and behave exactly as before;
  this feature MUST NOT alter the manual save path.
- **FR-022**: The scheduled refresh and a manual save MUST be safe to use on the same page (governed by the
  optimistic-concurrency version check in FR-009); neither corrupts the other's result.

## Key Entities

- **PiReviewSchedule** — the per-team scheduler configuration: an enable flag, a schedule time (`HH:MM` local), and
  the inputs a server run needs (see PiReviewScheduledPage). Persisted alongside the other schedulers' config.
- **PiReviewScheduledPage** — one configured PI Review page to keep fresh: the Confluence page reference/URL, the PI
  name to match, the PI field identifier, and the Product Owner assignee value used to scope the Feature pull. (A
  team may have more than one, one per PI.)
- **PiReviewRunResult** — the outcome of a run (scheduled or Run-now): status (success / skipped / failed / no-op),
  timestamp, the number of features/rows refreshed, and a human-readable message on non-success.
- **PiReviewPageContent** — the parsed page: the Jira-owned columns (refreshed) versus the human-curated content
  (preserved) — the boundary the run must respect.

## Success Criteria

- **SC-001**: With a team enabled at a set time and no browser open, its configured PI Review page is refreshed from
  Jira at that time **on at least one run**, verifiable by an updated status/estimate/date appearing on the page.
- **SC-002**: Across a scheduled refresh, **100%** of human-curated content (manual columns, capacity snapshot,
  commitment boundary, grouping lines, confidence votes) is preserved unchanged — zero manual data loss.
- **SC-003**: A run that finds no Features leaves the existing rows intact (the table is **never** emptied by a
  scheduled run).
- **SC-004**: Enabling/adjusting one team's schedule has **no** effect on any other team's schedule or page.
- **SC-005**: An operator can trigger a **Run now** and see a clear success/failure result with a timestamp within the
  Admin Hub, without opening the PI Review tab.
- **SC-006**: A scheduled run and a manual save on the same page never corrupt each other — a stale-version write is
  reported as a conflict rather than overwriting a newer edit.
- **SC-007**: The manual "Save to Confluence" button works identically before and after this feature (no regression).
- **SC-008**: A misconfiguration (no PO, invalid page, no Confluence credentials) produces a clear, actionable status
  in the Admin Hub rather than a silent failure or an emptied/corrupted page.

## Assumptions

- The server process that runs the schedulers already holds working Confluence credentials at run time (the same
  configuration the manual save's proxy uses). Confirmed for the current environment; FR-014 covers the case where it
  does not.
- The Product Owner assignee value that scopes the Feature pull is stable per team/PI and can be captured once in the
  scheduler config (it is the same value the roster supplies to the manual pull).
- Each PI Review page already exists and contains a recognizable PI Review table (created via the app's normal flow)
  before it is added to the schedule; the scheduler refreshes, it does not scaffold.
- "Jira-owned columns" are exactly the fields `reconcilePiReviewRowsWithJira` already refreshes on every manual
  load/save — **Priority, Point Estimate, Dependency, Risks**, plus the dependency/risk→Notes migration.
  "Human-curated" is everything else (carry-over, feature title on existing rows, committed) plus the
  capacity/commitment-boundary/grouping/confidence page regions. Status and target dates are **not** saved-table
  columns (status is a live picker; dates are pills + a separate Jira-write action), so they are out of scope for the
  reconcile.
- A team may schedule more than one PI Review page (one per active PI); each page is refreshed independently under the
  team's single schedule time.
- Local server time is the reference for the `HH:MM` schedule, consistent with the other schedulers.

## Dependencies

- The manual PI Review save/reconcile logic and the PO+PI Feature-pull logic (their pure, reusable parts) must be
  runnable server-side. The page parse/write engine is currently browser-DOM-bound and will need a server-side DOM
  host or an injected DOM — a planning/implementation concern (see `/speckit-plan`), not a scope change.
- The existing scheduler infrastructure (periodic tick, fired-state persistence, live config) and the server-side
  Jira/Confluence request helpers.
- The existing Admin Hub scheduler panel pattern and its config persistence.
