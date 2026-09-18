# Contract: AI Rounds (prompt out, JSON reply in)

**Modules**: `intake/ai/intakeClassifyRound.ts`, `intake/ai/intakeMatchRound.ts`, `intake/ai/intakeDraftRound.ts` —
pure. **Covers**: FR-005 – FR-008, FR-011, FR-018, FR-021, FR-026, FR-027, US1, US3-2/3, US4-1/2.

## 0. Rules common to all three

- **Propose-only**. No round causes a Jira write (FR-027). Each prompt is copied out through `PoAiPanel` and the reply
  pasted back. `PoAiPanel` renders nothing when locked.
- **Only open decisions are asked** (FR-005). An item whose relevant slots are all settled is not in the prompt.
- **Replies are object envelopes** `{ "kind": "<kind>", "items": [ … ] }`, parsed with `extractJsonPayload`.
- **Parsers never throw.** Each returns `IngestOutcome<TAccepted> = { accepted: TAccepted[]; rejected: { itemId: string | null; reason: string }[] }`.
  Whole-reply failures (no JSON, bad JSON, wrong kind, missing `items`) → `accepted: []`, one rejection with
  `itemId: null`, and **no** `aiAttempts` increment. The PO simply pastes again; the reply was never about a decision.
- **Per-decision failures** (for example, an invalid owner share for `item-4`) increment that slot's `aiAttempts` via
  `recordAiRejection`. Two failures send the slot to the PO (FR-007).
- **Answers to settled slots are ignored silently** (edge case "AI answers a question it was not asked"), and
  PO-settled slots can never be touched (INV-1).
- **Item ids** are matched case-insensitively after trimming. An unknown id → rejection `"item-99" is not in this intake`.
- **Prompt text never says "AI" to the PO.** The prompt itself addresses the assistant, but it only renders inside
  `PoAiPanel`, which the no-AI scan never sees because the panel returns `null` when locked.

## 1. Classify — `epicIntakeClassify` (step `sortNotes`, also fills `decideOwners` inputs)

```ts
export const CLASSIFY_REPLY_KIND = 'epicIntakeClassify';
export function buildClassifyPrompts(intake: EpicIntake): string[];            // one per part (R-006)
export function parseClassifyReply(replyText: string, intake: EpicIntake, partItemIds: readonly string[]): IngestOutcome<ClassifyAnswer>;
export function applyClassifyAnswers(intake: EpicIntake, outcome: IngestOutcome<ClassifyAnswer>, nowIso: string): EpicIntake;
```

**The prompt contains**:

- The numbered lines of this part, verbatim (`[12] o (1.2M) XL Enrollment`).
- Toolbox's baseline grouping (`item-3: lines 11–15`).
- For each item, which slots are open.
- The closed vocabularies.
- The instruction to return every item in the part.

**Reply item**:

```json
{ "id": "item-3",
  "lines": [11, 12, 13, 14, 15],
  "title": "Core Integration",
  "kind": "work",
  "enrollmentShare": 70,
  "searchTerms": ["core integration", "facets integration"],
  "labelProposal": "Roadmap",
  "reason": "Sizes put most of the effort in Enrollment" }
```

The reply may also set lines aside: `"setAside": [{ "line": 2, "reason": "headingOrProse" }]`.

**Validation, per item**:

- `lines`:
  - Integers in this part's line set.
  - ≥ 1 per item.
  - A line claimed by two items → both claims rejected. The line stays with its baseline owner, and the conflict is
    reported (US1-4).
  - A regrouping moves lines between items **only within the part**. It re-runs `parseAreaSizes`,
    `extractNamedKeys`, `findDeferralEvidence` and the size rule on the affected items.
- `kind` ∈ `work | risk | personAction | deferred | noise`. It is ignored when the rule already settled `kind`.
- `enrollmentShare` is an integer from 0 to 100, stored as the `owner` slot's `aiProposal`. The owner is settled by
  `decideOwnerFromShare` only when the size rule gave `undefined`.
- `searchTerms`: 1–5 non-blank strings of ≤ 60 characters each. They are sanitised with `utils/jqlTextTerms.ts`. A term
  that sanitises to empty is dropped; if none survive, that counts as a rejection.
- `labelProposal` ∈ `Roadmap | Stability`, stored as the proposal only (the PO confirms).
- `title` is ≤ 120 characters and stored as `proposedTitle`.
- New ids (items the AI invented) are **rejected**. Every item must be a baseline item. The AI may regroup lines but
  never mint items, which guarantees every item cites source lines.

**Coverage**: after applying, `proveLineCoverage` runs. Lines that are missing or duplicated block `decideOwners` and
are named to the PO (US1-3). The PO resolves each by assigning the line to an item or setting it aside from a select.

## 2. Match — `epicIntakeMatch` (step `match`)

```ts
export const MATCH_REPLY_KIND = 'epicIntakeMatch';
export function buildMatchPrompt(intake: EpicIntake): string;
export function parseMatchReply(replyText: string, intake: EpicIntake): IngestOutcome<MatchAnswer>;
```

**The prompt contains**: each item whose `duplicate` slot is open, with its title and lines, followed by its
candidates as `DENP-1234 [In Progress] Summary — excerpt`, and the instruction *"choose a key from THIS item's list, or
none"*.

**Reply item**:

```json
{ "id": "item-3", "verdict": "existing", "key": "DENP-632", "confidence": "high", "reason": "…" }
```

or

```json
{ "id": "item-7", "verdict": "createNew", "confidence": "high", "reason": "…" }
```

**Validation**:

- `verdict: existing` → `key` (upper-cased) **must be in that item's own `candidates`** (FR-018, US3-3). Otherwise it
  is rejected: `DENP-9 was not among the Epics found for item-3`. A key found for a **different** item is also rejected
  for this one.
- `confidence` ∈ `high | low`.
  - `high` settles the slot (`settledBy: 'ai'`).
  - `low` stores the proposal and hands the slot to the PO (US3-6), with the AI's pick pre-selected.
- `createNew` with confidence `high` settles.

## 3. Draft — `epicIntakeDraft` (step `draft`)

```ts
export const DRAFT_REPLY_KIND = 'epicIntakeDraft';
export function buildDraftPrompt(intake: EpicIntake): string;
export function parseDraftReply(replyText: string, intake: EpicIntake): IngestOutcome<DraftAnswer>;
export function buildManualDraft(item: IntakeItem, lines: readonly SourceLine[]): EpicDraft;   // AI-locked / fallback path
```

**The prompt contains**: for each item with `duplicate = createNew` and no draft, **only that item's own lines**
(US4-1), plus the nine section labels built from `SECTION_LABELS` and the `VALIDATION_MARKER` wording
(`ai/featureDocSections.ts`), so the list cannot drift from the normaliser (R-005).

**Reply item**: `{ "id": "item-3", "summary": "…", "description": "…" }`.

**Validation**:

- `summary` is 1–255 characters (Jira's limit).
- `description` goes through `stripAiAttribution(normalizeFeatureDescription(…))`, so all nine sections are always
  present and in order (FR-021).
- A draft for an item that already has a PO-edited draft is **not** applied. It is reported as
  `item-3 already has your edits`.

**Manual draft** (AI locked, or two failed attempts): `summary = proposedTitle ?? title`. The description is
`normalizeFeatureDescription(<the item's lines as a bullet list>)`, which yields the item text in Description plus
flagged placeholders for the other eight sections. The PO edits it in place.
