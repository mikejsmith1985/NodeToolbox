# Feature Specification: Blueprint-First Surfacing, a Curated Canvas, and Expandable Nodes

**Feature short name**: `surface-picker-expand`
**Created**: 2026-07-03
**Status**: Draft — all clarifications resolved (Q1=A, Q2=A, Q3=A); ready for `/speckit-plan`

## Summary

Real use of the shipped Feature Canvas Surface control (feature 010, v0.29.0) surfaced three UX/coaching
problems and one plain bug. This spec redesigns *how work gets onto the canvas* and *how you inspect it*
once there, from a master-UX + master-Agile-coach standpoint.

- **The default no longer works for a real SAFe topology (bug).** The default query looks for
  `Feature/Epic` issue types **in the team's own project** — but in this org the team project holds only
  the sprint work (stories/tasks); the **features and epics live in a separate portfolio project** and are
  discovered by walking parent links up from the PI-scoped team work. That is exactly what the existing
  **blueprint** query does. So the naive same-project default returns nothing. The fix: **surface from the
  blueprint**, not a same-project issue-type guess.

- **Surfacing should be a deliberate selection, not an auto-dump.** Dumping every query match onto the
  canvas is the opposite of the coaching goal ("find the scope in the madness"). The redesign makes
  surfacing a **picker**: the user browses the in-scope items and **chooses** which to place. The canvas
  becomes a *curated working set*, assembled with intent — not a raw query output.

- **A second surface should add, not overwrite.** Because this is exploratory, running another query today
  **replaces** the canvas and destroys the arrangement the user built. Surfacing should be **additive** —
  each pick appends to what is already there (skipping duplicates) — with a deliberate way to remove a node
  you no longer want. You build the board up and prune it, rather than restart it.

- **Nodes must be expandable to inspect the epic and its children.** Right now a feature node is a compact
  card with no way to open it. The user needs **progressive disclosure**: expand a node to see the epic's
  full detail and its **child records** (the stories/tasks under it), so they can understand what is inside
  before and while they plan.

Custom JQL stays available as a **power-user path**, but it feeds the same picker — it never auto-dumps.

## Coaching & UX rationale (why the redesign is shaped this way)

- **Deliberate curation over bulk import.** A recovering backlog is triaged by *choosing* what to engage,
  not by mirroring a query. A selection step is the moment the Scrum Master decides "these are the parents I
  will actually work on this week," which is the whole point of the canvas.
- **Non-destructive, additive building.** Exploration requires safety: nothing you already arranged should
  vanish because you ran another search. Additive surfacing + explicit removal makes the canvas a stable
  workspace you shape over multiple sessions.
- **Progressive disclosure.** A card shows the gist; expansion reveals the depth (children, links, detail)
  on demand — so the board stays scannable while full context is one click away when a decision needs it.
- **Meet the tool to the org's topology.** Surfacing must use the org's real parent-finding (the blueprint),
  not assume features live where the team's stories live.

## Scope Boundary (explicit non-goals)

- **Out of scope**: Changing the five-stage coaching journey, the overlay/commit model, or the AI accelerator
  from features 009/010. This refines *surfacing and inspection*, not the planning or commit flow.
- **Out of scope**: Editing epic or child-issue fields from the expanded node (read-only inspection here).
  Field edits remain the job of the existing Review & Commit / hygiene surfaces.
- **Out of scope**: A full portfolio/roadmap view. The blueprint picker shows the in-scope hierarchy for the
  active team + PI; it is a selection aid, not a new reporting surface.
- **Out of scope**: Removing the custom-JQL capability. JQL remains, demoted to a secondary source that
  feeds the picker.
- **Out of scope**: Multi-user/live-collaborative selection. Single-operator, as today.

## Clarifications

### Session 2026-07-03

All three decisions were resolved in favor of the recommended options:

- **Q1 — Surfacing model**: Resolved → **Blueprint-first picker (Option A)**. The picker's default source is
  the blueprint's cross-project parent-walk; custom JQL is a secondary source that feeds the same picker.
- **Q2 — Additive vs replace**: Resolved → **Additive (Option A)**. A surface appends and skips duplicates;
  an explicit node-remove action prunes the working set. New surfaces never overwrite.
- **Q3 — Select vs auto-add**: Resolved → **Pick from a checklist (Option A)**, with select-all/clear-all for
  speed. Nothing reaches the canvas without a selection (or select-all).
- Q: How does a node "expand" to show detail + children? → A: A docked **side inspector panel** —
  selection-driven, one node at a time (not persistent per-node inline expansion), keeping the board scannable.
- Q: What happens to feature 010's refine chips (label/text/status)? → A: **Removed** from the canvas; the
  picker instead gets its own **search/filter** to locate features while selecting. The canvas shows exactly
  the curated set.

The original options are retained below for context.

Three decisions materially shape the surfacing model and are the exact forks the user raised (they were
explicitly undecided on two). Recommended options are marked; the spec is written against them, now confirmed.

### Q1 — What is the primary way to get work onto the canvas?

**Context**: Today the primary path is a raw JQL box whose default is wrong for a cross-project topology.

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **Blueprint-first picker.** Surfacing opens a picker showing the in-scope features found by the existing blueprint (active team + PI, walking parent links across projects), grouped Program Epic → Feature. Custom JQL is a secondary source that feeds the same picker. | Fixes the cross-project bug, matches the org's real parent-finding, and makes surfacing a deliberate selection. |
| B | **JQL-first, fixed default.** Keep the JQL box primary but change the default to the correct cross-project parent query; add selection on top. | Smaller change; but keeps a query box as the front door, which is less discoverable and still power-user-shaped. |
| C | **Keep current (auto-dump JQL).** Only fix the default query. | Minimal; but leaves the destructive auto-dump and same-project assumption's UX problems unaddressed. |

**Recommendation: A.** The blueprint already solves the hard problem (finding cross-project parents in
scope); make it the front door and let the user pick.

### Q2 — Does a new surface add to the canvas or replace it?

**Context**: Today a second query overwrites the canvas, destroying the built arrangement. The user was
undecided.

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **Additive.** Each pick appends the chosen items to what is already on the canvas; items already present are shown as "already added" and skipped. A separate, explicit action removes a node. | Safe for exploration; the canvas is a curated set built up over time. Requires a node-remove affordance. |
| B | **Replace.** A new surface clears the canvas and shows only the new results (today's behavior, but from the picker). | Simpler mental model for one-shot use; but destroys in-progress arrangement and fights the exploratory goal. |

**Recommendation: A.** Additive is the exploratory-safe default; pair it with easy node removal.

### Q3 — Within a surface, does the user pick items or add all matches?

**Context**: The user asked whether to "select from a list what gets added rather than just putting it on
the canvas." They were undecided.

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **Pick from a list.** Matches appear in a checklist; the user selects which to add (with select-all / select-none for speed). | Maximum control and the deliberate-curation coaching moment; a couple extra clicks. |
| B | **Auto-add all matches.** Everything the source returns is added (deduped), no selection step. | Fastest; but re-introduces bulk import and reduces the "choose your scope" intent. |

**Recommendation: A.** Selecting is the point — it is where the Scrum Master decides what to engage. Provide
select-all so it is not tedious when they do want everything.

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**Story A — Scrum Master (see the right parents, cross-project):**
As a Scrum Master whose epics/features live in a portfolio project separate from the team's story project, I
want surfacing to find the in-scope parents via the blueprint (the same way ART/Feature Review does), so the
canvas shows real features instead of nothing.

**Story B — Scrum Master (choose what to work on):**
As a Scrum Master triaging a messy backlog, I want to browse the in-scope features and **check the ones** I
want on the canvas, so the board reflects a deliberate decision about scope rather than a raw query dump.

**Story C — Scrum Master (build up, don't wipe):**
As a Scrum Master exploring, I want a second surface to **add** to what I have arranged — not replace it — and
I want to **remove** a node I no longer want, so I can shape the board across a week of sessions without
losing work.

**Story D — Scrum Master (inspect before planning):**
As a Scrum Master, I want to **expand a feature node** to see the epic's detail and its **child stories/tasks**
(status, points), so I understand what is inside a feature before I prioritize, size, or box it.

**Story E — Power user (custom query when needed):**
As an advanced user, I want to run a **custom JQL** query whose results still appear in the **same picker** to
choose from, so I can reach work the blueprint doesn't surface without losing the deliberate selection step.

### Acceptance scenarios

- **Blueprint surfacing works cross-project (Q1=A)**: Given a team whose features live in a separate project,
  when the user opens the picker, then it lists the in-scope features found by the blueprint (parents of the
  PI-scoped team work), grouped Program Epic → Feature — not an empty result.

- **Deliberate selection (Q3=A)**: Given the picker shows 12 in-scope features, when the user checks 4 and
  presses Add, then exactly those 4 appear on the canvas and the other 8 do not.

- **Select-all convenience (Q3=A)**: When the user chooses "select all" and Add, then every listed item is
  added in one action.

- **Additive build-up (Q2=A)**: Given 4 features already arranged on the canvas, when the user surfaces again
  and adds 3 more, then all 7 are present and the original 4 keep their position/size/priority/box.

- **Duplicate skip (Q2=A)**: Given a feature already on the canvas, when it appears in a later pick, then it is
  shown as "already added" and adding does not duplicate or reset it.

- **Node removal (Q2=A)**: Given a feature node on the canvas, when the user removes it, then it disappears
  from the canvas; its saved arrangement is discarded for that node only, and other nodes are unaffected.

- **Custom JQL feeds the picker (Q1=A, E)**: Given the user switches to custom JQL and runs a query, then the
  matches appear in the same checklist to select from (not auto-dumped); a bad query shows a clear error and
  changes nothing on the canvas.

- **Open a node's inspector (Story D)**: Given a feature node, when the user opens it, then a docked side
  inspector shows the epic's detail (summary, status, assignee, size/points, health, completion, hygiene
  flags, links) and a list of its **child records** with each child's status and points; opening another node
  replaces the inspector's contents, and dismissing it closes the panel and returns focus to the board.

- **Inspection is read-only**: When a node is being inspected, then no field is editable there; inspection
  does not mutate Jira or the overlay.

## Functional Requirements

### Area 1 — Blueprint-first selection surfacing

**FR-1: Blueprint picker as the primary surfacing entry (per Q1=A)**
1.1 Surfacing opens a **picker** that lists the in-scope features from the **blueprint** for the active team +
    PI — i.e. the parents found by walking links up from the PI-scoped team work, **across projects** — grouped
    by Program Epic → Feature.
1.2 Each picker row shows enough to decide: feature key, summary, status, health, and child count.
1.3 The picker never depends on features living in the team's own project; it works when features/epics are in
    a separate portfolio project.

**FR-2: Deliberate selection (per Q3=A)**
2.1 The picker lets the user **select** which listed features to add (per-row checkboxes) with **select-all**
    and **clear-all** controls.
2.2 Pressing **Add** places exactly the selected features on the canvas; unselected ones are not added.
2.3 The picker provides a **search/filter** (e.g. by key, summary text, or label) to locate features within a
    long in-scope list while selecting. This replaces feature 010's canvas-level refine chips, which are
    **removed** — the canvas now shows exactly the curated set rather than a post-hoc filtered view.

**FR-3: Custom JQL as a secondary source (per Q1=A)**
3.1 The user can switch the picker's source to a **custom JQL** query; its matching features appear in the
    same selectable checklist (never auto-dumped).
3.2 A malformed or unauthorized custom query surfaces nothing, shows a clear error, and does not change the
    canvas.

### Area 2 — Curated, additive canvas

**FR-4: Additive surfacing (per Q2=A)**
4.1 Adding from the picker **appends** the selected features to whatever is already on the canvas; it never
    clears or replaces existing nodes.
4.2 Features already on the canvas are shown in the picker as **already added** and are skipped when adding —
    no duplicates, and their existing arrangement (position/size/priority/box) is preserved.

**FR-5: Remove a node from the canvas (per Q2=A)**
5.1 The user can **remove** an individual feature node from the canvas.
5.2 Removal affects only that node (its overlay arrangement is dropped); all other nodes and their arrangement
    are untouched. Removal is a canvas/working-set action only — it does not change anything in Jira.

### Area 3 — Expandable node detail

**FR-6: Inspect a feature node in a side panel (progressive disclosure)**
6.1 Opening a feature node (via a per-node control and/or selecting it) opens a docked **side inspector
    panel** showing the epic's detail: summary, status, assignee, size/points, health, completion %, hygiene
    flags, and links. Exactly **one** node is inspected at a time.
6.2 The inspector lists the feature's **child records** (stories/tasks), each with at least key, summary,
    status, and points.
6.3 The inspector is **selection-driven**: it shows the currently opened node and closes when dismissed or
    when another node is opened. It does not grow the node inline or clutter the spatial board, so the canvas
    stays scannable.
6.4 The inspector is **read-only**: it inspects, it does not edit Jira or the overlay.

## Success Criteria

1. **SC-1 — Cross-project surfacing succeeds**: For a team whose features are in a separate project, the picker
   lists a non-empty set of in-scope features (matching what ART/Feature Review shows for the same team + PI).

2. **SC-2 — Nothing is added without a choice**: When the user surfaces, zero features reach the canvas until
   they select and Add (except when they use select-all).

3. **SC-3 — No destructive overwrite**: Across any number of surfaces, previously arranged nodes are never
   removed or reset by a new surface (only explicit node removal removes a node). Measured: zero unintended
   node losses over a multi-surface session.

4. **SC-4 — No duplicates**: Adding a feature already on the canvas results in exactly one node for that
   feature (duplicate adds are no-ops).

5. **SC-5 — Inspect in place**: From a feature node, the user can view the epic's detail and its child records
   without leaving the canvas, in one action (a docked side inspector).

6. **SC-6 — Scannability preserved**: With nodes collapsed, the board is as scannable as today; detail appears
   only on demand (expansion), so adding this capability does not clutter the default view.

7. **SC-7 — Safe custom queries**: A malformed custom query adds nothing and shows a clear error, leaving the
   canvas unchanged 100% of the time.

## Key Entities

| Entity | Description |
|--------|-------------|
| Surfacing Picker | The selection surface listing in-scope features (from the blueprint or a custom query) with per-row checkboxes and select-all/clear-all |
| Blueprint Scope Source | The in-scope feature set for the active team + PI, found by the existing cross-project parent-walk (the default picker source) |
| Custom Query Source | An optional user JQL whose matches populate the same picker |
| Canvas Working Set | The curated, additive set of feature nodes the user has chosen; built up and pruned, never overwritten by a surface |
| Feature Node + Inspector | A canvas node (compact card) plus a read-only, selection-driven **side inspector** that shows the opened node's epic detail and its child records |
| Child Record | A story/task under a feature, shown (read-only) in the expanded node with key, summary, status, points |

## Assumptions

- **A1**: The blueprint picker reuses the org's existing parent-finding (the same hierarchy ART/Feature Review
  already computes for the active team + PI); this is the correct cross-project source and replaces the naive
  same-project default from feature 010.
- **A2** *(confirmed — Q1=A)*: Blueprint is the primary picker source; custom JQL is a secondary source
  feeding the same selectable list.
- **A3** *(confirmed — Q2=A)*: Surfacing is additive; a new surface never overwrites, and an explicit
  node-remove action prunes the working set.
- **A4** *(confirmed — Q3=A)*: Surfacing requires selection (with select-all), not auto-add of all matches.
- **A5**: Node expansion is read-only inspection; child records are read from the data the blueprint already
  fetches for each feature, so no new heavy fetch is required to show children.
- **A6**: The custom-JQL escape hatch retains the safe-failure behavior from feature 010 (bad query → error,
  canvas unchanged).
- **A7**: This feature supersedes feature 010's surfacing front door: the same-project default query is
  replaced by the blueprint picker, the JQL box becomes the picker's "custom query source", and 010's
  canvas-level refine chips are removed (their find-features role moves into the picker's own search/filter).

## Dependencies

- The existing blueprint hierarchy (cross-project parent-finding for the active team + PI) from features
  009/010 and ART/Feature Review.
- The Feature Canvas overlay + node model (009), including the existing per-node expand state and child-story
  data.
- The custom-JQL surfacing path and its safe-failure behavior (010).
