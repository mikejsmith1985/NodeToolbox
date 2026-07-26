# Quickstart & Validation: Structured Feature Documentation in Feature Composition

Runnable validation that the composed Feature is a complete, honestly-flagged nine-section document and that risks link. References the contracts rather than duplicating them.

## Prerequisites

- Repo on `feature/029-composition-doc-sections`; `npm install` done.
- PO Tool → Feature Composition open, with a team/project selected and the Acceptance Criteria field discoverable on the instance.
- AI assist unlockable (Ctrl+Alt+Z) for the composition prompt/ingest.
- Jira reachable through the proxy (VPN up) for the live commit/link steps.

## Unit validation (no Jira, no clock) — run first (TDD)

```bash
cd client && npx vitest run src/views/PoTool/ai/featureDocSections src/views/PoTool/ai/compositionAiAssist src/views/PoTool/FeatureCompositionTab
```

Expected: new + updated suites green. Covers the contract obligations:
- document-structure: normalize → nine sections in order, missing ones flagged with the right marker, idempotent; `stripAiAttribution` removes AI-authorship but keeps markers; `extractRiskLinkKeys` returns only Risks-section keys, de-duplicated.
- ai-prompt-ingest: prompt carries the nine labels + three markers + no-AI + AC-in-both instructions; ingest normalizes + strips the description.
- commit-writes: `riskLinkKeys` computed from the Risks section; one `Relates` link per key; a failing link is captured, never fatal; empty keys ⇒ no link calls.

## Live end-to-end (manual — Article X evidence)

1. Open Feature Composition; unlock AI. Provide thin material for a new Feature (a short narrative + one note that mentions an existing risk ticket key, e.g. `ABC-123`).
2. Run AI assist → confirm the **proposed description has all nine sections, labeled, in order**, and sections the material didn't cover open with a `⚠ REQUIRES … VALIDATION` marker of the right kind. *(US1, US2)*
3. Confirm the **Acceptance Criteria** appears in the description's AC section **and** in the AC field box. *(US1, FR-010)*
4. Confirm **nothing in the text says it was written by AI**. *(US1, FR-003)*
5. Commit → in Jira, the Feature's description shows the nine sections + AC field is populated, and a **"relates to" link to `ABC-123`** exists. *(US3, FR-030)*
6. Repeat with material that mentions **no** risk key → risk documented in the Risks section, no link attempted. *(FR-031)*
7. Repeat with a **bad** key (e.g. `ZZZ-999999`) → commit still succeeds, Feature created, the link failure surfaced (not fatal). *(FR-032)*
8. **Update** an existing Feature via AI → the nine-section document is shown in the draft for review before you commit (no silent overwrite). *(FR-042)*

## Done when

All unit suites green (incl. unchanged existing composition tests), and live steps 2–8 pass with Jira evidence (nine-section description, populated AC field, a "relates to" link, and a non-fatal bad-key case).
