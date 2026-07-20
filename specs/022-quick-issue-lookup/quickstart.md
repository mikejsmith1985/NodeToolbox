# Quickstart & Validation: Quick Issue Lookup

Validation guide proving the feature end-to-end. Implementation details live in `tasks.md`; this is the run/verify
guide. Client-only feature; Jira is stubbed in the e2e harness.

## Prerequisites

- Repo on branch `feature/022-quick-issue-lookup`.
- Dev client running via the project's dev command (see `package.json` scripts — do not hardcode).
- e2e harness under `test/e2e/` (Playwright) with the standard Jira stub used by the shipped detail-panel specs.

## Unit validation (fast, red-first)

Run the client unit suite (vitest). These pure units must be written failing first, then implemented:

- `normalizeIssueKey`: ` encuc-1234 ` → `ENCUC-1234`; `.../browse/ENCUC-1234` → `ENCUC-1234`; `hello world` → `null`.
- `buildIssueLookupPath`: emits the exact `fields=` list incl. the resolved story-point field id.
- `buildRecentIssues`: empty-add, cap-at-5, re-add-moves-to-top, summary-refresh.
- `fieldEditorPayloads`: each field's value → the payload its `featureReviewFixes` writer expects (option match,
  labels array set, user field, simple field).

Expected: all green, each pure test < 10ms.

## End-to-end validation (Playwright — `test/e2e/quick-issue-lookup.spec.js`)

Each scenario maps to a Success Criterion / FR.

| # | Scenario | Proves |
|---|----------|--------|
| E1 | From an arbitrary route, press **F2** → popup opens with the input focused; type `ENCUC-1234` → **Enter** → detail renders. Measure open→visible. | SC-001, FR-001/002, NFR-001 |
| E2 | With the issue shown, assert type/status/priority/assignee/age/description visible without scrolling. | SC-002, FR-005/011 |
| E3 | Change **status**, **assignee**, **priority**, **story points**; each shows a confirmation, panel reflects the new value, popup never closes, no reload. | SC-003, FR-008/010 |
| E4 | Click the issue **key** → a new tab opens at the Jira browse URL for that exact key. | SC-004, FR-007 |
| E5 | Search `ENCUC-9999999` → "No issue found"; a no-permission key → distinct "no access"; `hello world` → inline hint, no fetch. | SC-005, FR-012 |
| E6 | Paste ` encuc-1234 ` and a `/browse/ENCUC-1234` URL → both resolve to the same issue. | FR-003 |
| E7 | View 6 different issues; reopen F2 → recents shows the last 5, most-recent-first; selecting one reopens it. Reload page → recents persist. | FR-002a |
| E8 | With an issue shown, type a new key in the persistent bar → detail swaps in place. Press F2 while open → search input re-focused/cleared, no second popup. | FR-007a, FR-001 |
| E9 | Description edit is not offered (read-only); attempting shows no editor. | FR-009 |
| E10 | Run E1–E3 at A/A+/A++ and in light + dark and at narrow width → layout reflows, nothing clips, chips keep text labels. | NFR-003/004 |
| E11 | Regression: render `IssueDetailPanel` in a hygiene/AgileHub context (no `fieldEditing` prop) → identical to pre-feature behavior. | plan Structure Decision (byte-identical) |

## Definition of done (validation)

- All unit tests green; E1–E11 pass in the e2e harness with captured evidence (Article X — no asserted-only UX
  claims).
- `IssueDetailPanel` callers without the `fieldEditing` prop are visually unchanged (E11).
- CHANGELOG updated in the implementation PR.
