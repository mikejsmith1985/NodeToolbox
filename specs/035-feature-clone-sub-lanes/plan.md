# Implementation Plan: Cloned-Feature Sub-Lanes

**Branch**: `feature/035-feature-clone-sub-lanes` | **Date**: 2026-08-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/035-feature-clone-sub-lanes/spec.md`

## Summary

QE and BT clone the dev Feature into their own Feature projects and break their own work down underneath the clone.
The board sees none of it, so a Feature reads as finished when **dev** is finished. This plan draws each clone as a
**sub-lane** beneath the dev Feature's lane, in the dev team's own columns, **read-only**, with a **second progress
figure** covering the whole family.

The finding that shapes everything, from the sampled Feature's Issue Links panel:

```
is cloned by
   DENP-1359   H Contract Migration - Blue Plans to Purple Platforms for plan year 2028      ← same project
   QEINT-610   Enrollment- Migration - H Contract Consolidation (Blue to Purple) …           ← QE's project
```

**The project decides, not the link.** `DENP-1359` is a peer Feature cloned to split scope and keeps its own
top-level lane; only `QEINT-610` is a sub-lane. A design keyed on "has a Cloners link" would have nested a sibling
Feature under its own sibling.

The second finding: those two summaries share almost no words. **Name matching would have found nothing here.** The
name fallback survives as a net for hand-created Features, gated to exact matches inside configured projects, but the
plan does not depend on it.

What is genuinely new, and how much:

| New | Kind | Why it does not already exist |
|---|---|---|
| `cloneFamily.ts` — find and classify clones | pure | No clone-link handling anywhere in `rollupBoard/`; no shared issue-link helper either. |
| `familyProgress.ts` — the second figure | pure | `computeFeatureProgress` takes one flat item list; nothing spans Features. |
| `subLaneLayout.ts` — build the bands | pure | `RenderedLane` is flat (`rollupBoardTypes.ts:298`); there is no nesting concept. |
| `SubLane.tsx` | component | — |
| `isReadOnly` on `ChildCard` | 1 prop | Every card is currently unconditionally draggable (`ChildCard.tsx:89`). |
| `disciplineProjects` in the scope store | 1 field | — |

Everything else is wiring. Clone **discovery costs no request**: `issuelinks` is already in `BASE_ISSUE_FIELDS`
(`rollupBoardFetch.ts:57`), so the links are already loaded. Only the clones' child work is new traffic, and it reuses
`fetchTeamIssuesForFeatures` (`:444`).

## Technical Context

**Language/Version**: TypeScript 5 / React 18 (client), Node.js/Express (server — untouched by this feature)
**Primary Dependencies**: dnd-kit (existing), Jira REST v2 via `services/jiraApi.ts` (existing)
**Storage**: `window.localStorage` under the existing `tbxRollupBoardScope` key — one new field, no new store
**Testing**: Vitest + @testing-library/react
**Target Platform**: The existing Roll-Up Board tab in the Team space
**Project Type**: Web application (client-only change)
**Performance Goals**: A board with no clones is no slower and no taller than today (SC-004). Clone discovery adds
zero requests; clone work adds one read per configured discipline project.
**Constraints**: No writes cross a project boundary (sub-lanes are read-only, A-006). Nesting is one level (A-007).
**Scale/Scope**: Up to ~23 Feature lanes on a real board; 0–3 sub-lanes each.

## Constitution Check

| Article | Status | Note |
|---|---|---|
| I — Prime Directive | ✅ | Three pure modules with contract tests, not a shortcut through the render layer. |
| II — Process Protection | ✅ | No process management involved. |
| III — Branching | ✅ | `feature/035-feature-clone-sub-lanes`, PR to main. |
| IV — Code Quality | ✅ | Functions under 40 lines; `is`/`has` boolean prefixes; named constants for tone rotation. |
| V — Testing | ✅ | Contract tests written before implementation, per module. Unit tests fully mocked. |
| VI — Documentation | ✅ | CHANGELOG updated in the PR; artefacts live under `specs/035-…` (pipeline-exempt). |
| VII — Framework-First | ✅ | **Gate passes with no drift** — see research.md R-008. Jira's own Cloners link, dnd-kit's own `disabled`, the existing tone tokens, the existing progress function, the existing scope store. Nothing custom is built where something exists. |
| VIII — Release | ✅ | Local pipeline only. |
| IX — Vault | ✅ | No secrets involved. |
| X — Verification | ✅ | Quickstart V-01…V-14 are behavioural, against live Jira. |
| XI — Output restraint | ✅ | No dashboards; no ad-hoc summary documents. |

**Initial check: PASS. Post-design check: PASS** — the design added no infrastructure the frameworks already provide.

## Project Structure

### Documentation (this feature)

```
specs/035-feature-clone-sub-lanes/
├── spec.md
├── plan.md                  ← this file
├── research.md              R-001…R-008
├── data-model.md
├── quickstart.md            V-01…V-14
├── contracts/
│   └── module-contracts.md  C-*, P-*, L-*, S-*, R-*, T-*
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```
client/src/views/SprintDashboard/rollupBoard/
├── cloneFamily.ts                 NEW  find + classify clones, tone index
├── cloneFamily.test.ts            NEW
├── familyProgress.ts              NEW  dev figure + family figure
├── familyProgress.test.ts         NEW
├── subLaneLayout.ts               NEW  build the bands in dev columns
├── subLaneLayout.test.ts          NEW
├── components/
│   ├── SubLane.tsx                NEW
│   ├── SubLane.test.tsx           NEW
│   ├── ChildCard.tsx              MOD  + isReadOnly
│   ├── MasterCardLane.tsx         MOD  render subLanes under the cells
│   └── FeatureScopePanel.tsx      MOD  + discipline projects editor
├── rollupBoardTypes.ts            MOD  + SubLane, RenderedLane.subLanes
├── boardScopeStore.ts             MOD  + disciplineProjects
├── featureScope.ts                MOD  + disciplineProjects
├── boardLayout.ts                 MOD  attach sub-lanes to lanes
├── rollupBoardFetch.ts            MOD  fetch clone Features + their work
├── RollupBoardTab.tsx             MOD  wiring, unconfigured-clone notice
└── RollupBoardTab.module.css      MOD  sub-lane bands, tone rotation
```

**Structure Decision**: Client-only, inside the existing `rollupBoard/` module. No server change: the board reads
Jira directly through the existing client service, and this feature adds no write path at all.

## Phase Sequence

**Phase A — Configuration** (no visible change)
The `disciplineProjects` setting, its store round-trip, and its editor. Ships dark: with no disciplines configured
the board is byte-identical to today, which makes the whole feature opt-in and gives Phase B something to read.

**Phase B — Discovery** (no visible change)
`cloneFamily.ts` and the fetch. Classification is fully testable against the DENP-1359 / QEINT-610 sample before
anything renders. Ends with the unconfigured-clone notice, which is the first user-visible output and the cheapest
possible feedback on whether detection works at all.

**Phase C — Sub-lanes** (US1, US2, US4)
`subLaneLayout.ts`, `SubLane.tsx`, `ChildCard.isReadOnly`, the tone rotation, and the `MasterCardLane` wiring.

**Phase D — The second figure** (US3)
`familyProgress.ts` and the lane header. Deliberately last: it is the requirement most likely to need a second look
once real families are on screen, and nothing else depends on it.

**Phase E — Polish**
Collapse-by-default behaviour, quick-filter parity, CHANGELOG, release.

Each phase is independently shippable and independently reversible.

## Risks

| Risk | Mitigation |
|---|---|
| A team clones within its own project **and** to a discipline project, and the peer rule hides something | The peer keeps its own top-level lane — it is never hidden, only never nested. C-01 pins this. |
| Discipline statuses flood the Unmapped column | Expected and correct (FR-007a); the existing unmapped-states notice already names exactly what to map. This is the feature working, not failing. |
| Two disciplines land on the same tone | Tone rotation is by configured position; more disciplines than tone pairs (7) wraps. Text labels carry the distinction regardless (FR-004). |
| The family figure changes what people think the board's numbers mean | Both figures shown, labelled, never one replacing the other (FR-008). A no-clone Feature shows one figure, so most lanes are unaffected. |
| Extra Jira reads slow a large board | Discovery is free (links already fetched). Work reads are chunked at the existing `FEATURE_KEY_CHUNK_SIZE` and skipped entirely when no disciplines are configured. |

## Complexity Tracking

No Article VII drift. Every capability this feature needs is provided by something already in the project — Jira's
Cloners link, dnd-kit's `disabled`, `computeFeatureProgress`, `chunkList`, the `--color-tone-*` pairs, and
`boardScopeStore`. Nothing custom is introduced against a documented gap because there is no documented gap.

One deliberate near-duplication is worth recording: `readCloneLinks` is a **fifth** private reader of
`fields.issuelinks`, joining the four the recon found (`featureRollup.ts:200`, `defectRollup.ts:43`,
`masterCards.ts:36`, `rollupBoardFetch.ts:247`). Extracting a shared link helper is the right refactor and is
**explicitly out of scope here** — it would touch four working call sites for no behavioural gain in this feature, and
each of those readers is deliberately direction-specific in a way a shared helper would have to parameterise anyway.
Recorded so it is not rediscovered as an accident.
