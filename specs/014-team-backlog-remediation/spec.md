# Feature Specification: Per-Team Persistent Backlog Remediation

**Feature short name**: `team-backlog-remediation`
**Created**: 2026-07-13
**Status**: Draft — clarifications resolved (FR-013 = status-category change or reassign-into-team); ready for `/speckit-plan`
**Builds on**: feature 016's Aging AI cleanup triage (verdicts + bulk close/transition) and the shared
`storyPointsField` reader; reuses feature 012's per-team persistence pattern
(`tbxReallocationDetails:<teamProfileId>:<scope>`) and the roster/overlay per-team stores.

## Summary

The Aging report's AI cleanup triage answers "what open work can we cancel, review, or keep?" and can already
enact those decisions in Jira. But it lives in the **Reports Hub** as a stateless, run-it-again analysis: you
type a scope JQL, run, ingest an AI reply, act, and the result evaporates. That shape fights the way backlog
cleanup actually happens — **ongoing, per team, a little at a time**, with more than one team cleaning up in
parallel.

This feature relocates the **actionable triage** into a **team-scoped, persistent Backlog Remediation panel on
the Team Dashboard**, so every team keeps its own standing remediation queue that survives reloads and team
switches. The point is durability and parallelism: Team A and Team B each have their own queue, their own
already-handled history, and can resume where they left off.

The **Aging metrics report** (counts, average/median age, day-range buckets) is analytics and **stays in the
Reports Hub** — only the actionable triage moves.

## Why this shape (product rationale)

- **Remediation is a standing chore, not a one-shot report.** A bloated backlog is worked down over weeks. State
  must persist so progress accrues instead of resetting every run.
- **It belongs where the team already works.** The Team Dashboard is already scoped to a team profile and is where
  roster, sprint, and Feature Review remediation live. Backlog cleanup is the same operational muscle.
- **Multiple teams, in parallel.** Each team needs its own queue and its own "already dealt with" memory, keyed to
  the team profile — exactly the per-team persistence pattern features 012 and the roster/overlay already use.
- **Don't resurface handled work.** Once a person cancels, keeps, dismisses, or snoozes an item, a later refresh
  must not show it again as if untouched — otherwise the queue never feels like it is shrinking.
- **Scope should follow the team, not be retyped.** Deriving scope from the active team profile removes the manual
  JQL step for the common case while still allowing an override for ad-hoc sweeps.

## Scope Boundary (explicit non-goals)

- **Out of scope**: Changing the AI round-trip itself. The copy-prompt → paste-reply → strict-JSON-ingest flow,
  the verdict taxonomy (cancel-safe / review / must-remain), and the aggressive triage posture are reused as-is.
- **Out of scope**: Moving or changing the **Aging metrics** report. It remains in the Reports Hub, unchanged.
- **Out of scope**: New Jira write mechanics. Bulk close/transition reuses the proven Feature Review write helpers;
  no new write paths are introduced.
- **Out of scope**: A server-side or cross-device store. Persistence is local to the app profile, consistent with
  the existing per-team stores (roster, overlay, reallocation details).
- **Out of scope**: Automatic/scheduled remediation. A human always drives; nothing is canceled without an explicit
  commit, exactly as today.
- **Out of scope**: Multi-user concurrency/merge. One operator per app profile is assumed, as with the other
  per-team stores.

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**US1 — Resume a team's remediation queue (the core value).** As a delivery lead, I open the Team Dashboard for my
team and see my Backlog Remediation panel already populated with the verdicts from my last session and my
per-item decisions intact, so I can continue triaging without re-running anything.

**US2 — Two teams in parallel.** As someone who covers two teams, I switch the active team profile and the panel
swaps to that team's own queue and history — no bleed between teams.

**US3 — Scope follows the team.** As an operator, the panel scopes to my active team profile automatically
(project/board/roster), and I can optionally override with a JQL for an ad-hoc sweep, without that override
corrupting the team's default queue.

**US4 — Handled items stay handled.** As an operator, after I cancel, keep, dismiss, or snooze an item, refreshing
the backlog does not resurface those items as untouched; snoozed items reappear only after their snooze elapses.

**US5 — Enact cleanup, safely.** As an operator, I can bulk-close a cancel-safe feature group (preview → opt-out →
commit) exactly as in today's triage, and the committed outcomes are reflected in my persisted queue.

### Acceptance scenarios

1. **Given** a team with a previously ingested triage, **when** I reload the app and open the panel for that team,
   **then** the prior verdicts and my per-item statuses are shown without re-running the AI round-trip.
2. **Given** two team profiles each with their own remediation state, **when** I switch between them, **then** each
   shows only its own items and decisions, and acting in one never mutates the other.
3. **Given** no JQL override, **when** I refresh the backlog, **then** the scope is derived from the active team
   profile; **given** a JQL override, **when** I refresh, **then** the override is used and is remembered for that
   team only.
4. **Given** an item I marked "dismissed" (or "canceled"/"kept"), **when** I refresh the backlog, **then** it is not
   presented again as a new/untouched item.
5. **Given** an item I "snoozed" until a future date, **when** I refresh before that date, **then** it stays hidden;
   **when** I refresh after that date, **then** it returns to the actionable queue.
6. **Given** a cancel-safe feature group, **when** I commit a bulk close, **then** each item transitions individually
   (each showing its own result) and the persisted queue records those items as canceled.
7. **Given** the Reports Hub, **when** I open the Aging tab, **then** the metrics report is unchanged and the
   actionable triage no longer appears there (or points to its new home).
8. **Given** AI Assist is locked, **when** I open the Team Dashboard, **then** the remediation panel is hidden/locked
   exactly as the triage is today, and the rest of the dashboard is unaffected.

### Edge cases

- **Backlog item leaves scope** (already closed in Jira, reassigned out of team): it should drop from the actionable
  queue on refresh without corrupting its recorded history.
- **A previously handled item legitimately reopens/changes**: a material change — status-category change or
  reassignment into the team — returns it to `pending`; cosmetic edits do not (FR-013).
- **Stored state for a deleted team profile**: orphaned queues should not surface under another team.
- **Corrupt/oversized persisted state**: the panel degrades gracefully (empty queue) rather than erroring, matching
  the tolerant-parse behavior of the other per-team stores.
- **Team profile with no derivable scope** (no project/board/roster configured): the panel prompts for a JQL
  override instead of running an empty query.

## Functional Requirements

### Area 1 — Placement & gating

- **FR-001**: The actionable Backlog Remediation triage MUST be presented as a panel on the **Team Dashboard**,
  scoped to the active team profile.
- **FR-002**: The panel MUST be gated by the existing AI Assist lock exactly as the current triage is (hidden/locked
  when AI is locked), and MUST NOT affect the rest of the dashboard when locked.
- **FR-003**: The **Aging metrics** report MUST remain in the Reports Hub, unchanged. The actionable triage MUST no
  longer be duplicated in the Reports Hub (it either moves entirely or the Reports Hub links to the new home).

### Area 2 — Team scoping

- **FR-004**: By default the panel MUST derive its backlog scope from the **active team profile** (its
  project/board/roster), reusing existing team-profile scoping — not a hand-typed JQL.
- **FR-005**: The operator MUST be able to provide an optional **JQL override** for an ad-hoc sweep; the override is
  remembered **per team** and does not alter other teams' scope.
- **FR-006**: When a team has no derivable scope, the panel MUST prompt for a JQL override rather than run an empty
  or global query.

### Area 3 — Persistence & remediation lifecycle

- **FR-007**: Ingested **verdicts** MUST persist **per team** under a scoped storage key (mirroring the
  `tbxReallocationDetails:<teamProfileId>:<scope>` pattern), surviving reloads and team switches.
- **FR-008**: Each backlog item MUST carry a **remediation status**: at minimum `canceled`, `kept`, `dismissed`,
  `snoozed`, and an initial `pending` (awaiting a decision).
- **FR-009**: A `snoozed` item MUST be hidden from the actionable queue until its snooze date elapses, then return to
  `pending`.
- **FR-010**: Items with a terminal decision (`canceled`, `kept`, `dismissed`) MUST NOT resurface as new/untouched on
  refresh; they remain queryable as history.
- **FR-011**: Switching team profiles MUST load only that team's queue and history; acting on one team's queue MUST
  NOT mutate another's.
- **FR-012**: Persisted state MUST be read tolerantly — malformed or missing state yields an empty queue, never an
  error (consistent with the other per-team stores).
- **FR-013**: The feature MUST honor a **re-entry rule** for handled items: an item returns to `pending` only on a
  **material change** — defined as either (a) its **status category changed** (e.g. reopened, moved back from a Done
  category) or (b) it was **reassigned into the team**. Cosmetic edits (label, rank, description, `updated`-only
  bumps) MUST NOT resurface a handled item. This is captured by a fingerprint of the item's status category and
  assignee/team membership recorded at decision time (see Key Entities → RemediationItem).

### Area 4 — Enactment (reused)

- **FR-014**: Bulk close/transition of a cancel-safe feature group MUST reuse the existing preview → opt-out →
  commit flow and the proven Feature Review write helpers; no new write path is introduced.
- **FR-015**: On commit, each item MUST transition individually with its own success/skip/fail result, and the
  persisted queue MUST record committed items as `canceled` (or the corresponding decision).
- **FR-016**: Story points shown in the triage MUST use the shared, instance-correct `storyPointsField` reader
  (configured field + dropdown unwrap), not a hard-coded field id.

### Area 5 — Refresh & data fidelity

- **FR-017**: Refreshing the backlog MUST re-query the current scope, reconcile against persisted state (drop
  out-of-scope items, keep decisions), and surface only actionable (`pending`, or elapsed-snooze) items by default.
- **FR-018**: The triage prompt/signals MUST remain those of feature 016 (assignee, time-in-status, story points,
  description/AC presence, priority, parent status) so verdict quality is preserved after the move.

## Key Entities

- **RemediationQueue** — a team's persisted set of triaged items for a given scope. Keyed by team profile (and
  scope). Holds the ingested verdicts plus per-item remediation state and a last-refreshed marker.
- **RemediationItem** — one backlog issue in the queue: its Jira key, the AI verdict (cancel-safe/review/
  must-remain) and rationale, the triage signals it was judged on, a **remediation status** (pending/canceled/kept/
  dismissed/snoozed), an optional snooze-until date, and a fingerprint of the underlying issue used to detect
  material change (FR-013).
- **TeamScope** — the resolved backlog scope for the active team: derived from the team profile by default, or an
  operator-supplied JQL override, remembered per team.

## Success Criteria

- **SC-001**: A team's remediation queue and per-item decisions persist across an app reload and a team switch —
  reopening the panel shows the prior state with **zero** re-runs required.
- **SC-002**: Two teams can maintain independent queues with **no** cross-team bleed (acting in one never changes the
  other), verifiable by switching profiles.
- **SC-003**: After a decision (cancel/keep/dismiss/snooze), a backlog refresh does **not** resurface that item as
  untouched; snoozed items reappear only after the snooze elapses.
- **SC-004**: For the common case, an operator reaches an actionable queue **without typing a JQL** (scope derived
  from the team profile).
- **SC-005**: Bulk close outcomes match today's triage behavior (per-item results; nothing written until commit) and
  are reflected in the persisted queue.
- **SC-006**: The Aging metrics report in the Reports Hub is unchanged (same numbers, same queries) after the move.
- **SC-007**: Story points and the other triage signals are populated (non-blank) for issues that have them, so the
  verdict quality matches feature 016's post-fix behavior.

## Assumptions

- Persistence is **local to the app profile** (browser/local storage), consistent with roster/overlay/reallocation
  stores; no server or cross-device sync is expected.
- **One operator per app profile**; no concurrent-editing/merge semantics are required.
- The **team profile already encodes** enough to derive a default scope (project/board and/or roster). Where it does
  not, the JQL override covers the gap (FR-006).
- The AI copy-prompt/paste-reply round-trip and the aggressive triage posture from feature 016 are the intended
  behavior and are carried over verbatim.
- "Dismissed" means "not cleanup-worthy right now, hide it"; "kept" means "explicitly decided to keep"; both are
  terminal until a material change (FR-013) — the exact distinction may be refined in `/speckit-clarify`.

## Dependencies

- **Feature 016** — the Aging AI cleanup triage (prompt build, strict JSON ingest, verdict taxonomy, bulk
  close/transition) and the actionable table it relocates.
- **Feature 012 + roster/overlay stores** — the per-team, per-scope persistence pattern
  (`tbxReallocationDetails:<teamProfileId>:<scope>`, `deriveScopeKey`) and team-profile scoping this feature reuses.
- **Shared `storyPointsField` reader** — instance-correct story points (configured field + dropdown unwrap).
- **Feature Review write helpers** — the proven Jira transition path reused for bulk close.
- **AI Assist gate** — the existing unlock mechanism that hides/locks the panel.
