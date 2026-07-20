# Contract: Lookup Shell & Fetch-One-Issue-By-Key

Covers FR-001, FR-002, FR-002a (invocation), FR-003 (normalization), FR-004 (close), FR-007a (swap-in-place),
FR-012 (honest states), and the new data path.

## Invocation & shell (`QuickIssueLookupGate`)

- Mounted **once** in `App.tsx`, sibling to `<TodoQuickAddGate/>`. Attaches a `window` `keydown` listener.
- **F2** → `preventDefault()` + open the popup. Popup is `role="dialog" aria-modal="true"` with a backdrop; the
  search input receives focus on open (no click). — FR-001, NFR-001
- **F2 while open** → re-focus and clear the search input; never stack a second popup. — FR-001
- The global handler **ignores F2** when `document.activeElement` is an input/textarea/contenteditable *outside* the
  popup. — NFR-005 (keyboard guard)
- **Escape** → close non-destructively; underlying view untouched, focus returns to prior context. — FR-004

## Search bar (`IssueSearchBar` + `normalizeIssueKey`)

- One text input + a **Search** button. **Enter** in the input and clicking **Search** are identical. — FR-002
- Input is passed through pure `normalizeIssueKey(raw) → { key: string | null }`:
  - trim, collapse whitespace, upper-case;
  - if `raw` contains `/browse/<KEY>`, extract `<KEY>`;
  - validate `^[A-Z][A-Z0-9]+-\d+$`.
- `key === null` → inline hint "Enter an issue key like ABC-123"; **no fetch**. — FR-012
- While an issue is displayed, the same bar stays visible; a new valid key swaps the detail in place without closing
  or reloading. — FR-007a

## Recents (`RecentIssuesList`)

- With no key entered, the popup shows up to 5 recents (`key` + `summary`), most-recent-first. — FR-002a
- Click or **↑/↓ + Enter** re-opens a recent (triggers a fetch for its key). Blank on first-ever use.
- Backed by `useRecentIssuesStore` (see `recents-store.md`).

## Fetch-one-issue-by-key (`services/issueLookup.ts` + `hooks/useIssueByKey.ts`)

**`buildIssueLookupPath(key)`** (pure) →
```
/rest/api/2/issue/{KEY}?fields=summary,status,priority,assignee,issuetype,created,updated,duedate,description,issuelinks,labels,fixVersions,parent,comment,{storyPointFieldId}
```
- `{storyPointFieldId}` resolved via the existing story-point id resolution (`customfield_10016`/`customfield_10028`).
- No `expand`.

**`useIssueByKey(key)`** → `{ issue, status, refetch }` where `status` is
`idle | loading | loaded | not-found | no-permission | error`:

| Fetch outcome | `status` | UI |
|---------------|----------|-----|
| 200 | `loaded` | render `IssueDetailPanel`; record recent |
| 404 (issue does not exist) | `not-found` | "No issue found for KEY" |
| 403 / permission error | `no-permission` | "You don't have access to KEY" |
| network / 5xx | `error` | readable retryable error |
| in flight | `loading` | spinner; Escape still closes |

- On successful load, the issue's `key` + `summary` are recorded into recents.
- `refetch()` re-runs the GET (used after an edit — see `inline-field-editing.md`).

## Deep link (reuse `buildJiraBrowseUrl`)

- The rendered issue **key** is an anchor to `buildJiraBrowseUrl(key, jiraBaseUrl)` (`utils/jiraBrowseUrl.ts`),
  `target="_blank"`, opening that exact issue in Jira while the popup stays open. — FR-007

## Non-functional gates

- Instant open, keyboard-only operable end to end (F2 → type → Enter → edit → Escape). — NFR-001/002
- Light + dark themes; A/A+/A++ text sizes; narrow widths reflow not clip. — NFR-003
- No color-only meaning (inherits `IssueMeta` chips). — NFR-004
