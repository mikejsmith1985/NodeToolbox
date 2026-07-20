# Contract: US2 — Verifiable Hygiene Nodes (Jira JQL links)

Covers FR-005..008, SC-002, NFR-002.

## Per-family JQL clause

- Each hygiene check exposes a `jqlClause` (co-located with its predicate in `hygieneChecks.ts`) — the family's
  condition as JQL, using `buildJqlFieldReference`/`readConfiguredPiFieldId` for field ids. Examples:
  - `missing-fix-version` → `fixVersions is EMPTY AND issuetype in (Story, Task, Defect, Feature, Epic)`
  - `missing ownership` → `assignee is EMPTY AND <configured PO field> is EMPTY`
  - `missing estimate` → `<estimate field> is EMPTY`
  - (one clause per shipped family)

## Full JQL + link

- `buildHygieneCheckJql(checkId, scope, fieldConfig)` in `utils/buildHygieneJqlUrl.ts` returns
  `"(<scopeJql>) AND (<familyClause>)"`, where `scopeJql` is the SAME scope `buildHygieneSearchPath` uses.
- `buildJiraIssueNavigatorUrl(jql, jiraBaseUrl)` (extended to accept a raw JQL string) →
  `${base}/issues/?jql=${encodeURIComponent(jql)}`; empty base → a well-formed relative `/issues/?jql=...`.

## Tile affordance (HygieneView)

- Each tile (overall scope tile + every per-check family tile) renders a distinct **"open in Jira ↗"** anchor
  (`target="_blank"`, `rel="noreferrer"`).
- The tile's existing `onClick` (in-app finding filter) is UNCHANGED — the Jira affordance is additive.
- The existing copy-JQL affordance (`handleCopyCheckJql`) remains, so the JQL is inspectable (FR-007).
- A zero-finding tile still renders a valid link (opens a zero-result search) — FR-008.

## Agree-by-construction (NFR-002)

- The link's scope + family clause are derived from the same configuration and the same type constant the scan uses;
  the count and the Jira result set MUST match for the same scope.

## Tests

- Unit: each `jqlClause` emits the expected JQL (field ids, EMPTY conditions, type list); `buildHygieneCheckJql`
  composes scope AND clause; `buildJiraIssueNavigatorUrl` encodes + handles empty base.
- e2e (`hygiene-jira-links.spec.js`): the fix-version tile shows count N; clicking "open in Jira ↗" opens
  `/issues/?jql=...` whose JQL contains the family clause; a stubbed Jira search for that JQL returns N (count agrees).
