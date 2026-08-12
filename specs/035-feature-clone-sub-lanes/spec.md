# Feature Specification: Cloned-Feature Sub-Lanes — QE and BT work under the Dev Feature

**Feature Branch**: `feature/035-feature-clone-sub-lanes`

**Created**: 2026-08-12

**Status**: Ready for planning

**Input**: User description: "I want to add a new layer of complexity to the roll up dashboard. In current state every team maintains 2 projects in Jira. Project A houses Features. Project B houses stories. QE AND BT clone my feature into their own feature project and then create their own stories underneath their feature in their own separate story projects. I would like to show that the cloned features from other projects and the cloned issues child records in 'sub-lanes' of the primary dev feature. Maybe each could have some sort of color variation to help make each 'sub lane' stand out visually."

## Context

The Roll-Up Board today answers one question well: *what work delivers this Feature?* It answers it for **one team's
work only** — the dev team's stories, sub-tasks and defects, rolled up to the dev Feature.

The organisation's actual delivery model is wider than that. A single business outcome is delivered by **three teams
working from three copies of the same Feature**:

| Discipline | Feature lives in | Their work lives in |
|---|---|---|
| Dev | the team's own Feature project (e.g. `DENP`) | the team's own story project (e.g. `ENCUC`) |
| QE | QE's Feature project | QE's story project |
| BT | BT's Feature project | BT's story project |

QE and BT **clone** the dev Feature into their own Feature project, then break their own work down underneath their
clone. Nothing in the board's current model connects those three copies. The consequence is that the board reports a
Feature as complete when **dev** is complete, while the QE clone still has open test execution and the BT clone still
has open business testing — which is the same "looks finished, isn't" problem the Roll-Up Board was built to end,
reappearing one level up.

The current board therefore shows the dev slice of a Feature and silently presents it as the whole Feature.

**This feature does not change how the three teams work.** It reads the clones that already exist and draws them where
they belong: underneath the dev Feature they are copies of.

## Clarifications

### Session 2026-08-12

- Q: What evidence in Jira marks a Feature as a clone of another? -> A: Jira's **Cloners** issue link where present,
  falling back to a **matching Feature Name** within the configured discipline projects.
- Q: Does every Cloners link make a sub-lane? -> A: **No.** Only a clone living in a DIFFERENT, configured discipline
  project becomes a sub-lane. A clone in the dev team's own Feature project is a peer Feature, not another
  discipline's copy, and keeps its own top-level lane.
- Q: Whose column vocabulary do sub-lane cards sit in? -> A: The **dev team's own vocabulary** — one board, one set of
  columns — and sub-lane cards are **view-only**.
- Q: Do sub-lanes count toward the Feature's roll-up figures? -> A: **Both are shown, separately**: the dev figure and
  the whole-family figure side by side.

## User Scenarios & Testing

### US1 — See the whole Feature, not just the dev slice (P1)

As a **Scrum Master or PO looking at the Roll-Up Board**, I want the QE and BT clones of a Feature to appear as
**sub-lanes underneath the dev Feature's lane**, so that one glance shows every discipline's contribution to one
outcome.

**Acceptance scenarios**

1. **Given** a dev Feature with a QE clone and a BT clone, **when** the board loads, **then** the dev Feature's lane
   shows two sub-lanes beneath it, one per clone.
2. **Given** a dev Feature with no clones, **when** the board loads, **then** the lane renders exactly as it does
   today, with no empty sub-lane region and no visual change.
3. **Given** a clone that exists but has no stories under it yet, **when** the board loads, **then** its sub-lane
   appears and states that the discipline has not broken its work down — the same signal the board already gives for
   an empty Feature, one level down.

### US2 — Tell the disciplines apart at a glance (P1)

As a **viewer**, I want each sub-lane to be visually distinct from the primary lane and from the other sub-lanes, so
that I never mistake a QE story for a dev story.

**Acceptance scenarios**

1. **Given** a lane with QE and BT sub-lanes, **when** it renders, **then** each sub-lane carries a distinct and
   **stable** colour treatment, plus a text label naming the discipline — colour is never the only carrier of the
   distinction.
2. **Given** the same board reloaded, or viewed by a different team member, **when** it renders, **then** each
   discipline keeps the same colour it had before.

### US3 — Know when the disciplines disagree (P2)

As a **PO**, I want to see when the clones and the dev Feature are in materially different states, because that
disagreement is the thing worth acting on.

**Acceptance scenarios**

1. **Given** a dev Feature that is Done and a QE clone that is still in progress, **when** the board loads, **then**
   the Feature is not presented as finished, and the disagreement is stated.
2. **Given** a clone whose Feature could not be read, **when** the board loads, **then** the sub-lane says so rather
   than silently omitting the discipline.

### US4 — Read another discipline's work without being able to disturb it (P3)

As a **team member**, I want to open any sub-lane card and read it, but I do **not** want to move another discipline's
work through a workflow I do not own — so sub-lanes are deliberately view-only.

**Acceptance scenarios**

1. **Given** a card in a sub-lane, **when** it is clicked, **then** its detail opens in place exactly as a primary-lane
   card's does, including the transitions panel, which reads as information rather than as an invitation.
2. **Given** a card in a sub-lane, **when** a drag is attempted, **then** the card does not move and the board states
   that this discipline's work is read-only here — the restriction is announced rather than discovered by a card that
   silently snaps back.
3. **Given** a card in the primary lane, **when** it is dragged, **then** it behaves exactly as it does today. Making
   sub-lanes read-only MUST NOT make the primary lane feel different.

### Edge cases

- A dev Feature with **two clones from the same discipline** (a re-clone, or a split).
- A clone that has been cloned **again** — a clone of a clone. Depth is capped at one level of sub-lane; a
  second-generation clone is attributed to the dev Feature it ultimately descends from, not nested twice.
- A clone whose own PI value differs from the dev Feature's.
- A clone the viewer **has no permission to read**.
- A QE story that carries a Feature Link pointing at the **dev** Feature rather than the QE clone — it must not appear
  twice.
- A dev Feature that is itself a clone of somebody else's Feature.
- A dev Feature cloned **within its own project** — a peer, not a discipline. Keeps its own top-level lane.
- A clone in a project nobody has configured — reported, not guessed at.

## Requirements

### Functional Requirements

- **FR-001**: The board MUST identify, for each dev Feature on the board, the set of Features in other projects that
  are clones of it, using two tests in order:
  1. a Jira **Cloners** issue link between the two Features — exact, and free whenever the clone was made with Jira's
     own Clone action;
  2. failing that, a **matching Feature Name** between the dev Feature and a Feature in one of the configured
     discipline projects.
  The fallback exists because a discipline that creates its Feature by hand leaves no Cloners link, and a family that
  silently loses a member would recreate the very blind spot this feature exists to close. Observed evidence says the
  fallback will rarely fire and must never be relied on: on the sampled Feature, the QE clone `QEINT-610` carries a
  summary with no words in common with its dev original, because a discipline rewrites the title to describe its own
  scope. **The Cloners link is the real mechanism; the name match is a net, not a plan.**
- **FR-001a**: Where a clone is matched by name rather than by link, the sub-lane MUST say so. A name match is a
  reasonable inference and an edited title breaks it; presenting an inference as a fact is what makes a wrong board
  believable.
- **FR-001b**: A name match MUST be considered only within the configured discipline projects (FR-013), never across
  Jira at large, and MUST require an exact match after trimming — not a fuzzy or partial one.
- **FR-001c**: A clone MUST become a sub-lane **only when it lives in a different, configured discipline project**.
  A Cloners link is not by itself evidence of another discipline: teams clone Features within their own project to
  split scope — the sampled Feature is cloned by both `DENP-1359`, a peer in the dev team's own Feature project, and
  `QEINT-610`, the QE copy. The first is a sibling Feature and MUST keep its own top-level lane; only the second is a
  sub-lane. **The project decides, not the link.**
- **FR-001d**: A clone in an unrecognised project — neither the dev team's own nor any configured discipline's — MUST
  NOT become a sub-lane, and MUST NOT be silently discarded either. It MUST be reported once, so an unconfigured
  discipline is discovered by being told rather than by a Feature quietly reading as finished.
- **FR-002**: The board MUST render each identified clone as a **sub-lane** beneath its dev Feature's lane, labelled
  with the discipline it belongs to and the clone's own issue key.
- **FR-003**: Each sub-lane MUST show the work that rolls up to **that clone**, using the same roll-up rules the board
  already applies to the dev Feature (Feature Link, parent, and the existing defect precedence chain).
- **FR-004**: Each sub-lane MUST be visually distinguished from the primary lane and from other sub-lanes by a stable
  colour treatment **and** an accompanying text label. Colour MUST NOT be the sole carrier of any distinction.
- **FR-005**: A Feature with no clones MUST render exactly as it does today, with no added region and no added height.
- **FR-006**: Sub-lane cards MUST open their detail in place exactly as primary-lane cards do, and MUST be **read-only**
  — they cannot be dragged and their status cannot be changed from this board. The board does not own another
  discipline's workflow, and offering a move it has no business making is worse than not offering it.
- **FR-006a**: The read-only nature of a sub-lane MUST be visible before it is tested, not discovered by a card that
  refuses to move.
- **FR-007**: The board MUST place sub-lane cards into **the dev team's own column vocabulary**, so the whole board
  reads as one board with one set of columns rather than three boards stacked. Sub-lane cards MUST align with the same
  shared column grid as every other row.
- **FR-007a**: A clone status that no column claims MUST land in **Unmapped**, exactly as a dev status would, and MUST
  be reported by the existing unmapped-states notice so the mapping can be added. Another discipline's statuses are
  the commonest thing a team's vocabulary will not yet cover, so this path is the normal case rather than the
  exception.
- **FR-008**: The Feature's lane MUST show **two figures side by side**: the **dev** figure, computed exactly as it is
  today, and the **family** figure, which includes every discipline's work. Neither replaces the other. Redefining the
  existing number would silently change the meaning of every figure already on the board and of the PI-level surfaces
  that must agree with it; showing only the dev number would let a Feature read as finished while QE still has open
  work. Both are true, and they answer different questions.
- **FR-008a**: The two figures MUST be labelled such that neither can be mistaken for the other, and a Feature with no
  clones MUST show **one** figure — a family figure identical to the dev figure is noise, not information.
- **FR-008b**: Where the dev figure reads complete and the family figure does not, the lane MUST state the
  disagreement, because that gap is the single most actionable thing this feature surfaces.
- **FR-009**: The board MUST NOT show the same issue in both a primary lane and a sub-lane. The rule is the one the
  board already applies: **an issue is drawn in the lane of the Feature it rolls up to**, resolved by the existing
  precedence chain. If that Feature is the dev Feature the issue sits in the primary lane; if it is a clone, it sits in
  that clone's sub-lane. No new tie-break is introduced, and the card's existing roll-up-route line continues to name
  the Feature it reached — which now also explains which lane it is in.
- **FR-010**: Where a clone exists but cannot be read, the sub-lane MUST state that a discipline's work is missing,
  rather than being omitted — an absent sub-lane MUST always mean "no clone", never "a clone we failed to read".
- **FR-011**: Sub-lanes MUST be collapsible independently of their primary lane, and MUST default to a state that keeps
  the board's overall height comparable to today's.
- **FR-012**: The quick filters (type, assignee, fix version) MUST apply to sub-lane cards on the same terms as
  primary-lane cards.
- **FR-013**: Which projects belong to which discipline MUST be configurable per team, alongside the board's existing
  Feature-scope settings, and MUST NOT be inferred from project naming conventions. The configuration is the single
  thing that separates "another discipline's copy" from "our own second Feature", so it MUST be explicit.

### Key Entities

- **Feature Family** — one dev Feature and the set of clones descending from it. The unit the board now draws as a lane
  plus its sub-lanes.
- **Discipline** — a named participant in a Feature Family (Dev, QE, BT), owning one Feature project and one story
  project, and carrying a stable colour.
- **Clone Link** — the evidence connecting a clone to its dev original.
- **Sub-Lane** — the rendered band for one discipline's clone: its own Feature vitals, its own cards, and its own
  collapsed state.

## Success Criteria

- **SC-001**: For a Feature delivered by three disciplines, a viewer can name every discipline's status and outstanding
  work **without leaving the board** and without opening Jira.
- **SC-002**: No Feature is presented as complete while any discipline in its family has open work.
- **SC-003**: A viewer can tell which discipline any card belongs to within one second of looking at it, without
  relying on colour alone.
- **SC-004**: A board of Features with no clones is no taller and no slower to load than it is today.
- **SC-005**: Every issue on the board appears exactly once.
- **SC-006**: When a clone cannot be read, the viewer is told which discipline is missing and why.

## Assumptions

These are reasonable defaults taken without asking. Any of them can be overridden.

- **A-001**: Disciplines are **Dev, QE and BT** today, but the design treats the list as configurable data rather than
  three hard-coded cases — a fourth discipline should cost a configuration entry, not a code change.
- **A-002**: Colour is assigned **per discipline**, not per lane, so QE is the same colour in every lane on the board.
  Colours are drawn from the app's existing token palette and never generated randomly.
- **A-003**: Sub-lanes are **collapsed by default**, showing a one-line summary of the discipline's state, and expand
  on click. This keeps FR-005's promise about board height while still surfacing SC-002's disagreement signal.
- **A-004**: The clone relationship is read **from Jira on every board load**. Nothing about the family is stored
  locally except the per-team project configuration.
- **A-005**: A clone's own work is scoped by the same PI as the dev Feature's board. A clone carrying a different PI is
  still shown, with the difference stated, because hiding it would recreate SC-002's failure.
- **A-006**: Sub-lanes are read-only, so the board makes **no writes at all** into another discipline's issues. This
  removes the whole question of foreign workflows, permissions, and half-applied moves across project boundaries.
- **A-007**: "Sub-lane" nesting is **one level deep**. A clone of a clone is attributed to the dev Feature at the root
  of the family.

- **A-008**: The Cloners link is checked in **both** directions. Which end of the link Jira recorded depends on who
  pressed Clone, and a family that appears or disappears based on that is not a family.
- **A-009**: The family figure counts a discipline's work whether or not that discipline's statuses map to a column.
  An unmapped card is still work; excluding it would make the family figure flatter the truth.

## Dependencies

- The existing Roll-Up Board (spec `034-feature-rollup-board`), specifically its lane model, roll-up route resolution,
  column vocabulary, and move-refused dialog.
- The per-team Feature scope configuration, which this feature extends with discipline project mappings.

## Out of Scope

- Changing how QE or BT create or clone their Features.
- Creating a clone from the board.
- Keeping clone fields in sync with the dev Feature.
- Any change to the PI Review or Feature Review surfaces.

## Resolved Questions

All three are answered; see **Clarifications** above.

| # | Question | Decision |
|---|---|---|
| 1 | What marks a clone? | Cloners link, falling back to Feature Name within configured discipline projects |
| 1a | Does every clone become a sub-lane? | No — only one in a different, configured discipline project |
| 2 | Whose columns do sub-lane cards use? | The dev team's, and sub-lanes are view-only |
| 3 | Do sub-lanes count toward the roll-up numbers? | Both figures shown separately: dev and family |
