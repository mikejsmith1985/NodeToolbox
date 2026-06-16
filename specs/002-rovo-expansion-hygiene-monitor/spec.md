# Feature Specification: Rovo Expansion + Proactive Hygiene Monitor

**Feature short name**: `rovo-expansion-hygiene-monitor`
**Created**: 2026-06-16
**Status**: Draft — ready for `/speckit-clarify` or `/speckit-plan`
**Feature directory**: `specs/002-rovo-expansion-hygiene-monitor/`

## Summary

NodeToolbox already uses Rovo intelligence in one place: the CHG Planning wizard
(Step 4) lets a user ask Rovo to draft the implementation plan, test plan, and
backout plan for a change request. The same underlying pattern — Toolbox sends
a prompt to an Atlassian Automation webhook, Rovo processes it and writes its
response to a Confluence "parking page," Toolbox retrieves and applies the
result — can be applied anywhere the product generates structured content or
evaluates health signals.

This feature expands Rovo assistance to **three additional existing surfaces**
(standup briefing reports, scope/feature change reports, and two more steps in
the CHG wizard), then goes further by adding a **proactive, scheduled Jira
hygiene monitor** that scans for violations daily, asks Rovo to classify each
violation as fixable or not, applies Jira field corrections automatically for
fixable items, and notifies issue owners via Jira comments for items requiring
human attention. A hygiene digest is delivered by email (via the existing
webhook → Atlassian Automation → email path; an inbox rule forwards it into
Microsoft Teams) so teams receive a daily nudge toward better data quality.

Rovo never reads from or writes to Jira directly. Toolbox owns all Jira
interactions. Rovo's role is analysis and text generation; Toolbox's role is
applying the results.

All Rovo-powered features are protected by the existing Ctrl+Alt+Z passphrase
gate — they are invisible to users who have not unlocked Rovo in their session.
All new configuration lives in the Admin Hub; no new standalone settings panels
are introduced.

## Scope Boundary (explicit non-goals)

- **Out of scope**: Rovo writing to Jira directly; the Jira proxy (Toolbox)
  handles all field updates and comments.
- **Out of scope**: Hygiene monitoring of ServiceNow records or Confluence pages;
  this feature covers Jira issues only.
- **Out of scope**: New standalone config panels for hygiene settings; Admin Hub
  is the only config location.
- **Out of scope**: Webhook delivery to non-Atlassian destinations; the existing
  Atlassian-hosts allow-list applies to all new Rovo dispatch calls.
- **Out of scope**: Making Rovo features available without the Ctrl+Alt+Z
  passphrase gate; the gate applies universally.
- **Out of scope**: Removing or altering any existing scheduler behaviour; all
  Rovo enrichment is additive and non-blocking.

## Clarifications

### Session 2026-06-16

- Q: Can Rovo write back to Jira to fix hygiene violations? → A: No. Rovo only reads/writes Confluence. Toolbox handles all Jira reads and writes via its existing proxy. Rovo outputs a structured classification response; Toolbox applies the Jira mutations.
- Q: How should issue owners be notified of unfixable violations? → A: A Jira comment is posted directly on the violating issue, and a team digest is delivered (see digest delivery below).
- Q: Where does hygiene monitor configuration live? → A: Admin Hub only. No separate settings panel in the Hygiene view.
- Q: How is the hygiene digest delivered to Teams? → A: Not via a direct Teams webhook. NodeToolbox sends the digest **by email** using the same trigger-webhook → Atlassian Automation → email mechanism the other reports use; the recipient's inbox rule forwards the email to Teams, where a Teams automation handles it. This keeps all outbound calls on Atlassian hosts (no allow-list exception) and reuses the existing delivery path.

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**Story A — Scrum Master / RTE (scheduler surfaces):**
As a Release Train Engineer, when my daily standup briefing or scope-change
report is generated and delivered to Confluence, I want a Rovo-authored insight
block included automatically so I receive a concise synthesis alongside the raw
data, without having to read the tables myself first.

**Story B — CHG author (wizard extension):**
As a change author building a ServiceNow Change Request, I want Rovo to draft
the short description and description fields from my Jira issues (Step 3) and
then review the completed CHG for obvious gaps before I submit (Step 6), so I
spend less time on boilerplate and more time validating the substance.

**Story C — Team lead (proactive hygiene):**
As a team lead, I want NodeToolbox to scan my team's Jira issues daily, have
Rovo flag and fix hygiene violations automatically where possible, and send me
a digest to Teams so I know exactly what was auto-corrected and what my team
still needs to address, without requiring manual hygiene audits.

### Acceptance scenarios

**Phase 1 — Scheduler enrichment:**

1. **Given** a standup briefing is generated and published to Confluence,
   **When** Rovo is enabled and the passphrase is active,
   **Then** the Confluence post contains a Rovo insight block above the data
   tables summarising the most urgent items, and the post delivery time is not
   materially delayed (see SC-001).

2. **Given** a scope-change or feature-change report is generated,
   **When** Rovo is enabled,
   **Then** the Confluence report page contains a Rovo trend commentary paragraph
   above the change table identifying the release most at risk.

3. **Given** Rovo is unavailable or times out during a briefing/report run,
   **When** the scheduler publishes to Confluence,
   **Then** the briefing or report publishes normally without the Rovo block and
   without an error surfaced to the user; the absence of a Rovo block is logged.

**Phase 1 — CHG wizard extension:**

4. **Given** a user has fetched Jira issues in CHG wizard Step 1,
   **When** they reach Step 3 and activate "Draft with Rovo" (visible only after
   Ctrl+Alt+Z),
   **Then** a Short Description and Description are populated from the Jira issue
   content within 60 seconds (else the action reports a non-blocking skip and the
   user proceeds manually), and the user may edit them before proceeding.

5. **Given** a user has completed Steps 3–5 of the CHG wizard,
   **When** they reach Step 6 and activate "Risk check with Rovo",
   **Then** Rovo returns a structured list of any obvious gaps or risks in the
   completed CHG, displayed inline before submission.

**Phase 2 — Proactive hygiene monitor:**

6. **Given** the hygiene monitor is configured for a team and the scheduled time
   passes,
   **When** the daily scan runs,
   **Then** all open issues in the configured project keys are evaluated, Rovo
   classifies each violation, Toolbox applies Jira field updates for fixable
   items, and the run completes without manual intervention.

7. **Given** a fixable violation (e.g. missing acceptance criteria on a story),
   **When** the scan processes that issue,
   **Then** Toolbox updates the appropriate Jira field and the updated value is
   visible on the issue in Jira within the same business day.

8. **Given** an unfixable violation (e.g. missing assignee),
   **When** the scan processes that issue,
   **Then** a Jira comment is posted on the issue, addressed to the current
   assignee (or to the reporter if unassigned), explaining the violation and the
   specific action needed to resolve it.

9. **Given** a hygiene scan has completed,
   **When** the digest trigger webhook is configured,
   **Then** a digest message is delivered to Teams listing the total issues
   scanned, violations found, fixes applied, and actions required — with a trend
   indicator comparing counts to the prior scan.

10. **Given** a user opens the Hygiene Monitor panel (behind Ctrl+Alt+Z),
    **When** no scan has run today,
    **Then** they can trigger a manual scan, observe progress, and see the
    results in the panel.

### Edge cases

- Rovo returns an empty response or a malformed classification → the scan logs
  the failure for the affected issue, skips Jira mutation, does not post a
  comment, and continues with remaining issues.
- A Jira field update is rejected by the Jira API (e.g. field not on the screen)
  → the violation is re-classified as unfixable for this run; a Jira comment is
  posted instead; the failure is included in the digest.
- An issue has no assignee and no reporter → the Jira comment is posted on the
  issue but not addressed to a named individual; the digest flags it as
  "unassigned violation."
- Hygiene monitor finds zero violations → a digest is still delivered to Teams
  confirming a clean scan; no Jira comments are posted.
- Rovo passphrase has not been entered → all Rovo UI elements (insight blocks,
  "Draft with Rovo" buttons, "Risk check with Rovo", Hygiene Monitor panel)
  are invisible; schedulers run normally without the enrichment step.
- Digest trigger webhook for the hygiene email is not configured → the digest
  delivery is silently skipped; the scan still runs and applies fixes/comments normally.

## Requirements *(mandatory)*

### Functional Requirements

**Phase 1 — Scheduler enrichment:**

- **FR-001**: The standup briefing scheduler MUST, after generating the briefing
  content and before writing to Confluence, dispatch the briefing to Rovo and
  prepend the Rovo-authored insight block to the Confluence post when Rovo is
  enabled. Rovo enrichment MUST be non-blocking: if Rovo is not configured or
  does not respond within the configured timeout, the briefing MUST publish
  without it.

- **FR-002**: The scope-change and feature-change schedulers MUST, after
  generating their change tables, dispatch the change data to Rovo and prepend
  a Rovo trend commentary paragraph to the Confluence report page when Rovo is
  enabled. The same non-blocking fallback from FR-001 applies.

- **FR-003**: All scheduler-initiated Rovo dispatch calls MUST be governed by
  the existing Atlassian-hosts allow-list; no new host policy is required.

**Phase 1 — CHG wizard extension:**

- **FR-004**: The CHG wizard MUST expose a "Draft with Rovo" action in Step 3
  that, when activated, populates the Short Description and Description fields
  from the Jira issues loaded in Step 1. This action MUST be visible only when
  the Rovo passphrase gate is active.

- **FR-005**: The CHG wizard MUST expose a "Risk check with Rovo" action in
  Step 6 that, when activated, submits the completed CHG payload for Rovo review
  and displays a list of identified gaps or risks before the user confirms
  submission. This action MUST be visible only when the Rovo passphrase gate is
  active.

- **FR-006**: Rovo actions in the CHG wizard MUST reuse the existing
  dispatch-and-poll pattern already implemented for Step 4. The user MUST be
  able to proceed without using either new action (they are optional accelerators,
  not required steps).

- **FR-006a**: Each CHG-wizard Rovo action MUST complete within 60 seconds; if Rovo
  does not respond in that window it MUST report a non-blocking skip and let the user
  continue manually. The action MUST never block CHG submission.

**Phase 2 — Proactive hygiene monitor:**

- **FR-007**: The system MUST include a scheduled hygiene monitor that runs
  daily on configurable weekdays and at a configurable time (default: 06:00
  Monday–Friday). The schedule MUST be configurable per team in the Admin Hub.

- **FR-008**: On each run, the monitor MUST query Jira for all open issues in
  each team's configured project keys and evaluate every issue against the
  established set of Jira hygiene rules (the same rules surfaced in the existing
  Hygiene view).

- **FR-009**: Violations MUST be batched per team and dispatched to Rovo with a
  prompt instructing it to classify each violation as either fixable (Rovo can
  produce the correct value) or unfixable (human action required) and to supply
  either the corrected field value or a plain-language explanation for the owner.

- **FR-010**: For each violation classified as fixable, the system MUST apply
  the Rovo-supplied value to the corresponding Jira field via the existing Jira
  proxy. The update MUST be confirmed by a successful Jira API response before
  the violation is considered resolved.

- **FR-011**: For each violation classified as unfixable, the system MUST post
  a Jira comment on the issue containing the Rovo-authored explanation and
  remediation guidance. The comment MUST be attributed to indicate it was
  generated by the hygiene monitor.

- **FR-012**: After each scan, the system MUST deliver a hygiene digest **by email**,
  using the same trigger-webhook → Atlassian Automation → email mechanism the existing
  standup/scope/feature reports use (NodeToolbox fires a trigger webhook to an Atlassian
  Automation rule that composes the email; the recipient's inbox rule forwards it to
  Teams where a Teams automation handles it). Because the destination is an Atlassian
  Automation webhook, the existing Atlassian-host allow-list already covers it — no new
  host exception is required. The digest payload MUST include: total issues scanned,
  violation count, fixes applied, actions required, and a trend indicator (change vs the
  previous scan). Digest delivery MUST be non-blocking: if no digest trigger webhook is
  configured, the scan still runs normally.

- **FR-013**: The Hygiene view MUST include a Hygiene Monitor panel that is
  visible only when the Rovo passphrase gate is active. The panel MUST display
  the last scan time, next scheduled scan, per-team violation counts and trends,
  and a "Scan Now" action to trigger an immediate scan.

- **FR-014**: All hygiene monitor configuration (schedule time, weekday pattern,
  project keys, digest trigger-webhook URL/secret + recipient, Jira field mappings
  for hygiene rules) MUST be managed exclusively in the Admin Hub. No configuration
  UI for this feature exists outside the Admin Hub.

- **FR-015**: Rovo-powered features MUST be invisible to any user who has not
  activated the Ctrl+Alt+Z passphrase gate in their current session. Disabling
  the gate MUST immediately hide all Rovo UI elements without a page reload.

- **FR-016**: The hygiene monitor MUST NOT post duplicate comments. If a comment
  explaining a given violation has already been posted on an issue in the current
  scan cycle, no second comment is created for the same violation in that cycle.

### Key Entities

- **Rovo insight block**: A Rovo-authored prose section prepended to a
  Confluence briefing or report page, providing a synthesised summary above the
  raw data tables.
- **Hygiene violation**: A specific Jira issue attribute that fails one of the
  established hygiene rules (e.g. missing acceptance criteria, no assignee, past
  target end date).
- **Rovo classification**: Rovo's determination for a violation — `FIXABLE`
  (with the corrected value) or `UNFIXABLE` (with owner guidance) — returned as
  structured text on the Confluence parking page.
- **Hygiene digest**: A structured summary payload delivered via an Atlassian
  Automation trigger webhook (which emails it; the recipient's inbox rule routes
  it to Teams) after each scan, covering scan statistics, fix counts, and trend
  direction.
- **Passphrase gate**: The Ctrl+Alt+Z session unlock that makes all Rovo
  features visible. Session-scoped; requires re-entry after a page reload.

## Success Criteria *(mandatory)*

- **SC-001**: Standup briefings delivered to Confluence include a Rovo insight
  block when Rovo is enabled, and the total delivery time for a briefing does
  not increase by more than 30 seconds compared to the baseline (non-Rovo) run.

- **SC-002**: Scope-change and feature-change Confluence report pages include a
  Rovo trend paragraph when Rovo is enabled, and report delivery remains
  non-blocking even when Rovo is unavailable.

- **SC-003**: CHG wizard users can populate Short Description and Description
  from Jira content (Step 3) and receive a risk summary (Step 6) without
  leaving the wizard or copying text manually, with each Rovo action bounded to
  ≤60 seconds or a graceful skip (FR-006a).

- **SC-004**: The hygiene monitor completes a full team scan and delivers its
  digest to Teams each scheduled weekday without manual intervention.

- **SC-005**: Fixable violations detected in a scan result in Jira field updates
  confirmed within the same scan run; zero fixable violations are left un-applied
  due to a silent failure.

- **SC-006**: Every unfixable violation results in exactly one Jira comment per
  scan cycle; zero duplicate comments are created for the same violation in the
  same cycle.

- **SC-007**: Zero Rovo UI elements (buttons, panels, insight blocks triggered
  by user action) are accessible without the Ctrl+Alt+Z passphrase gate being
  active in the current session.

- **SC-008**: All Rovo-enriched scheduler runs degrade gracefully when Rovo is
  unavailable: 100% of briefings and reports still publish to Confluence on
  schedule without error.

- **SC-009**: The Hygiene Monitor panel displays a violation trend (↑ / ↓ vs
  prior scan) whenever at least two consecutive scans have been recorded for a
  team.

## Assumptions

- The existing Rovo dispatch-and-poll pattern (send prompt to Atlassian
  Automation webhook, read result from Confluence parking page by correlationId)
  is stable and performant enough to be called from server-side schedulers
  without impacting briefing delivery schedules.
- Rovo can classify hygiene violations reliably when given structured issue data
  (issue type, summary, description, field values) and explicit instructions to
  output `FIXABLE` or `UNFIXABLE` lines.
- The Jira proxy available to Toolbox can update all Jira fields relevant to
  hygiene rules (acceptance criteria, story points, target dates, assignee) via
  standard Jira API calls.
- Atlassian Automation trigger webhook delivery for the hygiene digest reuses
  the existing `deliverReport` / `payloadContext` pattern without requiring a
  new transport mechanism; the automation rule handles composing and emailing
  the digest, and the recipient's inbox rule forwards it to Teams.
- The passphrase gate persists only for the current browser session; users
  re-entering NodeToolbox will not see Rovo features until they re-enter the
  passphrase. This is the existing and accepted behaviour.
- "Daily scan" means once per configured weekday; re-running via "Scan Now"
  does not reset the daily scheduled run.

## Dependencies

- Existing Rovo dispatch-and-poll mechanism (`dispatchPrompt` / `fetchResult`
  pattern used in CHG Planning today).
- Existing standup briefing, scope-change, and feature-change schedulers and
  their Confluence delivery paths.
- Existing Jira proxy for field updates and comment creation.
- Existing report webhook delivery engine and Teams webhook configuration
  (used by scope-change and feature-change reports today).
- Existing Rovo passphrase gate (Ctrl+Alt+Z session unlock).
- Existing Admin Hub as the sole configuration surface for new settings.
- Existing Atlassian-hosts allow-list enforced on all webhook dispatch calls.
