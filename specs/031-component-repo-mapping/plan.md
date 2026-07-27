# Implementation Plan: Component (Repo) Mapping & Repo-Only Story Generation

**Branch**: `feature/031-component-repo-mapping` | **Spec**: [spec.md](./spec.md) | **Date**: 2026-07-27

## Summary

Classify each Jira component as **repo** or **domain** (explicit, human, at import), hold that classification as
Toolbox state (it does not exist in Jira), and drive three behaviours off it: (1) a **gated, propose-only, allowlist-
constrained AI mapping** that suggests the **repo** components a Feature touches — on both the Feature Composition
and PI Planner surfaces; (2) a **deterministic per-team rule** that applies **domain** components; and (3)
**repo-only story generation** — one Story per repo component (titled `{summary} ({repo})`, with that repo set on the
Story's own component field), replacing the 028 AI breakdown as the story set for repo-driven Features, and never
generating a story for a domain or unclassified component.

## Technical Context

**Language/Runtime**: TypeScript + React (client), the existing NodeToolbox SPA. No new dependencies.
**Storage**: browser `localStorage` via a zustand store (classification + team rules) — mirrors `settingsStore` /
`toolVisibilityStore`. Components themselves stay in Jira (read via `listProjectComponents`).
**AI**: propose-only, gated by `useAiAssistStore`, rendered via `PoAiPanel` — no automated/background AI (Article IX).
**Testing**: vitest unit tests (pure modules < 10ms), TDD; the pre-commit hook requires a test file per new source
file + a CHANGELOG entry in the same commit.
**Primary surfaces**: `AdminHub/ComponentManagerPanel` (classification), `PoTool/FeatureCompositionTab` (mapping),
`ArtView/piPlan/PlannerTab` (mapping + repo-story generation).

**Resolved unknowns** (see research.md): classification storage mechanism; component identity key; how the AI mapping
writes the component field; how repo-story generation replaces the 028 breakdown while reusing its downstream pipeline;
where the team→domain rule is keyed and applied.

## Constitution Check

| Article | Gate | Status |
|---|---|---|
| VII Framework-First | Reuse before building | ✅ Reuses `compositionAiAssist` allowlist pattern, `PoAiPanel`, `componentManager`, the composition commit path, and the 028 scheduling/dating/write pipeline. Net-new is only what has no analog: the classification store, the `componentMapping` module, the deterministic repo-story breakdown, and the domain-rule config — each justified in research.md. |
| IX Vault / AI rules | Propose-only, gated, never AI-attributed | ✅ Mapping is copy-out/paste-back, gated, per-item accept; sets a structured field only (no nine-section prose here); nothing AI-attributed. Domain rule is deterministic (never AI). |
| IV Code Quality | Names, ≤40-line functions, guard clauses | ✅ Pure modules with named helpers. |
| V Testing | TDD, pure unit < 10ms, test-per-source | ✅ Every new pure module ships with its `.test.ts`. |
| X Verification | Evidence, not "it compiled" | ✅ quickstart.md defines the live proof (classify → map → generate one-per-repo → domain excluded). |
| III / VIII Branching & Release | feature/*, local release only | ✅ On `feature/031-…`; released via `local-release.ps1`. |

No unjustified violations. The classification store and domain-rule config are the only new persistence — justified
because Jira offers no repo/domain marker and the spec forbids inferring one (FR-002).

## Project Structure (new & touched files)

```
client/src/views/AdminHub/
  lib/componentClassificationStore.ts        NEW  zustand+localStorage: name→kind; repo allowlist selector
  lib/componentClassificationStore.test.ts   NEW
  ComponentManagerPanel.tsx                   EDIT add repo/domain toggle per component + "unclassified" surfacing

client/src/views/PoTool/ai/
  componentMappingAiAssist.ts                NEW  buildComponentMappingPrompt / parseComponentMappingIngest (kind:'componentMapping')
  componentMappingAiAssist.test.ts           NEW
  PoAiPanel.tsx                               REUSE (gated panel — unchanged)

client/src/views/PoTool/
  FeatureCompositionTab.tsx                   EDIT mount the mapping panel; accept → draft.fields[componentsFieldId]=[{id}]
  domain/teamDomainRuleStore.ts              NEW  zustand+localStorage: teamProfileId→domain component names
  domain/teamDomainRuleStore.test.ts         NEW
  jira/componentResolve.ts                   NEW  resolve component names→ids for a project (listProjectComponents)
  jira/componentResolve.test.ts              NEW

client/src/views/ArtView/piPlan/
  repoStoryBreakdown.ts                      NEW  deterministic one-Story-per-repo (title, dedup, empty-state)
  repoStoryBreakdown.test.ts                 NEW
  piPlanJira.ts                               EDIT buildStoryCreateRequest sets the Story's components field to its repo
  PlannerTab.tsx                              EDIT mapping panel + repo-story generation path (replaces breakdown for repo-driven)

CHANGELOG.md                                  EDIT
```

## Phase 0 — Research

See [research.md](./research.md). Resolves: classification storage & identity, component-field write path, repo-story
generation vs the 028 breakdown, and the domain-rule keying/application.

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — Component Classification, Repo Allowlist, Team Domain Rule, Feature Component
  Mapping, Repo Story Proposal.
- Contracts:
  - [contracts/component-classification.md](./contracts/component-classification.md)
  - [contracts/ai-component-mapping.md](./contracts/ai-component-mapping.md)
  - [contracts/repo-story-generation.md](./contracts/repo-story-generation.md)
  - [contracts/team-domain-rule.md](./contracts/team-domain-rule.md)
- [quickstart.md](./quickstart.md) — unit + live validation.

## Complexity / Risks

- **Highest risk**: repo-story generation replacing the 028 breakdown without regressing 028. Mitigation: repo-story
  generation is an **additive alternate path** (repo-driven Features use it; the AI breakdown stays intact for others),
  and it **feeds the existing** scheduling/dating/write pipeline rather than forking it — only story *origin* changes.
- **Component identity**: repos are per-project components (per-project ids) but a repo is one thing across projects.
  Classification is keyed by **name** (case-insensitive); ids are resolved per project at write time. Documented in
  the classification contract.
- **Writing the `components` field**: it is a Jira **system** field (`components`), written as `[{id}]`; the value flows
  through the existing composition field bag / create payload — no new writer primitive.
```
