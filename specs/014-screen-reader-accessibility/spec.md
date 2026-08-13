# Feature Specification: Screen-Reader Accessibility for Reports Hub & Team Dashboard

**Feature short name**: `screen-reader-accessibility`
**Created**: 2026-07-08
**Status**: Draft — recommendations applied (Q1=A, Q2=A, Q3=A); confirm to finalize, then `/speckit-plan`
**Feature directory**: `specs/014-screen-reader-accessibility/`
**Source guide**: Deque University — *JAWS Screen Reader Guide* (screen-reader navigation & authoring requirements)

## Summary

A screen-reader user — specifically a **JAWS** user on Windows — cannot today work effectively in the two
richest NodeToolbox surfaces: the **Reports Hub** and the **Team Dashboard**. Both are dense, interactive
views (tabbed navigation, filters, data tables, on-demand report generation, person pickers, roster editing,
capacity and standup workflows) built with clickable `<div>`s, emoji-only labels, unlabeled controls, and
tables/status updates that a screen reader cannot announce or navigate.

JAWS users navigate not line-by-line but by **jumping between structures** — headings (**H**), landmark
regions (**R**), form fields (**F**), tables (**T**), lists (**L**), links (**K**), and buttons (**B**) —
and they toggle between a **reading (virtual) cursor** and **Forms Mode** for input. An app is only usable
if those structures actually exist and are correctly labeled: real headings in a logical order, ARIA
landmarks, every control with an accessible name, tables with header cells and scope, live regions that
announce dynamic changes, a sensible focus order, and full keyboard operability.

This feature makes the Reports Hub and Team Dashboard **perceivable, operable, and understandable with a
screen reader** — bringing both to **WCAG 2.1 AA**, verified specifically against JAWS's navigation model —
without changing what the tools *do* for sighted users.

## Why this shape (rationale)

- **These two views are where the value and the barriers are highest.** They carry the most interactive
  density (tabs, tables, filters, generate/send actions, editable rosters), so they are both the hardest and
  the most valuable to make accessible; simpler read-only views can follow later.
- **Structure is navigation.** For a JAWS user, a heading that isn't a real heading, or a table built from
  `<div>`s, doesn't just look wrong — it removes an entire way of moving through the page. Meeting the guide
  means providing the semantic structures the quick keys rely on.
- **Dynamic content must announce itself.** Reports generate on demand, filters re-run, rosters update, and
  status changes — none of which a screen reader perceives unless the app deliberately announces them via
  live regions and managed focus.
- **WCAG 2.1 AA is the testable bar; JAWS is the proof.** AA gives an objective, auditable standard; running
  the primary journeys end-to-end with JAWS proves the standard translates into a real, usable experience.
- **No behavior change for sighted users.** This is a semantics/labeling/keyboard/announcement effort layered
  onto the existing UI, not a redesign of what the tools do.

## Scope Boundary (explicit non-goals)

- **In scope**: The **Reports Hub** (all its tabs, filters, tables, report generation/send actions, the
  Personal Flow person picker + comparison table) and the **Team Dashboard** (its tab navigation, roster
  view/editor incl. the role toggles and person search, standup, capacity, and PI-review surfaces — their
  navigation, controls, tables, and dynamic status).
- **Out of scope (this feature)**: Other views (Feature Canvas, ART View, My Issues, SNow Hub, etc.). They
  benefit from any shared component fixes but are not part of this feature's acceptance.
- **Out of scope**: Visual redesign, color/theme changes beyond meeting contrast, and new functionality. This
  is accessibility of the *existing* behavior.
- **Out of scope**: Full conformance to WCAG 2.1 **AAA** or non-JAWS assistive tech certification. Building to
  AA semantics makes other screen readers work far better, but JAWS on a supported browser is the verified
  target (per Q2).
- **Out of scope**: A third-party accessibility *audit/certification* engagement. This delivers the
  conformance and internal verification; a formal external audit, if desired, is a separate effort.
- **Out of scope**: Mobile / touch screen-reader (VoiceOver/TalkBack) certification. NodeToolbox is a desktop
  web tool; the target is JAWS + a desktop browser.

## Clarifications

### Session 2026-07-08

Three decisions shape the effort's size and definition of done; each is written against the recommended
option below. Please confirm or adjust.

- **Q1 — Conformance bar**: Recommended → **WCAG 2.1 AA, verified with JAWS (Option A)**. AA is the objective
  standard; JAWS end-to-end runs of the primary journeys are the proof.
- **Q2 — Verified screen-reader/browser target**: Recommended → **JAWS on a current Chromium browser
  (Chrome/Edge) as the single verified combination (Option A)**, with the work built to standard semantics so
  other screen readers benefit.
- **Q3 — Depth**: Recommended → **All primary user journeys and every interactive control of both tools to AA
  (Option A)**, with obscure edge controls remediated iteratively; not a big-bang "every pixel at once."

### Q1 — What is the accessibility bar?

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **WCAG 2.1 AA, JAWS-verified.** Meet AA success criteria for the two tools and prove it by driving the primary journeys with JAWS. | Objective, auditable, and industry-standard; the guide's JAWS patterns are the verification lens. |
| B | **"JAWS-operable" only** — make it work with JAWS without formally targeting AA. | Faster to claim "done" but subjective and gap-prone; regressions are hard to catch without a standard. |
| C | **WCAG 2.1 AAA.** | Substantially more effort (e.g. stricter contrast, context help) for little added JAWS benefit here. |

### Q2 — Which screen-reader / browser combination is the verified target?

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **JAWS + current Chrome/Edge**, one verified combo; standard semantics so NVDA/others benefit too. | Matches the user's guide and real environment; one combo keeps verification tractable. |
| B | **JAWS + NVDA + VoiceOver** all verified. | Broadest assurance but multiplies verification cost and defers value. |
| C | **JAWS on a specific pinned browser/version only.** | Narrowest; risks breaking on the browsers people actually use. |

### Q3 — How deep does "accessible" go for these two large tools?

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(recommended)* | **All primary journeys + every interactive control to AA**, edge cases iterative. | Delivers a genuinely usable experience for the real workflows without an unbounded scope. |
| B | **Every control and state, exhaustively, before shipping.** | Most complete but very large and slow; delays any benefit. |
| C | **A thin pass** (landmarks + labels only). | Quick but leaves tables, live updates, and keyboard traps — i.e. still unusable in practice. |

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**Story A — Orient and move by structure:**
As a JAWS user opening the Reports Hub or Team Dashboard, I want to pull up a list of **headings** and
**landmarks** and jump to the section I need, so I can orient myself without reading the whole page top to
bottom.

**Story B — Operate the tabs:**
As a JAWS user, I want the Reports Hub / Team Dashboard **tab strip** to be announced as a tab list with the
selected tab and each tab's name, and to move between tabs and into the tab's content with the keyboard, so I
can switch reports/sections the way a sighted user clicks them.

**Story C — Understand every control:**
As a JAWS user, I want every **button, link, filter, and input** — including icon-only and emoji controls — to
announce a clear name, role, and state, so I never land on an "unlabeled button" I can't identify.

**Story D — Read the data tables:**
As a JAWS user, I want report and dashboard **tables** to be real tables with **column/row headers**, so I can
navigate cell by cell and hear the header context ("Points / Week, 12") instead of a wall of numbers.

**Story E — Know when something changed:**
As a JAWS user, when a report **generates**, a filter **re-runs**, a person's data **loads**, or an action
**succeeds or fails**, I want it **announced** and focus handled sensibly, so I'm not left wondering whether
anything happened.

**Story F — Do everything by keyboard:**
As a keyboard-only / JAWS user, I want to reach and operate **all functionality** — filters, generation,
person search + pick, roster role toggles, capacity edits — using the keyboard alone, with a visible focus
indicator and no keyboard traps.

**Story G — Verified, not assumed:**
As the team, we want the two tools' primary journeys **driven end-to-end with JAWS** and checked against
WCAG 2.1 AA, so "accessible" is demonstrated, not asserted.

### Acceptance scenarios

- **Heading map (Story A)**: Given the Reports Hub is open, when a JAWS user lists headings, then there is
  exactly one page-level heading and a logical, correctly-nested heading for the view title, the active
  report's title, and each major section — with no skipped levels and no fake (non-heading) headings.

- **Landmarks (Story A)**: Given either tool, when a JAWS user lists landmark regions, then the main content,
  primary navigation/tabs, and any complementary panels are exposed as landmarks so they can be jumped to.

- **Tabs as a tablist (Story B)**: Given the tab strip, when a JAWS user reaches it, then it is announced as a
  tab list; each tab announces its name and selected state; arrow/Tab keys move between tabs; and activating a
  tab moves the reading context to that tab's panel.

- **Named controls (Story C)**: Given any interactive control in scope — including emoji/icon-only buttons
  (e.g. ✎ rename, ✕ close, 📥 apply) and filter/select inputs — when a JAWS user focuses it, then it announces
  a meaningful name, its role, and any state (pressed/expanded/selected/disabled); there are **zero**
  "unlabeled" or role-less interactive controls in scope.

- **Data tables (Story D)**: Given a report or dashboard table (e.g. the Personal Flow comparison, throughput,
  defect, roster tables), when a JAWS user navigates it in table mode, then rows/columns have header cells with
  correct scope and each data cell announces its header context.

- **Dynamic announcements (Story E)**: Given a JAWS user triggers report generation / a filter change / a
  person lookup, then loading and completion (and any error) are announced via a live region, and focus is not
  lost or stranded; a failed action announces the error text.

- **Keyboard operability (Story F)**: Given a keyboard-only user, when they traverse either tool with Tab and
  arrow keys, then they can reach and operate every control, focus order is logical, the focus indicator is
  always visible, and no interaction traps focus.

- **Form fields & person search (Story C/F)**: Given the person picker / roster search and any form field,
  then each field has an associated label, the suggestion list is announced and keyboard-selectable, and
  choosing a suggestion is announced.

- **JAWS journey pass (Story G)**: Given the defined primary journeys for each tool, when they are run
  end-to-end with JAWS on the target browser, then each can be completed using only JAWS + keyboard, and an
  automated accessibility check on the two views reports **no WCAG 2.1 A/AA violations**.

## Functional Requirements

### FR-1 — Semantic page structure (headings & landmarks)
1.1 Each tool exposes a correct **heading hierarchy**: a single top-level heading, then logically nested
    headings for the view title, the active report/section title, and each major sub-section — no skipped
    levels, no visually-styled non-headings standing in for headings.
1.2 Each tool exposes **landmark regions** for main content, the primary tab navigation, and complementary
    panels, so a screen reader can enumerate and jump to them.
1.3 A **skip-to-content** affordance lets a keyboard/screen-reader user bypass repeated chrome and land on the
    main content.

### FR-2 — Accessible tabbed navigation
2.1 The Reports Hub and Team Dashboard **tab strips** expose proper tab-list semantics: the container is a tab
    list, each tab announces its name and selected state, and exactly one tab is current.
2.2 Tabs are **keyboard operable** per the standard pattern (move between tabs with arrow keys, activate,
    and move into the associated panel), and each tab's content region is associated with its tab.

### FR-3 — Named, role-correct controls
3.1 Every interactive control in scope (buttons, links, toggles, checkboxes, selects, text inputs) has an
    **accessible name**, a correct **role**, and exposes its **state** (pressed, expanded, selected, checked,
    disabled) where applicable.
3.2 **Icon-only and emoji-only controls** (rename ✎, close ✕, delete, apply 📥, copy, run, etc.) carry a
    text alternative so they are never announced as unlabeled.
3.3 Controls implemented as non-native elements (e.g. clickable `div`s) either become native elements or are
    given the correct role, name, state, and keyboard behavior of the control they represent.

### FR-4 — Accessible data tables
4.1 Tabular data in scope is presented as **real tables** with header cells and correct **scope** (column
    and/or row), so cell navigation announces header context.
4.2 Tables that are sortable/filterable expose their current sort/filter state to assistive tech.

### FR-5 — Forms & inputs
5.1 Every form field (filters, search boxes, roster fields, capacity inputs, the person picker) has a
    **programmatically associated label**; required/invalid states and error messages are associated with the
    field and announced.
5.2 The **person search / suggestion** experiences (Reports Hub person picker, roster user search) expose the
    suggestion list and selection to assistive tech and are fully keyboard-operable.

### FR-6 — Dynamic content & status announcements
6.1 Asynchronous outcomes — **loading**, **completion**, **empty results**, and **errors** for report
    generation, filter changes, data fetches, saves, and sends — are announced via **live regions**.
6.2 When new content replaces or augments the view (e.g. a report renders, a panel opens), **focus is managed**
    so the screen-reader user is placed on or pointed to the new content, and focus is never lost to the
    document body.

### FR-7 — Keyboard operability & focus
7.1 **All functionality** in scope is operable with the keyboard alone; there are **no keyboard traps**.
7.2 Focus order is **logical** and a **visible focus indicator** is present on every focusable control.
7.3 Any transient UI (dropdowns, dialogs, popovers, the AI-assist and commit panels reachable from these
    tools) manages focus on open/close and supports Escape/return-focus conventions.

### FR-8 — Perceivable presentation
8.1 Text and meaningful UI meet **WCAG 2.1 AA contrast**; information is never conveyed by **color alone**
    (status, over-capacity, error states also carry text/shape/label cues).
8.2 Content reflows and remains operable at standard zoom/enlarged text without loss of function.

### FR-9 — Verification & non-regression
9.1 The defined **primary journeys** for each tool are documented and **run end-to-end with JAWS** on the
    target browser, and pass.
9.2 An **automated accessibility check** runs against the two views and reports **no WCAG 2.1 A/AA
    violations**; it is wired so future changes to these views are checked (guarding against regression).

## Success Criteria

1. **SC-1 — Zero automated A/AA violations**: An automated accessibility scan of the Reports Hub and Team
   Dashboard reports **0** WCAG 2.1 A and AA violations.
2. **SC-2 — No unlabeled controls**: **100%** of interactive controls in scope announce a meaningful name and
   correct role (0 "unlabeled button/link/graphic" occurrences).
3. **SC-3 — Structure is navigable**: In each tool a JAWS user can, from the heading and landmark lists, reach
   any major section in **≤ 2** navigation actions (no linear reading required).
4. **SC-4 — Tables are readable**: **100%** of in-scope data tables announce header context on cell
   navigation.
5. **SC-5 — Nothing silent**: **100%** of report-generation, filter, fetch, save, and send outcomes (success,
   empty, error) are announced to the screen reader.
6. **SC-6 — Full keyboard**: A keyboard-only user can complete **100%** of the defined primary journeys with
   no mouse and no keyboard trap, with a visible focus indicator throughout.
7. **SC-7 — JAWS journeys pass**: **100%** of the defined primary journeys for each tool are completed
   successfully using only JAWS + keyboard in a verification run.
8. **SC-8 — No behavior regression**: Sighted-user behavior and existing automated tests for the two tools are
   unchanged (the accessibility work adds semantics/announcements without altering what the tools do).

## Key Entities

| Entity | Description |
|--------|-------------|
| Accessible name | The text a screen reader announces for a control (from a label, text content, or an accessibility attribute) |
| Landmark region | A named page area (main, navigation, complementary) a screen reader can jump between |
| Heading hierarchy | The nested set of headings that lets a screen reader map and jump through page structure |
| Tab set | The tab list + tabs + associated panels of the Reports Hub / Team Dashboard navigation |
| Data table (accessible) | A table with header cells + scope so cell navigation announces header context |
| Live region | A page area whose updates are announced automatically (loading, completion, errors) |
| Primary journey | A documented end-to-end task per tool used as the JAWS/keyboard verification script |

## Assumptions

- **A1**: The target user/verification is **JAWS on a current Chromium browser** (Q2=A); building to standard
  semantics is expected to benefit other screen readers, but they are not the certified target.
- **A2**: The bar is **WCAG 2.1 AA** (Q1=A); "done" means the automated checks pass at A/AA **and** the JAWS
  journeys pass.
- **A3**: Scope is the **two named tools' primary journeys and interactive controls** (Q3=A); other views and
  obscure edge controls are follow-ups.
- **A4**: This is an **accessibility layer over existing behavior** — no feature/visual redesign; sighted-user
  flows and existing tests remain green.
- **A5**: Shared UI building blocks (tab strip, buttons, tables, panels) are used across both tools, so fixing
  them once improves both — the effort favors accessible shared components over per-screen patches where
  possible.
- **A6**: "Primary journeys" will be enumerated during planning (e.g. Reports Hub: pick a tab → filter →
  generate/read a report → read a table → run Personal Flow for a person/roster; Team Dashboard: switch tab →
  read roster → set a role → search/add a person → read capacity/standup).

## Dependencies

- The existing Reports Hub and Team Dashboard views and their shared UI components (tab strip, tables, panels,
  buttons, inputs).
- A screen-reader test environment: **JAWS** + the target browser.
- An automated accessibility checking capability integrated with the existing test setup (to satisfy FR-9.2 /
  SC-1 and guard against regression).
- WCAG 2.1 AA as the reference standard and the Deque JAWS guide as the navigation-model reference.
