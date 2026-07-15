# Contract: The PI Review AI reply envelope

**Feature**: `016-pi-review-ai-assist` | **Consumers**: `ai/piReviewAiAssist.ts` (builder + parser),
`PiReviewAiPanel.tsx`

This is the interface between NodeToolbox and whatever model answers the prompt — via either the automatic dispatch
or a human pasting a reply. It follows the **established** `{kind, items[]}` shape used by Canvas suggestions, the
Canvas master plan, Aging triage and Personal Flow (research R-3), so it works with the shared object-rooted
`extractJsonPayload` unmodified and gains the `kind` mismatch guard for free.

## The envelope

````jsonc
{
  "kind": "piReview",
  "items": [
    {
      "issueKey": "ALPHA-1",
      "size": "M",
      "riskNote": "Vendor SLA is unconfirmed for the batch window.",
      "dependencyNote": "PLAT-5 must ship the auth shim first; otherwise this slips a sprint.",
      "implementationNote": "Needs a BAT window with Jana's team — flag at PI planning.",
      "rationale": "Two integrations and a migration, no new UI."
    }
  ]
}
````

Wrapped in a ```` ```json ```` fence or surrounded by prose is fine — `extractJsonPayload` strips fences and slices
first `{` to last `}`.

## Field rules

| Field | Required | Type | Rule |
|---|---|---|---|
| `kind` | ✅ | `"piReview"` | Any other value → **reject the whole reply** |
| `items` | ✅ | array | Missing/not-an-array → treated as empty |
| `items[].issueKey` | ✅ | string | Must match a Feature on the page (case-insensitive). Missing → `unparsedCount++`. Unknown → `unknownKeys[]` |
| `items[].size` | ➖ | `XS\|S\|M\|L\|XL\|XXL` | Outside the vocabulary → `size: null`, **row survives** |
| `items[].riskNote` | ➖ | string | Capped at `MAX_AI_NOTE_LENGTH`; blank-ish → dropped |
| `items[].dependencyNote` | ➖ | string | Capped; blank-ish → dropped |
| `items[].implementationNote` | ➖ | string | Capped; blank-ish → dropped |
| `items[].devWork` | ➖ | boolean | Strictly boolean. Absent/`null`/a string → no verdict, cell untouched |
| `items[].testSupport` | ➖ | boolean | Same |
| `items[].rationale` | ➖ | string | Review display only — **never written to a cell** |

**The box fields are requested only when the page's table has those columns.** Dev Work and Test
Support are optional PI Review columns; asking for a verdict the table cannot record would produce a
suggestion that silently goes nowhere (`PiReviewAiColumnAvailability`).

**`points` is deliberately not in the contract.** The model supplies a **size**; NodeToolbox derives the number from
the scale. This is what makes FR-020 structurally true rather than a validation someone has to remember: the model
has no channel through which to contradict the rubric. If a model volunteers a `points` field, it is ignored.

## Parse strictness: lenient per field, strict per key

| Situation | Outcome |
|---|---|
| `kind` mismatch | **Whole reply rejected.** A wrong reply is not a partial one |
| Not JSON at all | Whole reply rejected with the `extractJsonPayload` error |
| Item missing `issueKey` | Item discarded → `unparsedCount++` |
| Item's `issueKey` not on the page | Item discarded → `unknownKeys[]`, surfaced to the user (FR-021) |
| Item's `size` invalid | `size: null`; **the item survives** with its notes |
| Item's note field blank/`n/a` | Field dropped; the item survives |
| Item has no usable content at all | `unparsed` |

This is intentionally **more lenient than `parseCanvasAiResponse`** (`canvasAiAssist.ts:272`), which throws on any bad
enum. That is right for a small canvas batch and wrong here: one item per Feature across a whole PI means a single
bad enum must not discard every good suggestion (FR-024). Precedent for the lenient posture: `parseMasterPlan`
(`canvasAiAssist.ts:314`).

## What the prompt must instruct

Derived from FR-013 – FR-017:

1. **Per Feature, supply**: `issueKey`, `size`, and — where there is something worth saying — `riskNote`,
   `dependencyNote`, `implementationNote`, `rationale`.
2. **Size against the embedded scale** (XS/S/M/L/XL/XXL), enumerated inline. Do **not** supply a point number.
3. **Use only the issue keys listed.** Never invent a Feature. (The parser enforces this too — belt and braces, per
   `AiSuggestionPanel.tsx:197`.)
4. **Absent input is absent.** Where a Feature has no description or acceptance criteria the prompt says so
   explicitly; a size with no basis should say so in `rationale` rather than be guessed silently.
5. **Notes are for what Jira's links cannot say** — the *why*, not a restatement of the linked keys. The keys are
   already in the Dependency/Risks columns and the AI must not attempt to set them.
6. **Reply with the JSON envelope only.**

The scale is embedded from the single `FeatureSizingScale` constant, so the rubric in the prompt and the rubric on
screen are the same object.

## Worked example

**Page has**: `ALPHA-1` (no estimate), `ALPHA-2` (estimate 8, notes already written).

**Reply**:
````json
{"kind":"piReview","items":[
  {"issueKey":"ALPHA-1","size":"M","riskNote":"Vendor SLA unconfirmed.","rationale":"Two integrations."},
  {"issueKey":"ALPHA-2","size":"HUGE","implementationNote":"Needs a BAT window."},
  {"issueKey":"GHOST-9","size":"S"}
]}
````

**Result**:

| Item | Outcome |
|---|---|
| `ALPHA-1` | `pending` — size `M`, `derivedPoints: 40`, one `Risk note:` line |
| `ALPHA-2` | `pending` — `size: null` (`HUGE` is outside the scale, dropped not coerced); survives with its `Implementation note:` line. Its existing estimate of 8 is **not** touched, since there is no valid size |
| `GHOST-9` | Discarded → `unknownKeys: ['GHOST-9']`, reported to the user |

Nothing has been written. Every outcome above is a *proposal* until the user accepts it.
