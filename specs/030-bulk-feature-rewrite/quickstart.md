# Quickstart & Validation: Bulk Feature Re-write

Proves the batch workflow end to end. Unit scenarios cover the pure/logic layer; the live scenario proves capture, submit, and drift against a real Jira.

## Prerequisites

- Repo on `feature/030-bulk-feature-rewrite`; `npm install` done.
- PO Tool open on a team; AI unlockable (Ctrl+Alt+Z) for the batch prompt/ingest.
- A few existing Feature keys to re-write; Jira reachable via the proxy (VPN up) for capture/submit.

## Unit validation (no Jira) — run first (TDD)

```bash
cd client && npx vitest run src/views/PoTool/rewrite
# regression: single-issue composition + write path must stay green
cd client && npx vitest run src/views/PoTool/ai src/views/PoTool/jira
```

Expected: new suites green; existing composition/commit suites unchanged. Covers the contracts:
- bulk-ai-assist: one vs chunked prompts (every key present), envelope template, reply parse (unknown key rejected, missing description counted, wrong kind throws, description normalized + AI-attribution stripped, multi-part merge).
- batch-store: save/load/list/delete round-trips; export→import deep-equal; malformed import throws; private-mode no-op.
- before-after-export: Markdown + self-contained HTML contain each issue's key + before + after; no external assets; no AI attribution.
- submit-drift: approved+matching → written; approved+changed → held (no write) unless submit-anyway; rejected/submitted → skipped; one failure non-fatal.

## Live end-to-end (manual — Article X evidence)

1. Open the **Bulk Re-write** tab; create a batch; paste several Feature keys → confirm each issue's **before** (summary/description/AC) is captured, and any bad key is reported without failing the batch. *(US1, FR-001/002)*
2. Unlock AI → generate the prompt (one, or an ordered set if large) → run it in your assistant → paste the reply → confirm each issue gets a **nine-section** proposed re-write, thin sections flagged, none AI-attributed. *(US1, FR-012)*
3. Open an issue → confirm **before/after** side by side; **edit** a proposal; mark one issue **approved**, one **rejected**. Reload the app → confirm edits + states persisted. *(US2, SC-002)*
4. **Export** → copy the Markdown and download the HTML; open the HTML in a browser → confirm every included issue's before/after reads standalone and rejected issues are absent. *(US3, SC-003)*
5. **Submit** with two approved → confirm only those two write to Jira (description + AC via the configured fields), each with its own result; the rejected one is untouched. Re-submit → the two are **not** re-written. *(US4, FR-040/043)*
6. **Drift**: before submitting, change one approved issue's description in Jira → submit → confirm that item is flagged **changed-since-capture** and held, the others still submit, and you can choose **re-capture / submit-anyway / skip**. *(US5, FR-053, SC-007)*
7. **Portability**: export the batch to a file, delete it locally, import the file → confirm the full batch (originals, proposals, edits, states) returns. *(FR-052)*
8. **AI-rules**: confirm the prompt/ingest are hidden while AI is locked, and nothing wrote to Jira at any point without your explicit approve + submit. *(SC-006)*

## Done when

Unit + regression suites green, and live steps 1–8 pass with Jira evidence (captured befores, submitted afters on the approved keys, a held changed-since-capture item, and a clean export→import round-trip).
