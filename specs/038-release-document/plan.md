# Implementation Plan: Release Document

**Branch**: `feature/038-release-document` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/038-release-document/spec.md`

## Summary

A new Team Dashboard tab, **Release Doc**, keeps one Confluence page per unreleased fixVersion (title `YYYYMMMDD`,
e.g. `2026Oct14`) under a per-team parent page. Each page lists every Epic with its team-project children in the
release (key, summary, type, status, assignee, release-check flag, hand-entered Notes) and a hand-entered Deployment
Steps table. Children come from the team project; Epics are found by walking parent links into whatever project they
live in (DASP/DENP…) plus a per-project search for Epics carrying the same version name. Every save reads the page
first and merges hand-entered content back in; "Sync all" moves items (and their notes) between release pages and
never touches released versions. Client-only; almost entirely reuse plus four pure modules and one tab.

## Technical Context

**Language/Version**: TypeScript 5 (React 19 client, Vite)

**Primary Dependencies**: existing only — `fetchIssuesPaged`, `featureLink.ts`, `jiraFieldMapping.ts`,
`confluenceApi.ts`, `boardScopeStore.loadTeamFeatureScope`, `artFeatureScopeSettings` — **no new packages**

**Storage**: Confluence page (system of record for hand-entered data); `localStorage` key `tbxReleaseDocumentParents`
(parent page per team)

**Testing**: Vitest + Testing Library (unit, mocked I/O); live quickstart in production

**Target Platform**: NodeToolbox client in the browser via the Express Jira/Confluence proxies

**Project Type**: web application (client feature)

**Performance Goals**: publish one release in under 1 minute (SC-001); sync all in one action

**Constraints**: never truncate a release (paged search); never lose hand-entered data; field-blind new modules
(fieldMappingBoundary ratchet); additive-only edits to `SprintDashboardView.tsx`; propose-only AI rules not involved

**Scale/Scope**: one team, ~5–15 unreleased versions, ~10–300 items per release

## Constitution Check

| Article | Gate | Status |
|---|---|---|
| III Branching | Work on `feature/038-release-document`; PR to `main` | ✅ |
| IV Code quality | Self-documenting names, functions < 40 lines, named constants, purpose + doc comments | ✅ planned |
| V Testing | Each new module has a test written first; pure modules mock all I/O | ✅ planned |
| VI Documentation | CHANGELOG entry in the implementing PR; spec tree is the exempt pipeline artifact | ✅ planned |
| VII Framework-First | 9 of 13 capabilities reuse (research.md); drift recorded below | ✅ |
| VIII Release | `scripts/local-release.ps1` only | ✅ |
| IX Vault | No secrets handled — existing proxy credentials | ✅ |
| X Verification | Quickstart V-01…V-08 in production; round-trip tests for storage | ✅ planned |
| XI Output restraint | No extra docs beyond the spec tree | ✅ |

**Framework-First drift (recorded at each component)**:
1. `releasePageSync` reads-and-merges before writing — the release-notes publisher overwrites the page body and would
   erase hand-entered tables (`releaseNotesConfluence.ts:117`).
2. A small shared Confluence version-conflict check — PI Review's is private inside a tab that must not be refactored.

Post-design re-check: no new violations.

## Project Structure

### Documentation (this feature)

```text
specs/038-release-document/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── gather.md
│   ├── page-storage.md
│   ├── page-sync.md
│   └── release-doc-tab.md
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
client/src/services/
└── confluenceVersionConflict.ts          # shared "Version must be incremented" check (+ test)

client/src/views/SprintDashboard/releaseDocument/
├── releaseTitle.ts                       # YYYYMMMDD from releaseDate or MM/DD/YYYY name (+ test)
├── releaseAlignment.ts                   # misalignment by fixVersion name (+ test)
├── releaseGather.ts                      # children → Epics → same-name Epics; injected Jira (+ test)
├── releasePageStorage.ts                 # build/parse page storage; notes + deployment steps (+ test)
├── releasePageSync.ts                    # read-merge-write one page; sync all (+ test)
├── releaseDocumentParentStore.ts         # tbxReleaseDocumentParents per team (+ test)
├── releaseDocumentJira.ts                # live deps: fetchIssuesPaged, fetch by keys, field ids (+ test)
├── DeploymentStepsEditor.tsx             # add / edit / move / remove steps (+ test)
└── ReleaseDocumentTab.tsx                # the tab (+ test)

client/src/views/SprintDashboard/
├── SprintDashboardView.tsx               # additive: tab option + dispatch line
└── hooks/useSprintData.ts                # additive: 'release-doc' in DashboardTab
```

**Structure Decision**: Client-only feature in its own folder beside `rollupBoard/` and `forecast/`; every Jira and
Confluence call is injected so the logic modules are pure and unit-testable.

## Complexity Tracking

No constitution violations.
