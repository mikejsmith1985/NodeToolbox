# Phase 1 Data Model: Issue #200 Review Fixes

Client-side models across the six stories. No server schema changes (US1 may adjust a shared server rule's constant).

## Hygiene check family (US1, US2)

One named hygiene condition; the tile count and the Jira link are both derived from it (agree by construction).

| Field | Type | Notes |
|-------|------|-------|
| `checkId` | string | e.g. `missing-fix-version` (existing `HYGIENE_CHECK_IDS`) |
| `predicate(issue)` | `(JiraIssue) => Finding \| null` | existing per-check predicate in `hygieneChecks.ts` |
| `issueTypeScope` | `readonly string[]` | for missing-fix-version: `FIX_VERSION_ISSUE_TYPE_NAMES` = Story, Task, Defect, Feature, Epic |
| `jqlClause(fieldConfig)` | `() => string` | **new**, co-located with the predicate: the family condition as JQL (e.g. `fixVersions is EMPTY AND issuetype in (...)`) |

**Rule (NFR-002)**: `issueTypeScope` is a single constant consumed by BOTH `predicate` and `jqlClause` — they cannot
disagree. Sub-tasks are never in a fix-version scope.

## Hygiene scope (US2)

The PI/team/project scope the scan runs within; shared by the count and the generated JQL.

| Field | Type | Notes |
|-------|------|-------|
| `piName` / `piFieldId` | string | resolved via `readConfiguredPiFieldId` |
| `projectOrRosterScope` | string | the same scope `buildHygieneSearchPath` uses |
| `scopeJql()` | `() => string` | the scope clause both the scan path and the Jira link reuse |

## Lookup open request (US3)

Imperative request to open the Quick Issue Lookup, optionally seeded with a key.

| Field | Type | Notes |
|-------|------|-------|
| `isOpen` | boolean | store-owned (was gate-local) |
| `seedKey` | `string \| null` | preset lookup key; null when opened via F2 |
| `openNonce` | number | bumped per open so a repeat open re-seeds/re-focuses |
| `open(key?)` | action | F2 → `open()`; linked-issue click → `open(key)` |
| `close()` | action | Escape / close button |

## PI option set (US4)

Available Program Increment names for the selected PO team.

| Field | Type | Notes |
|-------|------|-------|
| `availablePiNames` | `string[]` | from `loadAvailablePiNamesFromJira(piReviewTeams)` |
| `isLoading` | boolean | drives the loading/disabled state |
| `selectedPiName` | string | persisted via `usePoToolState` (`tbxPoToolSelection`) |
| `loadError` | `string \| null` | on failure → reload + manual-entry fallback |

## Remediation item (US5)

One issue under remediation with its co-located decision context.

| Field | Type | Notes |
|-------|------|-------|
| `issueKey` | string | |
| `verdict` | existing | from the remediation engine (unchanged) |
| `context` | `{ status, assignee, summary, acceptanceCriteria } \| 'loading' \| 'unavailable'` | from `issuesByKey`, hydrated on load; rendered beside the action buttons |
| `actions` | Keep / Dismiss / Snooze / Cancel | unchanged engine + persistence |

## Report subject & role lens (US6)

Who the My Issues report is about, and the lens applied.

| Field | Type | Notes |
|-------|------|-------|
| `subject` | `{ kind: 'viewer' } \| { kind: 'user', accountId, displayName } \| { kind: 'team', teamName }` | drives the assignee JQL |
| `assigneeJql()` | `() => string` | viewer → `currentUser()`; user → `assignee = "<accountId>"`; team → `assignee in (<members>)` |
| `roleLens` | `'dev' \| 'tester' \| 'sm' \| 'po'` | defaults from the subject's roster `roleCapabilities`; manually overridable; unset → default |
| `emphasizedCriteria` | derived | pure `myIssuesRoleLens(roleLens)` → sections/criteria to emphasize |

## Roster member / role (US6, reused)

From `useStandupRosterStore` — no new model.

| Field | Type | Notes |
|-------|------|-------|
| `displayName`, `assigneeQueryValue`, `jiraAccountId` | string | identity |
| `teamName` | string | membership for team views |
| `roleCapabilities` | `{ canDevelop, canInternalTest, canExternalTest, canScrumMaster?, canProductOwner?, ... }` | drives the default role lens |
