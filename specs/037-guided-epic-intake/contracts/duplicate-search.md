# Contract: Duplicate Search ("Check DENP")

**Module**: `intake/duplicateSearch.ts`. The JQL builders are pure; `runDuplicateSearch` takes its Jira calls as
injected dependencies. **Covers**: FR-017 – FR-019, US3-1/4/5/7.

## 1. Exports

```ts
export const DUPLICATE_SEARCH_MAX_RESULTS = 20;
export const DESCRIPTION_EXCERPT_MAX_CHARS = 400;

export function buildDuplicateSearchJql(projectKey: string, epicTypeName: string, searchTerms: readonly string[]): string | null;
export function classifyNamedKeyLookup(issue: JiraIssue | null, httpStatus: number | null, targetProjectKey: string, epicTypeName: string): NamedKeyLookup;
export async function resolveEpicType(projectKey: string, deps: { getProjectIssueTypes }): Promise<EpicTypeResolution>;
export async function runDuplicateSearch(intake: EpicIntake, deps: DuplicateSearchDeps): Promise<EpicIntake>;
```

`DuplicateSearchDeps = { searchIssues(jql, fields, maxResults), fetchIssueByKey, extractHttpStatus }`. Production wires
these to `jiraGet` / `services/issueLookup.ts`, and tests mock them.

## 2. Epic type (`resolveEpicType`)

- `getProjectIssueTypes('DENP')` → pick the non-subtask type whose name equals `Epic` (`EPIC_ISSUE_TYPE_NAME`,
  case-insensitive).
- If found → `{ state: 'resolved', id, name }`, with the name spelled the way the instance spells it.
- If not found → `{ state: 'missing', offeredTypeNames }`. Creation is blocked and the PO sees what DENP offers. The
  search is also blocked, and every item is marked `searchStatus: 'failed'` with that reason.
- On a request error → `{ state: 'error', reason }`, with the same blocking.
- **Never** falls back to `Feature` or any assumed name (R-007).

## 3. Per item (only items with `owner = enrollment` and an open `duplicate` slot)

**A. Named keys, fetched individually**:

| Fetch outcome | `NamedKeyLookup` | Effect |
|---|---|---|
| 200, project = DENP, type = Epic, status category ≠ Done | `openEpicInTarget` | added to candidates (`foundBy: 'namedKey'`); **the `duplicate` slot settles `existing` by rule** (US3-4), reason `Notes name DENP-632` |
| 200, Done | `unusable/done` | PO question: use anyway / create new / not actionable (US3-5) |
| 200, not an Epic | `unusable/notEpic` | same PO question |
| 200, other project | `unusable/otherProject` | reported; PO decides actionability (edge case) |
| 404 | `unusable/notFound` | same PO question |
| 401 / 403 | `unusable/noPermission` | same PO question |
| other error | `unusable/error` | **item `searchStatus: 'failed'`**, so it cannot be created |

With two open named DENP Epics on one item, the slot is **not** settled by rule; both become candidates for the match
round.

**B. Text search** (skipped when step A settled the slot):

```
project = "DENP" AND issuetype = "<name>" AND statusCategory != Done
AND ((summary ~ "<t1>" OR description ~ "<t1>") OR (summary ~ "<t2>" OR description ~ "<t2>") …)
ORDER BY updated DESC
```

- **Term values**: sanitised via `utils/jqlTextTerms.ts` (reserved-character strip, no wildcard) and quoted via
  `escapeJqlValue` (`utils/jqlValue.ts:14`).
- **Parentheses**: the whole OR group is wrapped so `statusCategory != Done` binds to every term. This is the
  `useCheckInIssues.ts:35` lesson; the unwrapped form returns closed issues.
- **No terms**: if no term survives sanitising, `buildDuplicateSearchJql` returns `null`, and the rule fallback terms
  (the item title's words of ≥ 3 characters) are used instead.
- **Fields requested**: `summary,status,description,issuetype`.
- **Candidate order**: candidates are de-duplicated against the named-key ones and kept in Jira's order (most recently
  updated first).

**Outcome**:

- Zero candidates and a successful search → the `duplicate` slot settles `createNew` by rule, reason
  `No open DENP Epic matched "<terms>"`.
- A failed request → `searchStatus: 'failed'`, `searchFailureReason = Jira's message`. The item cannot be created
  (INV-4), and **Check DENP** can be re-run for failed items only.

## 4. Execution

- Items are searched **sequentially**. With ~15 Enrollment items that is ≤ 30 requests, and it keeps load on DENP
  polite.
- The intake is saved after **each** item, so a closed tab loses at most one item's search.
- Progress `Checked 6 of 14` is shown on the Check DENP step.

## 5. Tests (all mocked)

- JQL shape, quoting, parenthesisation, and term sanitising. A summary like `ENCUC-1972: Critical` does not produce a 400
  shape.
- Every row of the named-key table.
- A mocked `Feature`-only project → `missing`, and no query naming `Feature` is ever built.
- A failed search blocks create (via the engine's INV-4).
