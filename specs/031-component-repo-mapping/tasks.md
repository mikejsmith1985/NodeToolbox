# Tasks: Component (Repo) Mapping & Repo-Only Story Generation

**Feature**: 031-component-repo-mapping | **Branch**: `feature/031-component-repo-mapping`
**Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md) | **Contracts**: [contracts/](./contracts/)

TDD throughout (Constitution V + the pre-commit test-per-source hook): the `.test.ts(x)` task precedes its source task.
`[P]` = parallelizable (disjoint files, no incomplete dependency). Paths are exact.

---

## Phase 1: Setup

- [ ] T001 Add a `## [Unreleased]` CHANGELOG.md entry stub for feature 031 (so subsequent commits satisfy the
  CHANGELOG-in-commit hook) in `CHANGELOG.md`.

## Phase 2: Foundational (blocking prerequisites for US2/US3/US4)

- [ ] T002 [P] Write `componentResolve.test.ts` — name→id resolution for a project (mocks `jiraGet`); unmatched names
  reported, case-insensitive match — in `client/src/services/componentResolve.test.ts` (shared location — M3).
- [ ] T003 Implement `componentResolve.ts` — `resolveComponentIdsByName(projectKey, names) → { ids: {name,id}[];
  unresolved: string[] }` calling `jiraGet('/rest/api/2/project/{key}/components')` directly (no PoTool/AdminHub
  import) — in `client/src/services/componentResolve.ts` (M3).

---

## Phase 3: User Story 1 — Classify components repo/domain at import (P1)

**Goal**: The repo/domain allowlist exists and persists; unclassified is surfaced, never guessed.
**Independent Test**: Classify some components repo, some domain, leave one unclassified; reload → persisted; the
unclassified one is flagged; `repoAllowlist()` returns only repos.

- [ ] T004 [P] [US1] Write `componentClassificationStore.test.ts` — classify/getKind/clear round-trip, re-classify
  overwrites, `repoAllowlist` returns only repos, unclassified→`getKind` null, case-insensitive key, persistence key
  `tbxComponentClassification` — in `client/src/views/AdminHub/lib/componentClassificationStore.test.ts`.
- [ ] T005 [US1] Implement `componentClassificationStore.ts` — zustand + localStorage (`tbxComponentClassification`),
  `classify` / `clearClassification` / `getKind` / `isRepo` / `isDomain` / `repoAllowlist`, name-keyed
  (case-insensitive) — in `client/src/views/AdminHub/lib/componentClassificationStore.ts`.
- [ ] T006 [US1] Extend the Component Manager UI: per-component **Repo / Domain** control + "not yet classified"
  marker, wired to the store, reusing `AdminHubView.module.css` classes — in
  `client/src/views/AdminHub/ComponentManagerPanel.tsx`.
- [ ] T007 [US1] Add/extend `ComponentManagerPanel.test.tsx` — classifying a listed component persists and reflects;
  an unclassified component renders its marker — in `client/src/views/AdminHub/ComponentManagerPanel.test.tsx`.

**Checkpoint**: the allowlist is real and durable — US2/US3 can consume it.

---

## Phase 4: User Story 2 — AI-map repo components to a Feature, Composition (P1)

**Goal**: Never-empty-but-always-reviewed repo components on a Feature, allowlist-constrained, gated, propose-only.
**Independent Test**: Reply naming allowlist repos + a domain tag + a bogus name → repos proposed, the other two
rejected with reasons; accept writes the repo components to the Feature.

- [ ] T008 [P] [US2] Write `componentMappingAiAssist.test.ts` — prompt contains Feature text + every allowlist name;
  allowlist names accepted; non-allowlist value rejected with reason (not returned); wrong `kind` → errors, no items;
  empty components → no throw; de-dupe; case-insensitive — in
  `client/src/views/PoTool/ai/componentMappingAiAssist.test.ts`.
- [ ] T009 [US2] Implement `componentMappingAiAssist.ts` — `COMPONENT_MAPPING_KIND='componentMapping'`,
  `buildComponentMappingPrompt(feature, repoAllowlist)`, `parseComponentMappingIngest(text, repoAllowlist):
  AiIngestResult<{componentName}>` (reuse `extractJsonPayload`, mirror `parseCompositionIngest` reject-on-ingest) — in
  `client/src/views/PoTool/ai/componentMappingAiAssist.ts`.
- [ ] T010 [US2] Mount the mapping in Feature Composition: gated `PoAiPanel` (build prompt from the Feature +
  `repoAllowlist()`; ingest via `parseComponentMappingIngest`); on accept `componentResolve` names→ids and set
  `draft.fields.components = [{id}]`; surface unresolved names; never blank an existing value. **Verify `components`
  is a writable field in the Feature editmeta (M2)** — if not on the edit screen, write via a direct edit call rather
  than dropping it — in `client/src/views/PoTool/FeatureCompositionTab.tsx`.
- [ ] T011 [US2] Extend `FeatureCompositionTab.test.tsx` — locked AI hides the mapping panel; an ingest surfaces
  rejected non-allowlist values; accept sets `draft.fields.components` — in
  `client/src/views/PoTool/FeatureCompositionTab.test.tsx`.

**Checkpoint**: a Feature can carry human-approved repo components — the input to story generation exists.

---

## Phase 5: User Story 3 — Repo-only story generation (P1)

**Goal**: One Story per repo component; zero for domain/unclassified; feeds the 028 pipeline unchanged.
**Independent Test**: Feature with several repos + a domain tag → exactly one Story per repo, titled `{summary}
({repo})`, each with its repo on its component field; zero stories for the domain tag; empty repo set → zero + prompt.

- [ ] T012 [P] [US3] Write `repoStoryBreakdown.test.ts` — N repos→N proposals with `{summary} ({repo})` titles; domain
  + unclassified → 0; empty→[]+honestState; existing matching child → skipped (idempotent); re-classify repo→domain
  stops generation; each proposal carries its single repo — in
  `client/src/views/ArtView/piPlan/repoStoryBreakdown.test.ts`.
- [ ] T013 [US3] Implement `repoStoryBreakdown.ts` — `buildRepoStoryProposals(feature, repoComponents,
  existingChildren, getKind)` → one `RepoStoryProposal` per repo (allowlist-filtered), dedup vs existing children,
  empty→honestState — in `client/src/views/ArtView/piPlan/repoStoryBreakdown.ts`.
- [ ] T014 [US3] Edit `buildStoryCreateRequest` to set `fields.components = [{id}]` when the ScheduledStory carries a
  repo (guarded so 028 non-repo stories are unaffected) — in `client/src/views/ArtView/piPlan/piPlanJira.ts`; update
  `client/src/views/ArtView/piPlan/piPlanJira.test.ts`.
- [ ] T015 [US3] Assemble the Feature's repo components for the planner input: fetch the Feature's `components`, filter
  by `repoAllowlist()`, pass into `repoStoryBreakdown` — in `client/src/views/ArtView/piPlan/plannerInputs.ts` (pure,
  testable — L1), with a test.
- [ ] T016 [US3] Wire the repo-story generation path in `PlannerTab.tsx`: for repo-driven Features use
  `repoStoryBreakdown` as the story set (replacing the 028 AI breakdown path), render the proposals for
  edit/remove/accept, and show the empty "map repos first" state — in `client/src/views/ArtView/piPlan/PlannerTab.tsx`.

**Checkpoint** (MVP complete): classify → map → one-story-per-repo, domain excluded, end to end.

---

## Phase 6: User Story 4 — Team → domain-component rule (P2)

**Goal**: Deterministic per-team domain components; never AI; never story-generating; misconfig flagged.
**Independent Test**: Configure Enrollment for a team; author/plan a Feature for it → Enrollment present, not
duplicated, no story; point the rule at a repo name → flagged, not applied.

- [ ] T017 [P] [US4] Write `teamDomainRuleStore.test.ts` — set/get round-trip; `validateRule` flags repo-classified,
  unclassified, and nonexistent names; a valid domain name passes — in
  `client/src/views/PoTool/domain/teamDomainRuleStore.test.ts`.
- [ ] T018 [US4] Implement `teamDomainRuleStore.ts` — zustand + localStorage (`tbxTeamDomainRules`), keyed by Dashboard
  Team profile id; `setTeamDomainComponents` / `getTeamDomainComponents` / `validateRule(teamProfileId, getKind)` — in
  `client/src/views/PoTool/domain/teamDomainRuleStore.ts`.
- [ ] T019 [US4] Add the rule config UI (per selected Dashboard Team profile) with validation flags surfaced, reusing
  the sibling surface's CSS module — in the PO Tool (`client/src/views/PoTool/domain/TeamDomainRulePanel.tsx`) + its
  `.test.tsx`.
- [ ] T020 [US4] Apply the rule deterministically on the Composition and Planner surfaces: union the Feature's
  components with the team's **valid** domain components (dedup, resolve name→id, never AI), flagged entries not
  applied — in `client/src/views/PoTool/FeatureCompositionTab.tsx` and `client/src/views/ArtView/piPlan/PlannerTab.tsx`.

## Phase 7: User Story 5 — Map from the PI Planner too (P2)

**Goal**: The same mapping on the Planner surface; identical gating/allowlist/no-attribution.
**Independent Test**: In the Planner, map a Feature with no repo components, accept, confirm they're set and feed story
generation; same allowlist rejection + gating as Composition.

- [ ] T021 [US5] Mount the gated `PoAiPanel` component-mapping in `PlannerTab.tsx` (reuse `componentMappingAiAssist`
  from US2); on accept resolve names→ids and write the Feature's `components` via `createIssue`/edit — in
  `client/src/views/ArtView/piPlan/PlannerTab.tsx`, with a test asserting locked-hidden + allowlist rejection.

## Phase 8: Polish & Cross-Cutting

- [ ] T022 [P] Finalize the `CHANGELOG.md` entry describing the feature (classification, mapping, repo-only stories,
  domain rule).
- [ ] T023 Regression: `cd client && npx vitest run src/views/ArtView/piPlan src/views/PoTool/ai` — confirm the 028
  pipeline and composition AI ingest are unchanged; then `npx tsc -b` and `npx eslint` on all new/edited files.
- [ ] T024 Execute `quickstart.md` live steps 1–9 against real Jira (classify → map → one-per-repo → domain excluded →
  empty-state → idempotent → re-classify → both surfaces → AI-locked), capturing evidence.

---

## Dependencies

- **Setup (T001)** → everything.
- **Foundational (T002–T003 componentResolve)** → US2 write (T010), US3 component-set (T014), US4 apply (T020), US5
  write (T021).
- **US1 (T004–T007 classification store + UI)** → US2 (allowlist), US3 (allowlist + getKind), US4 (validateRule).
- **US2 (T008–T011 mapping module)** → US5 (reuses the module).
- **US3 (T012–T016)** depends on US1; independent of US2 at the code level (US2 provides the components in practice, but
  US3 can be tested with hand-set repo components).
- **US4, US5** are P2, layered after the MVP (US1+US2+US3).

## Parallel opportunities

- **Test-first pairs** marked `[P]` can be written in parallel with other stories' tests: T004, T008, T012, T017 are
  disjoint files.
- Within US3, T012 (breakdown test) and T014's `piPlanJira.test.ts` edit touch different files and can proceed in
  parallel once T013 lands.
- US4 (T017–T020) and US5 (T021) are independent of each other and can be built in parallel after the MVP.

## Implementation strategy

- **MVP = US1 → US2 → US3** (all P1): the classify→map→repo-only-stories chain. Ship/validate that first (quickstart
  steps 1–2, 4–7).
- **Increment 2 = US4** (domain rule) then **US5** (Planner mapping) — additive, no MVP regression.
- Keep the **028 pipeline untouched** except the guarded `buildStoryCreateRequest` component-set (T014); run T023
  regression after any `piPlan*` edit.
