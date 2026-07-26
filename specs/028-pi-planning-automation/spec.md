# Feature Specification: PI Planning Automation

**Feature Branch**: `feature/028-pi-planning-automation`

**Created**: 2026-07-26

**Status**: Draft

**Input**: User description: "id like to enhance the canvas feature. I want to automate story creation, sprint creation, sprint assignment from the PI Review page. I want to see full capacity mapping. This will require the ai assist pattern we've already developed. I prompt ai with the details of the pi review tab. It knows the team capacity, the team roster, the size of each feature, and the dates of the PI. I want to use the same rules we already have which I think is a 70/30 split in effort between dev and internal testing. Every story that has testable output should have a sub-task for internal testing the target end date for each testing sub-task will drive when external testing can begin. Each story should have a sub-task for deploying to INT, REL, PROD the expectation will be that within 24 hours of internal test complete the deploy to INT will be complete. 5 days after deploy to INT we will deploy to REL, deploy to production will happen on the date of the fixVersion. What else could we possibly need to include in this prompt so that an agent can successfully and repeatably breakdown features into stories, plan the PI Sprint schedule and ensure that our target start, target end, and due dates are populated? I think we need a production release schedule which is just the already populated fixVersions in Jira that fall between the dates of the pi. Target start is when we start working, target end is when code is in INT and target end is when the issue is delivered to production. If additional releases are required to meet the timeline they can and should be suggested but we want to try to keep production releases to monthly and our DoD is only to INT features can be deployed to production after the PI end."

## Context

The PI Review surface already gathers everything needed to plan an increment: the team roster, per-person and per-sprint capacity, every Feature targeted at the PI with its point size, and the PI's start and end dates. Today a Product Owner turns that raw picture into an executable plan **by hand** — splitting each Feature into Stories, adding the standard internal-test and deploy sub-tasks, deciding which sprint each piece lands in, checking nobody is over-committed, and typing Target Start / Target End / Due dates onto dozens of issues. The work is slow, easy to get wrong, and inconsistent from one planner to the next because the scheduling rules live in people's heads.

This feature adds an **AI-assisted PI planner** to the PI Review surface. From the PI Review context the planner proposes a complete, rules-driven PI plan — a Feature→Story breakdown, the standard sub-task scaffold (internal testing plus deploy-to-INT/REL/PROD), a capacity-aware sprint schedule, and populated Target Start / Target End / Due dates — following a fixed, written set of scheduling rules so two runs over the same inputs produce the same plan. It also renders a **full capacity map** so the planner can see, before committing anything, whether the proposed plan actually fits the team.

The planner follows the project's established **propose-only AI pattern**: the user unlocks AI assist, the prompt is generated from the PI Review data, the AI's reply is ingested as structured data, and **nothing is written to Jira until the user reviews and accepts it** — per item. There is no automated AI channel and no background writer.

## Clarifications

### Session 2026-07-26

- Q: Effort-to-duration basis (how a point size becomes calendar dates)? → A: Velocity-based — points-per-working-day is derived from the team's committed sprint capacity ÷ working days per sprint; a Story consumes `size ÷ rate` working days.
- Q: How does the planner assign a Story to a specific roster member? → A: Capability-filtered, least-loaded — the engine assigns each Story to the eligible member (has the required capability) with the most remaining capacity in the target sprint; the PO can override before accepting.
- Q: Where does the PI's sprint calendar come from? → A: Existing team-board sprints in the PI window are authoritative; the planner only derives (from PI start + configured sprint length) and proposes creating sprints to fill any part of the window they do not cover.
- Q: Maximum Story size for the splitting rubric? → A: 13 points, and never more than a single assignee's remaining capacity in one sprint (whichever is smaller).
- Q: Is the "5 days" from INT to REL calendar days or working days? → A: 5 **working** days (INT + 5 working days), consistent with all other date math being in working days.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate a rules-driven PI plan from PI Review (Priority: P1)

A Product Owner viewing the PI Review tab for a selected team and PI unlocks AI assist and requests a plan. The planner assembles the full planning context (roster, capacity, Features and sizes, PI dates, sprint calendar, and the production release schedule), produces a prompt, and — once the AI reply is pasted back — presents a proposed plan: for each Feature, a set of Stories; for each Story with testable output, an internal-testing sub-task and deploy-to-INT/REL/PROD sub-tasks; each item placed in a sprint, assigned to a roster member, and carrying Target Start, Target End, and Due dates. The PO reviews the proposal and accepts the items they want; accepted items are created/updated in Jira.

**Why this priority**: This is the core value — turning the PI Review picture into an executable, correctly dated plan without manual data entry. Without it, nothing else matters. It is the MVP.

**Independent Test**: With a team, a PI, and at least one sized Feature selected in PI Review, generate a prompt, paste a well-formed reply, and confirm the proposed Stories + sub-tasks + dates render for review and that accepting an item creates the corresponding Jira issue with the stated dates. Fully testable on its own.

**Acceptance Scenarios**:

1. **Given** a PI Review tab with a selected team, a PI with defined start/end dates, and one or more Features with point sizes, **When** the PO generates a planning prompt, **Then** the prompt contains the complete input set (PI dates, sprint calendar, roster with capabilities, per-person/per-sprint capacity, each Feature key/summary/size, the production release schedule, and the encoded scheduling rules).
2. **Given** a generated prompt, **When** the PO pastes a well-formed AI reply, **Then** the planner shows a per-item proposal (Stories, sub-tasks, assignee, sprint, Target Start/End, Due date) with each item individually acceptable or dismissable, and writes nothing to Jira until an item is accepted.
3. **Given** a proposed Story the PO accepts, **When** acceptance is confirmed, **Then** the Story is created under its parent Feature with the proposed Target Start, Target End, and Due date, and its accepted sub-tasks are created beneath it.
4. **Given** an AI reply that is malformed or references a Feature not in the current PI scope, **When** it is ingested, **Then** the planner rejects the unusable portions with a clear reason and still surfaces the valid remainder, never writing partial/garbage issues.

---

### User Story 2 - Full capacity mapping (Priority: P1)

Before committing the plan, the PO sees a capacity map: for each roster member and each sprint in the PI, the committed effort from the proposed plan against that person's available capacity, with over- and under-allocation clearly flagged, plus a per-sprint and PI-wide roll-up. The same numbers that drive the schedule drive the map, so the map can never disagree with the plan.

**Why this priority**: A plan the team cannot physically deliver is worse than no plan. The capacity map is what makes the proposal trustworthy and lets the PO rebalance before writing anything to Jira. It is tightly coupled to US1 and equally load-bearing.

**Independent Test**: Given a proposed plan, confirm the capacity map shows committed-vs-available per person per sprint, flags any person whose committed effort exceeds available capacity in a sprint, and that the totals equal the sum of the assigned work — verifiable without writing to Jira.

**Acceptance Scenarios**:

1. **Given** a proposed plan with assignments, **When** the capacity map renders, **Then** each roster member shows committed effort vs available capacity for every sprint in the PI and a PI-total row.
2. **Given** a person committed above their available capacity in a sprint, **When** the map renders, **Then** that cell is flagged as over-allocated with the overage amount shown.
3. **Given** the plan changes (an item accepted, dismissed, or reassigned), **When** the map re-renders, **Then** committed totals update so the map and the plan always agree.

---

### User Story 3 - Deterministic date & deploy-cadence population (Priority: P2)

For every planned issue, the planner computes Target Start, Target End, and Due date, and the deploy-cadence sub-task dates, strictly from the written rules and the production release schedule — and can explain, per issue, how each date was derived. Target Start is when work begins; Target End is when the code is in INT (the Definition of Done for the PI); Due date is when the issue reaches production. Internal-test completion sets when external testing may begin; deploy-to-INT follows internal-test completion within one day; deploy-to-REL follows INT by five days; deploy-to-PROD lands on a production release date.

**Why this priority**: Correct, explainable dates are the point of the automation, but they build on the breakdown and schedule from US1. Separating this out lets the date math be validated and demonstrated on its own.

**Independent Test**: Given a Story with a known assigned sprint and a known target release, confirm the five derived dates (Target Start, Target End, internal-test end, INT, REL, PROD/Due) match the rules exactly, and that each date shows a plain-language derivation.

**Acceptance Scenarios**:

1. **Given** a Story sized in points assigned to a sprint, **When** dates are computed, **Then** Target Start equals the point at which its work begins, Target End equals the date the code is expected to be in INT, and the effort is split 70% development / 30% internal testing.
2. **Given** a Story with testable output, **When** its cadence is computed, **Then** deploy-to-INT is no later than one day after internal-test completion, deploy-to-REL is five working days after INT, and deploy-to-PROD falls on a production release date on or after REL.
3. **Given** a Story whose production release date falls after the PI end, **When** dates are computed, **Then** the Due date is still set to that release date (production after the PI end is allowed) while Target End (code-in-INT) remains within the PI.
4. **Given** any computed date, **When** the PO inspects it, **Then** a short explanation states which rule and which input produced it.

---

### User Story 4 - Sprint creation and assignment (Priority: P2)

On acceptance, the planner ensures the PI's sprints exist and assigns each accepted Story to its planned sprint and roster member. Sprints already present are reused, not duplicated; only genuinely missing sprints are created.

**Why this priority**: Placing work into real sprints and owners is what makes the plan actionable in Jira, but it depends on an accepted breakdown (US1) and a feasible schedule (US2). It is a natural second increment.

**Independent Test**: Given an accepted plan for a PI whose sprints partially exist, confirm the existing sprints are reused, missing sprints are created once, and each accepted Story is assigned to the correct sprint and assignee.

**Acceptance Scenarios**:

1. **Given** an accepted Story planned for a sprint that already exists, **When** assignment runs, **Then** the Story is placed in the existing sprint and no duplicate sprint is created.
2. **Given** an accepted Story planned for a sprint that does not yet exist, **When** assignment runs, **Then** the sprint is created once and the Story is placed in it.
3. **Given** an accepted Story with a proposed assignee, **When** assignment runs, **Then** the Story's assignee is set to that roster member.

---

### User Story 5 - Production release schedule awareness and suggestions (Priority: P3)

The planner reads the fixVersions in Jira whose release dates fall within the PI window and treats them as the production release calendar. Production deploys are scheduled onto those dates. When meeting the timeline would require a release that does not exist, the planner **suggests** an additional release (aiming to keep production releases roughly monthly) rather than silently inventing one — the suggestion is presented for the PO to accept.

**Why this priority**: Release awareness improves the realism of PROD dates and surfaces gaps, but the plan is still usable with the existing releases alone. It refines rather than blocks the core flow.

**Independent Test**: Given a PI window with two fixVersions and a Story whose timeline needs a third release, confirm the two existing releases are used as-is and a third monthly release is proposed as an explicit, acceptable suggestion — never written without acceptance.

**Acceptance Scenarios**:

1. **Given** fixVersions with release dates inside the PI window, **When** the planner builds the release schedule, **Then** those releases (name + date) form the production release calendar and PROD deploys are placed on them.
2. **Given** a Story whose earliest possible PROD date has no release on or after it, **When** the planner schedules PROD, **Then** it suggests an additional release positioned to keep releases roughly monthly, flagged as a suggestion requiring acceptance.
3. **Given** no fixVersions fall within the PI window, **When** the planner runs, **Then** it reports the empty release schedule honestly and proposes a monthly release cadence rather than failing.

---

### User Story 6 - Idempotent re-planning (Priority: P3)

Re-running the planner over a PI that has already been partially planned does not duplicate existing Stories, sub-tasks, or sprints. Existing breakdown is recognized and the proposal augments or updates it rather than recreating it.

**Why this priority**: Planning is iterative; a PO will run the planner more than once as scope shifts. Protecting against duplicates makes the tool safe to re-run, but the first run delivers value without it.

**Independent Test**: Given a Feature that already has one Story and its sub-tasks, re-run the planner and confirm the existing Story is not duplicated and only genuinely new items are proposed for creation.

**Acceptance Scenarios**:

1. **Given** a Feature that already has child Stories, **When** the planner proposes a breakdown, **Then** existing Stories are recognized and not proposed again as new creations.
2. **Given** a Story that already has an internal-test or deploy sub-task, **When** the planner proposes sub-tasks, **Then** the existing sub-task is not duplicated.

---

### Edge Cases

- **PI with no sized Features**: the planner reports that there is nothing to plan (honest empty state) rather than producing an empty proposal that looks like success.
- **Feature with no point size**: the Feature is surfaced as unplannable-until-sized rather than silently assigned zero effort.
- **Roster with no one capable of a required role** (e.g., no internal tester): the planner flags the capability gap instead of assigning testing work to someone who cannot do it.
- **Team over-committed for the whole PI** (total proposed effort exceeds total capacity): the plan is still shown, but the capacity map flags the PI as over-committed and identifies the overflow so scope can be cut.
- **Story too large to fit any single sprint**: the planner splits it further or flags it as needing to be split, rather than placing an impossible commitment.
- **fixVersion release date lands on a non-working day**: the deploy date is resolved deterministically (documented rule) rather than left ambiguous.
- **Deploy-to-REL (INT + 5 days) or PROD date computed to fall on a weekend/holiday**: resolved by the same documented working-day rule.
- **AI reply proposes an assignee not on the roster, or a sprint outside the PI**: that item is rejected with a reason; the rest of the plan is unaffected.
- **AI reply omits dates or proposes dates that violate the rules**: the planner recomputes dates from the rules rather than trusting AI-supplied dates that break the cadence.

## Requirements *(mandatory)*

### Functional Requirements — Planning inputs (the AI prompt contract)

The complete, repeatable input set the planner MUST assemble and include in the prompt. This section directly answers "what else could we possibly need to include so an agent can repeatably break down Features and plan the schedule."

- **FR-001**: The planner MUST include the **PI identity and window** — the PI name and its start and end dates.
- **FR-002**: The planner MUST include the **sprint calendar** — the ordered list of sprints in the PI, each with its start and end dates and its length, so work can be placed in a specific sprint. The calendar MUST be sourced from the team board's **existing sprints** that fall in the PI window; where those sprints do not fully cover the window, the planner MUST derive additional sprints from the PI start date and the configured sprint length to complete the calendar (these derived sprints are the ones proposed for creation in FR-053 / US4).
- **FR-003**: The planner MUST include a **working-day calendar** — which days are non-working (weekends and, where known, organisational holidays) — because every derived date is computed in working days and cadence dates must avoid non-working days.
- **FR-004**: The planner MUST include the **team roster** with, for each member, their identity and their **role capabilities** (whether they can perform development, internal testing, and/or external testing), so work is only assigned to people who can do it.
- **FR-005**: The planner MUST include **capacity** — each member's available capacity per sprint and the team's total capacity per sprint — expressed in the same unit as Feature/Story sizing, so committed effort can be measured against it.
- **FR-006**: The planner MUST include, for **each Feature in the PI scope**, its key, summary, point size, priority/rank, any known dependencies on other Features, its target fixVersion (if set), and any Stories/sub-tasks it already has.
- **FR-007**: The planner MUST include the **production release schedule** — the fixVersions whose release dates fall within the PI window, each as a name and release date — as the calendar onto which production deploys are placed.
- **FR-008**: The planner MUST include the **encoded scheduling rules as explicit constants** in the prompt (the 70/30 split, the ≤24h INT rule, the INT+5-day REL rule, PROD-on-fixVersion, the monthly production-release target, and the to-INT Definition of Done), so the plan does not depend on the AI remembering unstated conventions.
- **FR-009**: The planner MUST include the **story-splitting rubric** — the definition of "testable output," the maximum Story size, and the independent-testability expectation — so the breakdown is repeatable rather than a matter of AI taste.
- **FR-010**: The planner MUST include the **effort-to-duration basis** — a Story's point size becomes an amount of working time using a **velocity-based** conversion: points-per-working-day is derived from the team's committed sprint capacity ÷ working days per sprint, and a Story consumes `size ÷ rate` working days — so Target Start/End can be derived on the calendar rather than guessed.
- **FR-011**: The planner MUST include the **issue-shape mapping** — the naming/typing convention for the internal-test and INT/REL/PROD deploy sub-tasks and which fields carry Target Start, Target End, Due date, and fixVersion — so accepted proposals map onto real Jira issues deterministically.

### Functional Requirements — Breakdown rules

- **FR-020**: For each in-scope Feature, the planner MUST propose one or more Stories whose sizes sum to a breakdown of the Feature and each of which is independently testable per the rubric (FR-009).
- **FR-021**: For every Story that has **testable output**, the planner MUST propose one **internal-testing sub-task**; the internal-testing sub-task's target end date is the signal for **when external testing may begin**.
- **FR-022**: For every Story, the planner MUST propose **deploy sub-tasks for INT, REL, and PROD**.
- **FR-023**: The planner MUST split each Story's effort **70% development / 30% internal testing**.
- **FR-024**: The planner MUST NOT propose a Story larger than **13 points**, nor larger than the intended assignee's remaining capacity in a single sprint (whichever limit is smaller); oversized work MUST be split further or flagged.
- **FR-025**: The planner MUST assign each Story to a roster member using a **capability-filtered, least-loaded** rule — among members who hold the capability the work requires, choose the one with the most remaining capacity in the target sprint — and MUST allow the PO to override any assignment before acceptance. Assignment is computed by the planner engine, not supplied by the AI.

### Functional Requirements — Schedule & date rules

- **FR-030**: The planner MUST set **Target Start** to the working day on which the issue's work is planned to begin (respecting sprint boundaries and any dependency ordering).
- **FR-031**: The planner MUST set **Target End** to the date the issue's code is expected to be **in INT** — this is the Definition of Done used for the PI.
- **FR-032**: The planner MUST set the **Due date** to the date the issue is expected to be **delivered to production** (the production release date).
- **FR-033**: The planner MUST schedule **deploy-to-INT no later than 24 hours after internal-test completion**.
- **FR-034**: The planner MUST schedule **deploy-to-REL five working days after deploy-to-INT**.
- **FR-035**: The planner MUST schedule **deploy-to-PROD on a production release date** (a fixVersion date) on or after the REL date.
- **FR-036**: The planner MUST treat **"code in INT" as the Definition of Done for the PI**; a production deploy MAY occur **after the PI end date**, and the planner MUST allow Due dates beyond the PI end while keeping Target End within the PI.
- **FR-037**: When the timeline needs a production release that does not exist, the planner MUST **suggest** an additional release aiming to keep production releases **roughly monthly**, presented as an acceptable suggestion rather than silently created.
- **FR-038**: The planner MUST resolve any cadence date that lands on a non-working day using a single documented working-day rule, so dates are never ambiguous.

### Functional Requirements — Capacity mapping

- **FR-040**: The planner MUST render a **capacity map** showing, per roster member and per sprint, committed effort from the proposed plan against available capacity, plus per-sprint and PI-total roll-ups.
- **FR-041**: The capacity map MUST **flag over-allocation** (committed > available) for any person-sprint cell and show the overage.
- **FR-042**: The capacity map and the schedule MUST be driven by **one shared computation** so they cannot disagree (agree-by-construction); committed totals MUST equal the sum of assigned work.

### Functional Requirements — AI-assist envelope & Jira writes

- **FR-050**: The planning prompt MUST be generated on demand and the AI reply MUST be ingested as **structured data**, following the project's existing propose-only AI pattern; the feature MUST NOT open any automated or background AI channel.
- **FR-051**: AI-assist features MUST be **gated behind the existing AI unlock**; the planner's prompt generation and reply ingestion are unavailable until AI assist is unlocked.
- **FR-052**: Every proposed item (Story, sub-task, sprint, assignment, date set) MUST be **individually reviewable and individually acceptable or dismissable**; nothing is written to Jira without explicit per-item acceptance.
- **FR-053**: On acceptance, the planner MUST create/update the corresponding Jira issues (Stories under their parent Feature; internal-test and deploy sub-tasks under their Story), set the assignee, place the issue in its sprint, and populate Target Start, Target End, Due date, and fixVersion per the mapping (FR-011).
- **FR-054**: The planner MUST **recompute dates from the rules** rather than trusting AI-supplied dates that violate the cadence, so an accepted item always carries rules-consistent dates.
- **FR-055**: The planner MUST be **idempotent on re-run** — existing Stories, sub-tasks, and sprints MUST be recognized and not duplicated.
- **FR-056**: The planner MUST present **honest states**: empty scope, unsized Features, missing role capabilities, an empty release schedule, and PI-level over-commitment MUST each be reported clearly rather than hidden behind an apparently-successful empty or partial plan.

### Key Entities

- **Program Increment (PI)**: the planning window — name, start date, end date; contains an ordered set of Sprints and a set of in-scope Features.
- **Sprint**: a time-boxed interval within the PI — start date, end date, capacity per member and total.
- **Feature**: a unit of scope targeted at the PI — key, summary, point size, priority/rank, dependencies, target fixVersion, existing child Stories.
- **Story**: a proposed child of a Feature — size, assignee, sprint, Target Start, Target End, Due date, whether it has testable output.
- **Sub-task**: a child of a Story — one of {Internal Test, Deploy INT, Deploy REL, Deploy PROD}, each with its own scheduled date; the Internal Test sub-task's end date gates external testing.
- **Roster Member**: a team member — identity, role capabilities (dev / internal test / external test), per-sprint capacity.
- **Release (fixVersion)**: a production release — name, release date; the calendar for PROD deploys; may be an existing Jira fixVersion or a suggested addition.
- **Plan Proposal**: the reviewable output — a set of Plan Items (Stories, sub-tasks, sprint creations, assignments, date sets), each independently acceptable, each carrying its derivation.
- **Capacity Map**: the per-member, per-sprint committed-vs-available view derived from the same computation as the schedule.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a PI with sized Features, a PO can go from PI Review to a reviewable, fully dated PI plan proposal in a single guided flow without manually typing any Story, sub-task, or date.
- **SC-002**: Every accepted Story and sub-task is created in Jira with Target Start, Target End, and Due date populated, and with an assignee and sprint — with zero manual date entry.
- **SC-003**: Running the planner twice over unchanged inputs produces the same plan (same breakdown, same dates, same assignments), demonstrating repeatability.
- **SC-004**: The capacity map's committed totals equal the sum of assigned work in every case, and every person-sprint over-allocation is flagged — the map never disagrees with the plan.
- **SC-005**: 100% of computed dates conform to the rules (70/30 split; INT ≤24h after internal test; REL = INT + 5 working days; PROD on a release date; Target End within the PI; Due date may exceed the PI end) and each date can be explained from its rule and input.
- **SC-006**: Re-running the planner over a partially planned PI creates no duplicate Stories, sub-tasks, or sprints.
- **SC-007**: Nothing is ever written to Jira without explicit per-item acceptance, and AI features are unavailable until AI assist is unlocked.

## Assumptions

- **Surface**: the planner lives on the existing PI Review surface (the PI Review tab, reachable from the PO Tool / Agile Hub), reusing its current team and PI selection rather than introducing a separate selection.
- **Sizing unit**: capacity, Feature size, and Story size are all expressed in the same unit already used by PI Review (story points); the 70/30 split and effort-to-duration conversion operate in that unit.
- **Effort-to-duration basis** (FR-010): resolved in Clarifications — velocity-based (points-per-working-day = sprint capacity ÷ working days per sprint; a Story consumes `size ÷ rate` working days).
- **Assignment & sprint calendar**: resolved in Clarifications — capability-filtered least-loaded assignment (PO-overridable); sprint calendar taken from existing board sprints, derived only to fill uncovered parts of the PI window.
- **"Testable output"** (FR-009 / FR-021): every Story is assumed to have testable output — and therefore gets an internal-test sub-task — unless it is explicitly a non-deliverable (e.g., spike/research) Story; the AI is asked to classify this and the PO can override.
- **Working-day rule** (FR-003 / FR-038): dates are computed in working days; weekends are non-working by default, organisational holidays are honoured where a holiday calendar is available; a cadence date that lands on a non-working day rolls to the next working day.
- **Deploy cadence units**: resolved in Clarifications — the INT→REL gap is **five working days**; the ≤24h INT rule and the monthly production cadence are likewise interpreted against the working-day rule above.
- **Definition of Done**: the PI DoD is "code in INT"; production deploys are expected to happen on release dates that may fall after the PI end.
- **Release schedule source**: the production release schedule is read from existing Jira fixVersions whose release dates fall inside the PI window; suggested additional releases are proposals only.
- **Reuse**: the feature reuses the existing PI Review data, capacity model, roster, and the established AI-assist unlock/prompt/ingest pattern; per the Framework-First principle it builds custom logic only for the planning/date computation that does not already exist, and (per agree-by-construction) the capacity map and schedule share one computation.
- **Propose-only**: consistent with the project's standing AI constraint, there is no automated or scheduled AI writer; the planner only proposes and the human accepts.
- **Story ordering within a Feature**: absent explicit dependencies, Stories of a Feature are schedulable in parallel subject to capacity; declared dependencies constrain Target Start ordering.

## Out of Scope

- Executing tests, deployments, or releases — the planner schedules and dates them; it does not run them.
- Scheduling or coordinating **external** testing beyond emitting the internal-test end date that signals when external testing may begin.
- Cross-team or multi-team PI planning — the planner operates on the single team/PI selected in PI Review.
- Changes to the existing capacity model, roster, or PI Review selection behaviour beyond consuming them.
- Any automated, scheduled, or background AI planning — all AI use is on-demand, gated, and propose-only.
- Re-flowing or re-dating already-in-progress work based on live progress — the planner produces a plan; tracking actuals against it is a separate concern.
