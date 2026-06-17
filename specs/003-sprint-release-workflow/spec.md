# Feature Specification: Jira Sprint–Release Workflow Orchestrator

**Feature short name**: `sprint-release-workflow`
**Created**: 2026-06-17
**Status**: Draft — all clarifications resolved; ready for `/speckit-plan`
**Feature directory**: `specs/003-sprint-release-workflow/`

## Summary

Development teams using NodeToolbox work across four Jira projects: a Feature
project (e.g. DENP) that owns the epic/feature hierarchy, a Development project
(e.g. ENFCT), a QE project (e.g. INTTEST), and a BT project (e.g. UEFT). All
four project keys are configurable per team; the names above are representative,
not fixed.

Today, development issues stay open until QE and BT finish, which compresses all
delivery credit to the final day of the sprint and pollutes ownership metrics when
issues are reassigned. This feature installs a deterministic, configurable workflow
orchestrator in NodeToolbox that:

1. **Closes dev work at code freeze** — Dev issues transition to Done when the
   development team's code is ready for testing (the point NodeToolbox treats as
   the handoff trigger), not when QE or BT complete their work.

2. **Mirrors sprints with fixVersions** — Each release cycle carries both a Jira
   sprint and a Jira fixVersion with the same label. When the fixVersion's release
   date changes, the sprint end date adjusts automatically to preserve a code-freeze
   window of 12–13 business days before the release date.

3. **Structures environment handoffs** — NodeToolbox posts a formal handoff signal
   to QE when development code reaches the INT environment, and to BT when it
   reaches the REL environment. QE and BT sprints are managed outside this scope;
   NodeToolbox communicates readiness to them but does not drive their workflow.

4. **Provides defect intake** — When testing uncovers a defect, a structured
   re-intake process creates or re-opens a development issue and links it back to
   the originating feature.

5. **Enforces ownership stability** — Assignees are never changed by an automated
   status transition. The person who owns an issue at creation owns it through Done.

6. **Gates dev issues on testing readiness** — The Definition of Ready for every
   dev issue requires QE acceptance criteria and BT test scenarios to be documented
   before the issue enters a sprint.

NodeToolbox owns all Jira reads and writes. Jira automation rules, webhooks, and
direct field mutations are orchestrated through the existing Jira proxy layer.

## Scope Boundary (explicit non-goals)

- **Out of scope**: Defining or enforcing the internal QE or BT workflow steps.
  NodeToolbox may suggest a QE/BT workflow shape, but cannot block or transition
  their issues based on development status, and vice versa.
- **Out of scope**: CI/CD pipeline configuration, deployment tooling, or any
  system outside Jira and NodeToolbox.
- **Out of scope**: ServiceNow, Confluence, or other tool integrations beyond what
  is already present in NodeToolbox.
- **Out of scope**: Retroactively correcting historical sprint or fixVersion data.
  The orchestrator applies to new sprint cycles going forward.
- **Out of scope**: Sprint capacity planning, story point forecasting, or velocity
  analysis; this feature manages lifecycle state, not estimation.
- **Out of scope**: Changing how Jira renders burndown/burnup charts; the metric
  improvement comes from moving Done transitions earlier, not from chart config.
- **Out of scope**: Automated creation of QE/BT child issues. Issue structure and
  linking are assumed to exist; this feature manages their state signals.

## Clarifications

### Session 2026-06-17

**Q1 — Environment handoff trigger**: Resolved.
NodeToolbox detects environment promotion via `customfield_10201` (sub-status) on the dev issue:
- Sub-status value **"Ready for System Integration Test"** → code is in the INT environment → QE handoff triggered; dev issue transitions to Done.
- Sub-status value **"Ready for UAT"** → code is in the REL environment → BT handoff triggered.
- The INT→REL window is typically 3–7 days after code freeze (hardening period in INT before BT begins).
- **Config-only issues** may carry neither sub-status value; for issues flagged as config-only (no testing required), the handoff notification is suppressed and the dev issue transitions to Done at code freeze without a QE/BT handoff.
- The specific sub-status values ("Ready for System Integration Test", "Ready for UAT") are configurable in the Team Workflow Profile so teams with different picklist values can use the same orchestrator.

**Q2 — Defect intake model**: Resolved.
- **New issue (Option A)**: When testing uncovers a defect, a new ENFCT issue is created and linked to the original dev issue. The original stays at Done; its Done date and delivery credit are preserved. Defects are tracked as distinct work items, enabling separate release-quality reporting.
- **Jira-native trigger (Option Y)**: QE or BT initiates the intake by applying a specific label (e.g., `defect-intake`) to their own Jira issue that is already linked to the original dev issue. NodeToolbox detects the label via webhook and automatically creates the new ENFCT defect issue. QE/BT never leave their own Jira tooling. The trigger label name is configurable in the Team Workflow Profile.

**Q3 — Multi-team scope**: Resolved.
- **Single-team now, multi-team ready (Option C)**: NodeToolbox manages one active Team Workflow Profile at a time in the UI. However, every record in the data model carries a `teamProfileId` from day one so a second team profile can be added later without a schema migration or backend refactor. No multi-team profile-list UI is built in this release.

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**Story A — Development Lead (sprint close & handoff):**
As a development lead, when my team finishes coding a story and the build deploys
to INT, I want NodeToolbox to automatically mark the dev issue as Done and post a
QE handoff notification, so that sprint burndown reflects delivery at the moment
code is ready — not when QE signs off weeks later.

**Story B — Release Train Engineer (sprint–fixVersion sync):**
As an RTE, when the product owner moves the 6/18 fixVersion release date by one
week, I want the 6/18 sprint end date to update automatically to stay 12–13
business days before the new release date, so the code-freeze window is preserved
without manual sprint edits.

**Story C — QE Lead (structured handoff):**
As a QE lead, I want to receive a clear, structured notification from NodeToolbox
when development code hits INT, including the list of dev issues that are now Done,
so my team knows exactly what to test without chasing the development team.

**Story D — BT Lead (REL handoff):**
As a BT lead, I want to receive a structured notification when code hits the REL
environment, so my team can begin business testing against a stable environment
with a clear list of items to validate.

**Story E — Product Owner / Scrum Master (DoR gate):**
As a product owner, I want NodeToolbox to flag any dev issue that lacks QE
acceptance criteria or BT test scenarios before it enters sprint planning, so
testing gaps are caught before development starts — not discovered in testing.

**Story F — Developer (defect intake):**
As a developer, when QE or BT raises a defect against my story, I want the defect
to be properly linked back to the original feature and assigned back to me without
changing the Done state of the original issue or altering who owned it, so
ownership reporting stays clean and the original delivery credit is preserved.

**Story G — Reporting Consumer (ownership integrity):**
As a reporting consumer, I want to run a Jira query that shows who owned each
development issue through its full lifecycle without the assignee field having
been mutated by status transitions, so team-level delivery metrics are accurate.

### Acceptance scenarios

- **Sync trigger**: RTE changes fixVersion date from June 18 to June 25. NodeToolbox
  detects the change and updates the sprint end date to June 25 − 13 business days
  (approximately June 6). The sprint end date change is visible in Jira within one
  business day of the fixVersion date change.

- **Dev Done at handoff**: Developer's feature branch merges and deploys to INT.
  The ENFCT issue transitions to Done. The assignee field is unchanged. The sprint
  burndown chart reflects the Done transition on the deploy date, not on QE sign-off
  date.

- **QE handoff notification**: On the same event that closes the dev issue, a
  structured handoff message is posted. It references the issue key, the feature
  it belongs to in DENP, and confirms which environment the build is in.

- **BT handoff notification**: On deploy to REL, a structured handoff message is
  posted for BT that mirrors the QE handoff format.

- **DoR rejection**: A dev issue is added to a sprint but has no QE acceptance
  criteria field populated. NodeToolbox flags this violation; the issue cannot be
  confirmed into the sprint until the field is complete.

- **Defect intake**: QE raises a defect against ENFCT-101 (Done). A new or
  re-opened ENFCT issue is created, linked to ENFCT-101 and its parent DENP feature.
  ENFCT-101 remains at Done. The new issue's assignee is the same as ENFCT-101's
  assignee. The new issue is added to the current active sprint (or flagged for
  triage if the sprint is in code-freeze).

- **No reassignment**: An ENFCT issue moves through every status transition
  (Backlog → In Progress → Done). At every point, `assignee` is unchanged from
  the value set at issue creation.

## Functional Requirements

### FR-1: Project profile configuration

1.1 An administrator can define a **Team Workflow Profile** that specifies:
  - Feature project key (e.g., DENP)
  - Development project key (e.g., ENFCT)
  - QE project key (e.g., INTTEST)
  - BT project key (e.g., UEFT)
  - Code-freeze window in business days (default: 13)
  - Sprint/fixVersion naming convention (e.g., "M/DD" label format)

1.2 Profiles are stored in the NodeToolbox Admin Hub. No profile can be saved
    without all four project keys validated against the connected Jira instance.

### FR-2: Sprint–fixVersion synchronization

2.1 When a Jira fixVersion's release date changes, NodeToolbox recalculates the
    sprint end date as: `(new release date) − (code-freeze window in business days)`.
    Business days exclude weekends; public-holiday calendars are out of scope.

2.2 The sprint linked to the fixVersion shares the same display label. NodeToolbox
    maintains the sprint-to-fixVersion mapping so date changes propagate correctly.

2.3 The sprint end date update is applied within one business day of the fixVersion
    date change being detected.

2.4 If the sprint is already closed, no date update is applied; a warning is surfaced
    to the administrator.

### FR-3: Dev issue Done transition at handoff

3.1 When a development handoff event is detected for a dev issue, NodeToolbox
    transitions that issue to Done in the development project (ENFCT or configured).

3.2 The transition to Done does not alter the `assignee` field.

3.3 The transition is applied only if the issue is in an in-flight status (not
    already Done, not Cancelled/Won't Do). Issues already at terminal status are
    skipped with a logged warning.

3.4 QE and BT issue status has no bearing on when the dev issue transitions to Done.

### FR-4: QE handoff notification

4.1 When code is confirmed in the INT environment for a set of dev issues, NodeToolbox
    posts a structured QE handoff for each affected issue. The notification includes:
    - Dev issue key and summary
    - Parent feature key and summary (from DENP or configured feature project)
    - Confirmation of environment (INT)
    - Date and time of the handoff event

4.2 The handoff is posted using an existing NodeToolbox delivery channel (Jira
    comment, Confluence page, or webhook — consistent with the delivery pattern
    used by existing reports in this codebase).

### FR-5: BT handoff notification

5.1 When code is confirmed in the REL environment, NodeToolbox posts a structured
    BT handoff mirroring FR-4, confirming the REL environment.

5.2 BT handoff is independent of QE handoff; one environment reaching REL does not
    require INT to have been signalled first (deployments may be bundled).

### FR-6: Definition of Ready gate

6.1 Before a dev issue can be confirmed into a sprint, NodeToolbox validates:
  - A QE acceptance criteria field is populated (non-empty)
  - A BT test scenario field is populated (non-empty)
  - The specific Jira fields used for these are configurable in the Team Workflow Profile

6.2 Issues that fail the DoR gate are flagged with a Jira comment or label
    identifying the missing field(s). The issue is not blocked at the Jira workflow
    level; the flag is advisory and visible in NodeToolbox.

6.3 NodeToolbox surfaced a DoR violations report listing all sprint-assigned dev
    issues that have unfulfilled DoR criteria, filterable by sprint.

### FR-7: Defect intake and re-open

7.1 NodeToolbox provides a defect intake mechanism that creates a development issue
    linked to the original dev issue and its parent feature.

7.2 The new defect issue inherits the assignee of the original dev issue.

7.3 The new defect issue is placed in the current active sprint if the sprint is
    pre-code-freeze; if the sprint is in the code-freeze window, the issue is
    flagged for team triage instead of auto-assigned to the sprint.

7.4 The original dev issue remains at Done. Its Done transition date is not
    disturbed.

7.5 The defect issue is labelled or categorised distinctly from the original
    development work so it can be reported on separately.

### FR-8: Ownership preservation

8.1 No NodeToolbox action or automation alters the `assignee` field of any issue
    as a consequence of a status transition.

8.2 The initial assignee set at issue creation is preserved at Done.

8.3 Assignee changes triggered manually by a human user are not restricted.

## Success Criteria

1. **Sprint burndown reflects continuous delivery**: By the end of the first sprint
   cycle using this workflow, at least 80% of story-point closure events appear
   before the final two business days of the sprint.

2. **Zero automated reassignments**: Across a full sprint cycle, no dev issue has
   an assignee change that was triggered by a status transition (zero incidents).

3. **Sprint dates stay current**: Within one business day of a fixVersion date
   change, the mirrored sprint's end date reflects the new code-freeze calculation.

4. **Handoff timeliness**: QE receives a handoff notification within 30 minutes of
   the INT deploy event being registered in NodeToolbox. BT receives the same for REL.

5. **DoR compliance rate increases**: The percentage of dev issues entering a sprint
   with QE and BT criteria pre-populated reaches ≥ 95% within two sprint cycles of
   the feature going live.

6. **Defect intake completed quickly**: A team member can complete the defect intake
   flow (from defect raised to new/re-opened dev issue linked and assigned) in under
   3 minutes.

7. **Metric reportability**: A reporting consumer can produce a Jira query or
   NodeToolbox report showing original assignee, Done date, and defect linkage for
   every dev issue without requiring any post-hoc correction.

## Key Entities

| Entity | Owner Project | Description |
|--------|--------------|-------------|
| Feature | DENP (configurable) | Top-level work item; parent of all child issues |
| Dev Issue | ENFCT (configurable) | Development task; transitions to Done at handoff |
| QE Issue | INTTEST (configurable) | QE test execution; lifecycle managed by QE team |
| BT Issue | UEFT (configurable) | Business test execution; lifecycle managed by BT team |
| Sprint | Jira (dev board) | Dev team's iteration; end date = release date − freeze window |
| FixVersion | Jira | Release label; source of truth for release date |
| Team Workflow Profile | NodeToolbox Admin Hub | Per-team config: project keys, freeze window, DoR fields |
| Handoff Event | NodeToolbox | Triggered by INT/REL deploy; drives Done transition + notification |
| Defect Intake Record | NodeToolbox / ENFCT | Links defect to original issue; preserves Done on original |

## Assumptions

- **A1**: The Jira instance NodeToolbox connects to already has fixVersions and
  sprints created for the current and upcoming release cycles. This feature manages
  them; it does not create them from scratch.
- **A2**: The Jira workflow for dev issues (ENFCT or equivalent) includes a "Done"
  status reachable from In Progress. If the workflow requires an intermediate
  status (e.g., "In Review") before Done, the transition path must be configured
  in the Team Workflow Profile.
- **A3**: QE acceptance criteria and BT test scenarios are stored in dedicated
  Jira custom fields on the dev issue type (not in comment threads). The field IDs
  are discoverable via the Jira API.
- **A4**: Handoff notifications follow the existing delivery pattern used by
  NodeToolbox schedulers (Jira comment or webhook → Atlassian Automation).
  No new outbound channel types are introduced.
- **A5**: "Business days" for the code-freeze window calculation means Monday–Friday,
  regardless of locale. Public holidays are not factored in at this stage.
- **A6**: The dev team's sprint is on a Jira board scoped to the development project
  key. NodeToolbox can read and update sprint metadata via the Jira Software API.

## Dependencies

- Existing Jira proxy layer in NodeToolbox for all Jira reads and writes
- Jira Software API access (sprint management endpoints)
- Jira REST API (fixVersion, issue field, transition endpoints)
- Admin Hub configuration panel (Team Workflow Profile storage)
- Existing report delivery channel (Jira comment / webhook path)
- Active Jira connection to the corporate instance (already established in production)
