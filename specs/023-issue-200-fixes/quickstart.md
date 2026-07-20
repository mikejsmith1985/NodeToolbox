# Quickstart & Validation: Issue #200 Review Fixes

Validation guide for the six fixes. Implementation details live in `tasks.md`; this is the run/verify guide.
Client-only (US1 may also touch the server hygiene rule); Jira is stubbed in the e2e harness.

## Prerequisites

- Branch `feature/023-issue-200-fixes` (worktrees per track — see plan Structure Decision).
- Client dev/build per `package.json`; e2e via Playwright (`test/e2e/`), stubbing `**/jira-proxy/**`.

## Unit validation (fast, red-first)

Run the client unit suite (vitest); these pure units are written failing first:
- `carriesFixVersion` / `checkMissingFixVersion`: Story/Task/Defect/Feature/Epic flagged when fixVersions empty;
  Sub-task and any-with-fixVersion not flagged.
- each check's `jqlClause` + `buildHygieneCheckJql` + `buildJiraIssueNavigatorUrl`: correct JQL + encoding.
- `quickLookupStore`: `open()` / `open(key)` / `close()` reducer.
- `myIssuesRoleLens` + roster-role→default-lens + subject→assignee-JQL.
- PO PI option selection → `selectedPiName`.

Server (US1 parity, if applicable): `npm test` (Jest) stays green.

## End-to-end validation (Playwright)

| # | Scenario | Proves |
|---|----------|--------|
| H1 | Seed a PI with mixed-type issues missing fixVersion → the "Missing Fix Version" tile shows N (not 0). | SC-001, US1 |
| H2 | Click a tile's "open in Jira ↗" → opens `/issues/?jql=…` containing the family clause; a stubbed Jira search for that JQL returns the same count. | SC-002, US2, NFR-002 |
| H3 | Tile click still applies the in-app filter (unchanged). | US2 no-regression |
| L1 | Open an issue with a linked ticket → click the linked key → the F2 lookup opens on that issue; closing returns to the view. | SC-003, US3 |
| L2 | Pressing F2 still behaves exactly as feature 022 (regression). | US3 NFR-003 |
| P1 | PO Tool PI is a `<select>` populated for the team; picking updates the tool; switching teams refreshes options. | SC-004, US4 |
| R1 | Remediation shows each item's context beside its buttons; a decision persists; a pending item shows loading, not blank. | SC-005, US5 |
| M1 | Search + select another Jira user → report reflects them + a "Viewing as" banner; Back to me restores. | SC-006, US6 |
| M2 | Switch role lens (Dev→SM) → emphasized sections change; SM/PO switch to a team → report covers the team. | SC-006, US6 |
| X1 | Run the above across light/dark, A/A+/A++, narrow width → reflow-not-clip, text beside color. | NFR-001 |

## Definition of done (validation)

- All unit tests green; H1–X1 pass with captured evidence (Article X — the H2 count-agreement is asserted, not
  claimed). Shipped-surface regressions ruled out (L2 for the F2 lookup; IssueDetailPanel callers unaffected).
- CHANGELOG updated per story.
