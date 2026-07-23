# Implementation Plan: Personal Workflow — Auditable Markdown Report

**Branch**: `feature/025-personal-flow-audit` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/025-personal-flow-audit/spec.md`

## Summary

The Personal Workflow report states things about how people are performing, without showing its working. This feature
adds a second output from the same run: a team-wide Markdown document in which every metric carries its explanation,
its formula, a worked example, and one-click links into Jira — so a sceptic can check it without the person who ran it.

Two Phase 0 findings shape the build:

1. **The fetch query is deliberately broader than what gets counted** (R2). `assignee WAS … AND updated >= -Nd` is a
   documented superset; the engine does exact windowing afterwards. Linking that JQL beside a credited count would
   recreate the count-vs-link mismatch the feature exists to remove. The design therefore uses **three link kinds**,
   one per row of the `fetched = credited + excluded` reconciliation, each returning exactly its own number.
2. **No markdown→Confluence writer exists** (R5) — only a reader. The clipboard path needs no conversion and can ship
   immediately; direct publish needs a document-specific renderer. This is why the spec's P1/P2 split is real
   sequencing rather than preference.

The generator is a **pure function** from the completed roster results to a string (R8) — no clock, no browser, no
Jira. For a feature whose entire purpose is trustworthiness, having its output exhaustively unit-testable is the
point, not a convenience.

The engine change is small but real: `computePersonalFlow` currently **discards** the stints and spans behind its
cycle-time total (R1). It must retain them for **one** nominated issue — enough for the worked example, without
multiplying by roster size.

## Technical Context

**Language/Version**: TypeScript + React (client SPA), CSS Modules. Client-only — no server, scheduler, or new
integration.

**Primary Dependencies**: **zero new**. Reuse — `computePersonalFlow` + `TeamFlowRow` (`personalFlow.ts`,
`PersonalFlowTab.tsx`); `buildSearchJql` (`:258`, already factored for display); `buildJiraIssueNavigatorUrl`
(`buildHygieneJqlUrl.ts:100`, which already falls back to raw JQL when no base URL — FR-015 for free);
`copyToClipboard` (`JiraTemplateMaker/lib`, async + result); `updateConfluencePage` (`confluenceApi.ts:244`) for P2.

**Storage**: None. The document is generated on demand and either copied or written to Confluence. No persistence and
no new configuration beyond the P2 target page reference.

**Testing**: vitest (`cd client && npm test`), red-first per Article V. The generator, the link builders, and the
reconciliation are pure — unit tests cover every formula, every link kind, the worked example, the ceiling
disclosures, and per-person failure rendering, with no I/O. Component tests cover the copy/publish controls and the
progress/cancel affordance.

**Target Platform**: NodeToolbox SPA; light and dark themes; A/A+/A++ text sizes.

**Project Type**: Web application, client-only.

**Performance Goals**: NFR-006 — meaningful roster progress (which person, how many done), not a bare spinner.
NFR-006a — cancellable between people, yielding no document.

**Constraints**: fetched ≠ credited (R2) — the link kinds must not be conflated; document and screen derive from
**one** computation (NFR-001); two ceilings bound the run and both must be reportable (FR-019a/b); a cancelled run
produces nothing (NFR-006a); whole-page replace on publish requires a named, abandonable warning (FR-021/FR-021a).

**Scale/Scope**: a roster of ~5–20 people; a window up to "All history" (3650 days). Per-person ceiling × roster size
is the sizing case.

## Constitution Check

*GATE — evaluated pre-Phase-0 and re-checked post-design: **PASS**. One Article VII drift, justified.*

- **Art I (Best route)**: ✅ R2 was found by reading the JQL builder's own comment rather than assuming the fetch
  query was the credited query — the shortcut would have shipped a mismatch. The engine change is scoped to one
  issue's evidence rather than taking the easier "return everything" path.
- **Art III (Branching)**: ✅ `feature/025-personal-flow-audit`, merged via PR.
- **Art IV (Code quality)**: ✅ Verb-first (`buildFlowAuditDocument`, `renderMetricSection`, `buildCreditedIssuesLink`),
  `is/has/can` booleans (`isCeilingReached`, `hasWorkedExample`), named constants for both ceilings, purpose comment
  per file, doc comment per export, functions under 40 lines.
- **Art V (Testing, TDD)**: ✅ Red→green per task. The generator being pure means the *document itself* is under test,
  not merely the plumbing around it.
- **Art VI (Documentation)**: ✅ One CHANGELOG entry. `specs/025-*/` is the exempt pipeline artifact.
- **Art VII (Framework-first)**: ⚠️ **One drift** — the markdown→Confluence storage renderer (see Complexity
  Tracking). Everything else composes existing helpers.
- **Art X (Verification & proof)**: ✅ The feature *is* verification. Quickstart validates by following the document's
  own links and confirming Jira returns the counts it claims — the document proving itself.
- **Art XI (Output restraint)**: ✅ No dashboard artifact; no phase narration.

**Gate result: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/025-personal-flow-audit/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 — R1..R9
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── audit-document.md    # document model + generator (the core contract)
│   ├── evidence-links.md    # the three link kinds and the reconciliation
│   └── publish-routes.md    # clipboard (P1) and Confluence write (P2)
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 — /speckit-tasks, NOT created here
```

### Source Code (repository root)

```text
client/src/views/ReportsHub/
├── personalFlow.ts                    # CHANGED — retain evidence for ONE nominated issue (R1)
├── flowAuditMetrics.ts                # NEW — pure: metric meanings, formulas, worked-example rendering
├── flowAuditLinks.ts                  # NEW — pure: the three link kinds (R2)
├── flowAuditDocument.ts               # NEW — pure: roster results → markdown (composes the two above)
├── flowAuditPublish.ts                # NEW — P2 only: markdown → Confluence storage (Art VII drift)
└── PersonalFlowTab.tsx                # CHANGED — paged fetch + ceilings, progress/cancel, copy & publish controls

client/src/views/ReportsHub/
├── flowAuditMetrics.test.ts           # NEW
├── flowAuditLinks.test.ts             # NEW
├── flowAuditDocument.test.ts          # NEW
└── flowAuditPublish.test.ts           # NEW (P2)
```

**Structure Decision**: Everything that matters is pure and lives in `flowAudit*.ts` beside the engine it renders —
matching the repo's established shape, where `personalFlow.ts`, `agingTriage.ts` and `issueAging.ts` are pure modules
sitting beside their tabs. `PersonalFlowTab.tsx` gains controls and a paged fetch, but **no document logic**.

The split into three pure modules is deliberate: **metrics** (what a number means and how it is derived), **links**
(how a claim is made checkable), and **document** (how it is laid out) fail for different reasons and are tested
separately. `flowAuditPublish.ts` is isolated so P1 ships without it existing.

## Phase 1 — Design summary

**Data model** ([data-model.md](./data-model.md)): `MetricDefinition` (meaning, formula, how to render a worked
value), `PersonAuditRow` (a person's figures plus their link set), `ReconciliationRow` (fetched / credited / excluded,
each with its own link), `WorkedExample` (the one issue shown in full), and `RunEnvelope` (roster, window, timestamp,
ceilings reached).

**Contracts**:
- [`audit-document.md`](./contracts/audit-document.md) — the generator's signature, the document's section order, and
  the per-column/per-row economy that keeps a team document readable. **Highest-value contract.**
- [`evidence-links.md`](./contracts/evidence-links.md) — the three link kinds, and why conflating them breaks FR-012.
- [`publish-routes.md`](./contracts/publish-routes.md) — clipboard (P1), and the Confluence write with its
  whole-page-replace warning (P2).

**Quickstart** ([quickstart.md](./quickstart.md)) — validation here is unusual: the document is checked **by using
it**, following its own links and confirming Jira returns the counts it claims.

**Agent context**: `CLAUDE.md` updated to point at this plan.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| **`flowAuditPublish.ts` — a markdown→Confluence storage renderer** (Art VII drift) | Confluence pages are storage-format XHTML. The codebase converts storage→text (`confluenceStorageText.ts`) but **nothing converts the other way** (R5); PI Review hand-builds its own XHTML rather than rendering markdown. FR-020a requires publishing the document directly. | Adding a markdown library (rejected — a new dependency for a document whose markup we author entirely); making the generator emit storage XHTML directly (rejected — it would stop being readable as plain text, breaking NFR-003 and the P1 clipboard path); hand-building XHTML as PI Review does (rejected — that abandons the single-source document, so the clipboard copy and the published page could diverge, violating FR-020b). **The drift is bounded**: it renders only the constructs this document emits — headings, paragraphs, tables, links, bold, code spans — and must carry a comment saying it is a document-specific renderer, not a general markdown engine. |

**Not a drift**: `flowAuditLinks.ts` composes the existing `buildSearchJql` and `buildJiraIssueNavigatorUrl` rather
than constructing URLs itself. The "three link kinds" are a selection rule over helpers that already exist.
