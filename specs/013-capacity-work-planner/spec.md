# Feature Specification: Prioritizer + Deterministic Capacity Work Planner

**Feature short name**: `capacity-work-planner`
**Created**: 2026-07-07
**Status**: Draft — design decisions locked with the operator (see Decisions); ready for `/speckit-plan`
**Supersedes**: the one-target-sprint copy-out model from feature 012 (roster roles from 012 are retained and depended upon)

## Summary

Testing feature 012 in production surfaced that a copy-out prompt over a single, manually-boxed sprint is the
wrong shape. Assigned work was "missing" because it depended on the operator having dragged features into sprint
boxes, and the tool couldn't answer the real question: **given who we have and what they can each do, when does
the backlog actually finish — and where is the bottleneck?**

This feature reframes the Feature Canvas from a *sprint board* into a **work prioritizer**, and adds a
**deterministic, role-aware capacity planner** on top of it:

- **Prioritizer (the canvas).** The operator arranges **work items — stories, sub-tasks, and defects** — into
  **MoSCoW buckets that are drag-orderable *within* each bucket**, because some *Must* items are more urgent than
  other *Must* items. Priority is expressed as **ranked tiers**, not sprint boxes; manual sprint-boxing is retired.

- **Planner (deterministic).** The operator selects **which priority buckets to include**, and the tool
  **builds task/sub-task-level sprints from team capacity** — no LLM arithmetic. It:
  - sizes each item by its **story points**, charged to its **assignee → that assignee's role**;
  - **proposes assignees** for unassigned work and **rebalances** overloaded people (proposal only — no Jira write);
  - **sequences dev → internal test → external test**, letting testing slip to a later sprint when the tester is full;
  - **surfaces the internal-testing bottleneck** and states **how many more internal testers** the scope needs;
  - **projects 2-week sprints past the PI end date** until the selected backlog is exhausted, so the operator sees
    a realistic finish date.

The **only non-deterministic seam** is classifying an item's role (dev / internal test / external test): the tool
uses **structured signals first** (issue type, a QA sub-task, an external-test issue link) and falls back to
reading the item's **summary/description** only when structure is ambiguous.

## Why this shape (product rationale)

- **Priority is a ranking, not a sprint.** A recovering team needs to say "these Musts first, then those" before it
  can plan. Ranked tiers capture urgency the four MoSCoW buckets alone cannot, and they decouple *what matters most*
  from *which sprint it lands in* (which the planner derives).
- **Capacity math must be trustworthy.** "When does this finish?" and "how many testers short are we?" are
  arithmetic — they must be computed deterministically, not guessed by an assistant. AI, if used at all, only
  narrates the computed plan.
- **The bottleneck is the point.** With many developers and one internal tester, testing — not development — is the
  critical path. Making that visible, and quantifying the staffing gap, is the feature's core value.
- **Reality over an idealized org chart.** Work is often unassigned or on the wrong person; the planner proposes a
  role-legal, capacity-aware assignment instead of assuming the current one is right.
- **See past the PI.** Backlogs rarely fit one PI. Projecting sprints beyond the PI end turns "we're behind" into a
  concrete date.

## Scope Boundary (explicit non-goals)

- **Out of scope (v1)**: Writing assignees, sprints, or any field back to Jira. The plan is a **read-only
  projection** plus a copy-out summary; the operator enacts changes in Jira. Write-back is a later increment.
- **Out of scope**: LLM-computed scheduling. The sprint fill, sequencing, projection, and bottleneck counts are
  deterministic. AI is limited to (a) the ambiguous-role classification fallback and (b) optional narration.
- **Out of scope**: Replacing the roster or the AI Assist gate (both reused). The seven role capabilities from
  feature 012 are a dependency.
- **Out of scope**: A full resource-leveling / constraint-solver optimum. The planner uses a transparent greedy
  fill in priority order, not an optimizer — explainability beats optimality here.
- **Out of scope**: Per-person calendars (PTO, holidays, ramp). Capacity is a flat 8 points/person/2-week sprint in
  v1; finer availability can come later (the additional-details style escape hatch may return).

## Decisions (locked with the operator, 2026-07-07)

These were resolved interactively over the design conversation; the spec is written against them.

| # | Decision | Resolution |
|---|----------|------------|
| D1 | Compute vs. prompt | **Deterministic engine** builds the plan; AI only narrates and does the ambiguous-role fallback. |
| D2 | Canvas role | **Prioritizer** — MoSCoW buckets with **drag-ordering within each bucket**; sprint-boxing retired. |
| D3 | Planner input | Operator **selects which priority buckets** to include; planner builds **task/sub-task-level** sprints. |
| D4 | Work item types | **Stories, sub-tasks, and defects** (not just stories). |
| D5 | Capacity | **8 points/person/2-week sprint**, **total** per person, spendable across **any role they hold**. Ignore the 20-pt box cap. |
| D6 | Roles → capacity | **Dev Lead** counts as dev capacity; **SM / PO / SA** add no delivery capacity. |
| D7 | Sizing | Each item's **story points** charged to its **assignee → role**. |
| D8 | Unassigned / rebalance | Planner **proposes** an assignee (role-legal + free capacity) for unassigned work and rebalances overloaded people — **proposal only**. |
| D9 | Role classification | **Structure-first**: internal test = a **QA sub-task**; external test = an **external-test issue link** (e.g. to an INTTEST-style project); dev = everything else. **Summary/description context** is the fallback only when structure is ambiguous. |
| D10 | Missing test work | When an item has no QA sub-task / external-test link, **synthesize** a testing cost — a **configurable default (start at 50% of dev points)** — flagged "estimated." |
| D11 | Sequencing | **dev → internal test → external test**; testing shares the dev sprint when the tester has capacity, else slips to the next sprint. |
| D12 | Bottleneck output | Surface the internal-testing bottleneck and report **how many more internal testers** are needed to (a) **match dev throughput** and (b) **finish by the PI end**. |
| D13 | Projection | Project **2-week sprints beyond the PI end** until the selected backlog is exhausted. |
| D14 | Output | **Read-only projection** in the UI + a **copy-out summary**; optional AI narration. No write-back v1. |

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**Story A — Prioritize with urgency (canvas):**
As a Scrum Master, I want to drag work items into MoSCoW buckets **and order them within each bucket**, so I can
express that some Musts are more urgent than others before anything is scheduled.

**Story B — Build a capacity plan from selected priorities:**
As a Scrum Master, I want to pick which priority buckets to plan and have the tool **build task-level sprints from
our real capacity** (8 pts/person, by role), so I get a schedule grounded in who we actually have.

**Story C — See the testing bottleneck and the staffing gap:**
As a Scrum Master with one internal tester, I want the plan to **show testing as the bottleneck** and tell me
**how many more testers** I'd need to keep pace / finish on time, so I can make the staffing case.

**Story D — See a realistic finish date beyond the PI:**
As a Scrum Master, I want sprints **projected past the PI end** until the selected work is done, so I can tell
stakeholders when the backlog realistically completes.

**Story E — Handle unassigned / mis-assigned work:**
As a Scrum Master, I want the planner to **propose assignees** for unassigned items and **rebalance** overloaded
people (role-legally), so the plan reflects a workable distribution, not today's accidental one.

**Story F — Trust the classification:**
As a Scrum Master, I want each item's dev/internal-test/external-test nature decided by **structure** (issue type,
QA sub-task, external-test link) with a **context fallback**, so the capacity math is right and explainable.

### Acceptance scenarios

- **Order within a bucket (D2)**: Given three Must items, when I drag them into an order, then that order persists
  and the planner consumes them in exactly that sequence.
- **Bucket selection (D3)**: Given Must and Should buckets, when I select only Must and build, then only Must-bucket
  items appear in the projected sprints.
- **Capacity fill (D5/D7)**: Given 3 developers (24 dev pts/sprint) and 40 dev points of Must work, when I build,
  then dev work fills ~2 sprints and no developer is scheduled beyond 8 points in a sprint.
- **Multi-role flex (D5/D6)**: Given a person marked Developer + Internal Tester, when the plan needs testing and
  they have unused points, then their remaining capacity can be spent on internal testing; a person marked only
  SM/PO/SA is never scheduled delivery work.
- **Bottleneck surfaced (D11/D12)**: Given 3 developers and 1 internal tester, when I build, then the plan shows
  internal testing lagging development into later sprints and states the number of additional internal testers
  needed to match dev throughput and to finish by the PI end.
- **Projection beyond PI (D13)**: Given more selected work than fits before the PI end, when I build, then sprints
  continue past the PI end date and the plan reports the projected completion sprint/date.
- **Classification: structure-first (D9)**: Given a QA sub-task under a story, when the plan runs, then that
  sub-task is counted as internal-testing effort against an internal tester; given an external-test link, that
  effort is counted as external testing; an item with neither is dev, and only a structurally-ambiguous item
  triggers the summary/description fallback.
- **Synthesized test cost (D10)**: Given a dev item with no QA sub-task/link, when I build, then the plan adds an
  estimated internal-testing cost (default 50% of dev points), visibly flagged as estimated.
- **Unassigned proposal (D8)**: Given an unassigned Must item, when I build, then the plan proposes an assignee who
  holds the matching role and has free capacity, marked as a proposal (nothing is written to Jira).
- **Read-only (D14)**: Across a full planning session, no Jira field changes; the output is the on-screen projection
  and a copyable summary.

## Functional Requirements

### Area 1 — Prioritizer (canvas reframe)

**FR-1: Ranked priority buckets.** The canvas presents work items in **MoSCoW buckets (Must/Should/Could/Won't)**
with a **stable, drag-editable order within each bucket**. The intra-bucket order is a persisted overlay attribute.

**FR-2: Work items include sub-tasks and defects.** Planable items are **stories, sub-tasks, and defects** — not
only stories. The prioritizer and planner operate at this item granularity.

**FR-3: Sprint-boxing retired.** The manual sprint/release container flow is removed from the planning path;
sprints are an **output** of the planner, not a manual arrangement. (Any existing overlay data is migrated or
ignored gracefully.)

### Area 2 — Capacity & role model

**FR-4: Flat per-person capacity.** Each roster person contributes **8 points per 2-week sprint**, as a **single
pool** spendable across **any delivery role they hold**. The prior 20-point container cap is not used.

**FR-5: Role → capacity mapping.** **Developer** and **Dev Lead** provide **development** capacity; **Internal
Tester** provides **internal-testing** capacity; **External Tester** provides **external-testing** capacity;
**Scrum Master / Product Owner / Solution Architect** provide **no delivery capacity**.

**FR-6: Item sizing by assignee → role.** Each item's **story points** are charged to its **assignee's** matching
role pool. Unassigned items are sized but await a proposed assignee (FR-9).

### Area 3 — Role classification (structure-first, context fallback)

**FR-7: Structured classification.** The tool classifies each item's role from structure: **internal testing** =
a **QA sub-task** (issue type / name convention); **external testing** = an **external-test issue link** (e.g. a
link to an INTTEST-style project or a named link type); **development** = anything not matching. The exact
issue-type names / project key / link type are configuration, confirmed against the instance.

**FR-8: Context fallback.** Only when an item matches **no** structured rule does the tool fall back to reading its
**summary/description** to classify it. This fallback is the sole place AI/heuristics may be used in classification,
and each fallback decision is labeled as inferred.

**FR-8a: Synthesized test cost.** When a dev item has **no** associated QA sub-task or external-test link, the
planner **adds an estimated internal-testing cost** — a **configurable fraction of the item's dev points (default
50%)** — visibly flagged as an estimate so the operator knows it is synthesized.

### Area 4 — Deterministic planner

**FR-9: Assignment & rebalancing (proposal only).** For unassigned items, the planner **proposes** an assignee who
holds the required role and has available capacity, in priority order. For overloaded people, it **rebalances**
excess work to others with the matching role and free capacity. All assignment changes are **proposals**; nothing
is written to Jira.

**FR-10: Deterministic sprint fill.** Given the selected priority buckets in their ranked order, the planner fills
**2-week sprints** greedily by capacity: development work consumes dev capacity; the item's internal- and
external-testing work consumes the respective tester capacity, **sequenced after its development** (FR-11). The fill
is deterministic and explainable (priority order + capacity), not an optimizer.

**FR-11: Dev → test sequencing.** An item's internal testing is scheduled in the **same sprint** as its development
when the internal tester has remaining capacity, otherwise in the **next** sprint; external testing follows
internal testing by the same rule. Testing never precedes its development.

**FR-12: Bottleneck detection & staffing gap.** The planner detects when a role (typically internal testing) is the
**limiting resource** and reports: the number of **additional people in that role** needed to (a) **match the
throughput** of the upstream role (so testing isn't the critical path) and (b) **complete the selected scope by the
PI end date**.

**FR-13: Projection beyond the PI.** The planner continues generating **2-week sprints past the PI end date** until
the selected work is fully scheduled, and reports the **projected completion sprint and date** (and how far beyond
the PI end it falls).

### Area 5 — Output

**FR-14: Read-only projection + copy-out.** The plan is presented **read-only**: the projected sprints (with each
person's per-sprint load by role), the bottleneck/staffing statement, and the completion projection. A **copy-out
summary** reproduces this for sharing. **No Jira write occurs.**

**FR-15: Optional AI narration (gated).** Behind the existing AI Assist gate, the operator may generate a narrative
summary of the **already-computed** plan (risks, the staffing case). The numbers come from the deterministic engine,
not the assistant; narration never changes them.

## Success Criteria

1. **SC-1 — Deterministic & reproducible**: Re-running the planner on the same inputs yields the **identical**
   sprint projection, bottleneck count, and completion date (no run-to-run variance).
2. **SC-2 — Capacity respected**: No person is scheduled more than **8 points in any sprint** across all their
   roles; SM/PO/SA-only people are never scheduled delivery work.
3. **SC-3 — Priority honored**: Items are scheduled in the operator's ranked bucket order; only selected buckets
   appear.
4. **SC-4 — Bottleneck quantified**: For a team with a role imbalance, the plan states a concrete number of
   additional people in the limiting role for both targets (match-throughput and finish-by-PI-end).
5. **SC-5 — Realistic finish**: The plan reports a projected completion sprint/date, including when it lands beyond
   the PI end.
6. **SC-6 — Classification correctness**: QA sub-tasks and external-test links are counted as their respective
   testing effort; only structurally-ambiguous items use the context fallback, and those are labeled inferred.
7. **SC-7 — Zero writes**: A full planning session changes no Jira field (verified against issue state).
8. **SC-8 — Explainable**: For any scheduled item, the operator can see why it landed in its sprint (priority rank +
   whose capacity it consumed + dev→test sequencing).

## Key Entities

| Entity | Description |
|--------|-------------|
| Priority Bucket (ranked) | A MoSCoW bucket with an ordered list of work items; intra-bucket order is a persisted overlay attribute |
| Planable Work Item | A story, sub-task, or defect with points, assignee, type, links, and a classified role |
| Role Classification | dev / internal-test / external-test, from structured signals (issue type, QA sub-task, external-test link) with a context fallback |
| Capacity Pool | Per person, 8 points/sprint, spendable across the delivery roles they hold |
| Assignment Proposal | A proposed (unassigned→person) or rebalanced (person→person) assignment; never written to Jira |
| Projected Sprint | A 2-week sprint the engine fills, possibly beyond the PI end; holds each person's load by role |
| Bottleneck Report | The limiting role + additional-headcount needed to match throughput and to finish by PI end |
| Completion Projection | The sprint/date the selected scope finishes, and its offset beyond the PI end |

## Assumptions

- **A1**: The seven roster role capabilities (Developer, Internal/External Tester, Scrum Master, Product Owner,
  Solution Architect, Dev Lead) from feature 012 exist and are the capacity source. Delivery roles: Dev/Dev Lead →
  dev, Internal Tester → internal test, External Tester → external test.
- **A2**: A story point equals one estimated day of work; effective capacity is **8 points/person/2-week sprint**
  (overhead already baked in), overriding the story-point-days×10 arithmetic.
- **A3**: The instance exposes structured signals for testing work — a **QA sub-task** issue type/name and an
  **external-test link** (INTTEST-style project or named link type). Exact names/keys are configuration confirmed
  against the instance during planning. *(Confirm the concrete values.)*
- **A4**: **Defects** are planable work items surfaced alongside stories (as feature children and/or the canvas's
  existing surfacing). *(Confirm the exact defect source — feature children vs. a dedicated query — during planning.)*
- **A5**: Data fetch expands to include **sub-tasks** (points, assignee, type) and **child issue links**, which the
  canvas does not fully fetch today; this is a planning-phase data task.
- **A6**: Assignment changes are **proposals only** in v1; the planner never writes to Jira.
- **A7**: Sprint length is **2 weeks**; projection anchors to the PI start / current sprint boundary and continues
  past the PI end.
- **A8**: The role-classification **context fallback** (summary/description) is the only AI/heuristic step in the
  numeric pipeline and is used solely when structure is ambiguous; the capacity math is fully deterministic.

## Dependencies

- Feature 012 roster **role capabilities** (all seven) and the AI Assist gate (for optional narration + the
  classification fallback).
- The Feature Canvas overlay, feature/child data model, and surfacing (features 009–011) — reframed here from
  sprint-boxing to ranked prioritization.
- An **expanded Jira fetch** for sub-tasks (points/assignee/type) and child issue links.
- The PI schedule signal (`piSchedule`) for the PI start/end window that projection extends beyond.
- Instance configuration for the structured classification signals (QA sub-task type, external-test project/link).
