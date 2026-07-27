# Quickstart & Validation: Component (Repo) Mapping & Repo-Only Story Generation

Proves the classification → mapping → repo-only story generation chain. Unit tests cover the pure/logic layer; the live
scenario proves it against a real Jira.

## Prerequisites
- Repo on `feature/031-component-repo-mapping`; `npm install` done.
- Component Manager reachable (Admin Hub); the ~68 repo components already imported on the project(s).
- A team selected in the PO Tool / PI Planner; AI unlockable (Ctrl+Alt+Z) for the mapping.
- Jira reachable via the proxy (VPN up) for reads/writes.

## Unit validation (no Jira) — run first (TDD)
```bash
cd client && npx vitest run \
  src/views/AdminHub/lib/componentClassificationStore.test.ts \
  src/views/PoTool/ai/componentMappingAiAssist.test.ts \
  src/views/PoTool/domain/teamDomainRuleStore.test.ts \
  src/views/PoTool/jira/componentResolve.test.ts \
  src/views/ArtView/piPlan/repoStoryBreakdown.test.ts
# regression: the 028 write path and composition AI ingest stay green
cd client && npx vitest run src/views/ArtView/piPlan src/views/PoTool/ai
```

Expected — new suites green; 028 + composition suites unchanged. Covers the contracts:
- component-classification: classify/reclassify/clear, repoAllowlist, unclassified→null, case-insensitive.
- ai-component-mapping: allowlist names accepted; non-allowlist rejected with reason; wrong kind → errors; no throw.
- team-domain-rule: apply unions+dedups; validate flags repo/unclassified/nonexistent.
- repo-story-generation: one per repo, zero for domain/unclassified, `{summary} ({repo})` title, per-story component,
  idempotent skip, empty→honestState.

## Live end-to-end (manual — Article X evidence)
1. **Classify** — in the Component Manager, list a project's components; mark several as **repo** and one or two (e.g.
   "Enrollment", "Transformers") as **domain**; leave one **unclassified**. Reload → classifications persist; the
   unclassified one is clearly flagged. *(US1, FR-001/002)*
2. **Map (Composition)** — open a Feature in Feature Composition; unlock AI; generate the mapping prompt (carries the
   Feature text + repo allowlist); run it; paste a reply naming some repos **plus** a domain tag and a bogus name →
   confirm the repos are proposed, the domain tag and bogus name are **rejected with a reason**, and accepting writes
   the repo components to the Feature. *(US2, FR-012/013)*
3. **Domain rule** — configure the team's rule (e.g. Enrollment always on); author/plan a Feature for that team →
   confirm Enrollment is present without manual entry and is **not** duplicated; point the rule at a repo-classified
   name → confirm it is **flagged**, not applied. *(US4, FR-030/032)*
4. **Generate stories (Planner)** — run PI planning for a Feature whose components include several repos **and** the
   Enrollment domain tag → confirm **exactly one Story per repo**, titled `{summary} ({repo})`, each with that repo set
   on its own component field, and **zero** stories for Enrollment or any unclassified component. *(US3, FR-020/025/026)*
5. **Empty case** — a Feature with no repo components → story generation proposes **zero** stories and prompts "map
   repos first" (no fallback). *(US3, FR-027)*
6. **Idempotency** — re-run story generation on a Feature that already has its repo stories → **no duplicates**.
   *(FR-023)*
7. **Re-classify** — change a repo to domain; regenerate → that repo **stops** generating a story; change one back →
   it **starts**. *(FR-024)*
8. **Both surfaces** — run the mapping from the PI Planner too; confirm identical allowlist rejection, gating, and
   no-AI-attribution as Composition. *(US5, FR-015)*
9. **AI-rules** — confirm the mapping prompt/ingest are hidden while AI is locked, and nothing was written to Jira
   without an explicit accept. *(SC-005/SC-002)*

## Done when
Unit + regression suites green, and live steps 1–9 pass with Jira evidence (classified components, repo components
written on accept, one-story-per-repo with zero domain stories, a flagged domain-rule misconfig, and identical
behaviour on both surfaces).
