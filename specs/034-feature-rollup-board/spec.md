# Feature Specification: Feature Roll-Up Board — Master Cards with a Configurable Status Vocabulary

**Feature Branch**: `feature/034-feature-rollup-board`

**Created**: 2026-08-07

**Status**: Draft

**Input**: User description: "I need the ability to recreate a Sprint/Kanban board from Jira for my team based on the board that is selected in the team settings. The problem we're trying to solve for is clear status visibility. Features are housed in separate projects from the work we're doing. Sometimes we use stories sometimes we use sub-tasks sometimes we use smart-checklist items to break down work. Sometimes bugs found in testing are linked to the QA issue sometimes they're linked to the feature, sometimes they're linked to the Dev Story. I implemented a workflow to solve for this and it's not in alignment with enterprise standards so I'm told to go back to the chaos that has no predictability. What I need in a board is a 'Master' card that represents the feature. It should display: Key, Summary, Status, %Complete, dependencies, flagged, story points, priority. Inside that master card I want to see a Kanban board that is configurable just like a board in Jira. I need the ability to generate my own status names and then map them to a combination of status/sub-status in Jira, so that when I move a card to my personal status that clearly states where the issue is, in Jira it will get the correct status and sub-status. Seeing Stories, sub-tasks, defects all as child cards in the master card with colour coding — green headers for Stories, red headers for Defects, blue headers for sub-tasks. If we can show the sub-tasks in nested card models like Jira does that would be ideal, and honestly I would like to see the same for the defects. I want it to be ridiculously difficult to not understand how each item rolls up to deliver the feature master card it's in. A stack of these master cards exists for each item on the board. If an issue on the board doesn't roll up to a Feature then we need a 'Master Card' for 'No Feature' which is a hygiene issue which will need to be resolved. I will need quick filters to look at: only stories, only defects, only sub-tasks, each individual assignee, fixVersion. The master cards should be sortable in a priority order that the user chooses via drag and drop, maybe a right click send to top, or send to bottom feature would be nice also. In addition to drag and drop functionality the standard click an item and edit any field which we've already implemented in a handful of scenarios still applies here too."

## Context

The team cannot see, at a glance, **what state the work is actually in** or **which business outcome each piece of
work delivers**. Three structural facts in the organisation's Jira cause this, and none of them can be changed by this
team:

1. **Features live in a different Jira project from the delivery work.** A team board therefore shows Stories, Tasks,
   Sub-tasks and Defects with no visible connection to the Feature that justifies them.
2. **Work is broken down inconsistently.** The same kind of work may be expressed as a Story, as a Sub-task, or as a
   checklist item inside an issue, depending on who created it.
3. **Defects are attached inconsistently.** A defect found in testing may be linked to the QA issue, to the Feature,
   or to the development Story — so there is no single reliable route from a defect back to the outcome it threatens.

The team previously adopted a local workflow that resolved this, but that workflow was rejected as non-compliant with
enterprise Jira standards. The team must therefore work inside the standard, inconsistent structure. **This feature
does not attempt to change Jira. It changes what the team sees.** It reads the standard, messy data and presents it in
one arrangement where the roll-up is unmistakable — and, where the underlying data genuinely cannot support a roll-up,
says so out loud as a hygiene problem instead of hiding it.

Two further problems follow from the same root cause and are also in scope:

- **Status names do not describe reality.** The enterprise workflow's status names are coarse; the precise state of an
  item is expressed as a combination of a status and a sub-status. Reading a board requires holding that combination in
  your head. The team needs to define **their own clear status names**, each one mapped to the status + sub-status
  combination it represents, so that moving a card to a self-explanatory column writes the correct compliant
  combination back to Jira. The team gets clarity; the enterprise gets its standard values.
- **Priority order is not visible.** The order the team actually intends to work in is not represented on the board, so
  it is re-litigated verbally.

This feature is the **team-level visibility surface**. It is complementary to, and does not replace, the PI-level
planning and monitoring work: that answers "are we on track for the PI"; this answers "where is each piece of work
right now, and what does it deliver".

## Clarifications

### Session 2026-08-07

- Q: When a defect is linked to several candidate owners (QA issue, Feature, dev Story), which Master Card does it
  appear in? → A: **Nearest delivery ancestor wins, by fixed precedence: (1) development Story it is linked to,
  (2) the Story behind the QA issue it is linked to, (3) the Feature it is linked to directly, (4) otherwise "No
  Feature".** The chosen route is displayed on the defect card, and any *other* candidate links it had are shown as
  secondary links so nothing is silently discarded.
- Q: Is the custom status vocabulary personal or shared by the team? → A: **Team-scoped — one vocabulary per team,
  not per person.** A shared board must show every viewer the same columns; divergent per-person columns would
  recreate the ambiguity the feature exists to remove. See the following clarification for how it is distributed.
- Q: Where does the board's configuration live, given "shared" cannot mean per-browser? → A: **Split, with the
  vocabulary carried in the Shared ART Workspace.** The column vocabulary and its status/sub-status mappings become
  part of the team's record in the existing shared ART workspace: one person publishes it to the workspace's
  Confluence store, and other users pull it. The **Master Card order stays per-person and local**, because it is a
  daily working preference — publishing it would mean one person's drag silently reorders everyone else's board.
- Q: Do smart-checklist items appear as cards on the board? → A: **No — out of scope for v1.** Checklist items are
  displayed as a read-only completion indicator on their host issue's card when the checklist data is available, and
  are never movable, filterable, or writable. They are not a Jira issue and cannot carry a status, sub-status,
  assignee, or fixVersion, so they cannot participate in the board's columns or filters.
- Q: Can swimlanes be collapsed, and what state does the board open in? → A: **Collapsible, opens collapsed, and the
  collapse state is remembered per person.** The lane header already carries the Feature's eight vitals (FR-000c), so
  a collapsed board is a one-screen Feature-level portfolio read; the viewer expands only the lanes they are working.
  Opening fully expanded on a ~300-issue board would bury that read.
- Q: What board size must this support, and what happens past it? → A: **Around 300 issues, every page loaded, no
  truncation ever.** This is a sprint/kanban board, not a backlog, and it matches the volume the product's existing
  sprint surfaces already handle. Because the board's entire purpose is that nothing is hidden, truncation is not an
  acceptable failure mode: past the expected size the board still loads everything and warns that responsiveness may
  suffer.
- Q: How is nesting reconciled with each item sitting in its own status column? → A: **Every issue sits in the
  column of its own status; nesting is expressed by a per-column parent container**, exactly as Jira renders it
  (reference: GH #306). Within one column of one swimlane, children sharing a parent are wrapped in a lightweight
  container whose header shows the parent's key and summary. If two children of the same parent are in different
  columns, **each column draws its own container** for that parent. The parent's **own card** appears separately, in
  the column matching the parent's own status, **with no children inside it**, so the parent's status is readable
  independently of its children's. The container header is a **grouping label, not a second card** — the parent is
  still rendered as a card exactly once.
- Q: How do the Master Cards and the configurable columns combine geometrically? → A: **Swimlanes.** There is **one
  shared column header row at board level**, and each Master Card is a **full-width swimlane** beneath it, with its
  child cards sitting under the aligned columns. The Master Card's vitals live in the swimlane header. Columns stay
  aligned across every Master Card, so a single column can be read top-to-bottom to see everything in that state
  across all Features — a per-card, independently-scrolling mini-board would break that scan.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Every item on the board shows what it delivers (Priority: P1)

A delivery team member opens the board for their team. Instead of a flat list of issues, they see a vertical stack of
**Master Cards**, one per Feature. Every issue on the team's Jira board sits inside the Master Card of the Feature it
delivers — including issues whose Feature lives in a different Jira project. Any issue that cannot be traced to a
Feature is collected in a single **"No Feature"** Master Card that is clearly labelled as a hygiene problem to fix.

**Why this priority**: This is the feature's core purpose. Without the roll-up, none of the other capabilities have
anything to attach to.

**Independent Test**: Load the board for a team whose Features live in a separate project, including at least one
issue with no Feature link. Verify every board issue appears exactly once, under the correct Master Card, and that
the unattributable issue appears under "No Feature" with the hygiene marker.

**Acceptance Scenarios**:

1. **Given** a team board containing Stories linked to Features in a different project, **When** the board is opened,
   **Then** each Story appears inside the Master Card of its Feature, and the Feature's key and summary are shown even
   though the Feature is not on the team's board.
2. **Given** a Sub-task whose parent Story is linked to a Feature, **When** the board is opened, **Then** the Sub-task
   appears under that same Feature's Master Card.
3. **Given** an issue with no resolvable Feature, **When** the board is opened, **Then** it appears under the "No
   Feature" Master Card, which states how many issues it holds and identifies itself as a hygiene problem.
4. **Given** the board loads successfully, **When** the totals are compared, **Then** the number of issues shown across
   all Master Cards equals the number of issues on the source Jira board — nothing is dropped.

---

### User Story 2 — Status names the team actually understands (Priority: P1)

The team defines their own ordered set of column names that plainly describe where work is. Each column is mapped to
the Jira status and sub-status combination it represents. Moving a card into a column writes that compliant
combination back to Jira. Anything Jira reports that no column claims is shown in an explicit **"Unmapped"** column
rather than being hidden or guessed at. The vocabulary is the **team's**, not one person's: it is published to the
team's shared ART workspace and pulled by everyone else, so the whole team reads the board in the same language.

**Why this priority**: This is the "clear status visibility" the team is asking for, and it is what makes the board a
working surface rather than a read-only report.

**Independent Test**: Define a column mapped to a specific status + sub-status pair, drag a card into it, and confirm
in Jira that both values were written. Then place an issue in a status+sub-status combination no column claims and
confirm it surfaces under "Unmapped".

**Acceptance Scenarios**:

1. **Given** a defined column mapped to a status + sub-status pair, **When** a card is dragged into that column,
   **Then** the issue in Jira ends up with exactly that status and that sub-status.
2. **Given** the Jira transition demands additional fields before it will complete, **When** the card is dropped,
   **Then** the required fields are collected before the change is applied, and any field whose input type cannot be
   handled here is named plainly with a pointer to complete it in Jira.
3. **Given** a move that Jira rejects, **When** the failure returns, **Then** the card returns to the column it came
   from and the reason for the rejection is shown.
4. **Given** an issue whose status + sub-status matches no defined column, **When** the board renders, **Then** the
   issue appears in the "Unmapped" column with its raw Jira status and sub-status shown.
5. **Given** two columns claim the same status + sub-status combination, **When** the mapping is saved, **Then** the
   conflict is refused with an explanation, because one Jira state cannot resolve to two board columns.
6. **Given** one team member publishes the vocabulary to the shared ART workspace, **When** another team member pulls
   it, **Then** the differences are shown before acceptance, the pull can be refused, and after acceptance both people
   see identical columns.
7. **Given** a local vocabulary that has not been synchronised, **When** the board renders, **Then** it states which
   vocabulary is in use and when it was last synchronised with the workspace.

---

### User Story 3 — Roll-up that is impossible to misread (Priority: P1)

Within a Master Card's swimlane, every issue sits in the column of its **own** status, and parentage is shown by a
**per-column parent container**: children sharing a parent are wrapped together under a container header carrying the
parent's key and summary. If a parent's children are spread across three columns, each of those columns draws its own
container for that parent. The parent's **own card** appears separately, in its own status column, holding no children
— so the parent's progress is readable independently of its children's. Cards are colour-coded by type: Stories green,
Defects red, Sub-tasks blue. Every child card states the route by which it rolls up to the Master Card, so the
connection is never inferred.

**Why this priority**: The user's stated goal is that it be "ridiculously difficult" to misunderstand the roll-up.
Grouping alone (US1) does not achieve that when defects arrive through three different link routes — and physically
nesting children inside their parent's card would hide each child's real status, defeating the feature's whole
purpose.

**Independent Test**: Build a Master Card containing a Story with two Sub-tasks in *different* columns, a Defect
linked to that Story, and a Defect linked directly to the Feature. Verify that each column draws its own parent
container, that the Story's own card appears childless in its own column, and check the colouring, type labels, and
stated roll-up route on each card.

**Acceptance Scenarios**:

1. **Given** a Story with two Sub-tasks that are in different statuses, **When** the swimlane renders, **Then** each
   Sub-task appears in the column matching its own status, and **both** columns draw their own container headed by
   that Story's key and summary.
2. **Given** that same Story, **When** the swimlane renders, **Then** the Story's own card also appears in the column
   matching the Story's status, containing no children, so its own progress is separately visible.
3. **Given** a parent container header, **When** the board renders, **Then** it is visually distinct from an issue
   card, and the parent is counted as rendered exactly once as a card.
4. **Given** a Defect linked to a Story on the same Master Card, **When** the board renders, **Then** the Defect
   appears with a red header, grouped under that Story's container in the Defect's own status column, and states that
   it was raised against that Story.
5. **Given** a Defect linked only to the Feature, **When** the board renders, **Then** it appears with a red header at
   swimlane level, in its own status column, with no parent container, stating that it links directly to the Feature.
6. **Given** a Defect linked to a QA issue that is itself linked to a Story, **When** the board renders, **Then** it
   is grouped under that Story's container and states the route it took (via the QA issue), naming the QA issue.
7. **Given** any card is selected, **When** the swimlane is viewed, **Then** its parent and its sibling children are
   highlighted wherever they appear across the columns, so the family can be traced.
5. **Given** any child card, **When** its colour is removed (greyscale or colour-blind simulation), **Then** its type
   is still identifiable from a text or icon label — colour is never the only signal.

---

### User Story 4 — Master card health at a glance (Priority: P2)

Each Master Card's swimlane header carries the Feature's own vital signs: key, summary, status, percentage complete,
dependency indicator, flagged indicator, story points, and priority — so the state of the outcome is readable without
expanding the lane. The board opens with every lane collapsed, making that Feature-level overview the first thing
seen; the viewer expands only the lanes they are working, and that choice is remembered for next time.

**Why this priority**: High value and visible on every card, but the board is already useful with US1–US3 in place.

**Independent Test**: Open the board on a Feature that is flagged, has dependencies, and is part-complete; without
expanding anything, verify each of the eight displayed attributes matches Jira and that the percentage matches the
stated formula. Expand two lanes, restart the session, and confirm exactly those two are expanded.

**Acceptance Scenarios**:

1. **Given** a Feature with children in mixed states, **When** its Master Card renders, **Then** the percentage
   complete is shown together with the basis it was calculated on, so the number can be checked.
2. **Given** a Feature that is flagged in Jira, **When** the Master Card renders, **Then** the flag is visible on the
   card without opening it.
3. **Given** a Feature with blocking dependencies, **When** the Master Card renders, **Then** the dependency count is
   shown and the dependencies can be listed on demand.
4. **Given** a Feature with no story point estimate, **When** the Master Card renders, **Then** the absence is stated
   explicitly rather than shown as zero.
5. **Given** the board is opened for the first time, **When** it renders, **Then** every swimlane is collapsed and
   each lane header shows its Feature's vitals and child count, giving a Feature-level overview on one screen.
6. **Given** some lanes were expanded and the session is restarted, **When** the board is reopened, **Then** exactly
   those lanes are expanded again, and no other team member's board is affected.

---

### User Story 5 — Quick filters (Priority: P2)

The board offers one-click filters: Stories only, Defects only, Sub-tasks only, a specific assignee, and a specific
fixVersion. Filters combine, and clear in one action. Master Card figures always reflect the whole Feature, never the
filtered subset, and the board says so.

**Why this priority**: Substantially improves daily use, but the board delivers its core value without it.

**Independent Test**: Apply "Defects only" combined with an assignee filter; verify only matching child cards remain,
that Master Cards with no matches still appear with an explicit zero-match note, and that Master Card totals are
unchanged by the filter.

**Acceptance Scenarios**:

1. **Given** filters for type, assignee and fixVersion, **When** two are applied together, **Then** only children
   matching both remain visible.
2. **Given** an active filter that excludes every child of a Master Card, **When** the board renders, **Then** the
   Master Card is still shown, stating that none of its N children match.
3. **Given** any active filter, **When** a Master Card's percentage complete and points are read, **Then** they
   describe the whole Feature and the board states that Master Card figures ignore filters.
4. **Given** several active filters, **When** the clear action is used, **Then** all filters are removed at once.

---

### User Story 6 — Your own priority order (Priority: P2)

A viewer drags Master Cards into the order they intend to work them, and can send a lane to the top or bottom
directly from a card action. The order is remembered for that person, team and board across sessions. It is a
personal presentation order — it is never published to the team and never written back to Jira's ranking.

**Why this priority**: Lets each person shape the board around what they are actually working, without disturbing
anyone else's view, but is not required for status visibility.

**Independent Test**: Reorder Master Cards, send one to the top and another to the bottom, reload the board, and
confirm the order survived and that no Jira ranking field changed.

**Acceptance Scenarios**:

1. **Given** a stack of Master Cards, **When** one is dragged to a new position, **Then** it stays there after a
   reload of the board.
2. **Given** a Master Card, **When** "send to top" or "send to bottom" is chosen from its actions, **Then** it moves
   accordingly and the remaining order is preserved.
3. **Given** a saved order, **When** a Feature appears on the board that was not in that order, **Then** it is placed
   at the end of the stack rather than at an arbitrary position.
4. **Given** any reordering action, **When** Jira is inspected afterwards, **Then** no issue ranking has changed.
5. **Given** one person reorders their Master Cards, **When** another team member opens the same board, **Then** their
   own order is unaffected.

---

### User Story 7 — Edit in place (Priority: P2)

Clicking any card — Master or child — opens its detail, where any field the product already knows how to write is
editable in place, behaving exactly as it does on the product's other editing surfaces. A successful edit updates the
card on the board without reloading the whole board.

**Why this priority**: Consistency with existing behaviour and a large time-saver, but the board is readable and
movable without it.

**Independent Test**: Open a child card, change an editable field, and confirm the value is written to Jira and the
board card reflects it without a full board reload.

**Acceptance Scenarios**:

1. **Given** a card is opened, **When** an editable field is changed and confirmed, **Then** the change is written to
   Jira and shown on the board card.
2. **Given** a field the product cannot safely write, **When** the card is opened, **Then** the field is shown
   read-only rather than offering an edit that would fail.
3. **Given** a write that fails, **When** the failure returns, **Then** the previous value is restored on the card and
   the reason is shown.

---

### Edge Cases

- **No board selected in team settings** → the board renders as normal and raises a notice naming the one thing that
  is lost: the sprint-versus-PI check, which is the only thing the Jira board selection is used for. *(Revised
  v0.178.0 — see FR-052. It previously refused to render at all, which was disproportionate: this board does not read
  a Jira board's saved filter, so the selection was gating a view that did not depend on it.)*
- **Sub-status field not configured for this team** → columns fall back to status-only mapping, and the board states
  that sub-status is unavailable so the columns are less precise than intended.
- **The Feature referenced by an issue cannot be read** (permissions, deleted, cross-project restriction) → a Master
  Card is still created, identified by key, and marked as unreadable rather than silently folding the issue into "No
  Feature".
- **Circular or self-referencing links** between a defect, a QA issue and a story → the precedence chain terminates
  and the item is placed once; the loop is reported as a hygiene note.
- **One defect linked to two different Stories under different Features** → the precedence chain picks one placement;
  the card names the other Feature it also touches so the duplication is visible.
- **Board returns more issues than one page** → every page is retrieved before the board renders; the issue set is
  never truncated.
- **Board is far larger than expected (well past ~300 issues)** → the complete set is still rendered, with a warning
  that responsiveness may be reduced; issues are never dropped to keep the board fast.
- **An issue's type is none of Story / Defect / Sub-task** (e.g. Task, Spike) → it is still placed and rendered with a
  neutral, clearly labelled header rather than being dropped or mis-coloured.
- **A neutral-type issue while a type filter is active** → it is hidden, and no filter reveals it, because the quick
  filters are exactly the three named in FR-039. This is deliberate, and the lane's "n of N match" count is what
  keeps the omission visible rather than silent.
- **A status change that half-applies** → the card settles where the issue truly is, not where it started; see
  FR-022a. The board never redraws a state Jira does not hold, even to report a failure.
- **Sub-task whose parent is not on the team board** → the parent container header still identifies the parent by key
  and marks it as out of scope; no parent card is drawn, because the parent is not in scope.
- **A parent has children in a column but the parent itself is filtered out or out of scope** → the container header
  remains, so the children never appear orphaned.
- **A parent's children are all in the same column as the parent's own card** → that column shows the parent's
  childless own card *and* the parent container holding the children; the two are visually distinguished (FR-034).
- **A column's mapped status is not a legal transition from the card's current status** → the drop is refused before
  it is attempted, stating which transition Jira does not permit.
- **Two people reorder Master Cards at the same time** → no conflict is possible; each person's order is their own
  and is never published.
- **Two people publish a changed vocabulary in the same period** → the later publish wins; the board shows when the
  vocabulary it holds was last synchronised so a stale local copy is detectable.
- **A pulled vocabulary maps to a status or sub-status this team's issues never use** → the column is kept and shown
  as empty rather than dropped, since the vocabulary is the team's agreed language, not a derived one.
- **No shared ART workspace is configured for the team** → the vocabulary works locally and the board states plainly
  that it cannot currently be shared.
- **A Feature has zero children on this board** → its Master Card is not shown, because the board's scope is the
  team's board, not the Feature backlog.

## Requirements *(mandatory)*

### Functional Requirements

**Board layout**

- **FR-000a**: The board MUST render one shared column header row at board level, with every Master Card presented as
  a full-width swimlane beneath it.
- **FR-000b**: Columns MUST stay horizontally aligned across every Master Card, so one column can be read
  top-to-bottom across all Features.
- **FR-000c**: A Master Card's vitals (FR-011) MUST be displayed in its swimlane header, visible without expanding
  the lane.
- **FR-000d**: When the column set is wider than the viewport, horizontal scrolling MUST be shared by the whole
  board so column alignment is never lost.
- **FR-000e**: Every swimlane MUST be independently collapsible and expandable.
- **FR-000f**: The board MUST open with all swimlanes collapsed, so the first thing seen is a Feature-level overview.
- **FR-000g**: A collapsed swimlane MUST still show its Master Card vitals and its child count, so a lane can be
  judged without expanding it.
- **FR-000h**: Each person's collapse and expand state MUST be remembered across sessions for that team and board,
  and MUST NOT be shared with other team members.
- **FR-000i**: The board MUST offer a single action to expand all swimlanes and a single action to collapse them all.
- **FR-000j**: A swimlane that has no children matching the active filters MUST NOT be auto-expanded, and a lane the
  person expanded MUST stay expanded when filters change.

**Board scope and assembly**

- **FR-001**: The board MUST take its scope from the Jira board already selected in the team's settings; it MUST NOT
  introduce a second, independent board selection.
- **FR-002**: Every issue in scope MUST be rendered as a card exactly once, under exactly one Master Card — no issue
  may be dropped, and no issue may appear as a card twice. A parent container header (FR-031) is a grouping label,
  not a card, and does not count as a second rendering of the parent.
- **FR-003**: The system MUST resolve an issue's owning Feature even when the Feature resides in a different Jira
  project from the issue.
- **FR-004**: A Sub-task MUST resolve to the Feature of its parent issue.
- **FR-005**: A Defect MUST resolve to a Feature by a fixed, stated precedence: linked development Story → the Story
  behind a linked QA issue → a directly linked Feature → otherwise unattributed.
- **FR-006**: In addition to the roll-up route every child card carries (FR-036), a Defect's card MUST name the
  intermediate issue its precedence route passed through, whenever there was one.
- **FR-007**: Any candidate link not chosen by the precedence chain MUST still be listed on the card as a secondary
  link, so no relationship is silently discarded.
- **FR-008**: Issues with no resolvable Feature MUST be collected under a single "No Feature" Master Card that states
  its issue count and identifies itself as a hygiene problem requiring resolution.
- **FR-009**: The "No Feature" Master Card MUST offer the same per-card actions as any other Master Card, so the
  missing link can be fixed without leaving the board.
- **FR-010**: The board MUST be refreshable on demand, re-reading current state from Jira.

**Master Card content**

- **FR-011**: Each Master Card MUST display the Feature's key, summary, status, percentage complete, dependency
  indicator, flagged indicator, story points, and priority.
- **FR-012**: The percentage complete MUST be accompanied by the basis on which it was calculated, so a reader can
  verify it.
- **FR-013**: A missing value (no estimate, no priority) MUST be stated as missing, never displayed as zero or as a
  default that implies data exists.
- **FR-014**: Master Card figures MUST always describe the entire Feature and MUST NOT change when quick filters are
  applied; the board MUST state this.

**Custom status vocabulary**

- **FR-015**: Users MUST be able to define an ordered set of board columns with their own names.
- **FR-016**: Each column MUST be mappable to one Jira status combined with one Jira sub-status value.
- **FR-017**: The mapping editor MUST offer the status and sub-status values that actually exist for the issues in
  scope; it MUST NOT accept free text that Jira would reject.
- **FR-018**: Two columns MUST NOT be allowed to claim the same status + sub-status combination; the save MUST be
  refused with an explanation.
- **FR-019**: The column set and its mappings MUST be scoped to the team, not to the person viewing the board.
- **FR-019a**: The column set and its mappings MUST be carried in the team's record within the shared ART workspace,
  so one person can publish them and other users can pull them.
- **FR-019b**: Publishing and pulling the vocabulary MUST be explicit user actions; the board MUST NOT silently
  overwrite a local vocabulary with a workspace copy, or a workspace copy with a local one.
- **FR-019c**: The board MUST state which vocabulary it is currently using and when it was last synchronised with the
  workspace, so a viewer can tell whether they are looking at the team's agreed columns.
- **FR-019d**: When a pulled vocabulary differs from the local one, the differences MUST be shown before the change is
  accepted, and the pull MUST be refusable.
- **FR-019e**: Adding the vocabulary to the shared workspace MUST NOT prevent clients that predate it from loading the
  workspace, and a workspace saved without a vocabulary MUST load without error.
- **FR-020**: Moving a card into a column MUST apply the mapped Jira status and sub-status to that issue.
- **FR-021**: When the corresponding Jira transition requires additional field values, they MUST be collected before
  the change is applied, and any field whose input type cannot be handled MUST be named plainly with instruction to
  complete it in Jira.
- **FR-022**: When a status change is refused, or fails **as a unit**, the card MUST return to its original column
  and the reason MUST be shown.
- **FR-022a**: When the change can only be applied in two steps — because the sub-status is not available on the
  transition screen — and the first step succeeds while the second fails, the card MUST **NOT** return to its
  original column. The issue MUST be re-read and rendered at its true state, and the message MUST name exactly what
  was applied and what was not. Reverting would display a state Jira does not hold, which no failure message can
  undo.
- **FR-022b**: The system MUST prefer the single-step write whenever the sub-status field is available on the
  transition screen, so the two-step case of FR-022a arises only when Jira leaves no alternative.
- **FR-023**: A drop whose target status is not a permitted transition from the card's current status MUST be refused
  before any write is attempted, naming the disallowed transition.
- **FR-024**: Issues whose Jira status + sub-status matches no defined column MUST be shown in an explicit "Unmapped"
  column displaying their raw Jira status and sub-status; they MUST NOT be hidden or assigned to a nearest guess.
- **FR-025**: When the sub-status field is not configured for the team, columns MUST fall back to status-only mapping
  and the board MUST state that sub-status precision is unavailable.

**Child cards, colour and nesting**

- **FR-026**: Stories, Defects and Sub-tasks MUST appear as child cards within the Master Card of the Feature they
  roll up to.
- **FR-027**: Child card headers MUST be colour-coded by type: Stories green, Defects red, Sub-tasks blue.
- **FR-028**: Colour MUST NOT be the only indicator of type; every child card MUST also carry a text or icon type
  label.
- **FR-029**: Issue types outside Story / Defect / Sub-task MUST render with a neutral, explicitly labelled header
  rather than being dropped or coloured as another type.
- **FR-030**: Every issue MUST be placed in the column that matches its own status; an issue's column MUST NOT be
  derived from its parent's or its children's status.
- **FR-031**: Within one column of one swimlane, child cards sharing a parent MUST be wrapped in a parent container
  whose header displays the parent's key and summary.
- **FR-032**: When children of the same parent occupy different columns, each of those columns MUST draw its own
  container for that parent.
- **FR-033**: A parent's own card MUST appear in the column matching the parent's own status, rendered **without**
  its children inside it, so the parent's status is readable independently of its children's.
- **FR-034**: A parent container header MUST be visually distinct from an issue card, because it is a grouping label
  and not a second rendering of the parent issue.
- **FR-035**: For the purposes of FR-031's grouping, a Sub-task's parent is its Jira parent issue, and a Defect's
  parent is the issue identified by its FR-005 precedence route.
- **FR-036**: Every child card MUST state the route by which it rolls up to its Master Card.
- **FR-037**: When a child's parent is not itself in scope, the container header MUST still identify that parent by
  key so the grouping remains intact and the out-of-scope parent is visible as such.
- **FR-038**: Selecting or focusing any card MUST highlight its parent and its sibling children wherever they appear
  across that swimlane, so a family can be traced across columns.

**Quick filters**

- **FR-039**: The board MUST provide quick filters for: Stories only, Defects only, Sub-tasks only, a chosen
  assignee, and a chosen fixVersion.
- **FR-040**: Filters MUST be combinable, and MUST be clearable in a single action.
- **FR-041**: A Master Card whose children are all excluded by the active filters MUST remain visible, stating how
  many of its children match.
- **FR-042**: When a filter removes every child from a parent container, that container MUST be removed with them —
  an empty parent container MUST NOT be left behind implying work that is not there.

**Ordering**

- **FR-043**: Master Cards MUST be reorderable by drag and drop.
- **FR-044**: Master Cards MUST offer "send to top" and "send to bottom" actions.
- **FR-045**: The chosen order MUST persist across sessions for the person who set it, scoped to the team and board
  it was set for. It MUST remain local to that person and MUST NOT be published to the shared ART workspace.
- **FR-046**: The order MUST be presentation-only and MUST NOT write any ranking or ordering value back to Jira.
- **FR-047**: A Master Card not present in the saved order MUST be placed at the end of the stack.

**Editing**

- **FR-048**: Clicking any card MUST open its detail, where fields the product can safely write are editable in place
  using the product's existing editing behaviour.
- **FR-049**: A successful edit MUST update the affected card on the board without reloading the entire board.
- **FR-050**: Fields the product cannot safely write MUST be shown read-only rather than offering an edit that would
  fail.
- **FR-051**: A failed edit MUST restore the previous value on the card and state the reason.

**Honesty and degradation**

- **FR-052** *(revised v0.178.0)*: The board takes its scope from the Team Dashboard's Sprint / Fix Version / PI
  selector and MUST NOT read a Jira board's saved filter. A Kanban board shows all open work and a Scrum board shows
  the active sprint; this board shows what the operator selected, which is the whole reason the tool exists. When no
  Jira board is selected the board MUST still render, and MUST state the one capability that is unavailable without
  one — the sprint-versus-PI reconciliation — rather than refusing to draw.
- **FR-053**: When any part of the data could not be retrieved, the board MUST state what is missing and why, rather
  than rendering a silently shortened board.
- **FR-054**: Checklist-item completion, where available, MUST be shown as a read-only indicator on its host issue's
  card, and MUST NOT be movable, filterable, or writable.
- **FR-055**: The board MUST retrieve every page of issues in scope before rendering; it MUST NOT truncate the issue
  set under any circumstances.
- **FR-056**: When the board exceeds its expected size of roughly 300 issues, it MUST still render the complete set
  and MUST warn that responsiveness may be reduced, rather than dropping issues to stay fast.
- **FR-057**: While the board is still loading, it MUST show that it is incomplete, so a partly-drawn board is never
  mistaken for the finished picture.

### Key Entities

- **Board Scope** — the set of issues to display, taken from the team's selected Jira board.
- **Master Card** — one Feature rendered as a collapsible full-width swimlane: a header carrying the Feature's vital
  signs and child count, and beneath it — when expanded — the child cards that roll up to it, distributed across the
  board's shared columns. Includes the synthetic "No Feature" Master Card that holds unattributed work.
- **Lane State** — one person's collapsed/expanded choice per swimlane for a given team and board, remembered across
  sessions and never shared.
- **Child Card** — one Story, Defect, Sub-task or other issue on the board, with its type, its colour coding, the
  column its own status places it in, and the roll-up route that placed it in its swimlane.
- **Parent Container** — a per-column grouping label, headed by a parent issue's key and summary, wrapping that
  parent's children that fall in that column. It is not a card and never counts as a rendering of the parent issue.
- **Roll-Up Route** — the explicit, displayable chain of relationships from a child card to its Master Card (for
  example: defect → QA issue → story → feature).
- **Board Column** — a team-defined status name and its position in the board's left-to-right order, plus the
  "Unmapped" column that is always present.
- **Status Mapping** — the pairing of one Board Column to exactly one Jira status + sub-status combination.
- **Board Order** — one person's chosen ordering of Master Cards for a given team and board. Held locally, never
  published to the shared workspace, never written to Jira.
- **Shared Workspace Vocabulary Record** — the team's column set and status mappings as carried in the team's record
  within the shared ART workspace, together with the point in time it was last published or pulled.
- **Quick Filter State** — the currently active combination of type, assignee and fixVersion filters.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of issues on the team's selected board appear on the roll-up board — the issue count across all
  Master Cards equals the source board's issue count, with zero duplicates.
- **SC-002**: For any child card, a team member can state which Feature it delivers and by what route within
  5 seconds of looking at it, without opening the card or consulting Jira.
- **SC-003**: A team member can determine an item's precise state from the column name alone, without needing to know
  the underlying status and sub-status values.
- **SC-004**: Moving a card to a column produces the intended status and sub-status in Jira on the first attempt in at
  least 95% of moves; every failure states its reason and leaves the card where it started.
- **SC-005**: Zero items are hidden by the board: any item that cannot be mapped to a column appears in "Unmapped",
  and any item that cannot be attributed to a Feature appears in "No Feature".
- **SC-006**: The number of unattributed items ("No Feature") is visible as a single number at all times, so the
  team's hygiene backlog is quantified rather than estimated.
- **SC-007**: A team member can narrow the board to a single person's defects in two clicks or fewer.
- **SC-008**: A person's chosen priority order survives a session restart with 100% fidelity, no Jira ranking is
  altered by any reordering, and no other team member's order is affected.
- **SC-011**: After one team member publishes the column vocabulary and the others pull it, every team member's board
  shows an identical column set — verifiable by comparing the column names and their mappings across viewers.
- **SC-012**: A board of around 300 issues becomes fully readable within 5 seconds of opening, and shows 100% of its
  issues — the count on the board equals the count on the source Jira board at every size.
- **SC-013**: On opening the board, a viewer can assess the health of every Feature in scope without expanding
  anything, and reach the detail of any one Feature in a single action.
- **SC-009**: Every piece of information the board asserts (percentage complete, counts, roll-up routes) can be traced
  by the reader to the underlying issues it was derived from.
- **SC-010**: Card type remains identifiable at 100% accuracy when the board is viewed without colour.

## Assumptions

- The team's board selection already exists in team settings and is the single source of scope; no new board-picking
  concept is introduced.
- Percentage complete is calculated from the Feature's children on this board, weighted by story points where every
  contributing child is estimated, and by issue count otherwise. The basis used is displayed alongside the number
  (FR-012), so the two cases are always distinguishable.
- "Sub-status" refers to the organisation's existing sub-status field used alongside the workflow status; where a team
  has not configured it, the board degrades to status-only mapping (FR-025).
- A defect "raised against" an issue is determined by the same link data used for the precedence chain; no new
  relationship type is introduced in Jira.
- Colour choices (green / red / blue) are the team's stated preference and are treated as a requirement, paired with a
  non-colour type label for accessibility (FR-028).
- The per-column parent container is modelled on Jira's own nested-card rendering, captured in GH #306: a container
  header showing the parent's key and summary, wrapping only the children present in that column, with the parent's
  own card appearing childless in its own column.
- The board is a read-and-act surface for existing issues; creating new issues is done through the product's existing
  creation surfaces.
- The column vocabulary is held by the product, not by Jira, because Jira offers no compliant place to store it. It
  rides in the team's record inside the existing shared ART workspace rather than in a new store, which is also how it
  reaches other users.
- The shared ART workspace already carries a schema version and tolerates records written by older clients; adding the
  vocabulary is an additive change that must preserve that tolerance in both directions (FR-019e).
- The Master Card order is a personal working preference, not a team artefact, so it is never published.
- A team board is expected to hold roughly 300 issues; it is a sprint/kanban board, not a backlog. This is the volume
  the product's existing sprint surfaces already handle, so the board is sized to match them rather than to a new
  ceiling.
- The product's existing per-field write behaviour and its existing transition-required-fields handling are the
  behaviour this board reuses, so editing and status changes behave identically to other surfaces.

## Dependencies

- A Jira board must be selected in the team's settings for the board to have any scope.
- The relationship data that connects a child issue to its Feature must be readable for the roll-up to resolve;
  where it is not, the item is reported as unattributed rather than guessed.
- The sub-status field identifier must be known for the team in order to offer full status + sub-status mapping.
- Jira must permit the transition implied by a column move; the board reports rather than circumvents any workflow
  restriction.
- Checklist completion data is only displayable where the underlying checklist data is present and readable.
- Sharing the column vocabulary depends on the team having a shared ART workspace configured; without one, the
  vocabulary still works locally and the board states that it cannot be shared.

## Out of Scope

- Changing the organisation's Jira workflow, statuses, sub-statuses, or issue-type conventions.
- Writing Jira's own ranking or board order.
- Creating, deleting, or moving issues between projects.
- Creating, editing, or completing checklist items.
- Any AI-assisted analysis, suggestion, or generation on this board.
- Tracking or displaying testing performed by other teams on their own boards.
- Replacing the existing team dashboard, standup board, or PI-level planning and monitoring surfaces; this board is
  additive.
- Real-time push updates from Jira; the board reflects state as of its last load or refresh.
