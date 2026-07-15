# Phase 1 Data Model: Single AI Unlock + PI Review AI Assistance

**Feature**: `016-pi-review-ai-assist` | **Date**: 2026-07-15

Nothing here is persisted. Every entity below lives in component state for the life of one AI Assist run and is gone
on unmount — except the four cells an accepted suggestion writes, which become ordinary unsaved `PiReviewRow` edits
indistinguishable from typing.

---

## Existing entities (unchanged, listed for boundary clarity)

### `AiAssistUnlockState`

Source: `client/src/store/aiAssistStore.ts:32`. **Unchanged by this feature.**

| Field | Type | Notes |
|---|---|---|
| `isAiAssistUnlocked` | `boolean` | Session-scoped; persisted to `sessionStorage['tbxAiAssistUnlocked']` |

Part 1 changes only **how many components can write it** (five → one). The shape, the key, the passphrase and the
session scope are untouched.

### `PiReviewRow`

Source: `client/src/views/ArtView/piReviewTable.ts:83-95`. **Shape unchanged.** Reproduced here because which fields
an accepted suggestion may touch *is* the feature's central constraint.

| Field | Owner | May AI write it? |
|---|---|---|
| `rowId` | internal | ❌ |
| `feature` | identity (set at pull) | ❌ |
| `carryOver` | human | ❌ |
| `priority` | Jira mirror | ❌ |
| `dependency` | Jira mirror (rebuilt from links every load) | ❌ |
| `risks` | Jira mirror (rebuilt from links every load) | ❌ |
| `committed` | human | ❌ |
| **`devWork`** | human | ✅ **tick/untick** — reconcile passes it through, so it survives a reload |
| **`testSupport`** | human | ✅ **tick/untick** |
| **`pointEstimate`** | Jira, with a gap | ✅ **replace** |
| **`notes`** | human, append-only | ✅ **append** |

Formalised in [contracts/cell-write-contract.md](./contracts/cell-write-contract.md).

---

## New entities

### `FeatureSizingScale` — the T-shirt rubric

A frozen module constant in `ai/piReviewSizing.ts`. **One definition, two readers**: the prompt builder embeds it so
the model sizes against it, and `PiReviewSizingCard` renders it for manual sizing. They can never disagree.

| Size | Points | Acceptable without user input? |
|---|---|---|
| `XS` | 10 | ✅ |
| `S` | 20 | ✅ |
| `M` | 40 | ✅ |
| `L` | 60 | ✅ |
| `XL` | 80 | ✅ |
| `XXL` | *none* (`100+`) | ❌ — user must supply a number (research R-7) |

**Validation rules**
- The size vocabulary is closed. Anything outside it is `unparsed` — never coerced (FR-020).
- Points are **derived from the size**, never taken from the reply. A reply claiming `M` with `45` is a contradiction
  the scale wins (FR-020); the `45` is discarded, not honoured.
- `XXL` has no derived number by design. `100+` is a floor, not a value.

Source of truth: GitHub #147 and the linked Confluence guidance (spec A-3).

### `PiReviewAiFeatureContext` — one Feature's prompt input

Assembled by `ai/piReviewAiFetch.ts` from the row plus an on-demand Jira fetch. **Read-only. Never written to a
`PiReviewRow`** — that is what keeps description/AC from becoming Jira-owned columns (research R-2).

| Field | Type | Source | Absent → |
|---|---|---|---|
| `issueKey` | `string` | `extractPiReviewFeatureKey(row.feature)` | item is not includable |
| `summary` | `string` | issue `fields.summary` | `''` |
| `priority` | `string \| null` | issue `fields.priority.name` | `null` |
| `description` | `string \| null` | issue `fields.description` → `normalizeRichTextToPlainText` | `null` |
| `acceptanceCriteria` | `string \| null` | `readAcceptanceCriteriaText(issue, resolvedAcFieldIds)` | `null` |
| `linkedDependencies` | `string[]` | the row's `dependency` cell, split on `\n` | `[]` |
| `linkedRisks` | `string[]` | the row's `risks` cell, split on `\n` | `[]` |
| `currentPointEstimate` | `string` | `row.pointEstimate` | `''` |
| `hasExistingNotes` | `boolean` | `row.notes.trim() !== ''` | `false` |

**Validation rules**
- `null` means **absent** and MUST be rendered to the prompt as an explicit absence, not an empty string (FR-015).
  `readAcceptanceCriteriaText` already returns `null` for this exact purpose.
- `linkedDependencies` / `linkedRisks` are split on `\n`, **not** `, ` — `dedupeAndFormatLinkedIssues` joins with
  newlines and each entry is shaped `KEY - Summary (Status)` (research R-4).

### `PiReviewAiSuggestion` — one AI result for one Feature

| Field | Type | Notes |
|---|---|---|
| `issueKey` | `string` | Must match a Feature on the page or the item is discarded (FR-021) |
| `size` | `'XS'\|'S'\|'M'\|'L'\|'XL'\|'XXL' \| null` | `null` when the reply's size was outside the scale |
| `derivedPoints` | `number \| null` | From the scale, never the reply. `null` for `XXL` and for `size === null` |
| `userSuppliedPoints` | `number \| null` | Only ever set for `XXL`, by the user, before acceptance |
| `riskNote` | `string \| null` | Explanation of the risks; becomes a `Risk note:` line |
| `dependencyNote` | `string \| null` | Explanation of the dependencies; becomes a `Dependency note:` line |
| `implementationNote` | `string \| null` | For the ART/RTE; becomes an `Implementation note:` line |
| `rationale` | `string \| null` | Shown in review to explain the size; **never written to a cell** |
| `state` | `SuggestionState` | See below |

**Validation rules**
- Every note field is capped at **`MAX_AI_NOTE_LENGTH = 300`** characters before it can be applied, with an ellipsis
  on truncation. This is the notes column's **first** length cap — nothing bounds it today, and Confluence renders
  the whole cell on one line (research R-4).
  **Why 300**: it matches the existing house constant `MAX_TEXT_SIGNAL_LENGTH = 300` in
  `client/src/views/FeatureCanvas/ai/canvasAiAssist.ts:84`, which condenses text signals with the same
  `slice(0, N) + '…'` shape. Reusing the number keeps one notion of "a condensed AI text field" in the codebase.
  With three note kinds, a row gains at most ~900 characters — long, but bounded and reviewable, and the user sees
  every character before accepting.
- Blank-ish note values (`''`, `n/a`, `none`, `no`, `-`, `--`) are dropped by the existing
  `isMeaningfulFreeText` guard inside `appendUniqueNoteLine`. No new blank-handling logic.
- `rationale` exists to make Accept an informed click (the `describeSuggestionAction` idea from
  `canvasAiAssist.ts:340`), and is deliberately **not** persisted anywhere.

### `SuggestionState` — the review lifecycle

```text
                    ┌──────────────► rejected      (user dismisses; row untouched)
                    │
   parsed ──► pending ──► accepted                 (applied to the row; page now dirty)
                    │
                    └──────────────► needsPoints ──► pending
                                     (XXL only; resolves once the user supplies a number)

   unparsed                                        (terminal; reported, never applicable)
```

| State | Meaning | Can be accepted? |
|---|---|---|
| `pending` | Parsed, valid, awaiting the user | ✅ |
| `needsPoints` | `size === 'XXL'` and no `userSuppliedPoints` yet | ❌ until a number is supplied (R-7) |
| `accepted` | Written to the row; the page is dirty | — terminal |
| `rejected` | Dismissed; the row was never touched | — terminal |
| `unparsed` | Reply item was malformed or its key is unknown | ❌ ever (FR-020, FR-021, FR-024) |

**Invariants**
- **I-1**: A suggestion in any state other than `accepted` has had **zero** effect on any `PiReviewRow`.
- **I-2**: `accepted` implies the page reports unsaved changes (FR-022) and implies **no** Confluence write occurred.
- **I-3**: `unparsed` is terminal — it can never transition to `pending`. A bad item is reported, never rescued.
- **I-4**: Accepting one suggestion changes no other suggestion's state (FR-032).

### `PiReviewAiRunResult` — the outcome of parsing one reply

| Field | Type | Notes |
|---|---|---|
| `suggestions` | `PiReviewAiSuggestion[]` | Everything that parsed, in page-row order |
| `unknownKeys` | `string[]` | Keys the reply named that are not on the page — reported, never applied (FR-021) |
| `unparsedCount` | `number` | Items that failed to yield a usable suggestion (FR-024) |

**Validation rules**
- A reply whose `kind !== 'piReview'` is rejected **whole** — that is a wrong reply, not a partial one
  (contract, research R-3).
- Beyond that, parsing is **lenient per field, strict per key**: an invalid field drops to `null` and the row
  survives; a missing or unknown `issueKey` discards the item into `unknownKeys`/`unparsedCount`.

---

## Relationships

```text
PiReviewRow (n) ──derives──► PiReviewAiFeatureContext (n) ──┐
                                                            ├──► prompt (1)
FeatureSizingScale (1) ─────────────────────────────────────┘
                                    │
                              AI reply (1)
                                    │
                                    ▼
                         PiReviewAiRunResult (1)
                                    │
                                    ├──► PiReviewAiSuggestion (n)  ──accept──► PiReviewRow
                                    │        └── touches only { pointEstimate, notes }
                                    ├──► unknownKeys[]   (reported only)
                                    └──► unparsedCount   (reported only)
```

One run : one prompt : one reply : N suggestions : ≤N accepted rows (Q3 / FR-031).

---

## State the feature does NOT introduce

Called out because their absence is a design decision, not an omission:

- **No persistence.** Suggestions are not stored, cached or resumed. Navigating away discards them — which is why a
  reply arriving after unmount is a no-op rather than a stale write (spec edge case).
- **No provenance.** An accepted estimate is not marked "from AI". Q2 chose "identical to a typed estimate", and
  provenance would be the mechanism by which it *differed*. Its absence is what makes FR-029 true and FR-030
  necessary.
- **No new settings.** The AC field id is resolved at runtime by the existing
  `resolveAcceptanceCriteriaFieldIds()` (research R-2), so nothing is added to `tbxARTSettings` or to
  `SHARED_ART_SETTINGS_FIELD_NAMES`.
- **No server state.** Feature 015's scheduler never sees any of this (FR-037).
