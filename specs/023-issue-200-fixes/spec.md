# Feature Specification: Issue #200 Review Fixes — hygiene fidelity, transparency, and My Issues personas

**Feature short name**: `issue-200-fixes`
**Created**: 2026-07-20
**Status**: Draft — ready for `/speckit-clarify` or `/speckit-plan`
**Builds on**: the Hygiene scan and its per-check predicates and configurable field ids; the hygiene tiles and the
existing Jira browse/JQL URL helpers; the PO Tool's team/PI selection; the Backlog Remediation panel and the aging
triage detail table; the just-shipped **F2 Quick Issue Lookup** (feature 022) and the shared issue detail panel's
linked-issue rows; the My Issues report with its issue sources; and the team roster (role capabilities + team
membership) and team profiles.

## Summary

GH #200 ("we need to fix these") is a punch-list of six problems a real user hit while validating Toolbox against
Jira. They cluster into three themes:

1. **Data fidelity is wrong** — the hygiene "missing fix version" check reports **0 problems** on a PI that has **72**
   issues missing a fix version. A check that silently finds nothing is worse than no check: it tells the user
   everything is fine when it is not. This is the highest-severity item because it destroys trust in every other
   number Toolbox shows.
2. **The tool is not yet verifiable or inviting enough** — the user cannot click a hygiene node to see the **exact
   Jira search** behind it (so they can confirm Toolbox's count matches Jira's), a linked issue is a dead end rather
   than something they can open in place, the PO Tool makes them **type** a PI instead of picking one, and the
   Remediation experience puts the action buttons far from the (mostly missing) context.
3. **My Issues should serve more than one person** — the report is hard-bound to "me." The user wants to **simulate as
   another Jira user**, to see **role-appropriate** criteria (a Dev, Tester, SM, and PO care about different things),
   and — for SMs and POs — to see the report **for each of their teams**, not just their own assigned work.

The guiding principle across all six: **make Toolbox's numbers checkable and its context reachable, and meet each
persona where they are.** Every fix reuses an existing capability rather than building a parallel one — most visibly,
"open a linked issue" reuses the F2 Quick Issue Lookup instead of inventing a second issue viewer.

The six fixes are largely independent and are intended to be implemented in parallel (worktree-isolated), with the
data-correctness bug first.

## Clarifications

### Session 2026-07-20

- Q: Which issue types must carry a fix version (so the check flags them when missing)? → A: Story, Task, **Defect**
  (this instance's defect type, not "Bug"), and Feature/Epic — Sub-tasks excluded (they inherit the parent's release).
- Q: Is a configurable custom fix-version field needed, or is the native `fixVersions` field enough? → A: Native field
  only — the field is already fetched and populated; the bug is purely the issue-type scope. No new config key.
- Q: Does clicking a hygiene tile open Jira, or is that a separate control? → A: Separate affordance — the tile click
  keeps its existing in-app filter (no regression); each tile gains a distinct "open in Jira ↗" link opening the JQL
  search. Both coexist.
- Q: How is the My Issues role lens (Dev/Tester/SM/PO) chosen? → A: Both — default the lens from the user's roster
  role capabilities; the user can manually switch (many people wear multiple hats). Unset role falls back to a default.

## User Scenarios & Testing

### User Story 1 — The "missing fix version" check tells the truth (Priority: P1)

The user opens Hygiene for a PI they know has 72 issues without a fix version. Today the "Missing Fix Version" tile
reads **0**. After the fix it reads a number that matches what the same query returns in Jira, because the check now
evaluates the delivery work items that actually carry a fix version — not only Features/Epics.

**Acceptance:**
1. On a PI with issues of mixed types (Story/Task/Bug/Feature) lacking a fix version, the check counts **all** of
   them, not zero.
2. The count matches the equivalent Jira search for the same scope.
3. Where the instance records the release/target in a configured field rather than the native fix-version field, the
   check reads that configured field.
4. The check does not regress the other hygiene families or flag issue types that legitimately never carry a fix
   version.

### User Story 2 — Every hygiene node opens its exact Jira search (Priority: P1)

Standing in front of any hygiene number, the user clicks it and Jira opens in a new tab showing the exact set of
issues that number represents, using the exact JQL Toolbox used. They compare Toolbox's count to Jira's and confirm
they agree.

**Acceptance:**
1. Every hygiene node/tile (the overall scope and each per-check family) carries a distinct "open in Jira ↗" control
   that opens a Jira search in a new tab; the tile's existing in-app filter-on-click is unchanged.
2. The opened search reflects the **same scope and the same family condition** Toolbox evaluated (e.g. "in this PI/
   team scope AND fix version is empty"), not just a list of already-found keys.
3. The user can see/inspect the JQL (the existing copy-JQL affordance remains) so a mismatch is diagnosable.
4. A node with zero findings still opens a valid search (which returns zero), so "0" is verifiable too.

### User Story 3 — A linked issue opens in the F2 lookup with one click (Priority: P2)

While viewing an issue's detail, the user sees it links to another ticket. They click the linked key and the F2 Quick
Issue Lookup opens on that issue — full detail, editable fields, Jira deep-link — without leaving the current view or
building any new viewer.

**Acceptance:**
1. A linked-issue key in the detail panel is an interactive control (clickable, keyboard-focusable).
2. Activating it opens the Quick Issue Lookup pre-loaded with that key (the same experience as pressing F2 and typing
   it).
3. The originating view is not navigated away from; closing the lookup returns the user where they were.
4. This works everywhere the shared issue detail panel renders linked issues.

### User Story 4 — PO Tool PI is a dropdown (Priority: P2)

In the PO area of Agile Hub, the user selects the Program Increment from a dropdown of the available PIs for the chosen
team, instead of typing a PI string that must exactly match.

**Acceptance:**
1. The PI control is a dropdown populated with the available PI names for the selected team.
2. The current/most-relevant PI is preselected sensibly; changing the team refreshes the options.
3. The selected PI persists across sessions as before.
4. If PI options cannot be loaded, the control degrades to a still-usable state (honest message; manual entry
   fallback) rather than blocking the tool.

### User Story 5 — Remediation puts the context next to the action (Priority: P2)

Reviewing the remediation queue, the user sees each item's decision buttons **beside** the issue context they need to
decide — status, assignee, summary, acceptance criteria — instead of buttons in one place and (often empty) context
elsewhere.

**Acceptance:**
1. Each remediation item shows its decision-relevant context adjacent to its action buttons (Keep / Dismiss / Snooze /
   Cancel).
2. The context needed to decide is present without a separate manual refresh; when detail is still loading it shows a
   clear loading state rather than a blank.
3. The action buttons stay visually associated with the item they act on (no ambiguity about which issue a click
   affects).
4. Existing remediation decisions and their persistence are unchanged.

### User Story 6 — My Issues serves the person and the role (Priority: P3)

The report adapts to who is asking and for whom:
- A user searches for another Jira user and views the report **as if they were that user** (simulation), to understand
  that person's experience.
- The report surfaces **role-appropriate** criteria: a Dev, Tester, Scrum Master, and Product Owner each see the
  concerns that matter to their role.
- A Scrum Master or Product Owner can view the report **for themselves** (their own assigned work) and **for each of
  their teams**.

**Acceptance:**
1. A user-search control lets the user pick any Jira user; the report then reflects that user's assigned work
   (read-only, under the viewer's own access).
2. A clear indicator shows when the report is being simulated as someone else, and a one-action return to "me."
3. The role lens (Dev / Tester / SM / PO) defaults from the user's roster role and can be manually switched; the
   criteria/sections shown reflect the active lens.
4. For SM/PO roles, the user can switch between "my assigned work" and a selected team's view, using the team roster
   to define membership.
5. Nothing about simulation grants access the viewer does not already have in Jira.

### Edge cases (all stories)

- **Fix-version check** — issue types that never carry a fix version (e.g. sub-tasks, if excluded by policy) are not
  falsely flagged; an instance with the release stored in a custom field still counts correctly.
- **JQL links** — special characters in scope values are safely encoded; an empty base Jira URL still yields a
  well-formed link.
- **Linked-issue open** — a linked key the user cannot access opens the lookup which then shows the honest
  no-permission state (feature 022 behavior), not a crash.
- **PI dropdown** — a team with no resolvable PIs shows an honest empty/again state, never a blank locked control.
- **Remediation** — an item whose full context failed to load shows the loading/unavailable state next to the buttons,
  and the user can still act on what is known.
- **Simulation** — searching a user with no assigned issues shows an honest empty report labelled with that user;
  simulating never mutates data as another user.
- **Role lens with unknown role** — a user whose roster role is unset falls back to a sensible default lens rather than
  an empty report.

## Requirements

### Functional — US1: fix-version check correctness

- **FR-001**: The "missing fix version" hygiene check MUST evaluate the delivery work items expected to carry a fix
  version — **Story, Task, Defect, and Feature/Epic** (Sub-tasks excluded, as they inherit the parent's release) —
  not only Feature/Epic, so a PI whose Stories/Tasks/Defects lack a fix version is counted. ("Defect" is this
  instance's defect issue type; the check MUST match it, not a literal "Bug".)
- **FR-002**: The check MUST read the release value from the **native `fixVersions` field** (already fetched by the
  scan). No configurable custom field id is introduced — the field is populated; only the issue-type scope was wrong.
- **FR-003**: The check's issue-type scope MUST be the explicit set in FR-001 (Story/Task/Defect/Feature/Epic) so the
  fix does not silently flag types that legitimately never carry a fix version (e.g. Sub-tasks).
- **FR-004**: The resulting count MUST agree with the equivalent Jira search for the same scope (verified via US2's
  link).

### Functional — US2: verifiable hygiene nodes

- **FR-005**: Every hygiene node/tile — the overall scope tile and each per-check family tile — MUST carry a distinct
  "open in Jira ↗" affordance that opens the family's Jira issue search in a new browser tab. The tile's existing
  click behavior (the in-app finding filter) MUST be preserved; the Jira affordance is additive, not a replacement.
- **FR-006**: The opened search MUST express the same scope and the same family condition Toolbox evaluated (a
  semantic JQL clause such as "fix version is empty within this scope"), not merely a list of pre-found issue keys.
- **FR-007**: The exact JQL MUST remain inspectable by the user (retain the copy-JQL affordance) so a Toolbox-vs-Jira
  mismatch is diagnosable.
- **FR-008**: A node with zero findings MUST still open a valid (zero-result) search, so a "0" is verifiable.

### Functional — US3: linked issue → F2 lookup

- **FR-009**: A linked-issue key rendered in the shared issue detail panel MUST be an interactive, keyboard-focusable
  control.
- **FR-010**: Activating a linked-issue key MUST open the Quick Issue Lookup pre-loaded with that key, equivalent to
  pressing F2 and searching it, without navigating away from the current view.
- **FR-011**: There MUST be a single imperative way to open the Quick Issue Lookup with a seed key, reused by any
  caller (linked issues today, other callers later), so the lookup is not duplicated.

### Functional — US4: PO Tool PI dropdown

- **FR-012**: The PO Tool Program Increment control MUST be a dropdown populated with the available PI names for the
  selected team, replacing free-text entry.
- **FR-013**: Changing the team MUST refresh the PI options; a sensible current PI MUST be preselected; the selection
  MUST persist across sessions as today.
- **FR-014**: When PI options cannot be loaded, the control MUST degrade honestly (message + reload, or a manual-entry
  fallback) rather than blocking the tool.

### Functional — US5: remediation context beside action

- **FR-015**: Each remediation item MUST present its decision-relevant context (status, assignee, summary, acceptance
  criteria) adjacent to its action buttons.
- **FR-016**: The context needed to decide MUST be available without a separate manual refresh; while loading it MUST
  show a clear loading state rather than a blank.
- **FR-017**: Each item's action buttons MUST stay unambiguously associated with that item.
- **FR-018**: Existing remediation decisions, outcomes, and persistence MUST be unchanged.

### Functional — US6: My Issues personas

- **FR-019**: My Issues MUST provide a Jira user-search control that lets the user view the report as another user
  (their assigned work), read-only and under the viewer's own Jira access.
- **FR-020**: When simulating, the report MUST clearly indicate whose view is shown and offer a one-action return to
  the viewer's own report.
- **FR-021**: My Issues MUST offer a role lens (Dev / Tester / SM / PO) that changes which criteria/sections are
  emphasized. The lens MUST **default from the (simulated) user's roster role capabilities** and be **manually
  overridable**; a user whose roster role is unset falls back to a sensible default lens.
- **FR-022**: For SM/PO roles, the report MUST let the user switch between their own assigned work and a selected
  team's view, using the team roster to define membership.
- **FR-023**: Simulation and team views MUST NOT grant any access the viewer does not already have in Jira, and MUST
  never write data as another user.

### Non-functional

- **NFR-001**: All new links, controls, and panels MUST honor the standing responsive rules (light/dark themes, the
  A/A+/A++ text sizes, narrow widths reflow-not-clip) and never carry meaning by color alone.
- **NFR-002**: Hygiene counts and their Jira links MUST agree by construction — the link's scope/condition is derived
  from the same configuration the scan uses, not re-specified independently.
- **NFR-003**: Reused surfaces (F2 lookup, issue detail panel, PI-options loader, roster) MUST be extended additively;
  existing callers MUST NOT regress.

## Key Entities

- **Hygiene check family** — a named condition (e.g. missing-fix-version) with an issue-type scope, the field(s) it
  reads, and a JQL clause that expresses it; the tile count and the Jira link are both derived from it.
- **Hygiene scope** — the PI/team/project scope the scan runs within; shared by the count and the generated JQL.
- **Lookup open request** — an imperative request to open the Quick Issue Lookup seeded with a specific issue key.
- **PI option set** — the available Program Increment names for a team, used to populate the PO Tool dropdown.
- **Remediation item** — one issue under remediation: its verdict, decision actions, and the decision-relevant context
  shown beside them.
- **Report subject** — who the My Issues report is about: the viewer, a simulated Jira user, or a team; plus the role
  lens applied.
- **Roster member / role** — a team member with role capabilities (dev/test/SM/PO/…) and team membership, used for
  role lenses and team views.

## Success Criteria

- **SC-001**: On a PI known to have N issues missing a fix version, the hygiene check reports N (matching Jira), where
  previously it reported 0.
- **SC-002**: For every hygiene node, the user can reach the exact Jira result set in one click and confirm the count
  matches Jira — measured on at least the fix-version, ownership, estimate, PCode, target-end, and due-date families.
- **SC-003**: From an issue's detail, opening a linked issue takes one click and reuses the F2 lookup (no second issue
  viewer exists).
- **SC-004**: A PO selects a PI without typing, and cannot select a PI that does not exist for the team.
- **SC-005**: In remediation, a user can decide an item without scrolling away from its context; the context is present
  (or clearly loading), never a silent blank beside a live button.
- **SC-006**: A user views the My Issues report as another user, as a chosen role, and (for SM/PO) for a chosen team —
  each clearly labelled — without gaining any Jira access they lacked.

## Assumptions

- **Fix-version scope** (clarified): the check applies to Story/Task/Defect/Feature/Epic (Sub-tasks excluded) and
  reads the native `fixVersions` field only — no configurable custom field id.
- **JQL link semantics**: the generated JQL is the scan's scope JQL AND the family's condition clause; it is built from
  the same field-id configuration the scan uses, so counts and links agree by construction (never re-specified
  independently).
- **Linked-issue open** reuses feature 022 wholesale: the only new plumbing is an imperative "open with seed key" path
  and making the linked key a control; the lookup's fetch/render/edit/deep-link/honest-states are unchanged.
- **PI options** are sourced from the same loader ArtView/PI Review already use for the selected team; no new PI
  discovery mechanism is introduced.
- **Remediation** keeps its existing decision engine and persistence; this is a layout/context-availability fix, not a
  behavior change.
- **Simulation** is read-only and runs the same report query with `assignee = <selected user>` under the viewer's own
  credentials — no impersonation, no elevated permissions. Per the issue text ("search for other Jira users"), the
  "simulate as" control searches **arbitrary Jira users** (not only roster members). The **role lens defaults from the
  user's roster role and is manually overridable** (clarified). The exact per-role criteria set is left to
  `/speckit-plan` to detail.
- **Role and team data** come from the existing team roster (role capabilities + membership) and team profiles; no new
  roster is introduced.
- The six fixes are largely independent and are intended to be implemented **in parallel across worktree-isolated
  agents**, sequenced so the data-correctness fix (US1) lands first.

## Out of Scope

- Rebuilding hygiene, remediation, the PO Tool, My Issues, or the issue viewer — every item extends an existing
  surface.
- A second issue-detail viewer — linked issues reuse the F2 lookup.
- Impersonation or any write action performed as another user.
- New role/roster data models — roles and teams come from the existing roster.
- Server-side/scheduled behavior — these are in-app fixes (except where a check already runs in the shared scan).
- Redefining the other hygiene families' semantics beyond what US1/US2 require.
