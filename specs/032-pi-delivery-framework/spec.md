# Feature Specification: PI Delivery Framework — Plan-Once, Monitor-Continuously

**Feature Branch**: `feature/032-pi-delivery-framework`

**Created**: 2026-07-27

**Status**: Draft

**Input**: User description (distilled from the 2026-07-27 delivery-framework call and follow-up): "Once we commit to Features in the PI Review page we pass those to the Canvas. The AI assist generates a prompt that builds the entire PI — all 5 sprints worth of deliverables — using the point distribution to set Target Start / Target End dates, propose the fixVersion, and highlight expected bottlenecks with mitigation strategies (devs doing more unit testing, time-boxing SL testing to keep a consistent flow, some SL testing on every issue). The goal is to replan the PI so that all we're doing is monitoring whether we're on track, rather than actively planning. Use a fixed set of queries to keep the prompts tight and minimize the chance a hallucination produces a bad plan."

## Context

The organisation's Jira **hygiene** is the blocker to every cross-team improvement: because status, dates, and
ownership are inconsistent, the data cannot be trusted, so nothing downstream can be automated or reported on with
confidence. This feature fixes hygiene at the source by making the **plan itself** the source of truth: a Program
Increment (PI) is planned **once**, deterministically and completely, and thereafter the team's job is to **monitor
adherence** to that plan — not to re-plan continuously.

The framework establishes one consistent ownership hierarchy across every repository:

- **Feature** — a **business outcome**, owned by the Product Owner. Used for planning, prioritisation, and business
  acceptance. Not delivery work itself.
- **Story / Defect** — **delivery work that spans one or more repositories**, owned by assigned developers. Its
  workflow status is advanced automatically by GitHub activity (commit / PR opened / PR merged), not by hand.
- **Sub-task** — a **deployment or validation checkpoint**, owned by developers and shift-left (SL) testers. Gives
  granular visibility (who is coding which repo, whether SL test is done, how far through deployment the work is).

The central change from the earlier proposal (feature 031) is that the **repository maps 1:1 to a Sub-task, not to a
Story**. A single Story bridges front-end and back-end work under one **primary owner**; each repository it touches
becomes its own coding Sub-task, so different developers can be isolated to their repository and **work the same
Story in parallel**. This directly resolves the team's objection that a story-per-repo model created excessive churn
and split identical functionality (e.g. a DB change and a UI change) across separate stories that a tester would have
to validate together anyway.

The team chose **Sub-tasks over smart checklists** for the checkpoints, because sub-tasks block story closure until
complete (out of the box), can be **story-pointed separately** (this Jira instance allows it — SL testers need it),
and yield **timeline metrics** (when each checkpoint completed). Smart checklists remain **optional inside a Sub-task**
for teams working especially complex code, at the developer's discretion.

**Definition of Done = SL testing complete AND the work delivered to INT.** Production is **not** required for DoD.
The work is still **tracked** all the way to production through deployment checkpoints (INT → REL → PROD), but the
team does **not** track INT or REL testing — that testing is performed by other teams (QE in INT, BT in REL) on their
own boards and connected back only through Jira issue links. The **only** test checkpoint this workflow owns is SL
test.

To make the AI-assisted planning trustworthy, the design is built on an **anti-hallucination query layer**: a fixed
set of queries assembles a deterministic **PI Planning Fact Sheet** that both (a) the deterministic planning engine
consumes and (b) is embedded verbatim in the AI prompt. The AI therefore reasons only over stated facts; it proposes
only the **story decomposition** and a **mitigation narrative**, while the engine owns every date, capacity number,
assignment, sprint, fixVersion, and — critically — the **bottleneck detection** itself. Anything the AI returns that
references a repository, person, sprint, or issue key **not present in the fact sheet is rejected on ingest**.

This feature must not bend the project's **AI rules**: planning is **propose-only** (a prompt the operator runs in
their own assistant, a structured reply pasted back — **no automated or background AI**), **gated** behind the AI
unlock (Ctrl+Alt+Z), applied **per item on explicit accept**, and it **never attributes content to AI**. All dates,
capacity, and bottleneck findings are **recomputed from rules** and never trusted from the reply.

## Clarifications

### Session 2026-07-27

- Q: Does a repository map 1:1 to a Story or to a Sub-task? → A: **To a Sub-task.** A Story spans repositories under a
  primary owner; each repository touched becomes one coding Sub-task. This **replaces** feature 031's one-Story-per-repo
  generation. Applies to Features **and** multi-repo Defects.
- Q: Sub-tasks or smart checklists for the deployment/validation checkpoints? → A: **Sub-tasks** (they block story
  closure, can be pointed separately for SL testers, and give timeline metrics). Smart checklists remain **optional
  inside** a sub-task for complex work.
- Q: What is the sub-task scaffold per Story? → A: One **coding** sub-task per repository, **one SL-test** sub-task,
  and **per-story** deploy checkpoints **[INT] [REL] [PROD]** (deploys are per-story, not per-repo, to avoid an
  explosion of sub-tasks).
- Q: What is the Definition of Done? → A: **SL testing complete AND delivered to INT.** Production is not required for
  DoD, but the work is tracked through PROD.
- Q: Is INT or REL testing tracked here? → A: **No.** QE (INT) and BT (REL) test on their own boards, connected via
  issue links only, and are out of scope. The only test checkpoint owned here is SL test.
- Q: How are the coding sub-tasks assigned? → A: **Capability-least-loaded load balancing** (existing capacity
  planner), PO-overridable. There is **no repository-specialist map today**; learning repo→contributor affinity from
  GitHub activity is a **later phase**, out of scope for v1.
- Q: What load factor and sprint-5 handling? → A: **80% load factor** on velocity (reserve ~20% for
  defects/prod-support/rework). **Delivery must complete by Week 1 of Sprint 5**; **Sprint 5 Week 2 is an innovation
  week with no delivery commitments** — the PI-level buffer.
- Q: How does the AI avoid producing a bad plan? → A: A fixed **query set** builds a deterministic **PI Planning Fact
  Sheet** that feeds the engine and is embedded in the prompt. The AI proposes only story decomposition + mitigation
  narrative; the engine owns dates, capacity, assignment, sprints, fixVersion, and bottleneck detection. Any
  repo/person/sprint/key not in the fact sheet is **rejected on ingest**.
- Q: Is the bottleneck detection AI-generated? → A: **No — deterministic.** SL test is modelled as its **own capacity
  constraint** (one shift-left tester is the named bottleneck). The engine compares dev output vs SL-test throughput
  per sprint and flags pileup; the AI only proposes mitigations for what the engine flagged.
- Q: What replaces "actively planning"? → A: A **monitoring model** with explicit **on-track signals** and **replan
  triggers**, so the team watches adherence rather than continuously re-planning.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Generate the whole PI from committed Features (Priority: P1)

A Product Owner, having committed a set of Features on the PI Review surface, opens the PI Delivery Planner, unlocks
AI Assist, and generates **one** planning prompt covering the **entire PI (all 5 sprints)**. The prompt embeds the PI
Planning Fact Sheet (committed Features, their repo components, roster, per-sprint capacity, sprint calendar, existing
children, fixVersion schedule, velocity). The PO pastes the prompt into their own assistant, pastes the structured
reply back, and reviews a proposed plan: for each Feature, the Stories (bridging repos), each Story's coding sub-tasks
(one per repo) + SL-test sub-task + INT/REL/PROD deploy sub-tasks, with **engine-computed** Target Start / Target End
/ Due dates, sprint assignment, and a proposed fixVersion.

**Why this priority**: This is the core value — planning the PI once, deterministically. Without it there is no plan
to monitor against.

**Independent Test**: With a committed Feature set and a populated fact sheet, generate the prompt, paste a valid
reply, and confirm a complete, per-item-acceptable plan is produced with engine-computed dates — and that a reply
referencing an unknown repo/person/sprint/key is rejected.

**Acceptance Scenarios**:

1. **Given** committed Features each carrying repo components, **When** the PO generates the plan prompt, **Then** the
   prompt embeds the full fact sheet and asks only for story decomposition + mitigation narrative.
2. **Given** a valid pasted reply, **When** it is ingested, **Then** each Story shows its per-repo coding sub-tasks, an
   SL-test sub-task, and INT/REL/PROD deploy sub-tasks, with dates and sprint assignment computed by the engine.
3. **Given** a reply that names a repository not in the fact sheet, **When** it is ingested, **Then** that item is
   rejected with an explicit reason and nothing is written.
4. **Given** the proposed plan, **When** the PO accepts items, **Then** only the accepted items are written to Jira,
   each with the correct parent, dates, fixVersion, and assignment.

---

### User Story 2 — Repo→Sub-task structure with parallel ownership (Priority: P1)

For a Story that touches multiple repositories, the plan creates **one coding sub-task per repository** (each
carrying that repository on its own component field, titled to identify the repo), a single SL-test sub-task, and the
deploy checkpoints. Different developers can be assigned to different coding sub-tasks and work the Story in parallel.
The Story has a single primary owner. This applies to **Defects** that span repositories too.

**Why this priority**: This is the structural change the team agreed to and the reason the model works day-to-day
(parallel coders, isolated repos, one testable Story).

**Independent Test**: Given a Story touching three repos, confirm exactly three coding sub-tasks (one per repo, repo on
each sub-task's component field), one SL-test sub-task, and one each of INT/REL/PROD deploy sub-tasks — and that a
Story touching one repo produces exactly one coding sub-task (no explosion).

**Acceptance Scenarios**:

1. **Given** a Story touching repos A, B, C, **When** the scaffold is built, **Then** there are 3 coding sub-tasks
   (A, B, C), 1 SL-test sub-task, and 1 each of INT/REL/PROD deploy sub-tasks.
2. **Given** a repository already covered by an existing child sub-task, **When** the scaffold is built, **Then** it is
   not duplicated (idempotent).
3. **Given** a Defect spanning two repos, **When** the scaffold is built, **Then** it follows the same repo→sub-task
   structure.

---

### User Story 3 — Deterministic dates, capacity, and the 80% / Sprint-5 rules (Priority: P1)

Every date and capacity figure is computed by the engine from the fact sheet, never taken from the AI. SL-test end
gates INT (INT within 24h of SL-test completion); REL = INT + 5 working days; PROD lands on a fixVersion date; Target
End (code-in-INT) is the DoD and must fall within the PI; Due may fall after the PI end. Capacity is planned to **80%**
of velocity. **All delivery Target Ends must fall on or before the end of Sprint 5, Week 1**; **Sprint 5, Week 2 carries
no delivery commitments** (innovation week).

**Why this priority**: The plan's trustworthiness depends entirely on the dates and capacity being rule-derived and on
the buffer being real.

**Independent Test**: For a set of sized Stories, confirm INT/REL/PROD/Due dates follow the cadence rules on working
days; confirm no Story is scheduled such that its Target End falls after Sprint 5 Week 1; confirm planned load per
person per sprint never exceeds 80% of that person's velocity-derived capacity.

**Acceptance Scenarios**:

1. **Given** a Story with an SL-test completion date, **When** dates are computed, **Then** INT ≤ 24h after SL test,
   REL = INT + 5 working days, and PROD is the first fixVersion date on/after REL.
2. **Given** the PI sprint calendar, **When** the plan is built, **Then** every delivery Target End is on/before the
   end of Sprint 5 Week 1, and Sprint 5 Week 2 holds no delivery items.
3. **Given** per-person velocity, **When** work is assigned, **Then** no person's planned load in any sprint exceeds
   80% of their capacity; overflow is surfaced, not silently exceeded.

---

### User Story 4 — Deterministic bottleneck detection with AI mitigation (Priority: P2)

The engine models SL testing as its **own** capacity constraint and, per sprint, compares developer output rate
against SL-test throughput, flagging where work will pile up before SL test. It also flags key-person /
single-owner-repo serialisation risk, cross-repo dependency ordering (e.g. API before UI), and deliverables whose PROD
date falls after the PI (carry vs in-PI). For each flagged bottleneck, the AI proposes **mitigations** (e.g. more dev
unit testing, time-boxing SL test, ensuring a minimum SL-test touch on every issue), attached to the engine's number.

**Why this priority**: Bottleneck visibility is the difference between a plan that looks fine and one that will
actually flow; the named SL-test constraint is the team's real-world pain.

**Independent Test**: Construct a plan where dev output in a sprint exceeds SL-test capacity and confirm the engine
flags an SL-test bottleneck for that sprint with the underlying numbers; confirm a repo with a single capable owner is
flagged as key-person risk; confirm mitigations attach to flagged items only.

**Acceptance Scenarios**:

1. **Given** a sprint where dev-completed points exceed SL-test capacity, **When** bottlenecks are computed, **Then**
   an SL-test bottleneck is flagged for that sprint with dev-output and SL-capacity figures.
2. **Given** a repository only one roster member can work, **When** bottlenecks are computed, **Then** a key-person
   risk is flagged for that repository.
3. **Given** flagged bottlenecks, **When** the AI narrative is ingested, **Then** each mitigation is associated with a
   specific flagged bottleneck and none is invented for an unflagged one.

---

### User Story 5 — Monitor adherence, not re-plan (Priority: P2)

After the plan is written, the team's ongoing view is a **monitoring** surface that reports, per the plan, whether
delivery is on track: burn-up of completed vs planned points, sub-task aging (work stuck In Progress), SL-test queue
depth, issue freshness (from the GitHub email-intake comments), and sprint commit-vs-complete. Explicit **replan
triggers** (a Story slips a sprint; the SL-test queue exceeds capacity for two consecutive sprints) tell the team when
monitoring should escalate to a re-plan, rather than re-planning continuously.

**Why this priority**: This is the stated goal — shift the team from active planning to monitoring — but it depends on
a plan (US1–US3) existing first.

**Independent Test**: Given a written plan and current Jira state, confirm the monitoring view reports each on-track
signal against the plan, and that a Story which has slipped a sprint raises the corresponding replan trigger.

**Acceptance Scenarios**:

1. **Given** a written plan and live Jira state, **When** the monitoring view loads, **Then** it shows burn-up vs plan,
   sub-task aging, SL-test queue depth, freshness, and commit-vs-complete per sprint.
2. **Given** a Story whose delivery has slipped beyond its planned sprint, **When** monitoring evaluates triggers,
   **Then** the "story slipped a sprint" replan trigger is raised.
3. **Given** an SL-test queue exceeding capacity for two consecutive sprints, **When** monitoring evaluates triggers,
   **Then** the SL-test replan trigger is raised.

---

### Edge Cases

- A committed Feature has **no repo components** classified → it produces **no coding sub-tasks**; the plan surfaces an
  honest "map repos first" state for that Feature (never guesses repos).
- A Story exceeds the **13-point cap** → it is still planned but flagged for splitting.
- The **fixVersion schedule has no date** on/after a Story's REL → PROD/Due is left unresolved and surfaced (a monthly
  release suggestion may be offered), never fabricated.
- **Existing board sprints** partially cover the PI → the plan reuses them and only derives the missing ones.
- The pasted AI reply is **malformed** → it is auto-repaired where safe, else rejected with a clear message; nothing is
  written.
- A reply references a **repo/person/sprint/issue key absent from the fact sheet** → that item is rejected on ingest.
- **Sprint 5 Week 2** (innovation week) → no delivery item may be scheduled there; the engine treats it as unavailable
  delivery capacity.
- A Feature or Defect touches **repositories not yet imported as components** → those repos cannot be planned; the gap
  is surfaced for classification rather than invented.

## Requirements *(mandatory)*

### Functional Requirements

**Ownership model & structure**

- **FR-001**: The system MUST treat Features as PO-owned business outcomes, Stories/Defects as dev-owned delivery work
  spanning one or more repositories, and Sub-tasks as deployment/validation checkpoints.
- **FR-002**: The system MUST generate, per Story, **one coding sub-task per repository** the Story touches, with that
  repository set on the sub-task's own component field and the sub-task titled to identify the repository.
- **FR-003**: The system MUST generate, per Story, exactly **one SL-test sub-task** and **one each** of INT, REL, and
  PROD deploy sub-tasks (deploys are per-story, not per-repo).
- **FR-004**: The repo→sub-task structure MUST apply to **Defects** that span repositories as well as Features.
- **FR-005**: Sub-task generation MUST be **idempotent** — a repository or checkpoint already represented by an
  existing child sub-task MUST NOT be duplicated.
- **FR-006**: The system MUST NOT create INT-test or REL-test checkpoints; the only test checkpoint is SL test.
- **FR-007**: A Feature/Story with no repo components MUST produce zero coding sub-tasks and surface an honest "map
  repos first" state (no guessing).

**Definition of Done & tracking**

- **FR-008**: The system MUST treat Definition of Done as **SL testing complete AND delivered to INT**; production
  MUST NOT be required for DoD.
- **FR-009**: The system MUST still track work through PROD via INT → REL → PROD deploy sub-tasks.
- **FR-010**: The system MUST NOT ingest or display INT/REL testing state owned by other teams; cross-team testing is
  represented only by existing Jira issue links and is out of scope.

**Dates, capacity, assignment (deterministic)**

- **FR-011**: The system MUST compute all dates from rules on **working days**: SL-test end gates INT (INT within 24h);
  REL = INT + 5 working days; PROD = first fixVersion date on/after REL; Target End = code-in-INT (the DoD) within the
  PI; Due = PROD and MAY fall after the PI end.
- **FR-012**: The system MUST plan capacity to an **80% load factor** of each person's velocity-derived capacity and
  MUST NOT silently exceed it (overflow is surfaced).
- **FR-013**: The system MUST schedule all delivery so that every Target End falls on or before the end of **Sprint 5,
  Week 1**, and MUST schedule **no delivery item** in **Sprint 5, Week 2** (innovation week).
- **FR-014**: The system MUST reuse existing board sprints for the PI and derive only the missing ones.
- **FR-015**: The system MUST flag any Story exceeding the **13-point** cap for splitting.
- **FR-016**: The system MUST assign coding sub-tasks by **capability-least-loaded load balancing**, PO-overridable,
  with no repository-specialist mapping in v1.
- **FR-017**: The system MUST ignore any dates, capacity figures, or assignments supplied in the AI reply and use only
  its own rule-derived values.

**Anti-hallucination query layer**

- **FR-018**: The system MUST assemble a deterministic **PI Planning Fact Sheet** from a fixed query set: committed
  Features, per-Feature repo/domain component classification, roster + capabilities, per-sprint capacity, PI board
  sprints, existing children (for idempotency), fixVersion release schedule, historical velocity, and field/status
  configuration for DoD detection.
- **FR-019**: The system MUST embed the fact sheet verbatim in the generated AI prompt and MUST constrain the AI's
  requested output to **story decomposition** (grouping repos into Stories, naming, acceptance-criteria hints) and a
  **mitigation narrative** only.
- **FR-020**: The system MUST **reject on ingest** any AI-proposed item that references a repository, person, sprint,
  or issue key not present in the fact sheet, with an explicit reason, writing nothing for that item.
- **FR-021**: The whole PI (all 5 sprints) MUST be generatable from **one** prompt, chunked automatically when the set
  is too large for a single reply.

**Bottleneck detection (deterministic) & mitigation (AI)**

- **FR-022**: The system MUST model SL testing as its **own** capacity constraint and, per sprint, flag where
  developer output exceeds SL-test throughput (WIP pileup), reporting the underlying figures.
- **FR-023**: The system MUST flag **key-person / single-owner-repo** serialisation risk from the roster capability
  data.
- **FR-024**: The system MUST **detect and flag** cross-repo / cross-story dependency-ordering violations (e.g. a
  dependency scheduled after its dependent, API after UI), surfacing each as a `dependencyOrder` bottleneck. (Active
  re-sequencing is out of scope for v1 — the reused capacity planner orders by MoSCoW bucket + rank, not by dependency
  edges; the plan makes ordering risk visible rather than silently resolving it.)
- **FR-025**: The system MUST identify deliverables whose PROD date falls **after** the PI (carry) versus within it.
- **FR-026**: The AI MUST only propose **mitigations attached to engine-flagged bottlenecks**; a mitigation for an
  unflagged bottleneck MUST NOT be presented as such.

**AI governance**

- **FR-027**: Planning MUST be **propose-only**, **gated** behind the AI unlock, applied **per item on explicit
  accept**, and MUST **never attribute** written content to AI.
- **FR-028**: The system MUST write to Jira only on explicit per-item acceptance, reusing existing write primitives
  (issue create with parent, sprint create/assign, Target Start/End + due date, fixVersion), with field ids resolved
  by name discovery (never hardcoded).

**Monitoring**

- **FR-029**: The system MUST provide a monitoring view that reports, against the written plan: burn-up of completed
  vs planned points, sub-task aging, SL-test queue depth, issue freshness (from GitHub email-intake activity), and
  sprint commit-vs-complete.
- **FR-030**: The system MUST raise explicit **replan triggers** — at minimum, a Story slipping beyond its planned
  sprint, and the SL-test queue exceeding capacity for two consecutive sprints.

### Key Entities

- **PI Planning Fact Sheet** — the deterministic bundle of queried facts (committed Features, repo/domain
  classification, roster + capabilities, per-sprint capacity, PI sprints, existing children, fixVersion schedule,
  velocity, DoD field/status config) that both feeds the engine and is embedded in the AI prompt.
- **Feature** — a PO-owned business outcome; the planning seed; carries repo and domain components.
- **Story / Defect** — dev-owned delivery work spanning one or more repositories; has a primary owner; status
  GitHub-driven; the unit that receives the sub-task scaffold.
- **Coding Sub-task** — one per repository a Story touches; carries the repository on its component field; assignable
  independently for parallel work.
- **SL-test Sub-task** — the single shift-left test checkpoint per Story; separately pointable; gates DoD.
- **Deploy Sub-task** — per-story INT / REL / PROD deployment checkpoints; INT reaching DoD, REL and PROD tracked
  onward.
- **Sprint** — a PI iteration; reused from the board where present, derived where missing; Sprint 5 split into a
  Week-1 delivery window and a Week-2 innovation week.
- **Bottleneck** — an engine-detected constraint (SL-test throughput shortfall, key-person risk, dependency ordering,
  post-PI PROD carry) with underlying figures, to which AI mitigations attach.
- **Delivery Plan** — the complete, per-item-acceptable proposal (Stories, sub-tasks, dates, assignments, sprints,
  fixVersion, bottlenecks + mitigations) generated once and monitored thereafter.
- **Monitoring Signal / Replan Trigger** — the on-track measures and the explicit thresholds that escalate monitoring
  to a re-plan.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Product Owner can generate a complete PI plan (all 5 sprints) for a committed Feature set from a single
  prompt-and-reply cycle, then accept it item by item, without hand-entering any date.
- **SC-002**: 100% of dates, capacity figures, sprint assignments, and bottleneck findings in an accepted plan are
  rule-derived; none originates from the AI reply.
- **SC-003**: 100% of AI-proposed items that reference a repository, person, sprint, or issue key absent from the fact
  sheet are rejected before any write.
- **SC-004**: Every planned Story touching N repositories yields exactly N coding sub-tasks, one SL-test sub-task, and
  three deploy sub-tasks — and a single-repo Story yields exactly one coding sub-task (no explosion).
- **SC-005**: No accepted plan schedules any delivery Target End after Sprint 5 Week 1, and no delivery item is placed
  in Sprint 5 Week 2.
- **SC-006**: No person's planned load in any sprint exceeds 80% of their capacity in an accepted plan; any overflow is
  visibly surfaced rather than absorbed.
- **SC-007**: For any sprint where planned developer output exceeds SL-test capacity, the plan flags an SL-test
  bottleneck with the underlying figures before the plan is accepted.
- **SC-008**: After a plan is written, the team can determine on-track / off-track status for the PI entirely from the
  monitoring view, without re-deriving the plan by hand.

## Assumptions

- The PI comprises **5 sprints**; Sprint 5 is treated as a Week-1 delivery window plus a Week-2 innovation week.
- Features are **committed on the PI Review surface** before planning, and their repo components have been classified
  (feature 031) as repo vs domain.
- **Velocity** and per-person capacity are derivable from existing delivery data and roster capabilities.
- The **GitHub email-intake** activity feed is the source of issue-freshness signals for monitoring.
- Jira **workflows and statuses are fixed** and cannot be modified; sub-tasks have three working states (To Do / In
  Progress / Done, plus cancel).
- The operator uses their **own in-house AI** for the propose step; no automated/background AI is involved.
- Repository-specialist assignment learning (repo→contributor affinity from GitHub activity) is a **future phase**, not
  part of v1.

## Dependencies

- **Feature 031** — component repo/domain classification (provides the repo allowlist per Feature). This feature
  **supersedes 031's one-Story-per-repo generation** but reuses its classification store.
- **Feature 028** — the PI planning engine (dates, capacity, sprints, breakdown, fixVersion, Jira writes, the piPlan AI
  modules) that this feature restructures and extends.
- **GitHub email-intake** — supplies issue-freshness activity for the monitoring model (and, in a future phase, the
  repo→contributor affinity data).
- **PI Review surface** — the source of committed Features handed to the planner.

## Out of Scope

- INT and REL testing state (QE / BT), tracked on other teams' boards and connected only by issue links.
- A repository-specialist assignment map and any learning of repo→contributor affinity (future phase).
- Modifying Jira workflows, statuses, or the set of available sub-task states.
- Automated or background AI planning; any AI step is a manual propose-only prompt/paste cycle.
- Business-outcome KPIs (e.g. delivery-throughput improvement targets) beyond the plan/monitoring mechanics defined
  here.
