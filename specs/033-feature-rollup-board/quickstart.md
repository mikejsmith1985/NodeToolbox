# Quickstart: Feature Roll-Up Board

**Feature**: 033-feature-rollup-board | **Date**: 2026-08-07

How to run the feature and what evidence proves it works. Article X applies: *"it compiles"* and *"the API returned
200"* are not proof — each check below names an observable outcome.

---

## Prerequisites

| Requirement | Why |
|---|---|
| Jira reachable (**VPN on**) | An empty board is far more often a connectivity problem than a code bug. Confirm reachability before diagnosing anything. |
| A team profile with a **board selected** in Team space settings | The board's entire scope (FR-001) |
| The team's Feature Link field configured in ART settings | Cross-project roll-up (FR-003) |
| At least one issue on the board with **no** Feature link | Proves the No Feature card (FR-008) |
| A Story with sub-tasks in **two different statuses** | Proves per-column containers (FR-032) |
| A defect linked to a QA issue that links to a Story | Proves the precedence chain (FR-005) |
| A Confluence database id for the shared ART workspace | Vocabulary publish/pull (FR-019a) — optional; without it the board must state it cannot share |

---

## Run

```powershell
cd C:\ProjectsWin\NodeToolbox
npm start
```

Navigate to **Agile Hub → Team → Roll-Up Board**.

### Automated checks

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npx vitest run src/views/SprintDashboard/rollupBoard    # this feature
npx vitest run                                          # full client suite — must stay green
```

```powershell
cd C:\ProjectsWin\NodeToolbox
npm test                                                # server suite (regression only)
```

> Known local-sandbox noise: `local-release.test.js` fails here because this sandbox's PowerShell lacks
> `Get-FileHash`. That is environmental, not a regression — do not chase it.

---

## Validation scenarios

Each maps to a user story and its success criteria. Entity shapes are in [data-model.md](./data-model.md); rules are
in [contracts/](./contracts/).

### V1 — Nothing is dropped *(US1 · FR-002 · SC-001)*

1. Note the issue count on the source board in Jira.
2. Open the Roll-Up Board and total the child counts across every Master Card, including **No Feature**.

**Pass**: the two totals are equal. No issue appears twice. Parent container **headers** are not counted as issues —
if the totals exceed Jira's, the L-2 invariant has been broken (a parent is being drawn as a card per column).

### V2 — Cross-project roll-up *(US1 · FR-003)*

Pick a Story whose Feature lives in a different Jira project.

**Pass**: it sits under that Feature's Master Card, and the lane header shows the Feature's real key and summary.

### V3 — Hygiene is quantified, not hidden *(US1 · FR-008 · SC-006)*

**Pass**: exactly one **No Feature** card exists, marked as a hygiene problem, showing a count. Every item in it can
be acted on in place (FR-009).

### V4 — Per-column parent containers *(US3 · FR-031–034)*

Use the Story whose sub-tasks are in two different statuses.

**Pass**, all four:
- each sub-task sits in the column of its **own** status;
- **both** columns draw their own container headed by that Story's key and summary;
- the Story's **own** card appears in the column of the Story's status, **with no children inside it**;
- the container header is visually distinct from a card and cannot be dragged or opened.

This is GH #306's rendering. Compare against the images on that issue.

### V5 — Defect precedence is stated *(US3 · FR-005–007)*

Open the defect linked via a QA issue.

**Pass**: it is grouped under the Story's container; the card states the route it took and names the QA issue; any
other candidate link it had is listed as a secondary link, not discarded.

### V6 — Colour is never the only signal *(FR-028 · SC-010)*

View the board in greyscale (browser DevTools → Rendering → emulate `achromatopsia`).

**Pass**: every card's type is still identifiable from its icon and text label.

### V7 — Custom status vocabulary writes both values *(US2 · FR-020 · SC-004)*

1. Define a column mapped to a specific status + sub-status pair.
2. Drag a card into it.
3. Open the issue **in Jira**.

**Pass**: both the status and the sub-status hold the mapped values. Confirm in Jira itself — a green toast is not
evidence.

### V8 — Unmapped is visible, never guessed *(US2 · FR-024 · SC-005)*

Put an issue into a status+sub-status combination no column claims.

**Pass**: it appears in the **Unmapped** column showing its raw status and sub-status. It is **not** placed in the
nearest status-only column.

### V9 — Illegal transitions are refused before any write *(FR-023)*

Drag a card to a column whose status is not a legal transition from its current one.

**Pass**: the drop is refused, the card never leaves its origin column, the disallowed transition is named, and the
network tab shows **zero** write requests.

### V10 — Partial write tells the truth *(FR-022a · FR-022b · contracts/status-move.md §4)*

Requires a column whose sub-status is **not** on the transition screen, with a sub-status value Jira will reject.

**Pass**: the status change is applied; the card settles at the issue's **true** state rather than snapping back;
the message names what was applied and what was not.

Then confirm FR-022b: for a column whose sub-status **is** on the transition screen, the network tab shows exactly
**one** request — the two-step path is taken only when Jira leaves no alternative.

### V11 — Filters never change a Feature's numbers *(US5 · FR-014 · FR-041 · SC-007)*

Record a Master Card's % complete and points. Apply "Defects only" plus an assignee filter, **counting the clicks**.

**Pass**: the figures are **unchanged**; lanes with no matches remain visible stating `0 of N match`; no empty parent
container is left behind; and reaching one person's defects took **two clicks or fewer** (SC-007).

### V12 — Order is personal and never touches Jira *(US6 · FR-045, FR-046 · SC-008)*

Reorder lanes, send one to top and another to bottom, restart the session.

**Pass**: the order survived; the Jira board's own ranking is unchanged; a second person's board is unaffected.

### V13 — Lanes open collapsed and remember *(FR-000f–h · SC-013)*

**Pass**: the board opens fully collapsed with every lane header showing its vitals and child count; expand two
lanes, restart, and exactly those two are expanded.

### V14 — Vocabulary reaches the team *(US2 · FR-019a–d · SC-011)*

On machine A, publish. On machine B, pull.

**Pass**: B sees a difference preview before anything changes; the pull can be refused leaving B untouched; after
accepting, A and B show identical columns and mappings.

### V15 — Old clients are unharmed *(FR-019e)*

With the vocabulary property published, open the ART workspace on a build that predates this feature.

**Pass**: the ART workspace loads normally. Save from that older client, then re-pull the vocabulary on this build —
it is **intact**. (This is the guarantee the sibling-property decision exists to provide.)

### V16 — Honest degradation *(FR-025 · FR-046 · FR-052 · FR-053)*

| Do this | Expect |
|---|---|
| Clear the team's board selection | A plain statement that a board must be selected — not an empty board |
| Use a team whose instance has no sub-status field | Columns degrade to status-only and the board says so |
| Force a sub-task sweep chunk to fail | The board states what is missing — it does not render a silently shorter board |
| Use a board with ~400 issues | All 400 render, with a responsiveness warning; nothing is truncated |

Also **time it** on a board of roughly 300 issues, from opening the tab to the board being readable.

**Pass**: **under 5 seconds** (SC-012), and the on-board issue count equals Jira's at every size. Record the measured
time — an unmeasured performance target is not a target.

### V17 — Checklist completion is shown, read-only *(FR-054)*

Find an in-scope issue that carries readable checklist data, and one that does not.

**Pass**: the first card shows a completion indicator that cannot be dragged, filtered on, or edited; the second card
shows **nothing at all** in its place — no empty placeholder.

If this Jira instance exposes no checklist data on any in-scope issue, record that: the requirement is conditional on
the data being present, and its absence is a valid observed result rather than a skipped check.

---

## Definition of done

- [ ] V1–V17 pass against **live Jira**, with V16's ~300-issue timing **recorded**, not assumed
- [ ] `npx vitest run` green in `client/` (full suite, not just this feature)
- [ ] `npm test` green at repo root (no server regression)
- [ ] `hygieneFieldConfig.test.ts`, `hygieneChecks.test.ts` and `featureReviewFixes.test.ts` pass **unmodified** —
      if any needed editing, a change that was meant to be additive was not
- [ ] `SprintDashboardView` existing tests pass unmodified
- [ ] `CHANGELOG.md` updated
- [ ] No new npm dependency added
- [ ] Every new source file has a sibling test file (pre-commit hook requirement)
