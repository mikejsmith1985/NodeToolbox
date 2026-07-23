# Contract: Publish Routes

**Modules**: `PersonalFlowTab.tsx` (controls) + `client/src/views/ReportsHub/flowAuditPublish.ts` (P2 only)
**Feature**: `025-personal-flow-audit` | **Satisfies**: FR-020, FR-020a, FR-020b, FR-021, FR-021a, FR-022, NFR-006, NFR-006a

Two routes to the same document. **P1 ships first and has no dependency on P2.**

---

## P1 — Copy to clipboard

**Route**: `buildFlowAuditDocument(...)` → markdown string → clipboard.

No conversion needed: Confluence converts pasted markdown itself, and the plain text is legible anywhere else
(NFR-003).

**Rules**:
- Use the **async, result-returning** `copyToClipboard` (`JiraTemplateMaker/lib/copyToClipboard.ts`), not the
  fire-and-forget one. A silently failed copy of a long report means the user pastes stale clipboard content into
  Confluence and never knows — far worse than a failed copy of a short JQL string.
- Success and failure MUST both be visible to the user.
- The control is disabled while an analysis is running, and while no results exist.

**This is the whole of P1.** No new module, no conversion, no Confluence dependency.

---

## P2 — Publish directly to a Confluence page

**Route**: markdown → Confluence storage XHTML → `updateConfluencePage` (`confluenceApi.ts:244`).

### The renderer (`flowAuditPublish.ts`) — Article VII drift

The codebase converts storage → text (`confluenceStorageText.ts`) but **nothing converts the other way**; PI Review
hand-builds its XHTML rather than rendering markdown (R5).

**Bounded scope**: this renders only the constructs section-ordered documents emit — headings, paragraphs, tables,
links, bold, code spans. It is a **document-specific renderer, not a general markdown engine**, and must carry a
comment saying so, or a later reader will reasonably assume it handles arbitrary markdown and feed it something it
cannot render.

**Rejected alternatives** (recorded so they are not re-litigated): a markdown library — a new dependency for markup we
author entirely; emitting storage XHTML from the generator directly — it would stop being readable as text, breaking
NFR-003 and P1; hand-building XHTML like PI Review — abandons the single-source document, so the clipboard copy and
the published page could diverge (FR-020b).

### Whole-page replace

Per the Q7 decision, publishing **replaces the entire page**. That discards anything already there, so the warning is
load-bearing, not a formality.

| # | Rule | Requirement |
|---|---|---|
| P1 | Before writing, the user is told **by page name** that current content will be replaced | FR-021 |
| P2 | The user can abandon at that point | FR-021 |
| P3 | A page carrying a **previous run of this report** is recognised and presented as the routine case | FR-021a |
| P4 | A page carrying **unrelated content** is presented as the likely-mistake case | FR-021a |
| P5 | A failed publish leaves the document still copyable via P1 — never lost | FR-022 |

**On P3/P4**: the document's header (section 1) is a recognisable marker. Reading the target page before writing and
checking for it distinguishes "re-publishing my report" from "about to destroy someone's page" — and without that
distinction the warning either cries wolf on every routine run or fails to warn when it matters.

---

## Progress and cancellation (NFR-006, NFR-006a)

These belong to the **analysis**, not the document, but gate both routes.

| # | Rule |
|---|---|
| C1 | Progress shows how far through the roster the run is — which person, how many of how many — not a bare spinner |
| C2 | The run is cancellable |
| C3 | Cancelling abandons the run; previously displayed results stay on screen |
| C4 | A cancelled run produces **no document** |
| C5 | Cancellation is checked between per-person analyses and between pages within a person (R7) |

**C4 is the one that matters.** A part-finished team report that reads as complete is the exact failure this feature
exists to prevent — and it would be worse than the status quo, because it would carry all the trappings of an audit.

---

## Required tests (red first — Article V)

**P1 — clipboard**
- Copy places the generated document on the clipboard.
- A failed copy surfaces a visible error (not silence).
- The control is disabled while running and when there are no results.

**P2 — renderer** (`flowAuditPublish.test.ts`, pure)
- Each supported construct renders to valid storage XHTML: headings, paragraphs, tables, links, bold, code spans.
- A link renders as a working anchor — the document's whole value depends on the links surviving conversion.
- Special characters in a person's display name are escaped and cannot corrupt the page or break a link (edge case).
- Round-trip sanity: rendering then reading back with `readConfluenceStorageText` recovers the document's text.

**P2 — publish flow**
- A warning naming the target page appears before any write.
- Abandoning performs no write.
- A page with a previous run is presented as routine; a page with unrelated content is presented as a likely mistake.
- A failed write leaves the copy path working (P5).

**Progress and cancellation**
- Progress reports roster position, not just busy-ness.
- Cancelling mid-run stops further per-person fetches.
- Cancelling produces no document and leaves prior results displayed (C3, C4).
