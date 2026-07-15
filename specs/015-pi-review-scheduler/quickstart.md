# Quickstart & Validation: Scheduled PI Review Save to Confluence

Runnable validation that proves the feature end-to-end. Behavior evidence, not "it compiled" (Constitution X).

## Prerequisites

- NodeToolbox server running with working `configuration.jira` and `configuration.confluence` credentials (the same
  ones the manual PI Review save uses — verify a manual "Save to Confluence" works first).
- At least one PI Review Confluence page already created via the app, with a recognizable PI Review table and some
  human-curated content (a capacity snapshot, a couple of rows with manual carry-over/committed/notes).
- A team whose Product Owner assignee value and PI field id / PI name are known.

## Build & test commands

```bash
# Server-side unit tests (refresh run + config + engine seams)
npm test                              # jest, src/ (node env)

# Client-side unit tests (DOM-seam refactor of piReviewTable.ts + panel)
cd client && npx vitest run

# Full server + client build sanity
cd client && npm run build            # tsc -b + vite build
```

## Unit-level validation (fast, mocked — the core proof)

Run against the shared engine and the refresh orchestration with injected deps (no network, `nowIso` fixed):

1. **Engine DOM-agnostic (R1)** — `piReviewTable` produces identical output under the native DOM (existing client
   tests) and under linkedom (new server test): parse → append → reconcile → write round-trips a known storage body.
2. **INV-1 (no-op on empty)** — `refreshPiReviewPage` with a Jira search returning `[]` returns `no-op` and the PUT is
   never called; the storage body is unchanged.
3. **INV-2/INV-3 (preserve vs. refresh)** — given a page body with manual columns + capacity + boundary + grouping +
   confidence, and a Jira issue map that changes priority/estimate/dependency/risks, the written body differs **only**
   in those cells (+ appended rows) and is byte-identical elsewhere.
4. **INV-4 (conflict retry)** — a mocked Confluence PUT that returns a version conflict once then succeeds results in
   exactly one re-GET + re-PUT and a `success`; a PUT that always conflicts returns `failed` and never overwrites.
5. **INV-5 (no removal) + append** — a feature on the page that no longer matches the query stays; a new matching
   feature is appended once (deduped by key).
6. **Skip/skip-reasons** — blank PO → `skipped`; disabled team → not run; missing Confluence creds → `failed`.

## End-to-end validation (Admin Hub, real page)

**Scenario A — Run now refreshes without a browser tab open on PI Review**
1. Admin Hub → **PI Review Scheduler** panel → add a team: enable, set a time, enter PO assignee, PI field id, and one
   page (URL + PI name). Save.
2. In Jira, change a feature's estimate or a dependency link for a feature on that page.
3. Click **Run now** for the team.
4. **Expect**: result shows `success` with a timestamp; open the Confluence page → the changed estimate/dependency is
   reflected; **all** manual columns, the capacity block, boundary, grouping, and confidence votes are unchanged.

**Scenario B — Preserve on no-op**
1. Configure a team whose PO+PI query returns **no** Features (e.g. a PI with none assigned to that PO).
2. **Run now**.
3. **Expect**: result `no-op` ("No Features found … page left unchanged"); the page's existing rows are intact (table
   not emptied).

**Scenario C — Scheduled fire + catch-up**
1. Set a team's schedule time to 1–2 minutes ahead; leave the app with no PI Review tab open.
2. **Expect**: at that minute the page refreshes (status updates in the panel). Restart the server *after* the minute
   but same day with the team still due → it runs once (catch-up), and does **not** run twice.

**Scenario D — Manual button unaffected (no regression)**
1. Open the PI Review tab and click **Save to Confluence** as before.
2. **Expect**: identical behavior to before this feature; a subsequent scheduled run and the manual save agree on the
   Jira-owned columns (no drift).

**Scenario E — Conflict safety**
1. Open the Confluence page for edit (advance its version) between a Run-now's GET and PUT (or edit + save in the app,
   then immediately Run now against a stale copy).
2. **Expect**: the run retries once against the newest version; if it still conflicts it reports a conflict and the
   human edit is not overwritten.

## Success mapping

| Scenario | Requirements | Success Criteria |
|---|---|---|
| A | FR-006, FR-007, FR-017–019 | SC-001, SC-005 |
| B | FR-010 | SC-003 |
| C | FR-001, FR-003 | SC-001 |
| D | FR-021, FR-022 | SC-007 |
| E | FR-009 | SC-006 |
| Unit 3 | FR-007, FR-008 | SC-002 |
| Skip reasons | FR-014, FR-016 | SC-008 |
