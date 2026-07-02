# Contract: Shared Comment Thread (component + hook + tokens)

This feature's "interface" is internal to the client: the shared React component, the fetch hook,
and the theme-token contract that every comment-display location depends on. These contracts are what
Phase 2 tasks and their tests are written against.

## 1. Hook: `useIssueComments(issueKey: string): CommentThreadState`

**Location**: `client/src/hooks/useIssueComments.ts`

**Behavior contract**:
- On mount and whenever `issueKey` changes, fetches `GET /rest/api/2/issue/{issueKey}/comment` via
  the existing `jiraGet`.
- Returns `comments` ordered **newest→oldest by `created`** (descending). Ordering is guaranteed by
  the hook, not the caller.
- Returns `isLoading=true` until the first fetch settles.
- On failure, returns `loadError=<message>` and `comments=[]` (never partial/stale).
- Exposes `refresh()` that re-runs the fetch; used after a successful comment post.
- Ignores results from a superseded `issueKey`/unmount (mounted guard), preventing stale writes.

**Signature**:
```ts
interface CommentThreadState {
  comments: JiraComment[];   // full thread, newest first
  isLoading: boolean;
  loadError: string | null;
  refresh: () => void;
}
export function useIssueComments(issueKey: string): CommentThreadState;
```

**Test contract** (`useIssueComments.test.ts`, mock `jiraApi.jiraGet`):
- success → `comments` are newest-first and complete; `isLoading` false; `loadError` null.
- given comments out of order in the response → returned array is sorted descending by `created`.
- failure → `loadError` set, `comments` empty.
- `refresh()` → triggers a second fetch and updates state.
- changing `issueKey` → fetches the new key; late response from old key does not overwrite.

## 2. Component: `<CommentThread state={...} />` (or explicit props)

**Location**: `client/src/components/CommentThread/CommentThread.tsx`

**Props contract**:
```ts
interface CommentThreadProps {
  comments: JiraComment[];       // already ordered newest-first by the hook
  isLoading: boolean;
  loadError: string | null;
  emptyLabel?: string;           // defaults to shared "No comments yet."
}
```

**Rendering contract**:
- `isLoading` → single loading line (shared label).
- `loadError` → single error line (shared error style).
- `comments.length === 0` → single shared empty state.
- otherwise → a **scrollable** list (`max-height` bounded, `overflow-y:auto`) of every comment, each
  showing author, date (`created` truncated to `YYYY-MM-DD`), and normalized plain-text body.
- Comment bodies **wrap** (`white-space:pre-wrap`) and never overflow the window (FR-006).
- Presentation is identical regardless of consumer (FR-003).

**Test contract** (`CommentThread.test.tsx`):
- renders all N comments (not a capped subset) in the given (newest-first) order.
- renders the shared empty/loading/error states for those inputs.
- a very long body stays contained (assert the scroll container class / pre-wrap).

## 3. Theme token contract (`tokens.css`)

- Any new depth token (e.g. `--field-elevation-bg`, `--field-elevation-border`,
  `--field-elevation-shadow`, `--comment-window-bg`) MUST be defined under **both** `:root` and
  `[data-theme="light"]`.
- Fields (text boxes, inputs) and the comment window MUST be visibly distinct from the window
  background in both themes, using these tokens — not hardcoded colors.
- Text over treated surfaces MUST meet **WCAG 2.1 AA** (≥4.5:1 body, ≥3:1 large/boundary) in each
  theme; measured ratios recorded in the PR/CHANGELOG.
- Switching `data-theme` MUST update the treatment with no location left in the wrong theme (FR-009).

## 4. Consumer contract (each comment-display location)

Each of Story Pointing, Sprint Dashboard (pointing-row expansion), DSU board overlay, and
`IssueDetailPanel`:
- MUST obtain comments only via `useIssueComments(issueKey)` (no reliance on in-payload comments).
- MUST render them only via `CommentThread`.
- MUST NOT retain any "latest comment" / "last N" bespoke rendering after the switch.
- `IssueDetailPanel` MUST wire its post-comment success to `refresh()`.
