# Contract: AI Assist Envelope (`ArtView/ai/piPlanAiAssist.ts`)

Mirrors the shipped `piReviewAiAssist.ts`. Propose-only: the AI proposes **only the Feature→Story breakdown**; the engine owns all scheduling, assignment, and dates (FR-025, FR-054). Gated by `useAiAssistStore` (Ctrl+Alt+Z), rendered via `ReportAiPanel`.

## Functions

```ts
buildPiPlanAiPrompt(context: PiPlanPromptContext): string
parsePiPlanAiReply(replyText: string, knownFeatureKeys: string[]): PiPlanParseResult
```

### PiPlanPromptContext (the FR-001–FR-011 input set)
Assembled by `piPlanAiFetch.ts` from reused sources: `piName` + parsed window; sprint calendar; working-day/holiday calendar; roster with `roleCapabilities`; per-person + team per-sprint capacity (points); each Feature `{key, summary, sizePoints, priorityRank, dependencyKeys, targetFixVersion, existingChildren}`; the release schedule; the encoded rule constants (70/30, INT≤24h, REL+5 working days, PROD-on-fixVersion, monthly target, DoD-to-INT); the splitting rubric (testable-output definition, 13-pt max, independent-testability); the velocity effort→duration basis; the issue-shape/field mapping.

## Reply envelope

The prompt ends with a literal JSON template the model must fill:

```json
{
  "kind": "piPlan",
  "items": [
    {
      "featureKey": "ABC-123",
      "stories": [
        { "summary": "…", "sizePoints": 8, "hasTestableOutput": true },
        { "summary": "…", "sizePoints": 5, "hasTestableOutput": false }
      ],
      "rationale": "why this breakdown"
    }
  ]
}
```

## Parsing rules

- `JSON.parse(extractJsonPayload(replyText))` (REUSE `utils/extractJsonPayload.ts`); guard `kind === 'piPlan'` else throw a labeled error.
- **Strict per key, lenient per field**: an item whose `featureKey` is not in `knownFeatureKeys` → dropped into `rejected[]` with a reason (not written). A story missing `sizePoints` or with a non-numeric size → that story dropped, counted in `unparsedCount`; the rest of the Feature survives.
- `hasTestableOutput` defaults to `true` when omitted (FR-021 default).
- Returns `PiPlanParseResult { suggestions: BreakdownSuggestion[], rejected: {featureKey,reason}[], unknownKeys: string[], unparsedCount: number }`.
- Never throws on field-level problems; only a missing/blank reply or wrong `kind` throws.
- **No dates are read from the reply** — even if present they are ignored (FR-054).

## Apply (`piPlanAiApply.ts`)

```ts
applyBreakdownSuggestion(feature: FeatureInput, suggestion: BreakdownSuggestion): StorySuggestion[]
```
Pure. Attaches `matchExistingKey` where a suggested story matches an `ExistingChild` (idempotency), and passes `sizePoints`/`hasTestableOutput` through. Accepting is per-item in the UI; nothing is scheduled or written until the PO accepts.

## Test obligations (TDD, vitest)

- Well-formed reply → suggestions in Feature order; `rationale` preserved.
- Unknown `featureKey` → `rejected[]`, others unaffected.
- Missing `kind` / empty reply → throws labeled error.
- Story missing size → dropped, `unparsedCount++`, sibling stories kept.
- A date field present in the reply is ignored.
- Locked AI (`isAiAssistUnlocked=false`) → panel renders nothing (gate).
