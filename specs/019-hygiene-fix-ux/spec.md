# Feature Specification: Hygiene Fix Workspace — an issue view worth working in

**Feature short name**: `hygiene-fix-ux`
**Created**: 2026-07-17
**Status**: Draft — ready for `/speckit-plan`
**Builds on**: the Hygiene tab's finding rows and inline fix controls, the shared issue detail panel
(status/priority/assignee/description/comments/story points), the shared hygiene scan (one computation behind the tab
and the Today cards), and the editmeta-aware field writers (dropdown-capable story points, option-matched selects).

## Summary

The reporter put three screenshots side by side (GH #177, closing comment): a stale defect as Toolbox shows it during
hygiene review, and the same defect as Jira shows it. Their verdict: *"something about the interface of Jira is just so
much more inviting to see and manipulate these fields and read the status"* — and they are right, for identifiable,
fixable reasons. This is not "Jira has more features." It is that Jira **encodes meaning visually** and Toolbox
currently renders the same facts as undifferentiated text on undifferentiated dark boxes.

A master-UX read of the two interfaces:

| What the eye needs | Jira's answer | Toolbox today |
|---|---|---|
| "What is this?" | Red Defect icon + colored priority arrows, instantly | The words "Defect" and "High" in plain grey text |
| "Where does it stand?" | A prominent colored status control ("Ready to Accept") | STATUS label with plain text underneath |
| "Who owns it?" | Avatar + name, People group | Name in a plain box |
| "What's the story?" | Rich description — bold "Day one:", structure preserved | The same text flattened to a uniform wall |
| "What's connected?" | Links block: "links to ENCUC-2070 INC0100170 \| PRB0040953" with ITS status chip | Not shown at all |
| "What can I do?" | Edit / Add comment / Assign / transition buttons up top | An unlabeled "Choose…" dropdown beside a tiny "Fix" button |
| "Am I getting anywhere?" | — | — (neither; Toolbox can win here) |

The linked-issue row is the sharpest example: for THIS stale defect, the single most decision-relevant fact — it links
to an incident/problem ticket that is "READY FOR TE…" — exists only in Jira. A reviewer using Toolbox alone cannot see
the one thing that explains the ticket's state.

**The solution is one feature with three parts:**

1. **Meaning through color and shape** — a consistent semantic visual language for issue facts everywhere Toolbox shows
   them: status chips colored by category (to-do / in-progress / done), priority badges with the familiar
   direction-and-color arrows, issue-type icons (defect red, story green, task blue), assignee identity avatars
   (initials), and an age heat indicator (fresh → amber → red as staleness grows).
2. **The whole picture in the panel** — the issue detail panel grows the decision-relevant context Jira has and Toolbox
   hides: linked issues **with their statuses**, labels, fix versions, sprint, feature link, and acceptance criteria as
   a distinct block; and the description renders with its structure (headings, bold, lists) instead of flattened text.
3. **A guided cleanup flow Jira doesn't have** — reviewing "23 stale tickets" becomes a session: previous/next moves
   through the findings with a visible position ("7 of 23"), keyboard-first navigation, each handled finding visibly
   settles (checked off in the list), and finishing shows what was accomplished. Toolbox's edge over Jira is purpose:
   Jira is a filing cabinet; the hygiene workspace is a to-done machine.

Explicit non-goal, in the reporter's words: **we can't and shouldn't rebuild Jira.** No rich-text *editing*, no
watchers/votes, no attachment management, no full field editor. Every fact shown comes from data Toolbox already
fetches or can fetch read-only; every write goes through the existing propose/confirm fix controls.

## Clarifications

### Session 2026-07-17

- Q: What counts as "skipped" in a cleanup session — an explicit action, or merely advancing past a finding? → A:
  Explicit Skip action. Advancing without acting leaves a finding "untouched"; only fix / comment / deliberate Skip
  settle it. The summary reports fixed / commented / skipped / untouched separately, so progress is never overstated.
- Q: Where is the guided cleanup session available? → A: Everywhere the hygiene workspace renders — the Team
  Dashboard hygiene tab, the My Issues personal hygiene tab, and the standalone Hygiene tool all offer the identical
  session flow (one shared workspace, no per-surface behavior drift).

## User Scenarios & Testing

### Primary flow — reviewing one stale ticket

1. The user clicks the "Stale Ticket — 23" tile on the Hygiene tab and expands the first finding.
2. The issue header reads at a glance without any text-parsing: type icon, key, colored status chip ("Ready to
   Accept"), priority badge, assignee avatar + name, and an age indicator whose color already says "16 days is
   borderline".
3. The panel shows the linked issues block: "links to ENCUC-2070 — INC0100170 | PRB0040953" with that issue's own
   status chip. The user immediately understands the defect is waiting on the linked problem ticket.
4. The description renders with its original structure — "Day one:" / "Day two:" bold, steps listed — and is scannable
   in seconds instead of re-read twice.
5. The fix affordance states its case in words: "Stale — no update in 16 days," followed by clearly labeled actions
   (post a nudge comment, transition status, edit the flagged fields). The user posts a comment referencing the linked
   ticket and moves on.

### Session flow — clearing the stale pile

1. From the same filtered list, the user enters review mode on the first finding.
2. "1 of 23" is visible; keyboard next/previous moves between findings without scrolling or re-expanding.
3. Every finding the user acts on (fix applied, comment posted, or deliberately skipped via the Skip action) is
   visibly settled in the list; findings merely advanced past remain visibly untouched.
4. At the end: "23 findings — 9 fixed, 6 commented, 5 skipped, 3 untouched." The session summary is ephemeral
   (informational only) and never counts an untouched finding as handled.

### Editing flow — fixing a field without fear

1. On a finding flagged "Missing SP," the fix control names the field it will write and shows the allowed values where
   the field is a dropdown (existing editmeta behavior), as a labeled control — never a bare "Choose…".
2. Applying the fix gives immediate visual confirmation on the finding (flag clears or is struck through) without a
   full reload losing the user's place in the session.

### Edge cases

- **Issue has no links / labels / sprint** — the corresponding blocks are omitted entirely (no empty dashed boxes;
  that is a Jira anti-pattern the reporter's second screenshot demonstrates — six "There are no links" placeholders).
- **Linked-issue lookups fail or are slow** — the rest of the panel renders immediately; the links block shows a
  quiet "links unavailable" note rather than blocking or erroring the whole panel.
- **Description has no recognizable structure** — plain text renders as today, just with comfortable line spacing.
- **A field write fails mid-session** — the finding shows the readable error inline (existing behavior) and the
  session position is preserved; next/previous still work.
- **Color alone is never the only signal** — every chip/badge carries its text label; the accessibility text-size
  modes (A+/A++) must not break the header layout (lesson of GH #160).
- **The user leaves mid-session** — no state needs saving; re-entering starts a fresh session over the current
  findings.

## Requirements

### Functional — semantic visual language

- **FR-001**: Issue status MUST render as a chip colored by its status category (to-do, in-progress, done) with the
  status name as text, consistently wherever the hygiene workspace and the issue detail panel show a status (including
  linked issues' statuses).
- **FR-002**: Priority MUST render as a badge combining the conventional direction/color (highest/high warm and rising,
  medium neutral, low/lowest cool and falling) with the priority name.
- **FR-003**: Issue type MUST render as a recognizable colored icon + name (defect/bug, story, task, spike, feature).
- **FR-004**: The assignee MUST render with an identity avatar (initials derived from the display name) plus the full
  name — never a truncated name (standing rule from the Release Radar fix).
- **FR-005**: The finding's age MUST render with a graded color (comfortable / warning / overdue) alongside the day
  count, thresholds consistent with the configured stale threshold.

### Functional — the whole picture

- **FR-006**: The issue detail panel MUST show the issue's linked issues (link type, key, summary) each with its own
  status chip, when link data is available.
- **FR-007**: The panel MUST show labels, fix versions, sprint, feature link, and PI as compact chips/rows when
  present, and MUST omit each block entirely when empty.
- **FR-008**: Acceptance criteria, when present, MUST render as a distinct labeled block separate from the description.
- **FR-009**: The description MUST render preserving its source structure — bold/heading lines, paragraph breaks, and
  list items — rather than flattening to uniform text.
- **FR-010**: All information the panel showed before this feature MUST remain available (no regressions in fields,
  comments, transitions, or story-point editing).

### Functional — guided cleanup session

- **FR-011**: From a filtered hygiene list — on every surface the hygiene workspace renders (team tab, personal tab,
  standalone tool) — the user MUST be able to step through findings sequentially with visible position ("N of M")
  using both on-screen controls and keyboard shortcuts, with identical behavior across surfaces.
- **FR-012**: Each finding in a session MUST offer an explicit Skip action alongside fix and comment; a finding is
  settled ONLY by fix, comment, or Skip. Settled findings MUST be visibly distinguished in the list; findings merely
  advanced past remain untouched and are never presented as handled.
- **FR-013**: Completing or leaving a pass over the findings MUST show a summary with separate counts for fixed,
  commented, skipped, and untouched; the summary is informational and requires no persistence beyond the session.
- **FR-014**: Applying a fix or posting a comment MUST NOT discard the user's position in the session.
- **FR-015**: The fix affordance MUST state, in words, what is flagged and what each action will do, and every fix
  input MUST be a labeled control (no bare "Choose…" placeholders).

### Non-functional

- **NFR-001**: The redesigned panel MUST remain fully usable at every text-size mode (A / A+ / A++) and at narrow
  window widths — content reflows, never clips (standing responsive directive).
- **NFR-002**: Color is always paired with a text label or icon shape; no meaning is carried by color alone.
- **NFR-003**: Linked-issue context loads without delaying the initial render of the panel.
- **NFR-004**: Both light and dark themes render the semantic colors with adequate contrast.

## Key Entities

- **Semantic chip vocabulary** — the mapping from issue facts (status category, priority, type, age band) to visual
  treatment (color token, icon, shape). One vocabulary, used by every surface that shows these facts.
- **Issue context** — the read-only decision context for one issue: linked issues with statuses, labels, fix versions,
  sprint, feature link, PI, acceptance criteria.
- **Cleanup session** — an ephemeral pass over the currently filtered findings: ordered list, cursor position, and
  per-finding outcome (fixed / commented / skipped / untouched). Lives only in the open view.

## Success Criteria

- **SC-001**: A reviewer can determine an issue's type, status, priority, owner, and age from the header without
  reading body text — verified by a 5-second glance test on a seeded finding.
- **SC-002**: Every fact the reporter's Jira screenshots show that bears on a stale-or-not decision (status, priority,
  type, links + their statuses, labels, sprint, fix versions, AC, dates) is visible in Toolbox without opening Jira.
- **SC-003**: Reviewing and dispatching a typical stale finding (read context → comment or fix → advance) takes under
  30 seconds inside a session, with zero full-page reloads.
- **SC-004**: A full pass over a 20+ finding list is possible with keyboard alone once the session starts.
- **SC-005**: The reporter's side-by-side complaint is retested with the same ticket: the Toolbox view contains the
  linked-ticket context that previously only Jira showed, and the description reads with its structure intact.

## Assumptions

- The semantic visual language is introduced through the **shared** issue detail panel and hygiene surfaces first;
  other views that show the same facts adopt the same vocabulary opportunistically (one vocabulary, incremental
  adoption) rather than in one big-bang restyle.
- Linked-issue data is fetched read-only per expanded issue; no new write paths are introduced.
- Session outcomes need no persistence — the value is momentum inside a sitting, not an audit trail.
- The existing propose/confirm fix controls and editmeta-aware writers are the only write mechanisms; this feature
  changes their presentation, not their behavior.
- Description rendering targets the structures visible in the reporter's screenshots (bold run-in headings, paragraph
  breaks, simple lists); full Jira wiki-markup fidelity is out of scope.

## Out of Scope

- Rich-text editing, attachment upload/management, watchers/votes, worklogs, or any Jira administration.
- Rebuilding Jira's full field editor; fields without a hygiene flag remain read-only context.
- Empty-placeholder blocks for absent data (explicitly rejected — see edge cases).
- Server-side/scheduled anything; this is entirely an in-app experience.
