# Quickstart Validation — Hygiene Fix Workspace (019)

Runnable checks proving the feature end-to-end. Contracts: [issue-meta-chips](./contracts/issue-meta-chips.md),
[issue-context-panel](./contracts/issue-context-panel.md), [cleanup-session](./contracts/cleanup-session.md).

## Prerequisites

- `npm install` at repo root and in `client/` (skipped automatically when lockfiles unchanged)
- No live Jira needed — unit tests mock the API; e2e stubs the proxies (existing harness, port 5556)

## Unit gates

```powershell
cd client
npx vitest run src/components/IssueMeta src/utils/richTextStructured.test.ts `
  src/components/IssueDetailPanel src/views/Hygiene
npx tsc -b
npx eslint src/components/IssueMeta src/components/IssueDetailPanel src/views/Hygiene src/utils
```

Expected: all green. Vocabulary tests cover every tone branch + unknown fallbacks + initials rules; parser tests
cover headings/lists/paragraph fallback; panel tests cover each context block present/omitted + FR-010 regressions;
session tests cover outcome precedence, typing guard, and the four-bucket summary.

## E2E gates (real browser)

```powershell
cd C:\ProjectsWin\NodeToolbox
npx playwright test test/e2e/hygiene-session.spec.js
```

Expected: session flow (arrow / skip / comment → honest summary), typing guard, and A++/narrow layout checks pass
per the cleanup-session contract's E2E gates.

## Manual glance test (SC-001 / SC-005)

1. `npm start`, open the Team Dashboard → Hygiene, run a scan with findings (or seed via the e2e stubs).
2. Expand a finding: within 5 seconds, without reading body text, name the issue's type, status, priority, owner,
   and age — each must be identifiable by its chip.
3. Confirm the linked-issues block shows each link's key and ITS status chip (the reporter's ENCUC-2163 case: the
   linked INC/PRB explains the staleness without opening Jira).
4. Confirm a structured description ("Day one:" style) renders with bold run-ins and lists, not a flat wall.
5. Toggle Light theme and A++: chips remain readable, nothing clips, blocks with no data are absent entirely.

## Release gate

Production build must stay clean:

```powershell
cd client && npm run build
```
