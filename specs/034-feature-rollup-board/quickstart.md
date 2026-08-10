# Quickstart: Feature Roll-Up Board

**Feature**: 034-feature-rollup-board | **Applies to**: v0.142.0 and later

How to prove the board works, against live Jira. Article X applies: *"it compiles"* and *"the API
returned 200"* are not proof — every check below names something you can see or verify in Jira.

> **This has to be run by a person.** Every scenario needs a browser signed in to Atlassian, and V7,
> V10 and V19 **write to real Jira issues**. Nothing here can be automated from a test suite —
> that is the point of it.

---

## Prerequisites

| Requirement | Why |
|---|---|
| Jira reachable (**VPN on**) | An empty board is far more often a connectivity problem than a bug |
| A team profile with a **board selected** in Team space settings | The board's scope comes from here |
| The **Sprint / Fix Version / PI** selector set to something real | The board mirrors it — see V0 |
| The team's Feature Link field configured in ART settings | Cross-project roll-up |
| At least one issue in scope with **no** Feature link | Proves the No Feature card |
| A Story with sub-tasks in **two different statuses** | Proves per-column parent containers |
| A defect linked to a QA issue that links to a Story | Proves the precedence chain |
| A second team profile | V18 (copying a column setup) |
| A Confluence database id for the shared ART workspace | V14/V15 — optional; without it the board must say it cannot share |

## Run

```powershell
cd C:\ProjectsWin\NodeToolbox
npm start
```

**Agile Hub → Team → Roll-Up Board.**

### Automated checks (these do NOT replace the scenarios below)

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npx vitest run                 # full client suite
npx tsc -b                     # stricter than --noEmit; catches unused locals
cd ..; npm test                # server suite
```

---

## Validation scenarios

### V0 — The board mirrors the dashboard's scope *(the thing that was wrong twice)*

Note what the **Sprint / Fix Version / PI** selector at the top of the Team Dashboard is set to, and
how many issues the other tabs show.

**Pass**: the board's status line reads `N Feature lanes · N issues in scope · <Sprint|Fix Version|PI>`,
and that issue count matches the dashboard. Change the selector — the board follows.

**Fail looks like**: far more issues than the dashboard has, including backlog. That means it is
querying the board filter again instead of the dashboard's set.

### V1 — Nothing is dropped *(FR-002 · SC-001)*

Total the child counts across every lane, including **No Feature**, and add anything the scope says
is hidden.

**Pass**: the total equals the "issues in scope" figure. No issue appears twice.

**If the total is HIGHER**: invariant L-2 has broken — a parent is being drawn as a card once per
column instead of once board-wide. That is the single most likely defect in this feature.

### V2 — Cross-project roll-up *(FR-003)*

Pick a Story whose Feature lives in a different Jira project, and that is inside your configured
Feature projects.

**Pass**: it sits under that Feature's lane, with the Feature's real key and summary in the header.

### V3 — Hygiene is quantified *(FR-008 · SC-006)*

**Pass**: exactly one **No Feature** lane, marked as a hygiene problem, showing a count. Every item
in it can be acted on in place.

### V4 — Per-column parent containers *(FR-031–034)*

Use the Story whose sub-tasks are in two different statuses.

**Pass**, all four:
- each sub-task sits in the column of its **own** status;
- **both** columns draw their own container headed by that Story's key and summary;
- the Story's **own** card appears in the column of the Story's status, **with no children inside it**;
- the container header is visually distinct from a card and is not draggable.

Compare against the images on GH #306.

### V5 — Defect precedence is stated *(FR-005–007)*

Open the defect linked via a QA issue.

**Pass**: grouped under the Story's container; the card names the route it took and the QA issue; any
other candidate link is listed as a secondary link rather than dropped.

### V6 — Colour is never the only signal *(FR-028 · SC-010)*

DevTools → Rendering → emulate `achromatopsia`.

**Pass**: every card's type is still identifiable from its icon and text.

---

### V7 — A card move writes BOTH values ⚠️ *writes to Jira* *(FR-020 · SC-004)*

Map a column to a specific status + sub-status pair, drag a card into it, then open the issue **in Jira**.

**Pass**: both the status and the sub-status hold the mapped values. Confirm in Jira itself — a green
toast is not evidence.

### V8 — Unmapped is visible, never guessed *(FR-024 · SC-005)*

Put an issue into a status combination no column claims.

**Pass**: it appears in **Unmapped** with its raw status and sub-status. It is **not** filed into the
nearest status-only column.

### V9 — Illegal transitions are refused before any write *(FR-023)*

Drag a card to a column whose status is not a legal transition from its current one.

**Pass**: refused, card never leaves its origin, the disallowed transition is named, and the network
tab shows **zero** write requests.

### V10 — A partial write tells the truth ⚠️ *writes to Jira* *(FR-022a · FR-022b)*

Needs a column whose sub-status is **not** on the transition screen, with a value Jira will reject.

**Pass**: the status change applies; the card settles at the issue's **true** state rather than
snapping back; the message names what applied and what did not.

Then confirm **FR-022b**: for a column whose sub-status **is** on the transition screen, the network
tab shows exactly **one** request.

---

### V11 — Filters never change a Feature's numbers *(FR-014 · FR-041 · SC-007)*

Record a lane's % complete and points. Apply "Defects only" plus an assignee filter, counting clicks.

**Pass**: the figures are **unchanged**; lanes with no matches remain visible stating `0 of N match`;
no empty parent container is left behind; one person's defects took **two clicks or fewer**.

### V12 — Order is personal and never touches Jira *(FR-045 · FR-046 · SC-008)*

Drag a lane by its header grip, use send-to-top and send-to-bottom, restart the session.

**Pass**: the order survived; Jira's own ranking is unchanged; a colleague's board is unaffected.

### V13 — Lanes open collapsed and remember *(FR-000f–h · SC-013)*

**Pass**: the board opens fully collapsed, each header showing its Feature's vitals and child count.
Expand two lanes, restart, and exactly those two are expanded.

---

### V14 — A column setup reaches the team *(FR-019a–d · SC-011)*

On machine A press **Share my columns with the team**. On machine B press **Get the team's columns**.

**Pass**: B sees the differences before anything changes; the pull can be refused leaving B
untouched; after accepting, A and B show identical columns.

*(Skip if nobody else uses this yet — but see V18, which is the single-machine equivalent.)*

### V15 — Older builds are unharmed *(FR-019e)*

With the vocabulary published, open the ART workspace on a build predating v0.139.0. Save from it,
then re-pull the vocabulary on the current build.

**Pass**: the ART workspace loads normally and the vocabulary is **intact**. This is the guarantee
the sibling-property decision exists to provide.

---

### V16 — Honest degradation *(FR-025 · FR-052 · FR-053 · FR-056)*

| Do this | Expect |
|---|---|
| Clear the team's board selection | A plain statement that a board must be selected — not an empty board |
| Set the dashboard scope to something empty | "nothing has been filtered out", not a blank board |
| Use a team whose instance has no sub-status field | Columns degrade to status-only and the board says so |
| Force a sub-task sweep chunk to fail | The board states what is missing |
| Scope to ~300+ issues | All render, with a responsiveness warning; nothing truncated |

Also **time** a ~300-issue scope from opening the tab to a readable board.

**Pass**: **under 5 seconds** (SC-012). Record the number — an unmeasured target is not a target.

### V17 — Checklist completion is read-only *(FR-054)*

**Pass**: an issue with readable checklist data shows an indicator that cannot be dragged, filtered
on, or edited; an issue without shows **nothing at all** in its place. If this instance exposes no
checklist data at all, record that — absence is a valid observed result, not a skipped check.

---

## Scenarios added after the original release

### V18 — Feature scope, per team *(v0.140.x)*

In **Board setup**, set Transformers to `ENCUC` and Cleanup Crew to `ENCUC, DENP`.

**Pass**, all four:
- Apply visibly reduces the lanes to those projects;
- the project chips list **every** project the board touches, including ones currently excluded, and
  clicking one adds **or removes** it;
- a Feature-Linked Feature outside the projects is **hidden but named** in the warning banner;
- the hidden-issue count is stated, and the two toggles reveal each kind independently.

**Fail looks like**: Apply reloads and changes nothing (the old escape hatch), or an excluded
project's chip disappearing so it cannot be re-added.

### V19 — Finding and placing unmapped statuses ⚠️ *writes only when you drag* *(v0.141.0)*

Open **Board setup** with columns already defined.

**Pass**: every status currently in Unmapped is listed with its issue count; **Add to column** puts
one into an existing column and the issues move there on reload; **New column for this** creates a
column claiming it; one column can hold several statuses at once.

### V20 — Cards drag, and the whole card is the handle *(v0.141.0)*

**Pass**: pressing a card and moving it drags it; pressing without moving opens the detail panel.
Dragging into another Feature's lane is refused with a reason.

**Fail looks like**: a drag attempt opening the detail panel — the regression fixed in v0.141.0.

### V21 — Column headers stick and reorder *(v0.142.0)*

**Pass**: headers stay visible while the lanes scroll; dragging a header reorders the columns and the
order survives a reload; **Unmapped** cannot be moved from the end.

### V22 — Copy a column setup between teams *(v0.142.0)*

With one team configured, switch to the second and use **Copy columns from**.

**Pass**: the second team gets the first team's columns to adjust, and the first team's board is
**unchanged** when you switch back.

### V23 — Columns saved by an older build still load *(v0.141.1)*

If any browser still has a vocabulary saved before v0.141.0, open the board there.

**Pass**: the board renders with those columns intact — not a blank page. *(This is the regression
that took the tab down; if no such browser exists, record that it could not be exercised.)*

### V24 — Work in the PI's sprints with no PI value *(v0.145.0)*

Scope the dashboard by **PI**. Find (or make) an issue that is in one of that PI's sprints but whose
**PI field is empty** — the real case was ENCUC-2208 in Sprint 26.4.1, which took its whole Feature
lane (DENP-1387) off the board.

**Pass**: the board names that issue in a warning saying every PI-scoped tab is missing it. Set the
PI field in Jira, refresh, and both the issue **and its Feature's lane** appear.

**Also check**: an issue in the same sprint tagged to a *different* PI is **not** flagged — that is a
legitimate carry-over, not a defect.

---

## Definition of done

- [ ] V0–V23 run against **live Jira**, with V16's ~300-issue timing **recorded**
- [ ] Writes in V7 and V10 confirmed **in Jira**, not from an on-screen message
- [ ] `npx vitest run`, `npx tsc -b` and `npm test` green
- [ ] Anything that could not be exercised (V15, V17, V23) **recorded as such**, not marked passed
