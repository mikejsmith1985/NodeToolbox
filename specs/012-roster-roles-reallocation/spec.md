# Feature Specification: Role-Aware Roster + Canvas Work Re-Allocation Plan

**Feature short name**: `roster-roles-reallocation`
**Created**: 2026-07-07
**Status**: Draft — specify decisions resolved (Q1=A, Q2=A, Q3=A) + clarify session 2026-07-07 resolved
(role-phase = raw status; scope = one target sprint; PI window + point-as-days + time-in-status added); ready
for `/speckit-plan`
**Feature directory**: `specs/012-roster-roles-reallocation/`

## Summary

A Scrum Master who has surfaced, prioritized, sized, and boxed work on the Feature Canvas now faces the
next real question a board cannot answer on its own: **"given who I actually have and what they can each
do, can we finish the sprints I just defined — and if the allocation is wrong, how should I move the work?"**

Today the canvas's hidden AI accelerator reasons about the *work* (size, priority, WIP, sequencing) but is
blind to the *people*. It never sees the team roster, never sees who each item is assigned to, and — most
importantly — has no concept that a person can only do certain kinds of work. In this org, sprint delivery
depends on three distinct capabilities: **Developer**, **Internal Tester**, and **External Tester**. A
sprint is not "done" because it has enough hands; it is done because it has enough hands *in each role*,
sequenced so testing follows development with time to spare. Moving a story from an overloaded developer to
an idle external tester is not a re-allocation — it is a mistake the current tool cannot even detect.

This feature closes that gap in two coupled parts:

- **Part 1 — Role-aware roster (an enabling enhancement).** The team roster gains the ability to record,
  per person, **which of the three roles they can perform** — Developer, Internal Tester, External Tester —
  as independent capabilities (a person may hold any combination). This is the missing fact that makes
  people-aware planning possible at all, and it is useful on its own beyond this feature.

- **Part 2 — Canvas "Work Re-Allocation Plan" AI assist.** A new entry in the canvas's existing
  passphrase-gated AI accelerator assembles the roster (with each person's roles), the assigned work for a
  **chosen target sprint** with the issue details needed to reason about it (status, time-in-status, points),
  the **PI runway** (start/end dates) and the org convention that a **story point ≈ a day of work**, and a
  free-text **"additional details"** box for the human's real-world constraints (e.g. *"ESI only has two devs
  who can work it"*). It produces a **copy-out prompt** the operator feeds to Copilot; Copilot returns a
  **documented re-allocation plan and an explicit risk assessment** for completing that sprint — a narrative
  the human reads and acts on, not an automatic change to the board. The operator works one target sprint at a
  time, typically starting with the highest-priority sprint and using the remaining PI time to land it.

The result: instead of guessing whether the sprints are staffable, the Scrum Master gets a role-aware,
constraint-aware second opinion on how to move work across the team for the best chance of finishing the
committed sprints — and a clear-eyed list of what could still go wrong.

## Why this shape (coaching & product rationale)

- **People-aware planning is the missing half.** Features 009–011 made the *work* visible and arrangeable.
  Delivery risk, though, lives in the *people-to-work fit*: the right roles, in the right amount, in the
  right order. A re-allocation plan is only meaningful once the tool knows who can play each role.
- **Three roles are a hard constraint, not a label.** Development, internal testing, and external testing
  are sequential and non-interchangeable. Encoding them as first-class capabilities lets the plan reason
  about role bottlenecks ("two dev-days of work, one available developer") instead of treating the team as a
  pool of identical resources.
- **The human owns the nuance; the box captures it.** No roster schema can hold every real constraint
  ("Priya is half-time this sprint", "only two devs know ESI", "external testing is frozen until Thursday").
  A free-text *additional details* input lets the operator inject exactly those facts verbatim, so the plan
  reasons from reality rather than an idealized org chart.
- **A plan to read, not a change to absorb.** Re-assigning work is a real-world, cross-person negotiation
  and (in Jira) a write. The deliverable here is a *documented recommendation with risks* the Scrum Master
  reviews and enacts deliberately — consistent with the canvas's sandbox-first, never-surprise-me stance.
- **Reuse the accelerator that already exists.** This is a new analysis inside the established, hidden,
  passphrase-gated copy-paste round-trip — not a new AI channel. It stays invisible and inert for anyone who
  has not unlocked AI Assist, exactly like every other canvas suggestion.

## Scope Boundary (explicit non-goals)

- **Out of scope**: Writing re-assignments back to Jira, or changing assignees on the canvas. The plan is a
  read-only recommendation the operator acts on manually. Assignee changes remain a deliberate Jira action
  outside this feature.
- **Out of scope**: Ingesting a structured JSON reply to mutate the canvas overlay (as the size/priority/
  master-plan analyses do). Part 2 is a **one-way copy-out** prompt; the plan is consumed in the external
  assistant. A future structured round-trip is explicitly deferred.
- **Out of scope**: Any dependency on AI to use the roster roles. Part 1 (role capabilities) is a fully
  manual, always-available roster enhancement; only Part 2's *plan generation* sits behind the AI gate.
- **Out of scope**: Auto-detecting a person's roles from Jira, ServiceNow, or historical activity. Roles are
  set by the operator. (Reasonable seeding from existing signals may be considered at planning time but is
  not required.)
- **Out of scope**: A capacity/velocity model (story-points-per-person-per-sprint math). Per-person capacity
  nuance is expressed through the additional-details box for this release, not a structured availability
  schema.
- **Out of scope**: Modeling roles beyond the three named (Developer, Internal Tester, External Tester) or a
  free-form taxonomy of arbitrary roles. The three are fixed for this feature; the existing free-text
  `roleName` (a job-title label) is retained and is separate from these capability flags.
- **Out of scope**: Multi-team or cross-ART re-allocation. The plan reasons over the active team's roster and
  the active canvas's sprints, single-operator, as today.

## Clarifications

### Session 2026-07-07

All three decisions were resolved in favor of the recommended options (confirmed by the operator on
2026-07-07). The spec is written against them. The original options are retained below for context.

- **Q1 — Plan delivery model**: Recommended → **One-way copy-out (Option A)**. The analysis generates a
  prompt the operator copies into Copilot; Copilot's documented plan + risks is read there. Nothing is
  ingested back or written to the canvas/Jira. See FR-6, FR-7.
- **Q2 — Role model**: Recommended → **Independent multi-role capabilities (Option A)**. Each roster member
  can be flagged for any combination of Developer / Internal Tester / External Tester. Finer per-person
  availability is expressed via additional-details, not a structured schema. See FR-1, FR-2.
- **Q3 — Allocatable unit**: Recommended → **Child work items (Option A)**. The plan reasons over the
  stories/tasks under the canvas's feature nodes — the units that actually carry an assignee and get done in
  a sprint — grouped by person and by the canvas's sprints; feature nodes provide grouping context. See
  FR-5.

Follow-up clarifications (same session, resolved interactively):

- Q: How does the tool determine a work item's role phase (development / internal testing / external
  testing), given Jira status categories only distinguish To Do / In Progress / Done? → A: Carry each item's
  **raw status name + status category verbatim** and let the assistant infer the phase; the additional-details
  box fills any nuance. No new configuration, mapping, or workflow states are introduced. See FR-5.1, A8.

- Q: Does one prompt cover all canvas sprints or one at a time? → A: **One target sprint at a time**
  (operator-selected, typically the highest-priority sprint). The plan may legitimately use **all remaining
  PI time** to complete that target sprint's scope. See FR-6.1, FR-5.

- Q: What time and estimation signals must the prompt carry so the assistant can judge feasibility? → A:
  Three additions — (1) the PI's **start and end dates** (the full runway, not just days-left); (2) the org
  convention that a **story point ≈ one estimated day of work**, stated in the prompt; and (3) each in-progress
  item's **time in its current status**, so the assistant can gauge whether it is nearer its start or its
  finish. See FR-5.1, FR-5.3, FR-5.4.

### Q1 — Is the re-allocation plan a copy-out document, or a round-trip that changes the board?

**Context**: The request says the prompt lets Copilot *"document a plan … and what the risks are."* The
existing canvas accelerator ingests JSON to mutate the overlay; a re-allocation, by contrast, is a
cross-person, real-world change and (in Jira) a write.

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **One-way copy-out.** Generate a rich prompt; the operator pastes it into Copilot and reads the documented plan + risks there. No ingest, no overlay/Jira change. | Matches "document a plan"; safest; smallest surface. The plan is advice the human enacts. Re-assignment stays a deliberate manual act. |
| B | **Structured round-trip.** Copilot returns strict JSON of proposed re-assignments that pre-fill accept/reject rows and (on accept) tag the canvas node with a proposed assignee overlay. | Richer, but needs a new overlay attribute (proposed assignee), an accept/reject UI, and a story about committing assignee changes to Jira — a much larger feature. |
| C | **Both** — copy-out now, structured ingest later behind the same panel. | A is the release; B is a future increment. Building both now over-scopes this feature. |

**Recommendation: A.** The valuable, well-bounded deliverable is the documented plan and risk list. Ingesting
assignee changes is a separate, larger feature (assignee-as-overlay + Jira write path) best specced on its own.

### Q2 — How are the three roles modeled on a roster member?

**Context**: The request names three roles people "do" and notes a person may be constrained (e.g. only two
devs can work ESI). The roster today has a single free-text `roleName` (a job-title chip), which cannot
express "can do development AND internal testing."

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **Independent capability flags.** Each member carries three booleans — canDevelop / canInternalTest / canExternalTest — any combination allowed. Per-person availability nuance goes in additional-details. | Directly models "who can play which role", enables role-bottleneck reasoning, small schema addition. The existing `roleName` label is kept, separate. |
| B | **Single primary role (enum).** Each member is exactly one of Developer / Internal Tester / External Tester. | Simpler, but false: it cannot express a developer who also internal-tests, which is common and central to re-allocation. |
| C | **Roles + structured per-role capacity** (e.g. availability %, days off per role). | Most expressive; but a full capacity model is out of scope (see non-goals) and the additional-details box already captures this nuance for now. |

**Recommendation: A.** Multi-capability is the minimum that makes role-aware re-allocation correct; capacity
math is deliberately deferred to the free-text box.

### Q3 — What is the unit the plan re-allocates: features or their child work items?

**Context**: The canvas is feature-first (nodes are features/epics, expandable to child stories). But
assignees, "in testing" states, and sprint membership live on the **child stories/tasks**, which is where
developer and tester work actually happens.

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **Child work items.** The plan reasons over the stories/tasks under the canvas features — their assignee, status, points, and role-relevant state — grouped by person and by the canvas's sprints; feature nodes give grouping/context. | Matches where allocation really happens; lets the plan spot an overloaded developer or a testing bottleneck within a sprint. Requires the prompt to carry child-item detail. |
| B | **Feature nodes.** Re-allocate whole features by their feature-level assignee. | Coarser and often empty (features frequently have no single assignee); cannot express "move these two stories to another tester." |
| C | **Both levels.** Features for grouping, stories for allocation, both fully detailed in the prompt. | Most complete but risks an over-long prompt; A already includes feature context as grouping, which is the useful part of B. |

**Recommendation: A.** Sprint completion is won or lost at the story level; that is the unit to re-allocate.

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**Story A — Scrum Master (record who can do what):**
As a Scrum Master, I want to mark each roster member as a Developer, Internal Tester, and/or External Tester
(any combination), so the tool knows the real role capabilities of my team before it reasons about
allocation.

**Story B — Scrum Master (get a role-aware re-allocation plan):**
As a Scrum Master who has boxed work into sprints on the canvas, I want to generate a prompt that carries my
roster (with roles), everyone's assigned work, and my sprints, so an assistant can document how to move work
across the team for the best chance of finishing those sprints.

**Story C — Scrum Master (inject real constraints):**
As a Scrum Master, I want an "additional details" box where I can type constraints the roster can't hold —
like *"ESI only has two devs who can work it"* or *"external testing is frozen until Thursday"* — so the
plan reasons from my actual situation, not an idealized team.

**Story D — Scrum Master (see the risks, not just the plan):**
As a Scrum Master, I want the assistant's output to spell out the **risks** to completing the sprints
(role bottlenecks, overloaded people, unstaffed testing, unassigned or blocked work), so I can raise them
with stakeholders instead of discovering them at sprint end.

**Story E — Operator without AI (roles still work):**
As an operator who has not unlocked AI Assist, I want to still set and use role capabilities on the roster,
so the enhancement is useful even though the plan-generation panel is hidden from me.

**Story F — Operator with AI unlocked (accelerate, don't depend):**
As the operator who has unlocked AI Assist, I want the re-allocation analysis to appear alongside the
existing canvas suggestions and behave the same way (copy a generated prompt out), so it fits the workflow I
already know and never blocks anything for anyone else.

### Acceptance scenarios

- **Set roles on a member (Story A, Q2=A)**: Given a roster member, when the operator marks them as
  Developer and Internal Tester, then both capabilities persist for that member (surviving reload) and the
  member visibly shows both roles; External Tester remains unset.

- **Roles are independent**: Given a member marked all three roles and another marked none, when the roster
  is viewed, then each member's role set is exactly what was chosen, with no default or forced single role.

- **Roles are team-scoped**: Given two teams in the roster, when roles are set for a member on Team A, then
  switching the active team shows Team B's members with their own (independent) role state, consistent with
  how the roster is already team-scoped.

- **Plan prompt includes roster + roles + work + sprints (Story B, Q3=A)**: Given AI Assist is unlocked and
  the canvas has sprints with assigned child work, when the operator opens the Work Re-Allocation analysis,
  then the generated prompt contains, for the active team: each roster person with their roles; the child
  work items assigned to them (key, summary, status, points, and role-relevant state) grouped by sprint; and
  the canvas's defined sprints with their capacity — assembled from real canvas data, not invented.

- **Additional details are injected verbatim (Story C)**: Given the operator types *"ESI only has two devs
  who can work it"* into the additional-details box, when the prompt is generated, then that exact text
  appears in the prompt as an operator-stated constraint the assistant must honor.

- **Additional details persist**: Given the operator entered additional-details text, when they close and
  reopen the canvas for the same team/scope, then the text is still present (persisted with the planning
  context), and clearing it removes it.

- **Copy-out, no board change (Story B, Q1=A)**: When the operator copies the generated prompt, then nothing
  on the canvas overlay or in Jira changes; the panel offers no "ingest/apply" step for this analysis, and
  the deliverable is the copied prompt only.

- **Risk-aware output is requested (Story D)**: Given the generated prompt, then it explicitly instructs the
  assistant to return both (a) a re-allocation plan grouped by person and sprint and (b) an explicit list of
  risks to completing the sprints, including role bottlenecks, overloaded people, unstaffed testing, and
  unassigned or blocked work — reasoning only from the data and constraints provided.

- **Role-bottleneck reasoning is possible**: Given a sprint whose only developer is overloaded while two
  members are external-testers with spare capacity, when the plan is generated and read, then the prompt
  carries enough role and assignment data for the assistant to identify the developer bottleneck and avoid
  recommending dev work be moved to a tester who cannot develop.

- **Manual-only integrity (Story E)**: Given a user who has not unlocked AI Assist, when they open the
  roster, then role capabilities are fully settable and visible, and the Work Re-Allocation panel is not
  shown anywhere.

- **Empty-state clarity**: Given a canvas with no sprints defined or no assigned work, when the operator
  opens the analysis, then the panel clearly states what is missing (e.g. "no sprints on the canvas yet" or
  "no assigned work found") rather than generating a hollow prompt.

- **No roster, clear guidance**: Given the active team has no roster members, when the operator opens the
  analysis, then it explains that a roster (with roles) is required and points to where to build it, rather
  than producing a people-less prompt.

## Functional Requirements

### Area 1 — Role-aware roster (Part 1: the enabling enhancement)

**FR-1: Three role capabilities per roster member (per Q2=A)**
1.1 Each roster member can carry, independently, three role capabilities: **Developer**, **Internal
    Tester**, and **External Tester**. Any combination (including none or all three) is valid.
1.2 Role capabilities are **distinct from** the existing free-text `roleName` job-title label; adding role
    capabilities does not remove or repurpose `roleName`.
1.3 Role capabilities persist with the roster member and are **team-scoped**, consistent with how the roster
    is already partitioned by active team, and survive reload.

**FR-2: Editing and displaying roles**
2.1 The roster editor lets the operator **set and clear** each of a member's three role capabilities without
    leaving the roster surface.
2.2 A member's current roles are **visible at a glance** on their roster entry (e.g. role chips), so the
    operator can see team role coverage while building the roster.
2.3 Setting roles is fully manual and available regardless of AI Assist unlock state (per Story E).

### Area 2 — Assembled planning context (Part 2 inputs)

**FR-3: Roster + roles as a prompt input**
3.1 The Work Re-Allocation analysis includes the **active team's roster**, and for each member their name
    and their set of role capabilities, so the assistant reasons about who can play each role.

**FR-4: Additional details (operator constraints) input**
4.1 The analysis provides a free-text **"additional details"** input for constraints the roster cannot hold
    (e.g. limited-skill pools, part-time availability, testing freezes).
4.2 The additional-details text is **injected verbatim** into the generated prompt as operator-stated
    constraints the assistant must honor.
4.3 The additional-details text is **persisted** with the canvas planning context (scoped to the active
    team/work scope) so it survives across sessions until the operator changes or clears it.

**FR-5: Assigned work at child-item level, for a selected target sprint (per Q3=A; scope per follow-up)**
5.1 For the operator's **selected target sprint** (FR-6.1), the analysis assembles the **child work items**
    (stories/tasks) under the canvas's feature nodes that belong to that sprint, carrying for each item at
    least: key, summary, points, its **assignee**, its **raw Jira status name plus status category** verbatim,
    and — for in-progress items — its **time in the current status category** (days since the status category
    last changed; a soft progress signal per A11, not an exact per-status timer). The
    prompt does **not** pre-classify a dev/internal-test/external-test phase; it passes the real status text
    and lets the assistant infer the phase, with additional-details teaching any nuance. No new configuration,
    status mapping, or workflow states are introduced.
5.2 Items are organized so the assistant can reason **per person** (what each roster member is carrying within
    the target sprint) and against the **target sprint's requirement**, including flagging work that is
    **unassigned** or assigned to someone **not on the roster**. The other canvas sprints are named as context
    (so cross-sprint pull-forward/slip can be discussed), but the allocation target is the one selected sprint.
5.3 The analysis includes the target sprint's **capacity signal** and the Program Increment's **start date and
    end date** (the full runway), from which days-remaining is derived — reusing the existing PI-schedule
    signal but exposing **both ends of the window**, not only days-left. The plan may legitimately use the
    remaining PI time to complete the target sprint's scope.
5.4 The prompt states two **estimation conventions** so the assistant can judge feasibility against the
    calendar: (a) a **story point ≈ one estimated day of work** for the org, so point totals convert to
    day-of-effort estimates; and (b) an item's **time in the current status category** indicates how far along
    an in-progress item likely is (long time in an active category suggests nearer completion or a stall — a
    signal the assistant weighs, not a guarantee).

### Area 3 — The re-allocation prompt & delivery (Part 2 output)

**FR-6: Prompt content and instruction**
6.1 The operator **selects one target sprint** (from the canvas's defined sprints) to plan; the analysis
    generates a single **copy-out prompt** for that sprint, combining: the roster with roles (FR-3), the
    target sprint's assigned work grouped by person with per-item status/time-in-status (FR-5), the target
    sprint's capacity, the PI start/end window and estimation conventions (FR-5.3–5.4), and the
    additional-details constraints (FR-4). The selection defaults to the highest-priority / earliest sprint but
    is operator-changeable.
6.2 The prompt **instructs the assistant** to produce (a) a **re-allocation plan** — how to move work across
    the team, respecting that a person can only take work matching a role they hold, and using the remaining PI
    time — to maximize the chance of completing the **target sprint's** scope, and (b) an explicit **risk
    assessment** for completing it.
6.3 The prompt directs the assistant to **reason only from the data and constraints provided** and to **not
    invent** people, roles, assignments, or sprints — mirroring the guardrails in the existing canvas prompts.
6.4 The prompt is **legible and copyable** (visible in the panel, one-click copy), using the same copy
    mechanism as the existing accelerator (including the non-secure-context clipboard fallback).

**FR-7: One-way delivery, gated and additive (per Q1=A)**
7.1 The Work Re-Allocation analysis is a **one-way copy-out**: it presents no ingest/apply step and makes
    **no change** to the canvas overlay or to Jira.
7.2 The analysis lives inside the **existing passphrase-gated AI accelerator** and is invisible and inert
    unless AI Assist is unlocked; removing it entirely leaves every other canvas capability intact.
7.3 The analysis is **additive**: it does not alter the behavior of the existing size/priority/WIP/sequence/
    master-plan analyses.

**FR-8: Honest empty and error states**
8.1 When required inputs are missing (no roster for the active team, no sprints on the canvas, or no assigned
    work), the panel states **what is missing and where to fix it** rather than generating a hollow prompt.
8.2 When the roster has members but **none carry any role**, the panel warns that role-aware reasoning is
    degraded and points to the roster role editor.

## Success Criteria

1. **SC-1 — Roles are recordable and persistent**: An operator can set any combination of the three roles on
   every roster member, and 100% of those role selections are still present after closing and reopening the
   app (team-scoped).

2. **SC-2 — Roles are visible at a glance**: For any roster, the operator can read each member's role
   coverage without opening a detail view, in one glance.

3. **SC-3 — The prompt reflects reality, not invention**: For a selected target sprint, the generated prompt
   contains every active-team roster member with their roles, the target sprint's assigned child work grouped
   by person (each with status, time-in-status, and points), the PI start/end window, the story-point-as-days
   convention, and the verbatim additional-details — with zero invented people, sprints, or assignments.

4. **SC-4 — Constraints are honored end to end**: A constraint typed into additional-details (e.g. "only two
   devs can work ESI") appears verbatim in the prompt and is framed as a rule the assistant must respect.

5. **SC-5 — Risk is a first-class output**: 100% of generated prompts explicitly request both a re-allocation
   plan and a distinct risk assessment; a reader of the assistant's output can state the top risks to sprint
   completion without further prompting.

6. **SC-6 — Zero board/Jira side effects**: Generating and copying a re-allocation prompt changes no canvas
   overlay attribute and writes nothing to Jira (verifiable: overlay and issue state unchanged).

7. **SC-7 — Manual parity for roles**: An operator with no AI unlocked can fully use role capabilities; the
   only thing they lack is the plan-generation panel, not the roster enhancement.

8. **SC-8 — Additive safety**: With the new analysis present, the existing canvas AI analyses behave exactly
   as before (same prompts, same ingest behavior).

9. **SC-9 — Feasibility signals are present and correct**: For any in-progress item in the target sprint, the
   prompt carries its time-in-status; the PI window shows both start and end dates; and the story-point-as-days
   convention is stated — so a reader can judge whether the target sprint's remaining work fits the remaining
   PI days given available role capacity.

## Key Entities

| Entity | Source / Owner | Description |
|--------|----------------|-------------|
| Roster Member Role Capabilities | NodeToolbox roster (persisted, team-scoped) | The three independent capability flags — Developer, Internal Tester, External Tester — on each roster member, distinct from the existing `roleName` label |
| Active-Team Roster (with roles) | NodeToolbox roster store | The set of people the plan reasons about, each with name + role capabilities, scoped to the active team |
| Assigned Work Item | Jira child story/task under a canvas feature (read) | A story/task carrying assignee, raw status name + category, points, and **time in current status category** — the unit the plan re-allocates, grouped by person within the target sprint |
| Target Sprint (selected) | Canvas overlay container (sprint) | The one operator-selected sprint the plan focuses on (defaults to highest-priority); other sprints are named as context only |
| PI Runway | PI name's encoded date range | The Program Increment's **start and end dates** and derived days-remaining — the calendar the target sprint's work must fit into |
| Estimation Conventions | Operator/org convention stated in prompt | Story point ≈ one estimated day of work; time-in-status as a progress signal for in-progress items |
| Additional Details | NodeToolbox planning context (persisted) | Free-text operator constraints injected verbatim into the prompt (e.g. limited-skill pools, availability, testing freezes) |
| Re-Allocation Prompt | NodeToolbox (transient, copy-out) | The assembled, copyable prompt directing an external assistant to document a role-aware re-allocation plan and a risk assessment |
| AI Assist Gate | Existing passphrase mechanism | The Ctrl+Alt+Z unlock that makes the analysis visible; without it the analysis is inert |

## Assumptions

- **A1**: The role capabilities extend the **existing team-scoped roster** (`useStandupRosterStore`) rather
  than introducing a new people store; the roster is already the canonical team-people list shared across
  standup/DSU surfaces.
- **A2** *(confirmed — Q2=A)*: The three roles are fixed (Developer, Internal Tester, External Tester)
  and modeled as independent capabilities; per-person capacity math is deferred to additional-details.
- **A3** *(confirmed — Q1=A)*: The analysis is a one-way copy-out; it reuses the existing copy-paste
  accelerator's **prompt-generation and clipboard** infrastructure but has **no ingest** path, and never
  writes to the overlay or Jira.
- **A4** *(confirmed — Q3=A)*: The allocatable unit is the child story/task; the prompt carries child
  items grouped by person and sprint, with feature nodes as grouping context. The canvas already fetches
  child-story data (status, points, assignee) for each feature, so no new heavy fetch is required.
- **A5**: The plan targets **one operator-selected sprint** from the canvas's sprint containers (pulled from
  the board by the existing "pull sprints" path). It reuses the existing PI-schedule signal but exposes the
  PI's **start and end dates** (the full runway), not only days-remaining; it introduces no new sprint or
  schedule source.
- **A10**: The org convention **story point ≈ one estimated day of work** is stated in the prompt so the
  assistant can convert point totals to day-of-effort estimates and weigh them against the remaining PI days.
  This is a stated convention, not a stored per-team setting, in this release.
- **A11**: **Time in current status** is a per-item signal the prompt carries for in-progress items. Its exact
  source (e.g. Jira status-change history / changelog vs a status-age field) is a planning decision; it may
  require a read beyond the data the canvas already holds, which planning must account for. It is used as a
  soft progress heuristic, never as a definitive completion measure.
- **A6**: Additional-details text is persisted with the canvas planning context scoped to the active team /
  work scope, alongside the existing overlay persistence, and is not sent anywhere except into the copied
  prompt the operator pastes into their assistant.
- **A7**: The analysis is gated by the **existing AI Assist passphrase** and appears within the existing
  canvas suggestion accelerator; it introduces no always-on outbound AI channel.
- **A8** *(confirmed — clarify session)*: The prompt carries each work item's **raw Jira status name +
  status category verbatim** and does not itself classify a dev/internal-test/external-test phase. The
  assistant infers the phase from the real status text, aided by additional-details. No new workflow states,
  status mapping, or configuration are introduced — the tool stays honest about what Jira actually records.
- **A9**: The analysis uses the **people roster for the canvas's active Team-Dashboard profile** — the same
  profile key that already scopes both the roster (`useStandupRosterStore`) and the canvas overlay
  (`useCanvasScope`), filtered to the active team exactly as roster-scoped standup already does. No new
  team-resolution mechanism is introduced.

## Dependencies

- The existing **team-scoped roster** store and roster editor (Team Dashboard / Standup / DSU) — extended
  here with role capabilities.
- The existing **Feature Canvas** overlay, feature nodes, and their child-story data (features 009–011),
  including per-node assignee/status/points on child items.
- The existing **canvas sprint containers** and the "pull sprints from board" path that populates them.
- The existing **PI schedule** signal used by the current canvas AI analyses, extended to expose the PI's
  **start and end dates** (both ends of the runway), not only days-remaining.
- A source for each work item's **time in current status** (e.g. Jira status-change history) — potentially a
  read beyond the canvas's current data set, to be resolved at planning time.
- The existing **AI Assist passphrase gate** and the copy-paste accelerator's prompt-generation + clipboard
  infrastructure (prompt-out only; no new ingest).
- The existing team-profile / active-team configuration for scoping both the roster and the planning context.
