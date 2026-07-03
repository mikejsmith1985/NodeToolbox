# Feature Specification: Feature Canvas — Backlog Triage & Planning Board

**Feature short name**: `feature-canvas`
**Created**: 2026-07-03
**Status**: Draft — all clarifications resolved (Q1=A, Q2=A, Q3=A); ready for `/speckit-clarify` or `/speckit-plan`
**Feature directory**: `specs/009-feature-canvas/`

## Summary

A Scrum Master inheriting a chaotic team faces a specific, painful shape of problem:
the backlog is a wall of undifferentiated work with no prioritization, no sizing, and
no clear picture of what is actually in flight. The existing NodeToolbox **Planning
tab** is a grouped list optimized for a *stable* backlog — it lets you edit a release
or points field on issues that are already reasonably organized. It is the wrong tool
for triaging a warzone, where the first job is not editing fields but *seeing the whole
battlefield at once* and physically moving work into order.

This feature adds a **Feature Canvas**: a visual, drag-and-drop planning surface where
each feature is a movable **node**, and the user boxes those nodes into **release** and
**sprint** containers to turn an overwhelming list into a spatial, manageable plan. The
canvas answers three questions a list cannot answer at a glance: *what work exists*,
*what is truly active versus what can be paused*, and *what belongs in which release
or sprint*.

Wrapped around the canvas is a **guided triage journey** — a resumable, stage-based
coach built on established Agile facilitation practice — designed to be driven in short
daily working sessions. The coach walks the user from "I can't see the scope" to "I
have a committed plan and a clearly paused parking lot," one disciplined step at a time.
The workflow is **100% manual-operable**: every instruction tells the *user* what to
decide and do. No stage requires, assumes, or waits on AI.

Separately and invisibly, the same passphrase-gated **AI Assist** accelerator already
used elsewhere in NodeToolbox (Ctrl+Alt+Z gate; copy a generated prompt into an external
assistant, paste structured JSON back) can *expedite* the manual analysis steps for the
one operator who has unlocked it. This accelerator is additive and hidden: to every
other user the journey is a fully deterministic, human-driven process.

## The Coaching Model (why the journey is shaped this way)

When you take over a backlog in chaos, the failure mode is trying to prioritize before
you can see, or plan before you can size. The canvas enforces the canonical recovery
sequence — **Surface → Stabilize → Prioritize → Size → Sequence** — as five short
stages, each with a single job and a single, visible output. Each stage is sized to fit
a ~30-minute working session so a team can recover a backlog across one working week
without a marathon planning day.

| Stage | Coaching job | The one question it answers | Visible output |
|-------|-------------|------------------------------|----------------|
| 1. **Surface** | Make the mess visible | "What work even exists?" | Every candidate node on the canvas |
| 2. **Stabilize WIP** | Stop the bleeding | "What is truly active, and what can we pause?" | A bounded active set + an explicit Parking Lot |
| 3. **Prioritize** | Find the signal | "In what order does this matter?" | Nodes ranked into Must / Should / Could / Won't |
| 4. **Size** | Make it estimable | "How big is each thing, roughly?" | Every in-scope node carries a relative size |
| 5. **Sequence & Box** | Make it a plan | "What goes in which release and sprint?" | Nodes boxed within capacity → a committed Now/Next/Later plan |

The stages are **resumable and revisitable** — the user can leave after Stage 2 on
Monday and resume at Stage 3 on Tuesday, and can step back to re-triage WIP without
losing sizing or boxing work already done. The five-stage sequence is a *recommended
path*, not a locked wizard; an experienced user can jump directly to any stage.

## Scope Boundary (explicit non-goals)

- **Out of scope**: Replacing or removing the existing Planning tab. The Feature Canvas
  is a *complementary* triage/exploration surface for unstable backlogs; the Planning
  tab remains the tool for steady-state field editing.
- **Out of scope**: Any dependency on AI to complete the workflow. Every stage is
  fully operable by a human with no AI unlocked. AI Assist is an optional, hidden
  accelerator that only pre-fills *suggestions* a human accepts or rejects.
- **Out of scope**: Exposing or documenting the AI accelerator in any user-facing
  instruction, help text, or stage guidance. The coach never says "ask AI to…"; it
  says "you decide…".
- **Out of scope**: Building a new Jira workflow engine, transition automation, or the
  sprint↔fixVersion date-sync orchestration — that is the separate
  `003-sprint-release-workflow` feature. The canvas *arranges* work; it does not
  automate status transitions or release-date math.
- **Out of scope**: New hygiene rules or new feature-health math. The canvas *reuses*
  the existing deterministic hygiene checks and blueprint health/completion signals as
  read-only visual overlays.
- **Out of scope**: Real-time multi-user collaborative editing of the canvas (shared
  cursors, live co-drag). The canvas is a single-operator planning surface in this
  release; the resulting plan is what gets shared, not the live board.
- **Out of scope**: Story-point *estimation ceremony* mechanics (planning-poker voting,
  timers). Sizing on the canvas is a fast relative-sizing aid, not a facilitated poker
  session.

## Clarifications

### Session 2026-07-03

All three open decisions were resolved in favor of the recommended options:

- **Q1 — Write-back model**: Resolved → **Option A (Sandbox + explicit commit)**. Canvas
  changes live in a persisted planning overlay; Jira is written only through a reviewed
  Review & Commit diff. See FR-7.
- **Q2 — Node granularity**: Resolved → **Option A (Features/epics primary, expandable
  to child stories)**. Releases hold features; sprints may hold features or child stories.
  See FR-1.2.
- **Q3 — Container source**: Resolved → **Option A (Provisional containers allowed)**.
  Users may create proposed release/sprint boxes even when Jira has none; these are
  reconciled to real Jira sprints/fixVersions at commit. See FR-6.2 and FR-7.5.

The three decisions below record the context and options considered.

The following three decisions materially change the feature's scope and safety profile
and cannot be safely defaulted. Recommended answers are marked; the spec is written
against those recommendations, now confirmed.

### Q1 — How do canvas changes relate to Jira? (write-back model)

**Context**: When the user drags a feature into the "Sprint 24" box or changes its size
on the canvas, does that mutate the real Jira issue, or is the canvas a planning overlay
that only touches Jira on an explicit, reviewed commit?

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **Sandbox + explicit commit.** All moves, sizes, priorities, and box assignments live in a canvas planning overlay. Nothing changes in Jira until the user opens a "Review & Commit" step, sees a diff of proposed changes, and confirms. | Safe to explore a warzone without corrupting the real backlog; supports "what-if" planning; requires a persisted overlay + a commit/diff step. |
| B | **Live write-through.** Each drag/edit writes to Jira immediately (like the current Planning tab's inline edits). | No overlay to build; but every experimental move mutates production data — dangerous for exploratory triage. |
| C | **Read-only canvas.** The canvas visualizes and lets you arrange, but never writes to Jira; the plan is exported/screenshotted only. | Zero write risk; but the user must re-enter every decision into Jira by hand afterward. |

**Recommendation: A.** A chaotic backlog is exactly where destructive live edits are
most harmful and "what-if" exploration is most valuable.

### Q2 — What is a "node"? (granularity)

**Context**: The user speaks in terms of *features*, but sprints are normally filled
with *stories*. What level of the hierarchy does a canvas node represent?

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **Features/epics are the primary nodes; each node can expand to reveal child stories.** Releases hold features; sprints can hold features or their child stories. | Matches "pull in its nodes … box them into releases/sprints" while still supporting sprint-level story boxing; leans on the existing blueprint feature→story hierarchy. |
| B | **Feature/epic level only.** Nodes are features; boxing is feature-into-release (and feature-into-sprint as a coarse commitment). | Simplest; but you cannot box individual stories into sprints — too coarse for real sprint planning. |
| C | **Flat — every issue (feature, story, task, bug) is an equal node.** | Maximum flexibility; but reproduces the "wall of undifferentiated work" the tool exists to escape, and makes the canvas dense at large backlogs. |

**Recommendation: A.** Feature-first with expand-to-stories preserves the big-picture
view while still enabling sprint-level detail when needed.

### Q3 — Can the canvas invent new releases/sprints? (container source)

**Context**: A team in chaos may not have any sprints or fixVersions set up yet. Can the
user create *provisional* release/sprint boxes on the canvas that don't exist in Jira, or
may they only box work into containers Jira already has?

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **Provisional containers allowed.** The user can create proposed release/sprint boxes on the canvas even if Jira has none. At commit time (per Q1), the canvas offers to create the missing Jira sprints/fixVersions, or map a provisional box to an existing one. | Works for the true zero-structure case; the plan can be built before Jira scaffolding exists. Requires a provisional→real reconciliation step at commit. |
| B | **Existing containers only.** Boxes must correspond to Jira sprints/fixVersions that already exist; the canvas cannot invent them. | Simpler commit path; but blocks a team that hasn't created any sprints/versions yet — a common chaos state. |

**Recommendation: A.** The tool must work when the team has no planning scaffolding at
all; that is the defining condition of the problem being solved.

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**Story A — New Scrum Master (see the whole battlefield):**
As a Scrum Master who just inherited a chaotic team, I want to pull every candidate
feature onto one visual canvas as movable nodes, so that I can finally see the entire
scope of in-flight and pending work in a single view instead of scrolling endless lists.

**Story B — Scrum Master (find capacity by pausing work):**
As a Scrum Master, I want to identify what is *truly* in progress, set a WIP limit, and
drag everything above that limit into a clearly-marked Parking Lot, so that I can tell
my stakeholders exactly what we are pausing to make room for new work.

**Story C — Scrum Master (impose priority):**
As a Scrum Master, I want to rank nodes into Must / Should / Could / Won't buckets on
the canvas, so that the team has an unambiguous, visible order to work in instead of
everyone guessing what matters.

**Story D — Scrum Master (get rough sizes fast):**
As a Scrum Master on a team that has never pointed work, I want to assign quick relative
sizes (e.g. S/M/L/XL) to the prioritized nodes, so that release and sprint boxes can
show whether they are over capacity.

**Story E — Scrum Master (turn the mess into a plan):**
As a Scrum Master, I want to drag prioritized, sized nodes into release and sprint boxes
that show a running capacity total, so that I end the week with a concrete Now/Next/Later
plan and an explicit paused set.

**Story F — Scrum Master (recover work day by day):**
As a Scrum Master running a 30-minute session each day, I want the canvas to remember
exactly where I left off and guide me into today's stage, so that I can make steady
progress across the week without redoing yesterday's work.

**Story G — Scrum Master (commit deliberately, not by accident):**
As a Scrum Master, I want my exploratory moves to stay in a planning sandbox until I
explicitly review a summary of proposed changes and confirm, so that experimenting with
the layout never silently corrupts the real Jira backlog.

**Story H — Operator with AI unlocked (expedite, don't depend):**
As the one operator who has unlocked AI Assist, at any analysis-heavy step I want the
option to copy a generated prompt into my external assistant and paste structured JSON
back to pre-fill suggestions, so that I can move faster — while knowing the exact same
step is fully completable by hand for anyone without AI.

### Acceptance scenarios

- **Surface everything**: Given a project with 120 open items, when the user starts the
  canvas and runs Stage 1, then every in-scope feature appears as a node on the canvas
  and the node count matches the scoped Jira query count.

- **WIP limit + parking lot**: Given a WIP limit of 5 and 12 nodes currently marked
  In Progress, when the user enters Stage 2, then the canvas flags the WIP overflow (7
  over) and the user can drag the excess into the Parking Lot; the paused set is counted
  and visible as a distinct group.

- **Priority buckets**: When the user drags a node into the "Must" bucket, then the node
  is visibly tagged Must and the Must bucket's node count updates immediately.

- **Relative sizing**: When the user assigns "L" to a node that has no story points,
  then the node displays the size and contributes its size to any container capacity
  total it later joins.

- **Capacity meter**: Given a sprint box with a capacity budget, when the sum of sizes
  of nodes inside it exceeds the budget, then the box shows an over-capacity warning
  state and the amount over.

- **Resume mid-journey**: Given the user completed Stages 1–2 and closed the canvas,
  when they reopen it, then the canvas restores all node positions, box assignments, and
  the paused set, and the coach resumes at Stage 3.

- **Sandbox isolation (Q1=A)**: Given the user has dragged nodes into boxes and changed
  sizes, when they inspect the corresponding Jira issues, then no Jira field has changed
  until they open Review & Commit and confirm.

- **Commit with diff (Q1=A)**: When the user opens Review & Commit, then they see a
  itemized list of every proposed change (node → sprint, node → fixVersion, size → points)
  and only the confirmed changes are written to Jira through the existing proxy.

- **Provisional container reconciliation (Q3=A)**: Given the user created a provisional
  "Sprint 25" box that does not exist in Jira, when they commit, then the canvas offers
  to create the Jira sprint or map the box to an existing sprint, and does not write
  assignments until that choice is made.

- **Hygiene overlay**: Given a feature with 3 hygiene violations under the existing
  checks, when it appears on the canvas, then the node shows a hygiene badge with the
  violation count consistent with what the Hygiene tab reports for the same issue.

- **Manual-only integrity**: Given a user who has *not* unlocked AI Assist, when they
  run every stage end to end, then all guidance, controls, and outputs are available and
  no stage presents an AI-related instruction, control, or blocker.

- **AI accelerator is additive (unlocked operator)**: Given AI Assist is unlocked, when
  the operator uses the accelerator at a stage, then it only pre-fills editable
  suggestions the operator can accept or reject, and rejecting all of them leaves the
  operator exactly where the manual path would.

## Functional Requirements

### FR-1: Canvas surface & nodes

1.1 The feature provides a spatial canvas on which scoped work items render as movable
    **nodes** that can be dragged, positioned, and grouped, in addition to (not replacing)
    the existing list-based Planning tab.

1.2 A node represents a feature/epic as its primary and **boxable** unit and can be
    expanded to reveal its child stories for context (per Q2=A). Boxing operates on the
    feature node; child-story membership is **derived from the parent feature's container
    at commit** (see FR-6.1a). Placing an individual child story into a *different* sprint
    than its parent feature is **out of scope for this release** (documented non-goal);
    child stories are shown for context and follow their feature.

1.3 Each node displays, at a glance: key (linking to the Jira item), summary, status
    (colored by status category), size/points, feature health, and a hygiene-flag badge
    when violations exist.

1.4 The canvas **surfaces** work at the active team's **Program Increment (PI) scope**
    (the ART-team + PI context the Feature Review surface already uses), so the user
    chooses what body of work to triage before surfacing it. Jira **Sprints and Fix
    Versions** are not surfacing scopes here — they appear as **boxing targets** in Stage 5
    (see FR-6.1). If no ART team matches the active board, the canvas shows a "configure
    ART settings" empty state rather than surfacing nothing.

1.5 The canvas remains legible and usable at realistic backlog sizes (see Success
    Criteria SC-8); large node sets are navigable (pan/zoom or equivalent) without the
    user losing orientation.

### FR-2: Guided triage journey (the coach)

2.1 The feature presents a **resumable, stage-based journey** with the five stages:
    Surface, Stabilize WIP, Prioritize, Size, Sequence & Box. Each stage states its single
    job, the decision the user must make, and the output that marks it complete.

2.2 All stage guidance is written as instructions to the **user** (what to decide and do).
    No stage instruction references, requires, or waits on AI.

2.3 The journey is **resumable**: the canvas persists progress so a user can complete a
    stage in one ~30-minute session and resume the next stage later without rework.

2.4 The journey is **non-linear on demand**: the recommended order is presented by
    default, but the user may jump to or revisit any stage without losing work done in
    other stages.

2.5 Each stage surfaces the *specific* controls it needs (e.g. Stage 2 surfaces the WIP
    limit and Parking Lot; Stage 5 surfaces containers and capacity meters) so the user
    is never hunting for the relevant action.

### FR-3: Stage 2 — WIP stabilization

3.1 The user can set a **WIP limit** for the active set. The canvas computes current WIP
    from the existing status-category signal (In Progress / indeterminate) already used by
    the WIP zones elsewhere in the product.

3.2 When current WIP exceeds the limit, the canvas visibly flags the overflow and its
    magnitude.

3.3 The user can move nodes into a distinct **Parking Lot** group representing paused
    work. The Parking Lot count and its contents are always visible and separately
    reportable, so "what we paused" is an explicit, communicable output.

### FR-4: Stage 3 — Prioritization

4.1 The canvas provides **priority buckets** (Must / Should / Could / Won't — a MoSCoW
    frame) into which nodes are dragged. Bucket membership is a visible attribute on each
    node and each bucket shows a live count.

4.2 The prioritization is a canvas-overlay attribute (per Q1=A) and does not mutate Jira
    until commit; if a Jira priority field mapping is committed, it is part of the Review
    & Commit diff.

### FR-5: Stage 4 — Relative sizing

5.1 The user can assign a **relative size** to any node using a fast scale (e.g. t-shirt
    S/M/L/XL with a documented point mapping) without opening the issue.

5.2 Nodes that already carry story points display them; nodes that do not can receive a
    canvas size that participates in capacity totals.

5.3 Size is a canvas-overlay attribute until commit; committing a size maps it to the
    team's configured story-point field as part of the Review & Commit diff.

### FR-6: Stage 5 — Containers & capacity

6.1 The canvas provides **release** and **sprint** container boxes into which nodes are
    dragged. Releases correspond to fixVersions; sprints correspond to Jira sprints.

6.1a **Container commit semantics** (resolves the feature/story granularity of a box):
    - A feature boxed into a **release** sets that feature's **fixVersion** (Jira releases
      are set on the work item directly).
    - A feature boxed into a **sprint** places the feature's **child stories** into that
      sprint (Jira sprints hold stories, not epics/features); a feature with no child
      stories is itself the sprint member. Child stories inherit their parent feature's
      sprint at commit — they are not independently re-parented (per FR-1.2 non-goal).

6.2 Per Q3=A, the user may create **provisional** containers that do not yet exist in
    Jira. Provisional containers are visually distinguished from real ones.

6.3 Each container shows a running **capacity total** (sum of member node sizes) against
    an editable capacity budget, and an over-capacity warning when the total exceeds the
    budget.

6.4 A node may carry dependency indicators derived from existing Jira issue links so the
    user can spot when sequencing a node ahead of its blocker.

### FR-7: Planning overlay persistence & commit (per Q1=A)

7.1 All canvas state — node positions, expand state, WIP limit, Parking Lot membership,
    priority buckets, sizes, container assignments, provisional containers, and capacity
    budgets — is persisted as a **planning overlay** separate from Jira, scoped to the
    selected work scope and team, so the plan survives across sessions.

7.2 No canvas action writes to Jira implicitly. Writes occur only through an explicit
    **Review & Commit** step.

7.3 Review & Commit presents an itemized **diff** of every proposed Jira change (sprint
    assignment, fixVersion assignment, size→points, any priority mapping, and any
    provisional-container creation) before anything is written.

7.4 On confirmation, changes are written through the **existing Jira proxy layer** only;
    the canvas reports per-item success/failure and leaves un-committed items in the
    overlay.

7.5 For provisional containers (Q3=A), commit first resolves each provisional box to a
    real Jira sprint/fixVersion — by creating it or mapping it to an existing one — before
    writing member assignments.

### FR-8: Deterministic reuse of existing signals

8.1 Node hygiene badges are computed by the **existing deterministic hygiene checks**;
    the canvas introduces no new hygiene rules.

8.2 Node health and completion are derived from the **existing blueprint** feature/story
    model; the canvas introduces no new health math.

8.3 WIP classification reuses the **existing status-category** buckets; the canvas
    introduces no new WIP definition.

### FR-9: Hidden AI accelerator (additive only)

9.1 The AI accelerator is gated behind the **existing AI Assist passphrase** mechanism
    and is invisible and inert for any session that has not unlocked it.

9.2 Where offered, the accelerator only **pre-fills suggestions** (e.g. proposed priority
    order, likely-duplicate or stale candidates, proposed sprint groupings) into the same
    controls the user operates manually. Every suggestion is individually acceptable or
    rejectable.

9.3 The accelerator follows the **established copy-paste round-trip**: it generates a
    prompt for the user to run in an external assistant and ingests a strictly-validated
    JSON reply, mirroring the existing release-notes AI Assist pattern (robust to
    assistant chatter/markdown fences; descriptive validation errors).

9.4 No stage's completion, control availability, or guidance depends on the accelerator.
    Removing it entirely would leave the workflow fully functional.

## Success Criteria

1. **SC-1 — Scope becomes visible fast**: A user can go from opening the Feature Canvas
   to seeing every scoped feature as a node in under 60 seconds for a backlog of ~150
   items.

2. **SC-2 — A week recovers a backlog**: A user running five ~30-minute daily sessions
   can complete all five stages and reach a committed plan with a defined Parking Lot,
   without any session requiring more than 30 minutes to reach that stage's output.

3. **SC-3 — Pause set is explicit**: At the end of Stage 2, the user can state the exact
   count and list of paused items in one glance, with no manual tallying.

4. **SC-4 — Every in-scope node is ordered and sized**: After Stage 4, 100% of nodes the
   user placed in Must/Should/Could carry both a priority bucket and a relative size.

5. **SC-5 — Capacity is obvious**: For any sprint or release box, the user can tell
   whether it is over, at, or under capacity without doing arithmetic themselves.

6. **SC-6 — Zero accidental Jira writes**: Across a full exploratory session with no
   commit, the number of Jira field changes is zero (verified against issue history).

7. **SC-7 — Commit is reviewable**: 100% of Jira changes the canvas makes were shown to
   the user in the pre-commit diff before being written.

8. **SC-8 — Usable at scale**: The canvas remains interactive (drag latency imperceptible
   to the user) with at least 200 nodes present.

9. **SC-9 — Manual parity**: A user with no AI unlocked can complete every stage and
   reach the same committed-plan output as an AI-unlocked operator; the only difference is
   the time spent, not the achievable result.

10. **SC-10 — Resume fidelity**: After closing and reopening the canvas, 100% of node
    positions, box assignments, sizes, priorities, and the Parking Lot are restored
    exactly as left.

## Key Entities

| Entity | Source / Owner | Description |
|--------|----------------|-------------|
| Canvas Node | NodeToolbox (backed by Jira issue) | A movable feature/epic (expandable to child stories) carrying position, size, priority bucket, and container membership as overlay attributes |
| Planning Overlay | NodeToolbox (persisted) | The full saved canvas state for a given work scope + team: positions, WIP limit, Parking Lot, buckets, sizes, containers, budgets — separate from Jira until commit |
| Priority Bucket | NodeToolbox overlay | Must / Should / Could / Won't grouping applied to nodes |
| Parking Lot | NodeToolbox overlay | The explicit set of paused work removed from the active WIP set |
| Container (Release / Sprint) | Jira fixVersion / Jira sprint, or provisional | A box nodes are dragged into; may be real (existing Jira) or provisional (proposed on canvas) |
| Capacity Budget | NodeToolbox overlay | The editable size ceiling for a container, compared against the sum of member node sizes |
| Journey Stage State | NodeToolbox overlay | Which stages are complete/in-progress, enabling resume and revisit |
| Commit Diff | NodeToolbox (transient) | The itemized set of proposed Jira writes shown for review before any write occurs |
| AI Suggestion Set | NodeToolbox (transient, gated) | Optional pre-filled suggestions ingested via the passphrase-gated copy-paste round-trip; always human-accept/reject |

## Assumptions

- **A1**: The canvas draws its work items from the same Jira scope model
  (Sprint / FixVersion / PI) and the same proxy layer the Sprint Dashboard already uses;
  no new Jira connection or auth path is introduced.
- **A2**: Feature→story hierarchy and feature health/completion come from the existing
  blueprint model; hygiene badges come from the existing hygiene check engine. The canvas
  is a new *view* over existing signals, not a new data source.
- **A3** *(confirmed — Q1=A)*: The write model is sandbox + explicit commit; the canvas
  never writes to Jira outside the Review & Commit step.
- **A4** *(confirmed — Q2=A; refined 2026-07-03)*: Nodes are feature/epic-first and are the
  boxable unit; child stories are shown for context. A feature→release box sets the feature's
  fixVersion; a feature→sprint box places the feature's child stories in that sprint (FR-6.1a).
  Independent per-story sprint placement is out of scope this release.
- **A5** *(confirmed — Q3=A)*: Provisional containers are permitted and reconciled to real
  Jira sprints/fixVersions at commit time.
- **A6**: Relative sizing uses a t-shirt scale with a documented point mapping; committing
  a size targets the team's configured story-point custom field.
- **A7**: The AI accelerator reuses the existing Ctrl+Alt+Z passphrase gate and the
  existing copy-paste-JSON round-trip infrastructure; it introduces no new always-on
  outbound AI channel and stores no AI-specific instruction in user-facing copy.
- **A8**: The canvas is single-operator; sharing the *result* (export/screenshot/commit)
  is the collaboration path, not live co-editing.
- **A9**: Drag-and-drop is built on capabilities already available in the client; a
  spatial canvas may require a rendering approach beyond simple sortable lists, evaluated
  during planning under the Framework-First gate.

## Dependencies

- Existing Jira proxy layer for all reads and (commit-time) writes.
- Existing dashboard scope model (Sprint / FixVersion / PI) and its scoped-JQL builder.
- Existing deterministic hygiene check engine (read-only overlay).
- Existing blueprint feature/story hierarchy and health/completion computation.
- Existing status-category WIP classification.
- Existing AI Assist passphrase gate and copy-paste-JSON round-trip pattern (for the
  hidden accelerator only).
- Existing team-profile / active-team configuration for scoping the planning overlay.
