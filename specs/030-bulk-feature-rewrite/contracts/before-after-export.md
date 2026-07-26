# Contract: Before/After Export (`rewrite/rewriteBatchExport.ts`)

Pure builders that turn the batch (or a chosen subset) into a self-contained, reviewer-readable artifact in two forms. No AI attribution.

## Functions

```ts
buildMarkdownExport(items: BatchExportInput[]): string
buildHtmlExport(items: BatchExportInput[], title?: string): string
```

`BatchExportInput = { jiraKey: string; original: CapturedOriginal; proposed: ProposedRewrite }`. The caller filters out excluded (e.g. `rejected`) items before calling (FR-032).

## `buildMarkdownExport`
- One section per issue: a heading with the Jira key, then a clearly labeled **Before** (original summary/description/AC) and **After (proposed description + acceptance criteria)**. The After label explicitly names its scope so the unchanged **summary** (not re-written) is never misread as removed.

## `buildHtmlExport`
- A single self-contained HTML document (inline styles, no external assets) rendering each issue's before/after **side by side**, readable by opening the file in any browser. Includes the issue key per row.

## Guarantees
- Every included issue's key, original, and current proposal are present and unambiguously paired (FR-031).
- Output contains **no** phrase attributing the content to AI (SC-005) — the proposals are already AI-attribution-stripped, and the export adds none.
- Deterministic: same input → same output. Pure (no DOM, no clock, no I/O — the tab handles copy/download).

## Test obligations (TDD, vitest)
- Markdown: each issue's key + Before + After present; excluded items absent (caller-filtered fixture).
- HTML: self-contained (no `src=`/`href=` to external hosts), each issue's key + both columns present.
- Neither output contains AI-authorship phrasing.
- Empty input → an empty-but-valid document (no crash).
