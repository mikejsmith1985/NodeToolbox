# Implementation Plan: Agile Hub Home — honest gating and a job-shaped tool catalog

**Branch**: `feature/020-agile-hub-home-ux` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-agile-hub-home-ux/spec.md`

## Summary

Three increments, riskiest last, each releasable. **US1**: bind the existing (currently inert) Admin Hub Tool
Visibility map to the home surface through a small shared store, gate the SNow Hub card **and route** behind the
session admin unlock. **US2**: reshape `homeCardData` into the three job sections. **US3**: the Agile Hub full merge
as a **thin shell** — a new `/agile-hub` route with a Team / Product / Train space switcher that mounts the three
EXISTING views (`SprintDashboardView`, `PoToolView`, `ArtView`) completely unchanged. Capability parity (FR-011) and
selection carry-over (FR-012) hold **by construction**: the spaces are the same components reading the same stores
they read today. The three old routes become param-preserving redirects into their spaces, so every deep link
(Today cards' `?hygieneFilter=…`, Sprint-flow's dashboard link, PI Review cross-links) lands mid-flight untouched.

## Technical Context

**Language/Version**: TypeScript + React SPA, CSS Modules on the existing token system

**Primary Dependencies**: zero new. Reuse: `homeCardData` catalog + `HomeView` grid (dnd-kit already present),
`useAdminStore` (session unlock), `ToolVisibilitySection` + its `tbxToolVisibility` localStorage map, settings
store (card order, recents, `sprintDashboardActiveTab` precedent for persisted UI state), React Router `Navigate`

**Storage**: existing localStorage keys only (`tbxToolVisibility`, settings store); one new settings-store field
for the last-used hub space

**Testing**: vitest + @testing-library (store binding, gating, redirects, shell); Playwright e2e for the gating
flows and one full deep-link journey (Today card → Agile Hub Team space hygiene, filter intact)

**Target Platform**: NodeToolbox SPA, light + dark themes, all text-size modes

**Project Type**: web application, client-only

**Performance Goals**: the shell adds no data fetching of its own; switching spaces mounts/unmounts the existing
views exactly as route navigation does today

**Constraints**: `SprintDashboardView` (6,700 lines) and `ArtView` MUST NOT be internally refactored in this
feature — the shell wraps, never rewrites. PO selection isolation (017) preserved by keeping `PoToolView` intact.
GH #160 zoom rules for all new layout.

**Scale/Scope**: 14 cards → 12 (3 retired + 1 added); 3 sections; ~4 routes changed, ~10 legacy redirects repointed

## Constitution Check

*GATE — pre-Phase-0 and re-checked post-design: PASS.*

- **Art I**: thin-shell merge is explicitly the lowest-risk best route (see research §1). ✅
- **Art III**: on `feature/020-agile-hub-home-ux`; PR to main. ✅
- **Art IV/V**: standard naming/comments; red-first tests per task; Playwright for gating + deep-link journeys. ✅
- **Art VI**: CHANGELOG in the implementation PR. ✅
- **Art VII**: binds the half-built Tool Visibility mechanism instead of inventing a parallel one; reuses the
  existing card grid, stores, and the app's established route-retirement pattern (`Navigate` redirects). No drift. ✅
- **Art X**: gating and redirect claims verified in a real browser (locked/unlocked, hidden/visible, param carry). ✅

## Project Structure

### Documentation (this feature)

```text
specs/020-agile-hub-home-ux/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── home-gating.md        # visibility store + gate kinds + route gating
│   ├── agile-hub-shell.md    # space switcher, mounting, space persistence
│   └── route-redirects.md    # the full redirect table with param rules
└── tasks.md                  # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
client/src/
├── store/
│   └── toolVisibilityStore.ts        # NEW — zustand + tbxToolVisibility (same key ToolVisibilitySection
│                                     #   writes today); resolveToolIsVisible moves here; Admin Hub pinned visible
├── views/
│   ├── Home/
│   │   ├── homeCardData.ts           # CHANGED — 3 job sections; agile-hub card added; team-dashboard /
│   │   │                             #   po-tool / art cards removed; per-card gateKind ('admin-unlock' on snow-hub);
│   │   │                             #   recents legacy map: retired ids → agile-hub
│   │   └── HomeView.tsx              # CHANGED — filters cards by visibility store + gate state; sections
│   │                                 #   omit-when-empty (already true via getCardsForSection)
│   ├── AdminHub/
│   │   └── ToolVisibilitySection.tsx # CHANGED — reads/writes through toolVisibilityStore (live binding);
│   │                                 #   retired cards dropped from the toggle list; Admin Hub not listed
│   └── AgileHub/
│       ├── AgileHubView.tsx          # NEW — space switcher (Team | Product | Train); mounts the existing
│       │                             #   SprintDashboardView / PoToolView / ArtView UNCHANGED; ?space= param +
│       │                             #   settings-store last-space fallback
│       └── AgileHubView.module.css   # NEW — space nav styles (tokens; wraps, never clips)
└── App.tsx                           # CHANGED — /agile-hub route; /sprint-dashboard, /po-tool, /art become
                                      #   param-preserving redirects into spaces; legacy redirects repointed;
                                      #   /snow-hub gated by admin unlock; hidden-tool routes land home

test/e2e/
└── agile-hub-home.spec.js            # NEW — locked/unlocked SNow gating; visibility toggle live effect;
                                      #   Today-card deep link lands in Team space with filter intact
```

**Structure Decision**: `AgileHubView` is a shell in a new `views/AgileHub/` directory; the three merged views stay
exactly where they are and keep their names — the shell imports them. Nothing inside `SprintDashboard/`, `PoTool/`,
or `ArtView/` changes in this feature.

## Complexity Tracking

No constitution violations; no drift entries. The deliberately-avoided complexity (rebuilding three views' tab
systems into one) is recorded as the rejected alternative in research §1.
