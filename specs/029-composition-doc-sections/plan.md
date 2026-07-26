# Implementation Plan: Structured Feature Documentation in Feature Composition

**Branch**: `feature/029-composition-doc-sections` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/029-composition-doc-sections/spec.md`

## Summary

Make the Feature Composition AI compose the Jira **description** as a fixed nine-section document (Description, Benefit Hypothesis, Acceptance Criteria, Assumptions, Dependencies, In Scope, Out of Scope, Risks, NFR), always all present and in order. Sections the material can't substantiate are proposed but flagged `⚠ REQUIRES BUSINESS / TECHNICAL / BUSINESS & TECHNICAL VALIDATION`; nothing is ever attributed to AI. Acceptance criteria are written to the dedicated AC field **and** carried in the description's AC section; risks that reference an existing Jira key are linked ("relates to") on commit. Propose-only, scoped to Feature Composition (create + update).

**Technical approach — reuse-first (Framework-First gate).** The composition AI and its commit path already do almost everything:

- `PoTool/ai/compositionAiAssist.ts` exposes `buildCompositionPrompt(...)` and `parseCompositionIngest(...)` returning `CompositionProposal { summary, description, acceptanceCriteria, fields, rationale }` (the shipped 017 pattern: prompt out → strict JSON in → editable draft, propose-only).
- `FeatureCompositionTab.tsx` already **writes the AC field** (`acceptanceCriteriaFieldId`, discovered via `fieldConfig.acceptanceCriteriaFieldIds`) and stores the description as normalized plain text; `buildCompositionCommit(...)` (pure diff) + `runCompositionCommit(diff, {createIssue, saveField})` do the create/update, and the created Feature key is available in the outcome.
- `services/jiraApi.ts` `createIssueLink({ type:{name}, inwardIssue, outwardIssue })` already links issues ("relates to" = the instance's `Relates` type), and its own doc says treat link failure as non-fatal — exactly FR-032.

So the **new** work is small and mostly pure: (1) a new pure module that owns the nine-section canon — normalize any description to all nine sections in order, insert validation-flagged placeholders for missing ones, strip AI self-attribution, and extract risk-link keys from the Risks section; (2) prompt changes instructing the structure, the markers, the no-AI rule, and putting referenced risk keys in the Risks section; (3) ingest runs the description through the normalizer/stripper; (4) the commit creates "relates to" links for the extracted risk keys, non-fatal.

## Technical Context

**Language/Version**: TypeScript (client, strict) + React; vitest for tests.

**Primary Dependencies**: **No new dependencies.** Reuse `PoTool/ai/compositionAiAssist.ts`, `PoTool/FeatureCompositionTab.tsx` + its `buildCompositionCommit`/`runCompositionCommit`, `services/jiraApi.ts` (`createIssueLink`, `createIssue`), the AC-field discovery in `FeatureCompositionTab`, `utils/extractJsonPayload.ts`, `utils/richTextPlainText.ts` (`normalizeRichTextToPlainText`), the AI unlock gate.

**Storage**: none. Jira is the source of truth; the composition draft is the existing session/localStorage draft.

**Testing**: vitest — pure section normalizer/stripper/key-extractor, the modified prompt/ingest, and the commit's risk-link step (mocked `createIssueLink`). Existing `compositionAiAssist.test.ts` + `FeatureCompositionTab.test.tsx` must stay green (updated where behavior intentionally changes).

**Target Platform**: NodeToolbox desktop/browser; client-only, reaching Jira through the existing proxy.

**Project Type**: Web application (client-side feature).

**Performance Goals**: interactive; string normalization + a handful of link calls per commit — negligible.

**Constraints**: propose-only (no automated write); AI-gated; **never** emit AI self-attribution (hard output rule); a failed risk link never blocks the commit; scope limited to Feature Composition — Splitter/PI Review/hygiene untouched.

**Scale/Scope**: one Feature composed/updated at a time; up to a handful of risk links.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Status | Notes |
|---------|--------|-------|
| III — Branching | ✅ | `feature/029-composition-doc-sections`; PR to main. |
| IV — Code Quality | ✅ | Named section constants (no magic strings), verb-first funcs <40 lines, doc + purpose comments. |
| V — Testing (TDD) | ✅ | Pure normalizer/stripper/extractor and prompt/ingest are unit-first; failing test precedes each. |
| VI — Documentation | ✅ | CHANGELOG updated; only `specs/029-*` pipeline docs added. |
| VII — Framework-First | ✅ | **Strongly satisfied** — reuse the composition AI, commit path, AC-field write, and `createIssueLink`. One new pure module for the section canon (documented gap). |
| VIII — Release | ✅ | Local pipeline only. |
| IX — Vault Zero-Knowledge | ✅ | No secrets; Jira auth stays proxy-injected. |
| X — Verification & Proof | ✅ | quickstart defines the live evidence; determinism proven by unit tests. |
| XI — Output Restraint | ✅ | No new dashboards/summaries. |

**Framework-First drift ledger** (the only new infrastructure):

| New component | Why the framework doesn't provide it |
|---------------|--------------------------------------|
| `featureDocSections.ts` (nine-section canon: normalize/order/flag-placeholders, strip AI-attribution, extract risk-link keys) | Nothing in the codebase structures a description into these nine sections, flags under-supported ones, or extracts risk keys from a Risks section. `normalizeRichTextToPlainText` only flattens markup — it has no notion of sections. |

No unjustified violations → **gate passes**. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/029-composition-doc-sections/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── document-structure.md
│   ├── ai-prompt-ingest.md
│   └── commit-writes.md
├── checklists/
│   └── requirements.md  # (from /speckit-specify)
└── tasks.md             # /speckit-tasks output (NOT created here)
```

### Source Code (repository root)

```text
client/src/views/PoTool/
├── ai/
│   ├── featureDocSections.ts          # NEW pure: SECTION canon, normalizeFeatureDescription,
│   │                                  #   validation-marker builders, stripAiAttribution, extractRiskLinkKeys
│   ├── featureDocSections.test.ts     # NEW unit tests (TDD)
│   ├── compositionAiAssist.ts         # MODIFY: prompt instructs the 9 sections + markers + no-AI + risk keys;
│   │                                  #   parseCompositionIngest runs description through normalize + strip
│   └── compositionAiAssist.test.ts    # UPDATE: assert new prompt guidance + ingest normalization
├── FeatureCompositionTab.tsx          # MODIFY (commit only): create "relates to" links from the Risks-section keys
├── compositionCommit(.ts)             # MODIFY: buildCompositionCommit adds riskLinkKeys; runCompositionCommit
│                                      #   creates the links via injected createIssueLink (non-fatal)
└── *.test.tsx / *.test.ts             # UPDATE for the added commit step

REUSE (unchanged): services/jiraApi.ts (createIssueLink/createIssue), utils/extractJsonPayload.ts,
utils/richTextPlainText.ts, the AC-field discovery + AI unlock gate.
```

**Structure Decision**: Web app; the change is localized to the PO Tool composition module — one new pure file (`ai/featureDocSections.ts`) plus targeted edits to the composition prompt/ingest and the commit path. No new surface, no host-tab changes; the Feature Splitter and every other AI surface are untouched (FR-040).

## Complexity Tracking

> No Constitution violations require justification. The single new module fills a genuine gap (no existing code structures the nine-section document); no simpler reuse exists.
