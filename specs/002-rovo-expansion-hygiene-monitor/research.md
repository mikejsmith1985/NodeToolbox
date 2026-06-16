# Phase 0 Research: Rovo Expansion + Proactive Hygiene Monitor

The spec's Clarifications section already resolved the open product questions (Rovo
never writes Jira; notify via Jira comment + Teams digest; config in Admin Hub only).
The remaining unknowns are technical-fit questions about reusing existing machinery.
Each is resolved below.

## R1 — Running hygiene rules server-side

- **Decision**: Extract the pure check functions from
  `client/src/views/Hygiene/checks/hygieneChecks.ts` into a shared, dependency-free
  module (`src/services/hygieneRules.js`) that both the server scheduler and the
  client Hygiene view evaluate against. The functions already have the right shape —
  `(issue, fieldConfig) → HygieneFlag | null` — and take field IDs from
  Admin-Hub-managed `HygieneFieldConfig`, so they carry no UI dependency.
- **Rationale**: The monitor is a headless scheduler; it cannot reach the client to
  evaluate rules. The Hygiene view and the monitor must flag identical violations
  (SC numbering depends on "the same rules surfaced in the existing Hygiene view").
  One shared rule source guarantees lockstep.
- **Alternatives considered**:
  - *Re-implement rules in the scheduler* — rejected: guaranteed drift from the
    Hygiene view; violates Framework-First (rebuilding existing logic).
  - *Call a client-rendered evaluation* — impossible from a server scheduler.
  - *Move rules entirely server-side and have the client fetch results* — larger
    refactor than needed for this feature; deferred. The extraction keeps the client
    importing the same logic with no behaviour change.

## R2 — Dispatching Rovo from a server scheduler

- **Decision**: Schedulers call the existing `rovoExchange` service directly
  (`dispatchPrompt(configuration, { correlationId, prompt })` then poll
  `fetchResult(configuration, correlationId)`), wrapped in a new
  `src/services/rovoEnrichment.js` helper that adds: a generated `correlationId`, a
  bounded poll with timeout, and a **non-blocking fallback** (on timeout/empty/error
  it returns `null` and the caller proceeds without the Rovo block).
- **Rationale**: `dispatchPrompt`/`fetchResult` are already server-side module
  exports proven in the CHG Planning flow and now hardened (envelope parsing, view
  fallback, append-block isolation). Reusing them satisfies FR-006 and Framework-First.
- **Alternatives considered**: A second dispatch implementation for schedulers —
  rejected (duplication). Calling the HTTP `/api/rovo/*` routes from within the
  server — rejected (needless self-HTTP; the service layer is the right seam).

## R3 — Non-blocking enrichment & timeout budget

- **Decision**: The enrichment helper uses a configurable poll window (default ≈
  the existing client poll budget, ~3 min max but capped lower for schedulers, e.g.
  60s) and **never throws into the scheduler's delivery path**. On any failure it
  logs `[Rovo] enrichment skipped (<reason>)` and returns `null`; the scheduler
  publishes the report/briefing unchanged.
- **Rationale**: FR-001/FR-002/SC-008 require 100% of briefings/reports to publish
  on schedule even when Rovo is down. SC-001 caps added latency at 30s for the happy
  path; the scheduler enriches *before* the Confluence write, so a slow Rovo only
  delays that single run, never blocks other schedulers (each is its own interval).
- **Alternatives considered**: Enrich asynchronously after publishing and edit the
  page later — rejected (two Confluence writes, visible fl/flicker, more complex
  failure modes). Block until Rovo answers — rejected (violates SC-008).

## R4 — Hygiene digest delivery (by email, not a direct Teams webhook)

- **Decision (clarified 2026-06-16)**: The digest is delivered **by email**, reusing the
  same trigger-webhook → Atlassian Automation → email mechanism the standup/scope/feature
  reports already use. NodeToolbox fires a trigger webhook (per-team `digestTriggerUrl`/
  `digestTriggerSecret`, with the digest as the payload) to an Atlassian Automation rule
  that composes the email; the recipient's inbox rule forwards it into Teams, where a
  Teams automation handles it.
- **Rationale**: The user cannot post directly to a Teams endpoint from this environment;
  the established path to "an email that reaches Teams" is the existing Automation-driven
  email used by the other reports. Reusing it is Framework-First (no new transport) and
  keeps **all** outbound calls on Atlassian hosts.
- **Consequences**:
  - No Teams payload format to choose (no `MessageCard` vs Adaptive Card decision).
  - **No allow-list exception** — the destination is an Atlassian Automation webhook,
    already covered by the existing allow-list. (The previously-planned task to add a
    Teams-host exception is removed.)
  - The digest builder remains a pure function returning the webhook payload object
    (scan stats + trend), unit-tested independently of transport.

## R5 — Scheduler lifecycle & timing

- **Decision**: Add `src/services/hygieneMonitorScheduler.js` mirroring
  `scopeChangeScheduler.js`/`featureChangeScheduler.js`: a single `setInterval`
  (60s) calling `checkAndFireScheduledReports(configuration)`, which checks the
  configured time/weekday pattern and a "already ran today" guard before launching
  a scan. "Scan Now" calls the same scan function directly without touching the
  daily-run guard (per Assumptions).
- **Rationale**: Identical lifecycle to the three existing schedulers (start on
  server boot, single interval, business-day aware). Framework-First; predictable.
- **Alternatives considered**: cron library — rejected (the 60s-tick pattern is the
  established project convention and avoids a new dependency).

## R6 — Duplicate-comment suppression (FR-016 / SC-006)

- **Decision**: Within a single scan cycle, track which `(issueKey, violationId)`
  pairs have been commented in an in-memory set so the same violation never gets two
  comments in one run. Across runs, a comment is re-posted only if the violation is
  still present and a new cycle has begun (the scan is idempotent per-cycle, not
  per-lifetime), keeping the rule "exactly one comment per violation per cycle."
- **Rationale**: Matches the precise wording of FR-016/SC-006 ("in the current scan
  cycle"). Avoids needing a persistent comment-ledger; the cycle-scoped set is
  sufficient and simple.
- **Alternatives considered**: Persisting a full comment ledger to detect lifetime
  duplicates — rejected as out of scope (the spec scopes dedup to the cycle).
  Reading existing Jira comments to detect prior bot comments — heavier; deferred
  unless real-world double-posting is observed.

## R7 — Applying Jira fixes & comments (FR-010/FR-011)

- **Decision**: Use Toolbox's existing Jira proxy for field updates (PUT issue) and
  comment creation (POST comment). A fix is "resolved" only on a 2xx Jira response
  (SC-005); a rejected field update (e.g. field not on screen) re-classifies the
  violation as unfixable for that run and falls through to the comment path (edge
  case in spec).
- **Rationale**: Honors "Toolbox owns all Jira interactions." Reuses the proven
  proxy; no new Jira client.
- **Alternatives considered**: Letting Rovo write Jira — explicitly out of scope.

## R8 — Config & trend persistence

- **Decision**: Add a `hygieneMonitor` section to the config (per-team: project
  keys, schedule time, weekday pattern, Teams webhook URL/secret, field mappings)
  and a small bounded `hygieneScanHistory` (last N scan summaries per team for the
  trend indicator). Persisted via `loader.js` like `rovoAutomation`, with the Teams
  secret base64-obfuscated. Survives upgrades in `%APPDATA%`.
- **Rationale**: Mirrors the just-shipped `rovoAutomation` persistence fix; Admin
  Hub is the sole editor (FR-014). Trend (SC-009) needs only the previous scan's
  counts, so history is tiny.
- **Alternatives considered**: A separate file/db — rejected (the single config file
  is the established pattern and already upgrade-safe).

## Resolved unknowns summary

All Technical Context items are known from the existing codebase; no
`NEEDS CLARIFICATION` remain. The one tracked complexity (server-side hygiene rule
reuse) is addressed by R1 as an extraction of existing logic.
