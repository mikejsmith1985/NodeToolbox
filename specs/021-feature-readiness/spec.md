# Feature Specification: Feature Status & Readiness Workspace

**Feature Branch**: `feature/021-feature-readiness`

**Created**: 2026-07-18

**Status**: Draft

**Input**: User description: "read and review the last comment of gh #189 find the best place in Toolbox to implement our own version of this but we need to ensure we do it better, including inline fixes from the tool like we do everywhere else. and ai insights properly gated like we do everywhere else too please."

## Context

The last comment on GH #189 is an organization-wide reminder to use a Jira-native "Feature Status &
Readiness Dashboard". That dashboard offers three things: (1) a filter gadget scoped by Domain, ART,
and PI; (2) feature status metrics for carryover and current-PI features plus a readiness view of
upcoming-PI features; and (3) a feature listing with data hygiene alerts — Missing Feature
Assignee/Owner, Missing Estimate (the "Estimate (NF)" field), Missing Spark ID/PCode (entered as the
whole number, e.g. `12345` from `P00012345`), Past Target End Date, and Past Due Date — including
missing-PCode-by-Domain rollups for Solution Managers and RTEs.

The org dashboard is **read-only**: every alert ends with "Action: go update the field in Jira",
which means finding the feature again, opening it, locating the field, and editing it by hand.
Toolbox's version must be better in the ways Toolbox is always better: every alert carries an
**inline fix** right where the alert is shown (the established fix-control pattern), counts are
**honest** (an empty scope or an unconfigured field never masquerades as a clean result), the lists
are **deep-linkable**, and **AI insights are present but properly gated** behind the standard
session unlock, propose-only with per-item accept.

**Placement**: the Agile Hub **Train space**, as a new Readiness tab. The dashboard's audience
(RTEs, Solution Managers) and its scope (ART + PI, cross-team) are exactly what the Train space
already owns — its PI selector, ART team roster, and feature-level tooling live there today.

## Clarifications

### Session 2026-07-18

- Q: What makes an upcoming-PI feature count as "ready/refined"? → A: State-based — a feature is
  refined once its state has progressed past the instance's early funnel/analyzing states,
  mirroring the org's Feature States & Exit Criteria; hygiene alerts remain a separate per-row
  concern and never feed the refinement metric.
- Q: Which field does "Missing Feature Assignee/Owner" check — and fix? → A: Either satisfies —
  the alert fires only when BOTH the Jira assignee and the configured Product Owner field are
  empty, and the inline fix control lets the user fill either one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Status & readiness lenses for carryover, current, and upcoming PI (Priority: P1)

An RTE opens the Agile Hub Train space and selects the new Readiness tab. Three lenses summarize
the ART's features for the selected PI context: **Carryover** (features from earlier PIs that are
still not done), **Current PI** (feature progress in the selected PI — how much is done,
in progress, or not started, and which features carry blockers or risk signals), and **Upcoming PI**
(how many features exist for the next PI and how many are refined — where "refined" means the
feature's state has progressed past the instance's early funnel/analyzing states — enough work
lined up, or too much). Each lens shows feature counts grouped by feature state, and selecting a
lens or a state group filters the feature listing below it.

**Why this priority**: this is the core of the org dashboard being replicated — without the status
and readiness picture there is nothing to act on. It is independently valuable even before fixes
and AI exist.

**Independent Test**: with a configured ART and PI, open the Readiness tab and verify each lens
shows counts that match the features returned for its scope, that selecting a lens filters the
listing, and that an empty scope shows an explicit "matched nothing" state rather than a clean
zero.

**Acceptance Scenarios**:

1. **Given** an ART with features spread across a previous, the current, and the next PI, **When**
   the user opens the Readiness tab, **Then** the Carryover, Current PI, and Upcoming PI lenses
   each show the count of features in their scope grouped by feature state.
2. **Given** the Current PI lens is selected, **When** the user clicks a state group (e.g. "not
   started"), **Then** the feature listing shows exactly the features counted in that group.
3. **Given** a scope that matches no features (wrong PI value, empty ART), **When** the tab loads,
   **Then** an explicit empty-scope message appears and no lens shows a healthy-looking zero.
4. **Given** the user arrives via a shared deep link that names a lens and filter, **When** the tab
   opens, **Then** the same lens and filter are already applied.

---

### User Story 2 - Hygiene alerts with inline fixes (Priority: P2)

A Solution Manager reviews the feature listing. Each feature row shows the org dashboard's alert
families as visible flags — Missing Assignee/Owner, Missing Estimate, Missing Spark ID/PCode,
Missing or past Target End Date, Missing or past Due Date — alongside the feature's state, PI, and
age. Every alert that maps to an editable field offers an **inline fix control right on the row**:
assign an owner from a user search, set the estimate, enter the PCode number, pick a date, or move
the feature's status (collecting any workflow-required screen fields before submitting). A fix
writes to Jira immediately, shows Jira's actual response, and clears the alert on success. Alerts
whose field is not configured for this Jira instance say "not checked — no matching field" instead
of showing a clean zero, and alerts that cannot be edited inline link out to Jira and say why.

**Why this priority**: this is the "do it better" heart of the request — the org dashboard names
the problem and sends you away to fix it; Toolbox fixes it in place. Depends on the listing from
US1.

**Independent Test**: seed features with each alert condition, fix one of each kind inline, and
verify the write reaches Jira, the row's alert clears, and the lens counts update.

**Acceptance Scenarios**:

1. **Given** a feature with BOTH the assignee and the configured Product Owner field empty,
   **When** the user searches and selects a person in the row's fix control (choosing either
   target field), **Then** the feature is updated in Jira and the alert clears.
2. **Given** a feature with an assignee but no Product Owner value (or vice versa), **When** the
   listing renders, **Then** no ownership alert is shown — either field satisfies ownership.
3. **Given** a feature missing its PCode, **When** the user enters the whole number and applies the
   fix, **Then** the value is written to the configured PCode field and the alert clears.
4. **Given** a feature whose status move requires additional workflow screen fields, **When** the
   user chooses the transition, **Then** the required fields are collected inline and the submit
   stays disabled until they are complete.
5. **Given** a Jira instance with no PCode field configured, **When** the tab loads, **Then** the
   PCode alert column reads "not checked — no matching field" and contributes nothing to counts.
6. **Given** a fix attempt that Jira rejects, **When** the error returns, **Then** Jira's actual
   message is shown on the row and the alert remains.

---

### User Story 3 - Gated AI readiness insights (Priority: P3)

With the standard AI Assist unlock active for this tab, an AI insights panel appears on the
Readiness tab. It builds one prompt covering the current lens's features (their states, alerts, and
readiness gaps) and ingests the structured reply as individual proposals — e.g. suggested owners,
estimate suggestions, target-date corrections, or a readiness narrative for the upcoming PI. Every
proposal is listed for individual accept or decline; accepting writes through the same fix paths as
the manual controls, and nothing is written without a per-item click. While locked, no AI
affordance is visible anywhere on the tab.

**Why this priority**: valuable acceleration, but only meaningful once the lenses (US1) and fix
paths (US2) exist. Follows the app-wide propose-only doctrine exactly.

**Independent Test**: verify no AI element renders while locked; unlock, generate proposals against
seeded features, accept one and decline another, and verify only the accepted one reaches Jira.

**Acceptance Scenarios**:

1. **Given** AI Assist is locked, **When** the Readiness tab renders, **Then** no AI control,
   panel, or hint is present.
2. **Given** AI Assist is unlocked, **When** the user requests insights, **Then** one prompt is
   produced for the current lens scope and the reply is parsed into per-feature proposals.
3. **Given** a list of proposals, **When** the user accepts exactly one, **Then** only that
   proposal's change is written to Jira, through the same write path as the manual fix.

---

### Edge Cases

- A feature appears in both Carryover and a current-PI scope (re-planned but not re-tagged): it
  must be counted once per lens by that lens's own rule, and the listing must state which lens
  produced it.
- The PI values configured for the ART do not include a "next" PI: the Upcoming lens states that no
  upcoming PI is configured rather than showing zero features.
- Feature states differ from team-level workflows (Funnel/Analyzing/Implementing-style states): the
  state grouping must derive from the instance's actual feature states, not a hardcoded list.
- A user fixes a feature that another user just changed: the write surfaces Jira's response
  (conflict or success) and the row refreshes from Jira rather than trusting local state.
- Very large ARTs (hundreds of features): the listing must stay scannable — filters and lens
  selection bound what renders.
- The PCode field expects a number: non-numeric input (including a pasted `P00012345`) is
  normalized or rejected with a clear message before any write is attempted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Agile Hub Train space MUST offer a Readiness area presenting three lenses —
  Carryover, Current PI, and Upcoming PI — scoped by the Train space's existing ART and PI
  selection.
- **FR-002**: Each lens MUST show feature counts grouped by feature state, and selecting a lens or
  state group MUST filter the feature listing to exactly the counted features.
- **FR-003**: The lens that is displayed and any active filter MUST be expressible in the page
  address so the exact view can be shared and reopened (deep-linkable).
- **FR-004**: An empty scope MUST render an explicit "matched nothing" message and suppress
  healthy-looking zeros; a failed load MUST show the error and never a clean state.
- **FR-005**: The feature listing MUST flag, per feature: missing ownership (fired only when BOTH
  the assignee and the configured Product Owner field are empty — either filled satisfies),
  missing estimate, missing PCode/Spark ID, missing or past Target End Date, and missing or past
  Due Date — the five alert families from the org dashboard — plus the feature's state, PI, and
  age.
- **FR-006**: Every alert whose target field is editable MUST offer an inline fix control on the
  row: user search for ownership (writable to either the assignee or the configured Product Owner
  field, at the user's choice), value entry for estimate and PCode, date pickers for target/due
  dates, and status transitions that collect any workflow-required screen fields before submitting.
- **FR-007**: A successful fix MUST write to Jira immediately, show a success confirmation, clear
  the alert, and update the lens counts; a rejected fix MUST show Jira's actual error message on
  the row.
- **FR-008**: Alert families whose Jira field is not configured on this instance MUST display "not
  checked — no matching field" and MUST NOT contribute to any count; alerts that cannot be edited
  inline MUST link out to Jira with a plain statement of why.
- **FR-009**: The PCode fix MUST accept the whole-number form and normalize the prefixed form
  (`P00012345` → `12345`), rejecting other input with a clear message before any write occurs.
- **FR-010**: Counts and the listing MUST derive from one shared evaluation of the same feature
  set, so a lens count and its drilled-in listing can never disagree.
- **FR-011**: AI insights MUST be invisible while the standard AI Assist unlock is not held by the
  current tab, and MUST follow the app-wide propose-only pattern when unlocked: one prompt per
  request, a structured reply parsed into per-feature proposals, individual accept/decline, and
  accepted proposals written through the same paths as manual fixes.
- **FR-012**: The Readiness area MUST NOT alter the behavior of any existing Train space tab, and
  its lens/filter state MUST NOT leak into other spaces' selections.

### Key Entities

- **Feature**: a Jira Feature-type issue in the ART's scope, carrying state, PI assignment,
  assignee/owner, estimate, PCode, Target End Date, Due Date, and age.
- **Readiness Lens**: one of Carryover, Current PI, or Upcoming PI — a scoping rule that selects
  features relative to the chosen PI and groups them by feature state.
- **Hygiene Alert**: a named data-quality condition on one feature (one of the five families),
  either fixable inline (bound to an editable field) or link-out only.
- **Fix Action**: a single inline write resolving one alert on one feature, with an explicit
  success or Jira-error outcome.
- **AI Proposal**: one suggested change or insight for one feature, produced from a lens-scoped
  prompt, individually acceptable or declinable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Solution Manager can go from opening the Readiness tab to having fixed a missing
  PCode on a specific feature in under one minute, without leaving Toolbox.
- **SC-002**: Every alert family shown on the org dashboard is represented, and each editable one
  can be resolved inline — zero alert types require a trip to Jira when the field exists and is
  editable.
- **SC-003**: For any lens, the count shown and the number of rows in its drilled-in listing are
  identical in 100% of cases (they derive from one evaluation).
- **SC-004**: With AI locked, a review of the rendered tab finds zero AI affordances; with AI
  unlocked, no proposal writes to Jira without an explicit per-item accept.
- **SC-005**: An RTE preparing for PI Planning can answer "how many upcoming-PI features exist and
  how many are still unrefined" from the Upcoming lens alone, without opening any feature.
- **SC-006**: Deep links shared between two users open the identical lens, filter, and listing
  state.

## Assumptions

- **Placement**: the Agile Hub Train space is the right home — the org dashboard's audience (RTE /
  Solution Manager) and scope (ART + PI) match the Train space exactly. The Reports Hub was
  considered and rejected because it is a read-only reporting surface, and this feature's core
  differentiator is inline writes.
- **Scope**: v1 covers Feature-type issues in the ART's configured scope. Domain-level rollups
  (the org dashboard's missing-PCode-by-Domain gadgets) reduce to the ART grouping Toolbox already
  has; a multi-ART/Domain rollup is out of scope for v1.
- **Instance fields**: Estimate (NF), Spark ID/PCode, and the Product Owner field are
  instance-specific Jira fields. They are resolved through the same configurable field mapping the
  existing hygiene checks use, with the established "not checked — no matching field" honesty when
  absent. Exact field ids are a configuration concern, not a spec concern.
- **Ownership (clarified)**: ownership is satisfied by EITHER the assignee or the configured
  Product Owner field; the alert fires only when both are empty. If no Product Owner field is
  configured, the assignee alone decides the alert (and the fix offers only the assignee target).
- **Upcoming PI**: derived from the ART's configured PI list — the next PI value after the
  currently selected one. If none is configured, the Upcoming lens says so.
- **Carryover**: features assigned to an earlier PI than the selected one whose state is not a
  done-category state. Blocker/risk signals reuse the impediment detection the Train space already
  performs.
- **Feature states**: grouped by the instance's real feature workflow states (state names as they
  exist in Jira), rolled up by status category for the count summaries, so the tab works for both
  Feature-workflow and standard-workflow instances.
- **Refinement (clarified)**: the Upcoming lens's refined/unrefined split is purely state-based —
  past the early funnel/analyzing states means refined. Hygiene alerts are shown on rows but never
  feed the refinement metric.
- **No new external systems**: everything reads and writes through the existing Jira access paths;
  no Confluence or ServiceNow involvement in v1.

## Out of Scope

- Replicating the org dashboard's Confluence guideline links as embedded content (a static
  reference link may be shown, nothing more).
- Multi-Domain / multi-ART aggregate rollups.
- Scheduled or emailed readiness digests (the existing server digest patterns could adopt this
  later; not part of v1).
- Any automated AI channel — AI remains propose-only with per-item human accept, per the standing
  product rule.
