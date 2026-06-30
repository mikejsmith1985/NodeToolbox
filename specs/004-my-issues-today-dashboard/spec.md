# Feature Specification: My Issues — "Today" Scrum Master Dashboard

**Feature short name**: `my-issues-today-dashboard`
**Created**: 2026-06-30
**Status**: Draft — ready for `/speckit-clarify` or `/speckit-plan`
**Feature directory**: `specs/004-my-issues-today-dashboard/`

## Summary

The "My Issues" view is the Scrum Master's primary workspace, but the data needed
to run a clean day is spread across separate tabs (Report, Mentions, Hygiene) and
sibling views (Sprint Dashboard, DSU Board). Today a Scrum Master must remember to
open each one in turn and re-derive "what still needs my attention" every morning.

This feature adds a **"Today" dashboard as the landing tab of My Issues**: a single,
deterministic, at-a-glance answer to the question *"As a Scrum Master, what do I need
to do today to keep Jira clean and issues moving?"* It is a **daily checklist** of
attention items, each backed by a live count computed from data the product already
pulls, and each linking directly to the existing surface where that work is done.
Checking every item off means the day's Jira-hygiene duties are complete.

The dashboard is a **mashup, not a new data source**: every count reuses an existing
fetch and an existing rule (the Mentions scan, the Hygiene checks, the self-assigned
issue query, the team roster and sprint scope from the Sprint Dashboard). It performs
no analysis the product cannot already do.

Crucially, the dashboard is **fully deterministic** — it depends on no AI Assist
capability. It is the bridge the Scrum Master uses to maintain discipline *until*
direct AI assistance returns to Toolbox; when that happens, AI enrichment can be
layered on later as an additive, non-blocking enhancement (out of scope here).

## Scope Boundary (explicit non-goals)

- **Out of scope**: Any AI Assist dependency. Every count, threshold, and ordering on
  the dashboard is computed by deterministic rules already present in the codebase.
  No dashboard element requires the Ctrl+Alt+Z AI-Assist gate to function.
- **Out of scope**: New data fetches or new hygiene rules. The dashboard reuses the
  existing Mentions scan, Hygiene checks, self-assigned issue query, and Sprint
  Dashboard team scope. If a needed signal does not already exist, it is deferred.
- **Out of scope**: Rebuilding the detailed work surfaces. The dashboard summarizes
  and links; the actual list-level work (reading a mention thread, transitioning a
  blocked issue, fixing a hygiene flag) continues to happen on the existing tab/view
  the item links to. The dashboard itself does not mutate Jira (links-only; FR-017).
- **Out of scope**: Configuring team rosters, board/sprint selection, or hygiene
  field mappings. Those remain owned by their current views (Sprint Dashboard,
  Admin Hub); the dashboard consumes the already-saved selection.
- **Out of scope**: Multi-user / manager roll-up dashboards. This is a personal,
  single-Scrum-Master daily view scoped to "me" and "my team."
- **Out of scope**: Notifications, email, or scheduled delivery of the checklist.
  The dashboard is viewed in-app, on demand.

## Clarifications

### Session 2026-06-30

- Q: Must the dashboard work without AI? → A: Yes. Fully deterministic; no AI Assist
  dependency. This is a hard constraint, not a preference.
- Q: Is this a new data source? → A: No. It is a read-side mashup of data already pulled
  into existing tabs/views, reusing their existing rules and selections.
- Q: Where does it live? → A: As the landing (default) tab of the My Issues view.
- Q: What bounds the "team" / in-scope issue set for the team-wide categories (blockers, team-stale, unassigned, commitment gaps, due/overdue, untriaged)? → A: The active sprint/board scope from the Sprint Dashboard selection — all issues in the selected sprint/board regardless of assignee (so unassigned work is included). The roster is used only for display/grouping, not to bound the set.
- Q: How should the dashboard populate its counts (load strategy)? → A: Independent per-card fetch on mount — each category loads and errors on its own and fills in as it resolves; already-loaded/cached results from previously-visited tabs are reused when available, otherwise the card fetches its own data.
- Q: Should counts auto-refresh while the dashboard is open? → A: No background polling. Counts refresh on mount, on an explicit Refresh action, and when the Scrum Master navigates back to the dashboard tab (manual + on-return only).
- Q: Is the sprint-flow snapshot (WIP distribution, sprint days remaining) actionable, and is WIP pile-up a check-off item? → A: Informational only. The snapshot provides situational context and is never a check-off item; there is no WIP-pileup alert/threshold in v1 (consistent with the no-new-rules constraint). WIP-limit alerting may be added later if a threshold source appears.

### Resolved decisions (2026-06-30)

- **Q1 — Inline actions vs links-only → LINKS-ONLY (v1)**: The dashboard is a faithful
  summary plus one-click navigation. It does not mutate Jira (no inline reply,
  comment, transition, or field edit) from the dashboard itself; all actions are taken
  on the destination surface the item links to. Inline actions are a deferred,
  additive future enhancement and are out of scope here. This matches the request
  that items be "a link that brings me directly to the space where we already present
  this data."

- **Q2 — Daily completion & reset → DAILY RESET + AUTO-COMPLETE + DONE CONFIRMATION**:
  Manual check-offs reset automatically on a business-day cadence (a fresh checklist
  each morning). An item whose count reaches zero auto-completes (shows done) without
  a manual check. When every item is complete, the dashboard shows an unambiguous
  "done for today" confirmation. A streak / multi-day cadence indicator is a deferred
  nice-to-have and is out of scope for v1.

## User Scenarios & Testing *(mandatory)*

### Primary user story

**As a Scrum Master starting my day**, I open My Issues and land on the "Today"
dashboard. In one view I see a prioritized checklist of everything that needs my
attention to keep Jira clean and work flowing: mentions awaiting my reply, blocked
issues to unstick, my own and my team's stale issues, sprint-commitment gaps, and
items due or overdue — each with a live count and a one-click link to the place I
handle it. I work down the list, items fall off (or grey out) as I clear them, and
when the checklist is clear I know my daily Jira hygiene is done without having to
remember and visit each tab myself.

### Secondary stories

**Staying out of the weeds**: As a Scrum Master, when a checklist category has zero
outstanding items, I want it visibly cleared (not a list I must scan) so my attention
goes only to what is genuinely open today.

**Trusting the numbers**: As a Scrum Master, I want each dashboard count to match
exactly what I would see if I opened the underlying tab/view, so the dashboard is a
faithful summary I can act on without double-checking.

**Surviving an AI outage**: As a Scrum Master, I want the dashboard to be fully
functional with no AI available, because maintaining daily hygiene cannot depend on
a capability that is currently offline.

### Acceptance scenarios

1. **Given** I open the My Issues view, **When** it loads, **Then** the "Today"
   dashboard is the active landing tab and its attention categories begin populating
   from the data already available, without requiring me to choose a source first.

2. **Given** I have unaddressed mentions within the configured business-day window,
   **When** the dashboard loads, **Then** the "Respond to mentions" item shows the
   exact outstanding count (matching the Mentions tab) and links to the Mentions tab.

3. **Given** one or more of my issues, or my team's issues, are in a blocked/impeded
   state, **When** the dashboard loads, **Then** the "Unblock issues" item shows the
   count and links to where blockers are presented (Sprint Dashboard blockers view).

4. **Given** I have in-progress issues assigned to me that have not been updated within
   the stale threshold, **When** the dashboard loads, **Then** the "My stale issues"
   item shows the count using the same staleness rule and threshold as the Hygiene /
   Sprint Dashboard, and links to that list.

5. **Given** my team (per the saved roster and sprint scope) has stale in-progress
   issues, **When** the dashboard loads, **Then** the "Team stale issues" item shows
   the count and links to the DSU/Sprint Dashboard surface that already shows it.

6. **Given** a checklist category has zero outstanding items, **When** the dashboard
   renders, **Then** that item is shown as cleared/complete rather than as an empty
   list demanding attention.

7. **Given** a checklist item links to a sub-tab that is not URL-addressable today
   (Mentions, Hygiene), **When** I click it, **Then** I am taken to that exact sub-tab
   in a single action (not merely to the parent view's default tab).

8. **Given** AI Assist is unavailable or the AI-Assist gate is locked, **When** I use
   the dashboard, **Then** every count, link, and check-off works normally; no
   dashboard feature is hidden or degraded by the absence of AI.

9. **Given** the underlying data has changed (e.g. I addressed a mention on the
   Mentions tab), **When** I return to or refresh the dashboard, **Then** the
   corresponding count reflects the change.

### Edge cases

- **No team configured** (empty roster / no board or sprint selected): team-scoped
  items show a clear "team not set up — configure in Sprint Dashboard" state with a
  link, rather than a zero count that could be mistaken for "all clear."
- **Jira not connected / proxy not ready**: the dashboard shows a connection-needed
  state and does not present misleading zero counts.
- **A single source fails to load** (e.g. the mentions scan errors) while others
  succeed: the failed item shows an error/retry affordance; the rest of the dashboard
  still renders its counts. One source's failure must not blank the whole dashboard.
- **An issue qualifies for multiple categories** (e.g. blocked *and* stale): it is
  counted in each category it genuinely matches; the dashboard does not silently
  suppress it from one. (Display-level de-duplication of the same issue within a
  single category is still required.)
- **Window/threshold settings differ across views**: the dashboard reuses each
  source's own configured threshold (e.g. the mentions business-day window, the
  Sprint Dashboard stale-days threshold) so its counts always agree with that source.
- **Very large counts**: a count is displayed as-is (or capped with a "+", e.g.
  "99+") without attempting to render every issue inline on the dashboard.

## Requirements *(mandatory)*

### Functional Requirements

**Placement & determinism**

- **FR-001**: The system MUST present a "Today" dashboard as the default landing tab
  of the My Issues view, shown before the existing Report/Mentions/Hygiene/Time/Git
  Sync/Settings tabs in tab order, and selected automatically when the view first
  loads.

- **FR-002**: Every count, threshold, ordering, and completion state on the dashboard
  MUST be computed by deterministic rules. No dashboard element may require an AI Assist
  call or the AI-Assist gate to render or function.

- **FR-003**: The dashboard MUST derive its data exclusively from sources the product
  already fetches and rules it already implements (the Mentions scan, the Hygiene
  checks, the self-assigned issue query, and the Sprint Dashboard team roster + sprint
  scope). It MUST NOT introduce a new hygiene rule or a new categorization rule; where
  it needs a signal that does not already exist, that signal is out of scope.

**Attention categories (the checklist)**

- **FR-004**: The dashboard MUST present the following attention categories, each as a
  checklist item with a deterministic live count and a deep link to the existing
  surface where the work is done. Each category's count MUST match what the linked
  surface shows for the same scope and settings:
  - **a. Respond to mentions** — outstanding (unaddressed) mentions in the configured
    business-day window → Mentions tab.
  - **b. Unblock issues** — my and my team's issues in a blocked/impeded/on-hold state
    → Sprint Dashboard blockers surface.
  - **c. My stale issues** — my in-progress issues not updated within the stale
    threshold → the stale list (Hygiene / My Issues).
  - **d. Team stale issues** — team (roster + sprint scope) in-progress issues past the
    stale threshold → DSU/Sprint Dashboard stale surface.
  - **e. Unassigned in-progress work** — in-scope non-done issues with no assignee →
    Hygiene.
  - **f. Sprint commitment gaps** — in-scope sprint issues missing an estimate or
    acceptance criteria → Hygiene.
  - **g. Due / overdue today** — in-scope issues whose due date or target-end date has
    arrived without completion → Hygiene / issue.
  - **h. Untriaged new issues** — newly added issues needing grooming → DSU/Sprint
    Dashboard new-issues surface.

- **FR-005**: The dashboard MUST also surface a **sprint-flow snapshot** for situational
  awareness (deterministic, read-only): current work-in-progress distribution across
  status zones and days remaining in the active sprint, linking to the Sprint
  Dashboard. This snapshot is **informational only** — it is never a check-off item,
  and v1 introduces no WIP-pileup alert or threshold (consistent with FR-003's
  no-new-rules constraint).

- **FR-006**: For each checklist item, when its count is zero the item MUST render as
  cleared/complete rather than as an empty list, so the Scrum Master's attention is
  drawn only to open work.

**Scope & identity**

- **FR-007**: "My" items MUST be scoped to the current Jira user using the same
  current-user mechanism the existing Mentions and self-assigned-issue features use.
  "Team" / in-scope items MUST be bounded by the already-saved Sprint Dashboard
  **active sprint/board selection** — i.e. all issues in the selected sprint/board
  regardless of assignee, so unassigned work (FR-004e) is included. The saved roster
  is used only for display/grouping within those items, never to bound the issue set.
  The dashboard MUST NOT introduce its own team-configuration UI.

- **FR-008**: When the team roster or sprint scope is not configured, team-scoped items
  MUST show an explicit "not configured" state with a link to where it is set up,
  distinct from a genuine zero ("all clear") count.

**Navigation / deep-linking**

- **FR-009**: Clicking a checklist item MUST take the Scrum Master to the exact surface
  that handles it in a single action — including landing directly on a specific
  sub-tab (e.g. Mentions or Hygiene within My Issues) where that sub-tab is the right
  destination. The system MUST support targeting a specific My Issues sub-tab via
  navigation, which is a capability that does not exist today.

- **FR-010**: Where an item maps to an external Jira surface (a specific issue, an
  issue-navigator query), the dashboard MUST reuse the existing browse/navigator URL
  builders rather than constructing links independently.

**Freshness & resilience**

- **FR-011**: The dashboard MUST provide a way to refresh its counts on demand and MUST
  reflect changes made elsewhere (e.g. a mention marked addressed) when next shown or
  refreshed. Refresh occurs on mount, on an explicit Refresh action, and when the
  Scrum Master returns to the dashboard tab. The dashboard MUST NOT poll counts on a
  background timer while open.

- **FR-012**: A failure to load any single source MUST be isolated to that category
  (showing an error/retry affordance for it) and MUST NOT prevent the remaining
  categories from rendering their counts.

- **FR-013**: When Jira is not connected or the proxy is not ready, the dashboard MUST
  show a connection-required state instead of misleading zero counts.

- **FR-013a**: Each category card MUST load independently on mount — fetching and
  erroring on its own, and rendering its count as soon as it resolves rather than
  waiting on the slowest source. Where a source has already been loaded by a
  previously-visited tab/view in the session, the card MUST reuse that cached result
  instead of re-fetching; otherwise it fetches its own data. Each card MUST show its
  own loading and error/retry state (consistent with FR-012).

**Completion behaviour**

- **FR-014**: An item whose count reaches zero MUST be treated as complete for the day
  (auto-complete on zero) and rendered as cleared/done.

- **FR-015**: The Scrum Master MUST be able to manually mark a checklist item complete
  for the current day even when its count is non-zero (e.g. "I have triaged these and
  the rest are deliberately deferred"). Manual completion state MUST reset on a
  business-day cadence so each day starts fresh, and MUST be personal to the current
  Jira user (resolved and persisted the same way as the Mentions "addressed" state).

- **FR-016**: When every checklist item is complete (by auto-complete and/or manual
  check-off), the dashboard MUST show an unambiguous "done for today" confirmation.

- **FR-017**: The dashboard MUST NOT mutate Jira from the dashboard surface itself
  (no inline reply, comment, transition, or field edit). All actions are taken on the
  destination surface each item links to. (Inline actions are a deferred future
  enhancement, out of scope for this feature.)

### Key Entities

- **Attention category**: A named daily duty (mentions, blockers, my-stale,
  team-stale, unassigned, commitment-gaps, due/overdue, untriaged) with a
  deterministic rule, a current count, a destination link, and a per-day completion
  state.
- **Dashboard count**: The integer result of applying an existing rule to an existing
  data set for the current scope; defined to equal what the linked surface shows.
- **Scope**: The resolution of "me" (current Jira user) and "my team" (saved roster +
  board/sprint selection) that bounds which issues each category considers.
- **Daily completion state**: Per-Scrum-Master, per-day record of which checklist items
  are complete (auto via zero-count and/or manual), reset on a business-day cadence.
- **Sprint-flow snapshot**: A read-only situational summary (WIP distribution, sprint
  days remaining) shown for context alongside the checklist.

## Success Criteria *(mandatory)*

- **SC-001**: A Scrum Master can determine their complete set of outstanding daily
  Jira-hygiene duties from the "Today" dashboard alone, without opening any other tab
  or view first, in under 30 seconds of landing on My Issues.

- **SC-002**: Every dashboard count matches the count shown on its linked surface for
  the same scope and settings — verified for all categories with zero discrepancies.

- **SC-003**: From any checklist item, the Scrum Master reaches the surface that
  handles it (including the correct sub-tab) in a single click.

- **SC-004**: The dashboard renders and functions with 100% of features available when
  AI Assist is unavailable and the AI-Assist gate is locked.

- **SC-005**: When a single underlying source fails, at least all other categories
  still display their counts; the dashboard is never fully blanked by one source's
  failure.

- **SC-006**: When all checklist items are clear, the dashboard communicates "done for
  today" unambiguously, so the Scrum Master can trust that nothing was missed.

- **SC-007**: Clearing an item on its destination surface (e.g. addressing a mention)
  is reflected on the dashboard on next view/refresh — the dashboard never shows work
  as outstanding that has already been completed elsewhere.

- **SC-008**: Team-scoped items never show a false "all clear": when the team is not
  configured, the dashboard says so explicitly rather than showing zero.

## Assumptions

- The existing Mentions scan, Hygiene checks, self-assigned issue query, and Sprint
  Dashboard roster/sprint-scope are stable, performant, and correct enough to be the
  authoritative sources for the dashboard's counts; the dashboard inherits their
  thresholds and windows rather than defining its own.
- In-scope team issues are bounded by the saved Sprint Dashboard active sprint/board
  selection (all assignees, including unassigned); the saved roster only groups/labels
  within that set. No separate team concept is introduced.
- Staleness uses the Sprint Dashboard's configured stale-days threshold (so the
  dashboard, Hygiene, and Blockers all agree), defaulting to the existing default when
  unset.
- "Blocked" reuses the existing blocked/impeded/on-hold detection (status-based and/or
  issue-link-based) already used by My Issues and the Standup/Sprint surfaces.
- The dashboard is a personal daily tool for one Scrum Master at a time, scoped to "me"
  and "my team"; cross-team or managerial aggregation is not implied.
- Daily completion state is personal to the current Jira user (resolved the same way as
  the Mentions "addressed" state) and resets per business day.
- AI enrichment is a future, additive layer; nothing in this feature blocks or
  presupposes it, and removing AI entirely leaves the dashboard fully functional.

## Dependencies

- Existing Mentions feature and its addressed-state store (per-user, server-persisted).
- Existing Hygiene checks module and its deterministic rule set / configured thresholds.
- Existing self-assigned issue query and the Jira proxy that injects credentials.
- Existing Sprint Dashboard team roster, board/sprint selection, and stale-days
  threshold (team-scoped, persisted).
- Existing current-user resolution (Jira `currentUser()` / `/myself`).
- Existing Jira browse / issue-navigator URL builders for external deep links.
- A new (small) capability to navigate to a specific My Issues sub-tab, since sub-tabs
  are currently local state and not addressable (see FR-009).
