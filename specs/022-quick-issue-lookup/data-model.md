# Phase 1 Data Model: Quick Issue Lookup

All models are client-side. Only the recents list is persisted (localStorage); everything else is transient view
state. No server schema changes.

## Issue lookup query

The raw text a user typed and the normalized key derived from it. Lives for one search action.

| Field | Type | Notes |
|-------|------|-------|
| `raw` | `string` | Exactly what the user typed/pasted |
| `key` | `string \| null` | Normalized: trimmed, upper-cased, extracted from a `/browse/<KEY>` URL if present; `null` when the input does not match `^[A-Z][A-Z0-9]+-\d+$` |

**Validation**: `key === null` ⇒ show inline hint, do not fetch (FR-012). Produced by the pure `normalizeIssueKey`.

## Loaded issue

The result of fetching one issue by key; the object handed to `IssueDetailPanel`.

| Field | Type | Notes |
|-------|------|-------|
| `issue` | `JiraIssue \| null` | The full issue (`types/jira.ts`); already carries summary/status/priority/assignee/issuetype/description/issuelinks/labels/fixVersions/parent/comment + story-point custom fields |
| `status` | `'idle' \| 'loading' \| 'loaded' \| 'not-found' \| 'no-permission' \| 'error'` | Drives the honest-state UI (FR-012); distinct not-found vs no-permission from the fetch response |
| `refetch()` | action | Re-runs the fetch after an edit so the panel reflects the write (FR-010) |

**Lifecycle**: `idle → loading → (loaded | not-found | no-permission | error)`; a new search from the persistent bar
resets to `loading` and swaps in place (FR-007a).

## Editable field set

The per-issue mapping of which fields are editable and which writer each edit delegates to. Derived from the issue's
editmeta, not hard-coded.

| Field | Editor control | Delegates write to | Editable when |
|-------|----------------|--------------------|---------------|
| Summary | `TextFieldEditor` | `saveFeatureReviewSimpleField` | always (editmeta permitting) |
| Assignee | `AssigneeFieldEditor` | `saveFeatureReviewUserField` | editmeta exposes assignee |
| Priority / single-selects | `SelectFieldEditor` | `saveFeatureReviewOptionField` | editmeta exposes options |
| Fix versions | `SelectFieldEditor` | `saveFeatureReviewFixVersion` | editmeta exposes fixVersions |
| Issue link (key) | `TextFieldEditor` | `saveFeatureReviewIssueLinkField` | always |
| Labels | `LabelsFieldEditor` | `saveFeatureReviewSimpleField` (array set) | editmeta exposes labels as settable; else **read-only fallback** |
| Story points | *(existing panel editor)* | `saveFeatureReviewStoryPoints` | as today |
| Status | *(existing panel editor)* | `saveFeatureReviewTransition` (+ `TransitionRequiredFields`) | as today |
| Description | — read-only — | — | never (clarified; Jira link is the escape hatch) |

**Rule**: every write path is an existing `featureReviewFixes.ts` function. The editors add control shape only.

## Recents list (persisted)

Ordered, de-duplicated, capped list of recently viewed issues. localStorage key `tbxRecentIssueKeys`.

| Field | Type | Notes |
|-------|------|-------|
| `entries` | `RecentIssue[]` | Most-recent-first, max length 5 |
| `RecentIssue.key` | `string` | Normalized issue key |
| `RecentIssue.summary` | `string` | Cached summary for display without a fetch |

**Operations** (pure reducer, red-first tested):
- `recordRecent(list, entry)` → prepend, de-dupe by `key` (existing key moves to top), `slice(0, 5)`.
- Seed from localStorage on store creation; mirror to localStorage on every change (hand-rolled `try/catch`, per
  `todoStore`/`settingsStore` convention).

**Ephemerality**: client-only, never synced to the server; disposable convenience data (spec clarification).
