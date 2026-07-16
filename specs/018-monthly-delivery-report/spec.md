# Feature Specification: Monthly Delivery Report — Scheduled AI-Prompt Generator

**Feature short name**: `monthly-delivery-report`
**Created**: 2026-07-16
**Status**: Draft — ready for `/speckit-plan`
**Builds on**: the existing server-side scheduler family (`piReviewScheduler.js`, `scopeChangeScheduler.js` — 60-second
tick, once-per-fire + catch-up via `schedulerFiredState`, live config from `configuration.scheduler.<name>`), the
delivery-state ladder in `workflowDelivery.ts` (Ready for QA → Ready to Accept → statusCategory done), the Admin Hub
scheduler-panel pattern (per-scheduler config + last-run status view), and the Team Dashboard team profiles
(`sprintDashboardTeamProfiles`) as the source of the team list.

## Summary

Once a month, a leader has to answer the same question for every team they oversee: **"What was accomplished? What was
delivered that benefited the business or was a major technical improvement?"** Today that answer is assembled by hand —
walking boards team by team, remembering which stories actually reached testing or production, and typing up a
narrative. The data exists in Jira; the narrative is produced by an in-house AI agent that **cannot be automated** —
someone must paste a prompt into it manually.

This feature closes the gap between the two: a **scheduled, server-side Monthly Delivery Report** that, for every team
configured in the Team Dashboard, gathers everything the team delivered in the **prior calendar month** and emits a
single, ready-to-paste **AI prompt** containing the per-team delivery data plus instructions for the agent to produce a
bulleted, per-team accomplishment analysis. The run fires automatically on the **2nd Tuesday of each month at 08:00
local time**, can also be triggered ad-hoc with a **Run Now** button, and its output is viewed and copied from a single
**Admin Hub panel** — there is deliberately no other UI.

Delivery is measured in two business-meaningful buckets:

- 🚀 **Production** — the work reached done (e.g. *Accepted*) during the month, **or** it carries a fix version that has
  been released.
- 🧪 **External Test** — the work reached the team's Definition-of-Done delivery threshold (*Ready for QA* or later)
  during the month but has not yet reached production.

Stories and Tasks are grouped **under the Feature they support**, so the agent (and the human reading its output) sees
delivery organized by initiative rather than as a flat issue list.

## User Scenarios & Testing

### Primary flow — scheduled run

1. It is the 2nd Tuesday of the month, 08:00 local time, and the NodeToolbox server is running.
2. The scheduler fires once: for each configured team it queries Jira for Stories and Tasks that reached a qualifying
   delivery state during the **prior calendar month**, using each issue's change history to decide *when* the state was
   reached (not merely its current status).
3. Each qualifying issue is placed in exactly one bucket — Production or External Test (Production wins when both
   apply) — and grouped under its parent Feature (issues without a Feature fall into a "No Feature" group).
4. The run produces **one prompt** covering all teams: agent instructions followed by the per-team, per-Feature,
   per-bucket data.
5. The prompt, run timestamp, covered month, and per-team outcome (issue counts or error) are persisted server-side.
6. The user opens the Admin Hub panel, sees the last run, clicks **📋 Copy Prompt**, pastes it into the in-house AI
   agent, and receives the bulleted per-team analysis.

### Ad-hoc flow — Run Now

1. The user opens the Admin Hub panel and clicks **Run Now**.
2. The same generation runs immediately for the prior calendar month, regardless of schedule state, and replaces the
   persisted last-run output. Run Now does not consume or alter the monthly scheduled fire.

### Configuration flow — team snapshot

1. The user opens the Admin Hub panel. The panel offers to **snapshot the teams currently configured in the Team
   Dashboard** into the scheduler's server-side config.
2. Saving the panel persists that team list (and the schedule settings) server-side, where the scheduler reads it live.
3. When the user adds or removes a Team Dashboard team later, they re-open the panel and re-save to refresh the
   snapshot; the panel shows the currently snapshotted teams so drift is visible.

### Edge cases

- **A team delivered nothing** — the team still appears in the prompt with an explicit "no recorded deliveries this
  month" line, so the agent never silently omits a team.
- **Jira query fails for one team** — the run continues for the other teams; the failed team is marked with an error in
  the persisted per-team outcome and flagged inside the prompt as "data unavailable". The run never fabricates a clean
  result (lesson of GH #167).
- **Server was off at fire time** — on next startup within the same calendar month after the scheduled moment, the
  missed run fires once (catch-up); it never double-fires within a month.
- **No teams snapshotted** — the scheduler skips the run and the panel shows a "no teams configured" status instead of
  producing an empty prompt.
- **Issue qualified in an earlier month but is still in External Test** — it is *not* re-reported; only state
  transitions that occurred within the covered month qualify. An issue that reached External Test in a prior month and
  reached Production in the covered month appears once, in Production.
- **Released fix version with no in-month transition** — an issue whose fix version was released during the covered
  month counts as Production for that month even if its last status change was earlier.

## Functional Requirements

### Scheduling

- **FR-001**: The system MUST run the Monthly Delivery Report automatically on the **2nd Tuesday of each calendar month
  at a configurable local time, defaulting to 08:00**, covering the calendar month that most recently ended.
- **FR-002**: The system MUST fire at most once per calendar month per configuration, surviving restarts (persisted
  fired-state), with same-month catch-up when the server was off at the scheduled moment.
- **FR-003**: The system MUST provide a **Run Now** action that generates the report immediately for the prior calendar
  month without affecting the scheduled monthly fire.
- **FR-004**: The scheduler MUST read its configuration live (no restart required after saving the Admin Hub panel).

### Team configuration

- **FR-005**: The Admin Hub panel MUST snapshot the user's configured Team Dashboard team profiles into server-side
  scheduler configuration when saved, and MUST display the currently snapshotted team list.
- **FR-006**: When no teams are snapshotted, the scheduler MUST skip generation and surface a "no teams configured"
  status; it MUST NOT emit an empty prompt.

### Data gathering & classification

- **FR-007**: For each snapshotted team, the system MUST gather **Stories and Tasks** (no other issue types) belonging
  to that team's configured project scope (the board id is retained in the snapshot for future scoping but is not used
  for querying in this feature).
- **FR-008**: An issue qualifies for the covered month only if, per its **change history**, it first reached a
  qualifying state during that month — current-status snapshots or resolution dates alone MUST NOT be used for month
  attribution — or its fix version was released during that month (FR-010).
- **FR-009**: **External Test** bucket: the issue reached the delivery threshold (*Ready for QA* or any later state in
  the established delivery ladder) during the covered month and does not qualify for Production.
- **FR-010**: **Production** bucket: the issue reached a done-category state (e.g. *Accepted*) during the covered
  month, **or** the issue is delivered at report time and carries a fix version whose release date falls inside the
  covered month. An issue qualifying for both buckets appears only in Production.
- **FR-011**: Each qualifying issue MUST appear exactly once in the report.
- **FR-012**: Issues MUST be grouped under their parent **Feature** (via epic/parent linkage), identified by Feature key
  and summary; issues with no Feature linkage MUST appear under a "No Feature" group.

### Output — the prompt artifact

- **FR-013**: A run MUST produce **one prompt** covering all snapshotted teams, consisting of (a) instructions directing
  an AI agent to answer *"What was accomplished? Provide a summary of the achievement focusing on what was delivered
  that benefited the business or major technical improvement."* as a **bulleted analysis per team**, and (b) the
  per-team data: buckets, Feature groups, and per-issue key + summary.
- **FR-014**: Teams with no qualifying deliveries MUST still appear in the prompt with an explicit "no recorded
  deliveries" statement; teams whose data collection failed MUST appear flagged as "data unavailable".
- **FR-015**: The prompt MUST be plain text that can be pasted into a chat-style AI agent without further editing.

### Persistence & Admin Hub surface

- **FR-016**: The system MUST persist the last run server-side: the full prompt, run timestamp, covered month, trigger
  type (scheduled or manual), and per-team outcome (issue counts per bucket, or error detail).
- **FR-017**: The Admin Hub panel MUST display the last run's status and provide a **Copy Prompt** action that copies
  the full prompt to the clipboard.
- **FR-018**: A per-team failure MUST NOT abort the whole run; the run completes for remaining teams and reports
  partial results honestly.
- **FR-019**: This feature MUST introduce **no UI outside the Admin Hub panel** (no Reports Hub tab, no ART View
  changes, no Team Dashboard changes).

## Success Criteria

- **SC-001**: A user can go from opening the Admin Hub to having the full prompt on their clipboard in **3 clicks or
  fewer** (open panel → Copy Prompt; Run Now adds one).
- **SC-002**: For a configuration of up to 10 teams, a run completes in **under 5 minutes** end to end.
- **SC-003**: 100% of issues in the report are attributable to the covered month by change history or fix-version
  release date — spot-checking any reported issue against Jira confirms the month attribution.
- **SC-004**: Every configured team is accounted for in every prompt — with data, an explicit "no deliveries" line, or
  an explicit "data unavailable" flag; no team is ever silently missing.
- **SC-005**: The monthly report requires **zero manual data assembly**: the only manual steps remaining are pasting
  the prompt into the in-house agent and sharing its output.

## Key Entities

- **Team snapshot** — a server-side copy of one Team Dashboard team profile (name + board/project scope) taken when the
  Admin Hub panel is saved; the unit the scheduler iterates over.
- **Delivery record** — one qualifying Story/Task: key, summary, bucket (Production / External Test), qualifying date,
  and parent Feature reference.
- **Feature group** — a parent Feature (key + summary) with its delivery records; includes the synthetic "No Feature"
  group.
- **Run result** — the persisted outcome of one generation: prompt text, timestamp, covered month, trigger type, and
  per-team outcomes.
- **Prompt artifact** — the single plain-text output combining agent instructions and all teams' delivery data.

## Assumptions

- **A1**: The "2nd Tuesday at 08:00" pattern is fixed as the day rule (only the time-of-day is configurable). Making
  the day pattern configurable is deferred until a real need appears.
- **A2**: Run Now always covers the prior calendar month; an arbitrary month picker is out of scope for this feature.
- **A3**: The delivery ladder established in the codebase (Ready for QA = delivered threshold; Ready to Accept; done
  category e.g. Accepted) is authoritative for both buckets; no new status mapping is introduced.
- **A4**: "Fix version released" is determined by the version's released flag and release date in Jira.
- **A5**: The server's existing Jira credentials/configuration (as used by the other schedulers) are sufficient; no new
  authentication is introduced.
- **A6**: The prompt is consumed by a human-operated agent, so its exact wording may be tuned after first real-world
  use without a spec change, provided FR-013's structure holds.
- **A7**: The team snapshot is a point-in-time copy by explicit user save — automatic background sync of Team Dashboard
  profiles to the server is intentionally out of scope.

## Non-goals

- No Reports Hub tab, ART View change, or any UI outside the Admin Hub panel.
- No Confluence page delivery, no webhook/Teams delivery (revisit if Teams webhook capability appears).
- No automated execution of the AI analysis — the in-house agent cannot be automated; the output is a prompt artifact
  only.
- No write-back into the ART View Monthly Report tab cards.
- No inclusion of defects, spikes, or other issue types beyond Stories and Tasks.
