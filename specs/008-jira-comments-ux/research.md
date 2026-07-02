# Phase 0 Research: Consistent Jira Comment History & Themed Field Depth

All Technical Context items are known (no `NEEDS CLARIFICATION` remained after `/speckit-clarify`).
This document records the design decisions that shape Phase 1.

## R1 — Consistency target: reuse `IssueDetailPanel`'s comment window

- **Decision**: Standardize every comment display on the existing `CommentHistory` presentation from
  `client/src/components/IssueDetailPanel/index.tsx` (scrollable `.commentList`, `max-height:240px;
  overflow-y:auto`), extracted into a shared `CommentThread` component.
- **Rationale**: It already renders the full array with author/date/body and empty/loading/error
  states, is token-themed, and is used by ~8 views. Consolidating on it satisfies FR-003 (consistent
  presentation) and Article VII (framework-first) at once.
- **Alternatives considered**: (a) Restyle each site independently — rejected, re-introduces drift.
  (b) Build a new comment component from scratch — rejected, duplicates working code.

## R2 — Data completeness: on-demand fetch everywhere (Clarification Q1)

- **Decision**: Every location fetches the full thread via
  `GET /rest/api/2/issue/{key}/comment` through the existing `jiraGet`, wrapped in a shared
  `useIssueComments(issueKey)` hook (extracted from the panel's existing effect).
- **Rationale**: The `fields.comment.comments` array carried in list/search payloads can be truncated
  for large threads; only the dedicated comment endpoint guarantees all comments (FR-001, FR-001a,
  FR-012). The panel already proves this path works, including a refresh token to re-pull after a
  post.
- **Alternatives considered**: (a) Reuse in-payload comments — rejected, risks silent truncation.
  (b) Hybrid (fetch only when payload looks capped) — rejected as unnecessary complexity; the single
  per-issue fetch is already the panel's proven, low-cost pattern (one request per opened issue).
- **Note on cost**: The hook fetches once per opened/expanded issue (same as today's panel), not per
  list row, so bulk lists stay lean.

## R3 — Ordering: newest→oldest, newest pinned at top (Clarification Q2)

- **Decision**: The shared layer orders comments **descending by `created`** (newest first) so the
  most recent sits at the top of the window; older comments are reached by scrolling down. Ordering
  is applied once, in the shared hook/component, so all consumers are identical (FR-004).
- **Rationale**: Matches Jira's own comment ordering (user familiarity) and makes "latest visible on
  open" trivially true without auto-scroll scripting.
- **Implementation choice**: Sort client-side (`[...comments].sort` by `created` desc, stable) rather
  than depending on a server `orderBy` parameter, so ordering is deterministic and unit-testable
  regardless of Jira version behavior. Jira returns ISO-8601 `created` strings, which sort correctly
  lexicographically; sort on the parsed timestamp to be safe.
- **Alternatives considered**: (a) Server `orderBy=-created` — rejected as primary (version/behavior
  variance, harder to unit test); may be added later as an optimization. (b) Chronological +
  auto-scroll to bottom — rejected per Q2.

## R4 — Depth treatment via existing design tokens (Clarification Q3)

- **Decision**: Express field/text-box/comment-window elevation through `tokens.css`. Reuse existing
  gradient/shadow tokens where they fit (`--color-card-bg`, `--color-field-bg`, `--shadow-surface`,
  `--color-border`, `--color-surface-highlight`) and add a small set of purpose-named tokens only for
  a documented gap — a dedicated **field-elevation gradient** and its border/inset so a text box or
  comment window reads as raised from the window in both themes.
- **Rationale**: The token system is the single source of truth and already redefines every color for
  `[data-theme="light"]`, so adding tokens there covers both themes automatically and switches live
  (FR-009). Keeps the change DRY and Article VII-compliant.
- **Contrast**: Choose gradient endpoints so body text (`--color-text-secondary`/`-primary`) over the
  field background meets WCAG 2.1 AA (≥4.5:1 body; ≥3:1 large/boundary) in each theme (FR-010,
  SC-005). Verify with a contrast checker during implementation; document the measured ratios.
- **Graceful degradation**: Under `prefers-contrast: more` / reduced-transparency, fall back to a
  solid field background + clear border rather than a subtle gradient (edge case in spec).
- **Alternatives considered**: (a) Per-component hardcoded gradients — rejected, breaks theming and
  duplicates values. (b) Heavy borders instead of elevation — rejected, the request explicitly wants
  boundaries defined without relying on heavy borders.

## R5 — Latest-comment removal points

- **Decision**: Remove the now-redundant "latest comment" derivations:
  - `useStoryPointingState.ts` `readLatestComment` + the `latestComment` state field.
  - `SprintDashboardView.tsx` inline `detail.comments[len-1]` latest-comment line.
  - `DsuBoardView.tsx` `recentComments = slice(-3)` + `createCommentPreview` overlay block and the
    `MAX_OVERLAY_COMMENT_COUNT` constant (dead after switch).
- **Rationale**: Leaving them would create contradictory/duplicate comment UI (Article XI restraint,
  and the clarify rule "replace obsolete statements"). Each is swapped for `CommentThread` fed by
  `useIssueComments(issueKey)`.
- **Alternatives considered**: Keep a one-line "latest" summary above the full window — rejected as
  redundant since the newest comment is already pinned at the top.

## R6 — Testing approach (TDD)

- **Decision**: Write failing tests first: (1) `useIssueComments` — success returns newest-first,
  error sets error + empty, refresh re-fetches; mock `jiraApi.jiraGet`. (2) `CommentThread` — renders
  all comments in order, shows empty/loading/error states, wraps long bodies. Then extract to green.
  Views get a light render smoke test that the panel appears with the mocked hook.
- **Rationale**: Article V (Red→Green→Refactor); unit tests mock I/O and stay <10ms.
- **UX proof**: quickstart.md drives each view in both themes (Article X) since contrast/elevation
  can't be asserted by unit tests alone.
