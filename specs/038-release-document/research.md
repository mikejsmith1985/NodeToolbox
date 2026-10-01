# Research: Release Document (038)

All decisions below were checked against the code on `main` at v0.283.0 (2026-10-01).

## R-1 Where the children come from

- **Decision**: The team project's issues with the chosen fixVersion, fetched with the existing `fetchIssuesPaged`
  (`services/fetchIssuesPaged.ts:43`) — every page, no 50-issue cap.
- **Rationale**: The team project is the one place a team's work is unambiguous; the Releases tab's single
  `maxResults=50` search (`SprintDashboardView.tsx:5826`) would silently truncate (SC-002).
- **Alternatives**: Reuse the Releases tab loader — rejected, it is inline in a 7,000-line view and capped at 50.

## R-2 How Epics are found across projects

- **Decision**: Three steps. (1) Each child's parent key via `extractFeatureKeyFromIssueFields`
  (`utils/featureLink.ts:77`), which already covers the configured feature link, Epic Link and native `parent`.
  (2) Fetch those parents by key. (3) In the parent projects found in (2) plus the team's feature projects
  (`loadTeamFeatureScope`, `rollupBoard/boardScopeStore.ts:41`, falling back to `readArtFeatureScopeSettings`), search
  for issues whose own fixVersion has the same name, and keep only those with a child in the team project.
- **Rationale**: CUC's Epics live in DASP and DENP while children live in ENCUC; Transformers' Epics in DENP, children
  in ENFCT. Searching the team project for Epics finds nothing.
- **Issue type**: Step 3 does not filter by issue type name at all — DENP renamed Feature→Epic and CLAUDE.md forbids
  `loadFeatureIssueTypeNames()` for that reason. "Has a child in the team project" is the real test of an Epic here.
- **fixVersion is per project**: a name that does not exist in a project makes JQL 400. Step 3 queries project by
  project and treats a 400 as "this project has no such version", never as a failure of the whole document.
- **Children of step-3 Epics that lack the version**: found with `parent in (…)` plus the resolved Epic Link field id
  (`cf[<id>] in (…)`), id passed in as data — new modules stay field-blind (fieldMappingBoundary ratchet).

## R-3 Misalignment

- **Decision**: Compare fixVersion **names** (spec clarification): flag an Epic with no fixVersion, an Epic whose
  names differ from the release, and an Epic in this release whose team children carry another version or none.
- **Rationale**: Per-project versions with the same name are the same release in practice.

## R-4 Page title

- **Decision**: `YYYYMMMDD` with a three-letter English month (e.g. `2026Oct14`) from the version's `releaseDate`, else
  from its name when it is `MM/DD/YYYY`; neither → "needs a release date", not published.
- **Rationale**: User decision 2026-10-01. Team pages live in separate spaces, so the bare date is unique.

## R-5 Keeping hand-entered data across refreshes and moves

- **Decision**: Every save **reads the current page first**, parses the hand-entered parts — the Deployment Steps
  table and a per-item **Notes** column — merges fresh Jira rows, and writes the whole page back.
- **Rationale**: The release-notes publisher (`releaseNotesConfluence.ts:117`) overwrites the body; that would erase
  deployment steps. PI Review proves the read→merge→write pattern (`PiReviewTab.tsx:2081-2125`).
- **Moves (FR-011)**: Deployment steps belong to a release, so they stay with their page. The per-item Notes column is
  the hand-entered data attached to an item: "Sync all" reads every unreleased page first, collects notes by issue key,
  and writes each note wherever the item now belongs.
- **Locating tables**: by header labels (`piReviewTable.ts:936/948` pattern). Confluence strips `data-` attributes
  (`piReviewTable.ts:455`), so markers are not relied on.

## R-6 Version conflicts

- **Decision**: On "Version must be incremented", re-read the page, re-merge, and retry once (PI Review's pattern). The
  check is a small new shared helper, because PI Review's `isConfluenceVersionConflictError` is private to a 3,300-line
  tab that must not be refactored. *Drift note recorded at the helper.*

## R-7 Where it lives in the UI

- **Decision**: A new Team Dashboard tab, **Release Doc**, in its own folder `views/SprintDashboard/releaseDocument/`,
  mounted additively (tab list, tab union, one dispatch line) — the `RollupBoardTab` / `ForecastTab` precedent.
- **Rationale**: `SprintDashboardView.tsx` takes additive edits only (CLAUDE.md).
- **Editor**: No shared editable-table component exists; the Deployment Steps editor copies PI Review's
  confidence-vote row-card pattern and reuses `SprintDashboardView.module.css` classes.

## R-8 Parent page memory

- **Decision**: A new per-team key `tbxReleaseDocumentParents`, keyed by team profile id, beside (not shared with)
  release notes' `tbxReleaseNotesConfluenceParents`.
- **Rationale**: Release notes and release documents are different page trees; sharing one parent would mix them.
  The `tbx` prefix keeps it in Settings Backup.

## R-9 Released versions

- **Decision**: Only unreleased, unarchived versions are ever listed or synced, so a released version's page is never
  touched (FR-012) — no "frozen" flag to store.
