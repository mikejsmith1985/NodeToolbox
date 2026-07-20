# Feature Specification: Quick Issue Lookup — F2 to find, view, and fix any issue without leaving the tool

**Feature short name**: `quick-issue-lookup`
**Created**: 2026-07-20
**Status**: Draft — ready for `/speckit-plan`
**Builds on**: the shared issue detail panel (semantic status/priority/type/assignee/age vocabulary, structure-preserving
description, linked issues with statuses, labels/fix-versions/sprint/PI/feature-link rows, comments) and its inline
edits (status transition, comment, story points); the editmeta-aware field writers (assignee, single-select option
fields, simple fields, issue links, fix versions, dropdown-or-numeric story points) and shared required-transition-field
control; the "open in Jira" browse-URL builder; and the root-mounted global-hotkey + modal pattern already used by the
F1 quick-add and the AI-assist unlock gate (F2 is currently unbound).

## Summary

Every time a user has an issue key in hand — from a standup, a Slack message, a linked ticket, an email — and wants to
*see it* or *touch one field on it*, they leave Toolbox and open Jira. That round-trip is friction, and worse, once they
are in Jira they tend to stay in Jira. The reporter's standing complaint (GH #177) is that Jira feels "more inviting" to
see and manipulate an issue; feature 019 answered that for the hygiene surfaces by making Toolbox's issue view read and
edit *better* than Jira. This feature takes that same, now-superior issue view and makes it reachable from **anywhere**
in one keystroke.

Press **F2** → a lookup popup appears with the cursor already in a key field → type a key (or paste one, or paste a Jira
URL) → **Enter** or the **Search** button → the issue opens in the full detail view. Every populated field is visible,
laid out dead-simple and scannable; the fields Toolbox can safely write are editable in place with immediate
confirmation; and the issue key itself is a **clickable link into Jira** for the user who — for any field Toolbox does
not edit, or simply by preference — wants to work in Jira directly. The point is not to trap anyone: it is to make
staying in Toolbox the obviously easier choice for the common case of "look at this one issue and maybe fix a field."

This is overwhelmingly a **reuse** feature. The detail view, the semantic chips, the field writers, the Jira deep-link,
and the global-hotkey-plus-modal shell all already exist. The one genuinely new piece is a read-only path to **fetch a
single full issue by its key** — today the detail view is always handed an issue that some other view already loaded;
nothing fetches one on demand from a bare key.

Explicit boundary, inherited verbatim from feature 019: **we can't and shouldn't rebuild Jira.** "All fields editable"
is delivered as *see every field, edit every field we can safely write, and hand the rest to Jira in one click* — the
escape hatch the reporter themselves asked for. No rich-text editor, no attachments, no watchers/votes/worklogs, no
arbitrary custom-field editor.

## Clarifications

### Session 2026-07-20

- Q: What does the F2 popup show before a key is typed? → A: A short recents list (the last ~5 issues viewed via F2),
  re-openable by click or arrow-key; blank on first-ever use. Recents are ephemeral to the client, not synced.
- Q: Is the description editable in this view, or read-only? → A: Read-only (structure preserved); the Jira key link
  is the escape hatch for rewriting it. Avoids flattening Jira wiki formatting on save.
- Q: Can the user look up another key without closing the popup? → A: Yes — a persistent search bar at the top of the
  popup swaps the detail view in place on a new key + Enter; pressing F2 while the popup is open re-focuses/clears that
  bar. (Clicking a linked-issue key to load it in place is out of scope for now.)

## User Scenarios & Testing

### Primary flow — find an issue from anywhere

1. The user is mid-task on any screen (a dashboard, a report, the home page) and has the key `ENCUC-1234` in hand.
2. They press **F2**. A modal popup appears immediately, backdrop dimming the current view, cursor already blinking in a
   single key field — no click needed.
3. They type `encuc-1234` and press **Enter** (a **Search** button is also present and does the same thing).
4. Within a moment the issue opens in the full detail view: type icon, key, colored status chip, priority badge,
   assignee avatar + name, age indicator, structure-preserving description, linked issues with their statuses, labels,
   sprint, comments — the same view feature 019 made worth working in.
5. The user reads what they needed and presses **Escape**; the popup closes and the underlying view is exactly as they
   left it — nothing was navigated away from or disturbed.

### Editing flow — fix a field without leaving

1. From the same detail view, the user changes the **status** (choosing a transition, filling any required transition
   fields), reassigns the **assignee**, adjusts the **priority**, and sets **story points**.
2. Each change saves to Jira and shows immediate confirmation; the field updates in place with no full reload and
   without the popup closing — the user keeps their place.
3. A write that fails shows a readable inline error and leaves the field's previous value intact; the user can retry.

### Escape-hatch flow — prefer Jira

1. The user wants to edit a field Toolbox does not write inline (or simply prefers Jira's editor for this change).
2. They click the **issue key**, which is a link; the issue opens directly in Jira in a new browser tab, on the exact
   issue, ready to edit there. Toolbox stays open behind it.

### Edge cases

- **Unknown key** — `ENCUC-9999999` returns "No issue found for ENCUC-9999999," not a blank panel or a raw error.
- **Malformed input** — text that is not a plausible key shape (e.g. `hello world`) gets an inline hint ("Enter an
  issue key like ABC-123") before any lookup is attempted.
- **Pasted variations** — ` ENCUC-1234 ` (whitespace), `encuc-1234` (lowercase), and a pasted
  `…/browse/ENCUC-1234` URL all resolve to the same issue; the input is tolerant so the user never has to clean it up.
- **Issue exists but no permission** — a clear "You don't have access to ENCUC-1234" message, distinct from
  "not found."
- **Field write fails mid-edit** — inline readable error; the field reverts to its prior value; the rest of the view is
  unaffected and the popup stays open.
- **Empty / absent fields** — fields with no value are omitted entirely; no empty dashed placeholder boxes (standing
  019 anti-pattern rule).
- **Keys typed into an input** — F2 and any navigation keys never fire while focus is in a text field being edited;
  the global hotkey and keyboard behavior follow the existing keyboard-guard rule.
- **Slow lookup** — a spinner shows while fetching; the popup remains responsive and Escape still cancels/closes.

## Requirements

### Functional — invocation & search

- **FR-001**: Pressing **F2** anywhere in the application MUST open a modal quick-lookup popup, suppressing any browser
  default for that key, with the key input focused and ready to type without a click. Pressing **F2** again while the
  popup is already open MUST re-focus and clear the search input rather than stacking a second popup.
- **FR-002**: The popup MUST provide a single issue-key input plus a **Search** action; pressing **Enter** in the input
  and clicking **Search** MUST both execute the lookup identically.
- **FR-002a**: Before a key is entered, the popup MUST show a recents list of up to the last ~5 issues opened via F2
  (each showing at least key and summary), re-openable by click or arrow-key selection; the list is blank on
  first-ever use and is stored client-side and ephemerally (not synced, no server persistence). A newly viewed issue
  moves to the top; the list never grows unbounded.
- **FR-003**: The input MUST tolerate common variations — case-insensitive, surrounding whitespace trimmed, and an
  issue key extracted from a pasted Jira browse URL — so equivalent inputs resolve to the same issue without manual
  cleanup.
- **FR-004**: **Escape** MUST close the popup non-destructively; the view the user was on is untouched, and focus
  returns to the underlying context.

### Functional — the detail view

- **FR-005**: A successful lookup MUST display the issue in the shared full detail view, reusing the established
  semantic visual language (status chip, priority badge, type icon, assignee avatar, age badge) and showing the issue's
  decision context: type, key, summary, status, priority, assignee, structure-preserving description, acceptance
  criteria, linked issues **with their statuses**, labels, fix versions, sprint, PI, feature link, and comments.
- **FR-006**: Every populated field on the issue MUST be visible in the view — no populated field is silently hidden;
  fields with no value are omitted entirely (no empty placeholder boxes).
- **FR-007**: The issue **key** MUST render as a link that opens that exact issue directly in Jira in a new browser
  tab, so a user who prefers Jira can leave in a single click while Toolbox stays open.
- **FR-007a**: While an issue is displayed, a persistent search bar at the top of the popup MUST let the user enter a
  new key and swap the detail view in place (new key + Enter/Search) without closing the popup or reloading the page.

### Functional — editing in place

- **FR-008**: The view MUST allow in-place editing of every field for which a safe writer already exists — summary,
  assignee, priority (and other single-select option fields), fix versions, and issue links — each edit saving to Jira
  with immediate confirmation. **Status** (via transition, including any required transition fields) and **story
  points** (dropdown-aware or numeric) reuse the detail view's existing editors rather than new ones. **Labels** are
  editable when the issue's field metadata exposes labels as settable, and degrade to read-only (still visible) when it
  does not — editability is metadata-conditional, not guaranteed.
- **FR-009**: Fields for which no safe in-tool writer exists MUST render read-only, with the Jira key link (FR-007) as
  the escape hatch for changing them. This explicitly includes the **description** (rendered structure-preserving but
  not editable here, to avoid flattening Jira wiki formatting on save), attachments, watchers, votes, worklogs, and
  arbitrary read-only custom fields.
- **FR-010**: Each successful edit MUST reflect immediately in the view without a full reload and without closing the
  popup, preserving the user's place; a failed write MUST show a readable inline error and leave the field's prior
  value intact.

### Functional — honest states & stay-in-tool layout

- **FR-011**: The view MUST present the issue's data grouped, labeled, and scannable, with the primary fields (status,
  assignee, priority, story points) reachable and editable without scrolling on a typical issue.
- **FR-012**: Loading, not-found, invalid-shape, and no-permission outcomes MUST each produce a distinct, specific,
  human-readable state — a spinner while fetching, "No issue found for KEY," an input hint for a malformed key, and a
  clear no-access message — never a blank panel or a raw error string.

### Non-functional

- **NFR-001**: The popup MUST open perceptually instantly on F2 with the input focused (target: focused input within
  ~100 ms of the keypress — distinct from, and much tighter than, the ≤5 s end-to-end lookup target in SC-001); no
  click is required before typing.
- **NFR-002**: The entire flow — open, search, edit, close — MUST be operable by keyboard alone (F2 → type → Enter →
  edit → Escape).
- **NFR-003**: The view MUST render correctly in both light and dark themes and at every text-size mode (A / A+ / A++)
  and at narrow widths, content reflowing rather than clipping (standing responsive directives).
- **NFR-004**: No meaning is carried by color alone — every chip and badge carries its text label.
- **NFR-005**: While focus is in an editable field, F2 and navigation keys MUST NOT trigger global actions or reset the
  edit; keys originating in inputs never drive global navigation (keyboard-guard rule).

## Key Entities

- **Issue lookup query** — the raw text the user typed and the normalized key extracted from it (case-folded, trimmed,
  URL-unwrapped). Ephemeral to a single popup session.
- **Loaded issue** — one full issue fetched on demand by key: the same shape the shared detail view already consumes,
  carrying all fields, links, and comments needed to render and edit.
- **Editable field set** — the subset of the loaded issue's fields Toolbox can safely write (the existing writer set),
  distinct from the read-only remainder that defers to Jira via the key link.
- **Recents list** — an ephemeral, client-side ordered list of the last ~5 issues opened via F2 (key + summary),
  most-recent first, shown when the popup opens with no key entered. Not synced or persisted server-side.

## Success Criteria

- **SC-001**: From anywhere in the app, a user goes from "I have a key" to "the issue is on screen" in under 5 seconds
  using the keyboard alone (F2 → type → Enter).
- **SC-002**: For a typical issue, a user can read type, status, priority, owner, age, and description without
  scrolling and without opening Jira.
- **SC-003**: A user can change an issue's status, assignee, priority, and story points from the lookup view and see
  each change confirmed, without ever leaving the current view or triggering a full reload.
- **SC-004**: Any field Toolbox does not edit inline is reachable in Jira in exactly one click from the same view.
- **SC-005**: Invalid, unknown, and no-permission keys each produce a distinct, understandable message — never a blank
  panel or a raw error.
- **SC-006**: In usability observation, users who would previously have opened Jira to check or fix a single field on a
  known issue complete the task inside Toolbox instead — measured by task completion without navigating to Jira for any
  editable-field change.

## Assumptions

- **"All fields editable" is realized as see-all / edit-what-we-can-safely-write / defer-the-rest-to-Jira.** The detail
  view already shows the full field set read-only; this feature makes editable every field the existing writers cover
  and routes everything else through the one-click Jira key link (the escape hatch the reporter explicitly asked for).
  This honors the standing "we can't and shouldn't rebuild Jira" boundary (feature 019) while delivering "all data dead
  simple to see and manage."
- **A read-only "fetch one full issue by key" data path is the single net-new capability.** Today the detail view is
  always handed a pre-loaded issue; the generic Jira fetch primitive and the JQL-search path exist, but nothing fetches
  one full issue on demand from a bare key. This is a documented Framework-First gap; everything else — rendering,
  inline edits, field writers, transition control, deep-link, hotkey+modal shell — reuses existing components.
- **F2 is free.** F1 hosts quick-add and Ctrl+Alt+Z hosts AI-assist unlock; F2 is unbound. The feature claims F2 and
  suppresses the browser default, mounting as a root-level gate sibling to the existing global gates.
- **Search is exact-key resolution with tolerant normalization**, not full-text or JQL — the ask is "type in a key."
- **Edits write straight to Jira with immediate confirmation**, consistent with how Toolbox's manual field fixes
  already behave. This is a deterministic lookup-and-edit surface, not an AI-propose surface, so no propose/accept
  envelope applies.
- **The popup is a transient overlay**, not a route; it does not change the URL or unmount the underlying view, so it
  can be summoned and dismissed from the middle of any task without losing context.
- **PI, sprint name, and feature-link are populated best-effort or omitted.** The detail view takes these as
  host-resolved inputs (they are not first-class fields on the issue), and the lookup has no team context to resolve
  them; when unavailable those rows are simply omitted (the view already omits empty blocks). No PI/sprint resolver is
  built — anyone needing that context uses the Jira key link.

## Out of Scope

- Full-text / summary / JQL search returning a result list — this feature resolves a single key to a single issue.
- Rebuilding Jira's full field editor for arbitrary custom fields; rich-text/wiki editing, attachment management,
  watchers, votes, worklogs.
- Creating new issues or sub-tasks — lookup and edit of existing issues only.
- Bulk or multi-issue operations.
- Navigating the link graph in place — clicking a linked-issue key inside the detail view to load *that* issue without
  going through the search bar (deferred; the persistent search bar and the Jira key link both already reach it).
- Any server-side, scheduled, or background behavior — the feature is entirely in-app and on-demand.
- AI assistance in this surface — the lookup is deterministic and edits are direct; no propose/decline flow.
