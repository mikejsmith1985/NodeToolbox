# Tasks: Release Document (038)

**Input**: `specs/038-release-document/` — plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md
**Tests**: REQUIRED (constitution Article V — TDD). Every test task is written first and must fail before its
implementation task. All paths are under `client/src/` unless stated.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Create folder `views/SprintDashboard/releaseDocument/` and confirm baseline green: `cd client && npx vitest run`, `npx tsc -b`

---

## Phase 2: Foundational (blocks every story)

- [X] T002 [P] Test `services/confluenceVersionConflict.test.ts`: true for an error whose message contains "Version must be incremented on update" (and a `ConfluenceRequestError` 409), false otherwise
- [X] T003 [P] Implement `services/confluenceVersionConflict.ts` `isConfluenceVersionConflict(error: unknown): boolean` with the R-6 drift comment
- [X] T004 [P] Test `views/SprintDashboard/releaseDocument/releaseTitle.test.ts`: `2026-10-14` → `2026Oct14`; name `10/14/2026` with no date → `2026Oct14`; neither → null; every month abbreviation
- [X] T005 [P] Implement `views/SprintDashboard/releaseDocument/releaseTitle.ts` `formatReleasePageTitle({ releaseDate, name }): string | null`
- [X] T006 [P] Test `views/SprintDashboard/releaseDocument/releaseDocumentParentStore.test.ts`: read/write per team profile id under `tbxReleaseDocumentParents`; blank clears; corrupt value → ''
- [X] T007 [P] Implement `views/SprintDashboard/releaseDocument/releaseDocumentParentStore.ts` (`readReleaseDocumentParent`, `writeReleaseDocumentParent`)

**Checkpoint**: shared helpers green.

---

## Phase 3: User Story 1 — Publish a release document (P1) 🎯 MVP

**Goal**: pick an unreleased version and publish its page (Epics across projects + children).
**Independent test**: quickstart V-01–V-03, V-08.

- [X] T008 [P] [US1] Test `releaseDocument/releaseGather.test.ts` with injected `searchAll` / `fetchByKeys`: children from the team project only; Epics resolved from parent keys in DASP and DENP; orphans in a last "No Epic" group; unreadable Epic → `epic: null`; same-name Epic found per extra project and kept only with a team-project child; a 400 for one project → warning, not failure; groups sorted by key
- [X] T009 [US1] Implement `releaseDocument/releaseGather.ts` `gatherRelease(input, deps)` per contracts/gather.md (types `ReleaseItem`, `EpicGroup`, `ReleaseDocument` declared here; field ids passed as data)
- [X] T010 [P] [US1] Test `releaseDocument/releaseDocumentJira.test.ts`: `searchAll` pages via `fetchIssuesPaged` beyond 100; `fetchByKeys` chunks keys; field list includes `parent`, `fixVersions`, `project` and the feature-link candidates
- [X] T011 [US1] Implement `releaseDocument/releaseDocumentJira.ts` live deps (`jiraGet`, `fetchIssuesPaged`, `featureLinkCandidateFieldIds`, `resolveWriteFieldId('epicLinkFieldId')`, `loadTeamFeatureScope` / `readArtFeatureScopeSettings`)
- [X] T012 [P] [US1] Test `releaseDocument/releasePageStorage.test.ts` (build): "Last synced" line; `Release items` table headers Key · Summary · Type · Status · Assignee · Release check · Notes; Epic rows bold, child rows "↳ ", Key cells link to Jira; "No Epic" last; text escaped; no `data-` attributes
- [X] T013 [US1] Implement `buildReleasePageStorage(document)` in `releaseDocument/releasePageStorage.ts` per contracts/page-storage.md
- [X] T014 [P] [US1] Test `releaseDocument/releasePageSync.test.ts` (save): resolves parent → space → find by title → create child page, or update with version + 1; invalid parent → plain error, nothing written
- [X] T015 [US1] Implement `saveReleasePage` in `releaseDocument/releasePageSync.ts` with injected Confluence api
- [X] T016 [P] [US1] Test `releaseDocument/ReleaseDocumentTab.test.tsx`: parent input remembered per team; version `<select>` lists unreleased only with title preview; Pull from Jira renders groups; Save calls `saveReleasePage` and shows the page link
- [X] T017 [US1] Implement `releaseDocument/ReleaseDocumentTab.tsx` (styles from `SprintDashboard/SprintDashboardView.module.css`)
- [X] T018 [US1] Wire the tab additively: `'release-doc'` in `DashboardTab` (`views/SprintDashboard/hooks/useSprintData.ts`), "Release Doc" in `TAB_OPTIONS` and one dispatch line in `views/SprintDashboard/SprintDashboardView.tsx` passing `projectKey`, `teamProfileId`, `teamName`

**Checkpoint**: a release page can be published end to end.

---

## Phase 4: User Story 2 — Refresh without losing hand-entered data (P1)

**Independent test**: quickstart V-04.

- [X] T019 [P] [US2] Test `releasePageStorage.test.ts` (parse): reads Notes by Key cell and Deployment Steps rows verbatim; missing tables → empty; round trip `parse(build(doc))` preserves steps and notes
- [X] T020 [US2] Implement `parseReleasePageStorage(storageValue)` in `releaseDocument/releasePageStorage.ts` (DOM parser injectable; tables found by header labels)
- [X] T021 [P] [US2] Test `releasePageSync.test.ts` (merge): `readReleasePage` returns current body or null; save re-reads and merges hand-entered parts; version conflict → re-read, re-merge, retry once, then report
- [X] T022 [US2] Implement `readReleasePage` + merge-before-write + one conflict retry in `releaseDocument/releasePageSync.ts` (uses `isConfluenceVersionConflict`)
- [X] T023 [US2] Tab: on version select, load the saved page and merge its notes/steps into the gathered document; "Unsaved changes" badge; Notes cell editable per item (extend `ReleaseDocumentTab.test.tsx` first)

---

## Phase 5: User Story 3 — Record deployment steps (P1)

**Independent test**: quickstart V-03.

- [X] T024 [P] [US3] Test `releaseDocument/DeploymentStepsEditor.test.tsx`: add, edit each of the 12 fields, move up/down, remove; pasted text kept verbatim
- [X] T025 [US3] Implement `releaseDocument/DeploymentStepsEditor.tsx` and mount it in the tab
- [X] T026 [P] [US3] Extend `releasePageStorage.test.ts`: Deployment Steps table with the 12 headers; PR / Workflow run rendered as `<a>` only when a URL; "To be created" / "Does not matter" kept as text
- [X] T027 [US3] Implement the Deployment Steps table in `buildReleasePageStorage`

---

## Phase 6: User Story 4 — See fixVersion misalignments (P2)

**Independent test**: quickstart V-05.

- [X] T028 [P] [US4] Test `releaseDocument/releaseAlignment.test.ts`: `epic-has-no-version`, `epic-in-other-version`, `child-outside-release`; names compared case-insensitively and trimmed; aligned → none
- [X] T029 [US4] Implement `releaseDocument/releaseAlignment.ts` and call it from `gatherRelease` (also collect `outsideItems` via `parent in (…)` / `cf[epicLink] in (…)`)
- [X] T030 [US4] Render misalignments in the "Release check" column (storage) and as a flag in the tab (extend tests first)

---

## Phase 7: User Story 5 — Keep every unreleased release current (P2)

**Independent test**: quickstart V-06, V-07.

- [X] T031 [P] [US5] Test `releasePageSync.test.ts` (sync all): only unreleased versions; empty version → `skipped-empty`, no page; no date → `skipped-no-date`; notes collected across all pages follow their item to its new page; one failing release reported while others sync
- [X] T032 [US5] Implement `syncAllReleases(input, deps): Promise<SyncAllReport>` in `releaseDocument/releasePageSync.ts`
- [X] T033 [US5] Tab: "Sync all releases" button with the per-version report (extend tab test first)

---

## Phase 8: Polish

- [X] T034 CHANGELOG.md `[Unreleased]` entry (Added: Release Doc tab)
- [X] T035 Full gates: `npx vitest run`, `npx tsc -b`, eslint on changed files, `fieldMappingBoundary.test.ts` unmodified and green
- [ ] T036 Live quickstart V-01–V-08 in production after release

---

## Dependencies

- Phase 2 → all stories. US1 → US2, US3 (they extend US1's modules). US4 and US5 need US1 + US2 (merge) to be complete.
- Order: Setup → Foundational → US1 → US2 → US3 → US4 → US5 → Polish.

## Parallel opportunities

- Phase 2: T002/T004/T006 tests and their implementations are independent files.
- US1: T008, T010, T012, T014, T016 tests can be written in parallel.
- US3 editor (T024–T025) can proceed in parallel with US2's sync work (T021–T022).

## Implementation strategy

MVP = Phase 1 + 2 + US1 (publish a correct page). Then US2 + US3 make it a living document, then US4 + US5. Each
phase ends green and is independently demonstrable.
