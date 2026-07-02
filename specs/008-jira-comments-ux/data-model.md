# Phase 1 Data Model: Consistent Jira Comment History & Themed Field Depth

This is a presentation feature; it introduces no persistent storage. The "data" is the in-memory
shape flowing through the shared comment layer plus the theme tokens that drive appearance.

## Entities

### Comment (existing — `client/src/types/jira.ts` `JiraComment`)

The canonical, unchanged comment shape read from Jira.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Stable key for React list rendering |
| `author.displayName` | string? | Falls back to `Unknown` when absent |
| `body` | unknown | Normalized to plain text via `normalizeRichTextToPlainText` (unchanged) |
| `created` | string (ISO-8601) | Sort key for newest-first ordering; displayed truncated to date (`slice(0,10)`) |

**Source**: `GET /rest/api/2/issue/{key}/comment` → `{ comments: JiraComment[] }`.

### CommentThreadState (new — produced by `useIssueComments`)

The view-model every comment location consumes. Not persisted.

| Field | Type | Rule |
|-------|------|------|
| `comments` | `JiraComment[]` | The **full** thread, ordered **descending by `created`** (newest first) |
| `isLoading` | boolean | `true` until the first fetch settles |
| `loadError` | string \| null | Set to the error message when the fetch fails; `comments` is emptied |
| `refresh()` | function | Re-runs the fetch (used after posting a comment) |

**Validation / invariants**:
- Ordering is applied exactly once, in the hook, so every consumer is identical (FR-003, FR-004).
- On error, `comments` MUST be `[]` and `loadError` set — never a stale/partial list (FR-007).
- Empty thread (`comments.length === 0`, not loading, no error) → consumers render the single shared
  empty state (FR-005).

### Theme depth tokens (new/extended — `client/src/styles/tokens.css`)

CSS custom properties defined for **both** `:root` (dark) and `[data-theme="light"]`.

| Token (proposed) | Purpose | Both themes? |
|------------------|---------|--------------|
| `--field-elevation-bg` | Subtle gradient for text boxes / inputs raised from the window | Yes |
| `--field-elevation-border` | Boundary color pairing with the elevation (lighter than heavy border) | Yes |
| `--field-elevation-shadow` | Optional inset/soft shadow reinforcing the field edge | Yes |
| `--comment-window-bg` | Background for the scrollable comment window (distinct from panel) | Yes |

Existing tokens reused as-is: `--color-card-bg`, `--color-field-bg`, `--shadow-surface`,
`--color-border`, `--color-surface-highlight`, `--color-text-primary/-secondary/-muted`.

**Invariants**:
- Every new token has a value under **both** theme blocks (FR-009).
- Text over any treated field meets WCAG 2.1 AA in both themes (FR-010, SC-005).

## State transitions (comment window lifecycle)

```
mount(issueKey)
  → isLoading=true, comments=[], loadError=null
  → fetch settles:
       success → comments=sortDescByCreated(response.comments), isLoading=false, loadError=null
       failure → comments=[], isLoading=false, loadError=message
post comment (consumer calls refresh())
  → refetch → same success/failure transitions; newly posted comment appears pinned at top
issueKey changes
  → hook re-runs fetch for the new key (stale results from the old key ignored via mounted guard)
```

## Relationships

- Each comment-display **location** owns one `useIssueComments(issueKey)` instance and renders one
  `CommentThread` fed by its state.
- `IssueDetailPanel` additionally wires its existing post-comment flow to the hook's `refresh()`
  (replacing its private `commentsRefreshToken`).
- All locations share the same token-driven `CommentThread.module.css`, so visual + depth treatment
  is single-sourced.
