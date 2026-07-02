# Feature Specification: Consistent Jira Comment History & Themed Field Depth

**Feature Branch**: `008-jira-comments-ux`

**Created**: 2026-07-02

**Status**: Draft

**Input**: In some places we present the user with only the last comment from a Jira item and in
others we present all comments in a scrollable window. Make that consistently *all comments in a
scrolling window* everywhere. In addition, add subtle gradients to better define field boundaries
and separate text-box backgrounds from the window background — for both light and dark themes.
Approach it from a master-UX perspective and deliver the best experience possible.

## Summary

Today the same piece of information — the conversation history on a Jira issue — looks different
depending on where the user is standing in Toolbox. In some views they see **only the most recent
comment**; in one view they see **only the last three**; in others they see **the full history in a
scrollable panel**. This inconsistency makes users distrust what they are looking at ("is this all
of them, or just the newest?") and forces them to leave Toolbox to read the rest of a thread.

This feature makes comment display **consistent across every view**: wherever an issue's comments
appear, the user sees the **complete comment history in a single scrollable window**, presented and
ordered the same way each time, with the **most recent comment immediately visible**.

Alongside that, it raises the overall polish of the interface by using **subtle gradients and
surface elevation** to clearly separate interactive fields (text boxes, inputs, comment panels) from
the surrounding window — so boundaries read at a glance without heavy borders. This visual treatment
must look intentional and legible in **both light and dark themes**.

This is a **presentation and consistency** change. It does not change which issues are shown or how
comments are posted or any Jira write behavior; it does standardize *how the full comment thread is
retrieved for display* so every location can show all comments (see Clarifications).

## Clarifications

### Session 2026-07-02

- Q: How should the unified comment window get its data, given some locations only have the
  (possibly truncated) comments from their list/issue payload? → A: Standardize on the shared panel's
  **on-demand fetch of the full comment thread** in every location, guaranteeing all comments and
  consistent loading/error states.
- Q: What comment ordering should the unified window use, and what does the user see first? → A:
  **Newest→oldest (reverse chronological), newest pinned at the top**, matching how Jira itself
  presents comments; older comments are reached by scrolling down.
- Q: What contrast/legibility standard should the depth treatment meet, in both themes? → A:
  **WCAG 2.1 AA** — body text ≥ 4.5:1 and large text / UI boundaries ≥ 3:1 against their field
  background, in both light and dark themes.

## Scope Boundary (explicit non-goals)

- **In scope**: making every comment-display location show the full comment history in a consistent,
  scrollable window with consistent ordering and a consistent visual style; a subtle
  gradient/elevation treatment that distinguishes fields and text boxes from the window background;
  correct rendering of both treatments in light **and** dark themes.
- **Out of scope**: changing how comments are retrieved from Jira, adding pagination/lazy-loading of
  comments beyond what a scroll window needs, or changing comment-posting behavior.
- **Out of scope**: rich-text / ADF rendering of comment bodies (comments continue to render as the
  normalized plain text they use today).
- **Out of scope**: a full design-system redesign, new theme options, or restyling components that
  do not relate to comment display or field/text-box separation.
- **Out of scope**: changing which views exist or what other data (status, assignee, points, etc.)
  those views show.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Full comment history everywhere (Priority: P1)

Wherever a user opens or expands a Jira issue in Toolbox — story pointing, the sprint dashboard
pointing rows, the DSU board issue overlay, and every panel that already embeds the shared issue
detail — they see the **entire** comment history in a scrollable window, not just the latest one or
a truncated few.

**Why this priority**: This is the core of the request. Users must be able to trust that "comments"
means *all* comments, no matter where they are in the app.

**Independent Test**: Open an issue that has more comments than fit on screen from each
comment-showing view; confirm every view shows all of them in a scroll window (scrolling reveals the
oldest), and that no view silently caps the list.

**Acceptance Scenarios**:

1. **Given** a Jira issue with many comments, **When** the user views it in the story-pointing view,
   **Then** all comments appear in a scrollable window (not only the latest comment).
2. **Given** the same issue, **When** the user expands its row in the sprint dashboard, **Then** all
   comments appear in a scrollable window (not only the latest comment).
3. **Given** the same issue, **When** the user opens it in the DSU board issue overlay, **Then** all
   comments appear in a scrollable window (not only the most recent three).
4. **Given** the same issue in any view that already showed the full scrollable history, **When** the
   user opens it, **Then** it continues to show all comments with no regression.
5. **Given** an issue with no comments, **When** the user views it in any of these locations,
   **Then** a single, consistent empty-state message is shown (not a blank area).

### User Story 2 - Consistent presentation and "latest first to the eye" (Priority: P1)

Every comment window looks and behaves the same: the same layout for author, date, and body; the
same ordering; and the **most recent comment is immediately visible without hunting** for it.

**Why this priority**: Consistency is what makes the history trustworthy and fast to read. Showing
"all comments" in five subtly different formats would only trade one inconsistency for another.

**Independent Test**: View the same issue in three different comment locations side by side; confirm
the author/date/body layout, the ordering, and where the newest comment sits are identical, and that
the newest comment is on screen without manual scrolling.

**Acceptance Scenarios**:

1. **Given** an issue viewed in two different locations, **When** the user compares them, **Then**
   author, date, and comment body are laid out the same way and comments are in the same order.
2. **Given** an issue whose history is taller than the window, **When** the user opens any comment
   location, **Then** the most recent comment is immediately visible without the user scrolling.
3. **Given** a very long individual comment, **When** it renders, **Then** it wraps/contains within
   the window and the window scrolls — it does not overflow or break the surrounding layout.

### User Story 3 - Clear field boundaries in both themes (Priority: P2)

Text boxes, inputs, and comment windows are visually separated from the surrounding window through
subtle gradients/elevation, so the user can tell where an editable or scrollable field begins and
ends at a glance — and this reads correctly in both light and dark mode.

**Why this priority**: The visual-depth improvement is the second half of the request and directly
improves perceived quality and usability, but the app is still functional without it, so it ranks
below getting the comment content right.

**Independent Test**: In both light and dark themes, view a screen containing a text box / comment
window against the page background; confirm the field boundary is clearly distinguishable from the
window without relying on a heavy border, and text remains readable.

**Acceptance Scenarios**:

1. **Given** dark theme, **When** the user views a text box or comment window, **Then** its
   background is visibly distinct from the surrounding window background and its boundary is clear.
2. **Given** light theme, **When** the user views the same field, **Then** it is equally clear and
   the treatment looks intentional (not washed out or muddy).
3. **Given** either theme, **When** the depth treatment is applied, **Then** all text inside fields
   still meets a comfortable contrast level and no content becomes harder to read than before.
4. **Given** the user switches themes, **When** the theme changes, **Then** the gradient/field
   treatment updates with it and never leaves a field looking like the wrong theme.

### Edge Cases

- **No comments**: a consistent, friendly empty state appears in every location (no blank gap, no
  "undefined").
- **One comment**: the single comment shows inside the same scrollable window style (not a
  bespoke one-off layout) — the window simply doesn't need to scroll.
- **Very long thread**: the window scrolls smoothly to reveal older comments and does not grow the
  surrounding view unboundedly.
- **Very long single comment**: wraps and is contained; the window scrolls rather than the page.
- **Comment still loading / failed to load**: a consistent loading and error state is shown where a
  location fetches comments on demand (matching the existing behavior of the panel that already does
  this), rather than an empty or frozen window.
- **Theme with reduced-transparency / high-contrast preferences**: the gradient treatment degrades
  gracefully to a clearly bordered field rather than becoming invisible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every location that displays Jira issue comments MUST show the **complete** comment
  history for that issue, not only the latest comment and not an arbitrarily capped subset.
- **FR-001a**: Every comment-display location MUST obtain the complete thread by **fetching it on
  demand** (the same retrieval the shared panel already uses), rather than relying on the possibly
  truncated comments carried in a list/issue payload — so "all comments" is guaranteed regardless of
  thread size.
- **FR-002**: Comment history MUST be presented in a **scrollable window** that contains a long
  history within a bounded height instead of expanding the surrounding view.
- **FR-003**: The comment window's **presentation MUST be consistent** across all locations — the
  same author/date/body layout, the same ordering, and the same empty state.
- **FR-004**: Comments MUST be ordered **newest→oldest (reverse chronological) with the newest
  pinned at the top**, matching Jira's own ordering, so the **most recent comment is immediately
  visible** on open without scrolling; older comments are reached by scrolling down.
- **FR-005**: A **consistent empty state** MUST be shown when an issue has no comments, in every
  comment-display location.
- **FR-006**: Comment bodies MUST continue to render as the normalized, readable text used today
  (this change does not alter comment content parsing) and MUST wrap/contain within the window.
- **FR-007**: Where a location loads comments on demand, it MUST show consistent **loading** and
  **error** states rather than a blank or frozen window.
- **FR-008**: Interactive fields — text boxes, inputs, and comment windows — MUST be **visually
  separated from the surrounding window background** using a subtle gradient/elevation treatment so
  their boundaries are clear without relying on a heavy border.
- **FR-009**: The field/text-box depth treatment MUST render correctly and look intentional in
  **both light and dark themes**, and MUST update automatically when the user switches themes.
- **FR-010**: The depth treatment MUST NOT reduce text readability. Text within treated fields MUST
  meet **WCAG 2.1 AA** contrast (body text ≥ 4.5:1; large text and field/boundary indicators ≥ 3:1)
  against its field background in both light and dark themes.
- **FR-011**: The change MUST NOT alter which issues are shown, how comments are posted, or any Jira
  write behavior. It MAY change *where a location sources the comment thread from* (moving to the
  shared on-demand fetch per FR-001a) purely to guarantee completeness; no comment content parsing or
  write path changes.
- **FR-012**: No comment-display location may **silently truncate** the history; if a hard limit is
  ever required for performance, the user MUST be told the history is capped and how to see the rest.

### Key Entities *(include if feature involves data)*

- **Comment history**: The ordered set of an issue's comments (author, timestamp, body) — the same
  data everywhere; only its presentation is being unified.
- **Comment window**: The consistent, bounded, scrollable presentation of a comment history, reused
  across every view that shows comments.
- **Field surface**: Any editable or scrollable field (text box, input, comment window) that must be
  visually distinguished from the window background via the depth treatment.
- **Theme**: The active light/dark mode that the comment window and field-depth treatment must both
  honor.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of comment-display locations show the full comment history in a scrollable window
  (0 locations showing only the latest comment or a capped subset).
- **SC-002**: The comment window looks and orders comments identically across all locations — a user
  comparing any two locations sees the same layout, ordering, and empty state.
- **SC-003**: In every location, the newest comment is visible on open with **0** manual scroll
  actions required to see it.
- **SC-004**: For an issue with no comments, every location shows the same empty-state message (0
  blank gaps, 0 "undefined"/placeholder leaks).
- **SC-005**: Text boxes and comment windows are visually distinguishable from the window background
  in both light and dark themes (verified against both themes), with text contrast meeting **WCAG 2.1
  AA** (≥ 4.5:1 body, ≥ 3:1 large/boundary) in each.
- **SC-006**: Switching themes updates the field/comment treatment correctly every time (0 instances
  of a field rendering in the wrong theme).
- **SC-007**: No regression — views that already showed the full scrollable history still do, and
  comment fetching/posting behavior is unchanged.

## Assumptions

- The existing shared comment-history presentation (the scrollable panel already used by several
  views) is the intended "good" pattern to standardize on; other locations will be brought in line
  with it rather than a new pattern being invented.
- "Most recent comment immediately visible" is achieved by ordering comments newest→oldest with the
  newest pinned at the top (per FR-004), matching how Jira itself presents comments — so the latest is
  what the user sees first with no scrolling.
- Comment bodies continue to be shown as normalized plain text, consistent with current behavior; no
  new rich-text rendering is introduced by this feature.
- Theming is driven by the existing light/dark theme mechanism, so expressing the depth treatment
  through the established theme tokens is sufficient to cover both themes.
- A bounded scroll window is preferable to an unbounded expanding list for long threads; a sensible
  maximum height consistent with the existing panel is acceptable.
- The set of comment-display locations to unify are the story-pointing view, the sprint-dashboard
  pointing-row expansion, the DSU board issue overlay, and the shared issue-detail panel already used
  by the remaining views; any additional location that renders comments is also in scope.

## Dependencies

- The existing shared issue-detail comment panel and its scrollable comment-history presentation,
  which serves as the consistency target.
- The existing light/dark theme system and its color tokens, which the depth treatment must use so
  both themes are covered.
- The existing comment-fetch and comment-normalization behavior, which this feature reuses unchanged.
