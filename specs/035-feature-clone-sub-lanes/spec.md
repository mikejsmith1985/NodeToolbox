# Feature Specification: Cloned-Feature Sub-Lanes — QE and BT work under the Dev Feature

**Feature Branch**: `feature/035-feature-clone-sub-lanes`

**Created**: 2026-08-12

**Status**: Draft — 3 open questions

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

### US4 — Work in a sub-lane the way you work in the primary lane (P3)

As a **team member**, I want the cards in a sub-lane to behave like the cards I already use — clickable for detail,
draggable between columns — so that there is no second set of rules to learn.

**Acceptance scenarios**

1. **Given** a card in a sub-lane, **when** it is clicked, **then** its detail opens in place exactly as a primary-lane
   card's does.
2. **Given** a card in a sub-lane belonging to another discipline's workflow, **when** a move is attempted that that
   workflow does not allow, **then** the existing move-refused dialog explains it in the same terms it uses today.

### Edge cases

- A dev Feature with **two clones from the same discipline** (a re-clone, or a split).
- A clone that has been cloned **again** — a clone of a clone. Depth is capped at one level of sub-lane; a
  second-generation clone is attributed to the dev Feature it ultimately descends from, not nested twice.
- A clone whose own PI value differs from the dev Feature's.
- A clone the viewer **has no permission to read**.
- A QE story that carries a Feature Link pointing at the **dev** Feature rather than the QE clone — it must not appear
  twice.
- A dev Feature that is itself a clone of somebody else's Feature.

## Requirements

### Functional Requirements

- **FR-001**: The board MUST identify, for each dev Feature on the board, the set of Features in other projects that
  are clones of it. [NEEDS CLARIFICATION: see Question 1 — what evidence in Jira marks a clone?]
- **FR-002**: The board MUST render each identified clone as a **sub-lane** beneath its dev Feature's lane, labelled
  with the discipline it belongs to and the clone's own issue key.
- **FR-003**: Each sub-lane MUST show the work that rolls up to **that clone**, using the same roll-up rules the board
  already applies to the dev Feature (Feature Link, parent, and the existing defect precedence chain).
- **FR-004**: Each sub-lane MUST be visually distinguished from the primary lane and from other sub-lanes by a stable
  colour treatment **and** an accompanying text label. Colour MUST NOT be the sole carrier of any distinction.
- **FR-005**: A Feature with no clones MUST render exactly as it does today, with no added region and no added height.
- **FR-006**: Sub-lane cards MUST support the same interactions as primary-lane cards: open detail in place, drag
  between columns, and the existing move-refused explanation.
- **FR-007**: The board MUST place sub-lane cards into columns using [NEEDS CLARIFICATION: see Question 2 — the dev
  team's column vocabulary, or the owning discipline's own?]
- **FR-008**: The Feature's roll-up figures — % complete, story-point totals, item counts — MUST account for clone work
  according to [NEEDS CLARIFICATION: see Question 3 — do sub-lanes count toward the Feature's numbers?]
- **FR-009**: The board MUST NOT show the same issue in both a primary lane and a sub-lane. Where an issue could be
  attributed to both, the attribution MUST be decided by one stated rule and that rule MUST be visible in the card's
  existing roll-up-route line.
- **FR-010**: Where a clone exists but cannot be read, the sub-lane MUST state that a discipline's work is missing,
  rather than being omitted — an absent sub-lane MUST always mean "no clone", never "a clone we failed to read".
- **FR-011**: Sub-lanes MUST be collapsible independently of their primary lane, and MUST default to a state that keeps
  the board's overall height comparable to today's.
- **FR-012**: The quick filters (type, assignee, fix version) MUST apply to sub-lane cards on the same terms as
  primary-lane cards.
- **FR-013**: Which projects belong to which discipline MUST be configurable per team, alongside the board's existing
  Feature-scope settings, and MUST NOT be inferred from project naming conventions.

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
- **A-006**: Writes into another discipline's issues go through the board's existing write path and are therefore
  subject to that discipline's workflow and the viewer's own Jira permissions. The board adds no new write authority.
- **A-007**: "Sub-lane" nesting is **one level deep**. A clone of a clone is attributed to the dev Feature at the root
  of the family.

## Dependencies

- The existing Roll-Up Board (spec `034-feature-rollup-board`), specifically its lane model, roll-up route resolution,
  column vocabulary, and move-refused dialog.
- The per-team Feature scope configuration, which this feature extends with discipline project mappings.

## Out of Scope

- Changing how QE or BT create or clone their Features.
- Creating a clone from the board.
- Keeping clone fields in sync with the dev Feature.
- Any change to the PI Review or Feature Review surfaces.

## Open Questions

The three questions below block the plan. They are reproduced with full context in the conversation.

1. **What marks a clone?** (blocks FR-001)
2. **Whose columns do sub-lane cards use?** (blocks FR-007)
3. **Do sub-lanes count toward the Feature's roll-up numbers?** (blocks FR-008, SC-002)
