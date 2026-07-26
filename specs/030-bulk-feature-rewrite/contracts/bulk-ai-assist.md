# Contract: Bulk Re-write AI Envelope (`rewrite/ai/bulkRewriteAiAssist.ts`)

Mirrors `compositionAiAssist.ts` for a batch. Propose-only, gated by `useAiAssistStore`, rendered via `PoAiPanel`. Reuses `featureDocSections` for the format. There is **no automated/background AI** — the operator runs the prompt and pastes the reply.

## Functions

```ts
buildBulkRewritePrompts(items: { jiraKey: string; original: CapturedOriginal }[], options?: { maxCharsPerPrompt?: number }): string[]
parseBulkRewriteReply(replyText: string, knownKeys: string[]): BatchReplyParseResult
```

### `buildBulkRewritePrompts`
- Returns an **ordered array of prompts**: one when the batch fits `maxCharsPerPrompt`, otherwise the issues split across several (each issue whole in one prompt — never split mid-issue), and each prompt states "part N of M".
- **Concrete cap**: `maxCharsPerPrompt` defaults to **16000 characters**, and each issue's source text is capped at **4000 characters** (matching composition's `MAX_SOURCE_TEXT_LENGTH`) before assembly — both named constants, so the split is deterministic and testable. A single issue that still exceeds the cap gets its own prompt (never dropped).
- Each prompt carries every included issue's key + current summary/description/AC (each source capped like composition), the nine-section rules + the three validation markers, the never-AI-attribution rule, and a reply template ending in the envelope:
  `{"kind":"featureRewriteBatch","items":[{"key":"ABC-1","description":"…","acceptanceCriteria":"…"}]}`.
- No issue is ever dropped from the set (Edge Cases); the split is reported to the operator.

### `parseBulkRewriteReply`
- `JSON.parse(extractJsonPayload(reply))`; guard `kind === 'featureRewriteBatch'` else throw a labeled error.
- Per item: `key` must be in `knownKeys` — else `rejected[]` with a reason. `description` runs through `normalizeFeatureDescription` + `stripAiAttribution` (all nine sections, missing flagged, no AI attribution). Missing/blank `description` → counted in `unparsedCount`, that item skipped.
- Returns `{ rewritesByKey, rejected, unknownKeys?, unparsedCount }`. Never throws on field-level problems; only a missing/blank reply or wrong `kind` throws. **Ingesting multiple prompt-parts merges by key** (later parts add keys, don't clobber).

## Guarantees
- Batch output is byte-identical in format to single-issue composition (same `featureDocSections`).
- A key not in the batch can never write anything (rejected on ingest).
- Determinism: same reply + knownKeys → same result.

## Test obligations (TDD, vitest)
- One prompt for a small batch; multiple ordered "part N of M" prompts past the cap, with every key present across the set.
- Prompt contains the nine labels, the markers, the no-AI rule, the envelope template.
- Reply parse: keys mapped; unknown key → rejected; missing description → unparsedCount; wrong kind/empty → throws; description normalized to nine sections + stripped of AI attribution.
- Merging two parts' replies unions the keys.
