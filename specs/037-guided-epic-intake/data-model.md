# Data Model: Guided Epic Intake

**Feature**: 037-guided-epic-intake | **Plan**: [plan.md](./plan.md)

All types live in `client/src/views/PoTool/intake/epicIntakeModel.ts` and are plain serialisable data (no class
instances, no functions, no `Date` objects — ISO strings only), so the whole record round-trips through
`localStorage` unchanged.

---

## EpicIntake (the persisted record)

| Field | Type | Rule |
|---|---|---|
| `schemaVersion` | `1` | `EPIC_INTAKE_SCHEMA_VERSION`; a record with any other value is reported "cannot resume", never coerced. |
| `id` | `string` | Minted once; part of the storage key. |
| `teamProfileId` | `string` | Identity comes from the storage key on read, not the payload (draftModel precedent). |
| `name` | `string` | Defaults to the first source's title + date; PO-editable. |
| `targetProjectKey` | `string` | Fixed at creation to `DEFAULT_INTAKE_PROJECT_KEY = 'DENP'`; stored so queries never read a constant. |
| `createdAtIso` / `updatedAtIso` | `string` | |
| `sourceTitles` | `string[]` | Titles of the sources the notes came from — display only. |
| `lines` | `SourceLine[]` | Fixed after start (FR-003). |
| `items` | `IntakeItem[]` | |
| `setAsideLines` | `SetAsideLine[]` | Lines deliberately not part of any item, each with a reason. |
| `epicType` | `EpicTypeResolution` | See below. |
| `batchRequiredFieldValues` | `Record<string, unknown>` | PO answers to create-screen required fields, applied to every Epic. |
| `roundHistory` | `RoundRecord[]` | Audit of every AI exchange (kind, part, accepted/rejected counts, ISO time). |

## SourceLine

| Field | Type | Rule |
|---|---|---|
| `lineNumber` | `number` | 1-based, over non-blank lines of the concatenated notes; never renumbered. |
| `text` | `string` | Trimmed, bullet marker removed. |
| `rawText` | `string` | As pasted — shown to the PO and quoted in prompts. |
| `outlineLevel` | `0 \| 1 \| 2` | 0 = unmarked (heading/prose), 1 = top-level marker, 2 = second-level marker or deeper. |

## SetAsideLine

`{ lineNumber, reason: SetAsideReason, settledBy: SettledBy, note?: string }`

`SetAsideReason = 'headingOrProse' | 'duplicateOfAnotherLine' | 'notWork' | 'contextOnly'`

## IntakeItem

| Field | Type | Rule |
|---|---|---|
| `id` | `string` | `item-<n>`, stable for the life of the intake; the key every AI reply must use. |
| `title` | `string` | Text of the item's first line; the AI may propose a clearer one (`proposedTitle`). |
| `lineNumbers` | `number[]` | The item's own lines, ascending; ≥ 1 (an item with no line is rejected — edge case "AI invents an item"). |
| `areaSizes` | `AreaSize[]` | Parsed by Toolbox from `lineNumbers` (never supplied by the AI). |
| `namedKeys` | `NamedKey[]` | Extracted by Toolbox from `lineNumbers` (FR-013). |
| `deferralEvidence` | `string \| null` | The matched phrase ("future conversation", "no funding", "rejected") if any. |
| `decisions` | `ItemDecisions` | The checklist. |
| `candidates` | `DuplicateCandidate[]` | Filled by the Toolbox search step. |
| `searchStatus` | `'notRun' \| 'ok' \| 'failed'` | `failed` ⇒ item cannot be created (FR-019). |
| `searchFailureReason` | `string \| null` | |
| `draft` | `EpicDraft \| null` | |
| `creation` | `CreationRecord` | |

**Invariant (coverage, FR-011)**: every `SourceLine.lineNumber` appears in **exactly one** of: some item's
`lineNumbers`, or `setAsideLines`. Checked by `proveLineCoverage(intake) → { isComplete, missing[], duplicated[] }`.

## AreaSize

`{ area: string, canonicalArea: 'enrollment' | 'fulfillment' | null, size: FeatureSizeName, cost: string | null, lineNumber }`

`canonicalArea` is set only for the two owning areas (aliases: `enrollment`/`enrolment`, `fulfillment`/`fulfilment`);
every other area (Infra, Facets, Vendor, Testing, Billing, Dev) is reported with `canonicalArea: null` and never votes
(US2-6).

## NamedKey

`{ key: string /* upper-cased */, projectKey: string, lineNumber, lookup: NamedKeyLookup }`

`NamedKeyLookup = { status: 'notRun' } | { status: 'openEpicInTarget', summary } | { status: 'unusable', reason: 'notFound' | 'noPermission' | 'done' | 'notEpic' | 'otherProject' | 'error', detail }`

## Decision<TValue> — one checklist slot

```ts
type SettledBy = 'rule' | 'ai' | 'po';

type Decision<TValue> =
  | { state: 'open';          aiAttempts: number; lastRejection: string | null; aiProposal: TValue | null; aiReason: string | null }
  | { state: 'settled';       value: TValue; settledBy: SettledBy; reason: string; aiAttempts: number }
  | { state: 'notApplicable'; reason: string };
```

- `aiProposal`/`aiReason` hold an AI suggestion that is **not** allowed to settle the slot on its own (the label, and
  in-band ownership shares) so the PO sees it beside the closed choice (US2-5).
- A slot with `settledBy: 'po'` is immutable to every ingest (FR-008); ingest code only ever writes to `open` slots.
- `aiAttempts ≥ MAX_AI_ATTEMPTS_PER_DECISION (2)` ⇒ the slot's turn is the PO's (FR-007).

## ItemDecisions — the seven slots

| Slot | Value type | Applies when | Settled by |
|---|---|---|---|
| `kind` | `'work' \| 'risk' \| 'personAction' \| 'deferred' \| 'noise'` | always | rule (deferral evidence) · AI · PO |
| `owner` | `'enrollment' \| 'fulfillment' \| 'notActionable'` | `kind = work` | rule (stated sizes, or AI share outside the band) · PO |
| `searchTerms` | `string[]` (1–5 phrases) | owner = enrollment | AI · rule fallback (title words) |
| `duplicate` | `{ verdict: 'existing', key } \| { verdict: 'createNew' } \| { verdict: 'notActionable' }` | owner = enrollment | rule (open named DENP Epic; zero candidates ⇒ createNew) · AI (key ∈ candidates) · PO |
| `label` | `'Roadmap' \| 'Stability'` | duplicate = createNew | **PO only** (AI proposal shown) |
| `draftAccepted` | `'accepted' \| 'declined'` | duplicate = createNew | **PO only** |
| `outcome` | `SummaryAction` | always | derived / Toolbox create |

`ownerShare` (the AI's estimated Enrollment %) is stored on the `owner` slot's `aiProposal` as `{ enrollmentShare: number }`
and converted by the rule; it is never itself a decision.

## DuplicateCandidate

`{ key, summary, statusName, statusCategory, descriptionExcerpt /* ≤ 400 chars */, foundBy: 'search' | 'namedKey' }`

## EpicDraft

`{ summary: string, description: string /* nine-section, normalised */, source: 'ai' | 'po', editedByPo: boolean }`

## CreationRecord

`{ state: 'notStarted' } | { state: 'creating', startedAtIso } | { state: 'created', key, createdAtIso } | { state: 'failed', reason, failedAtIso }`

`creating` is written **before** the POST and `created` immediately after — the pair is what R-009's recovery reads.

## EpicTypeResolution

`{ state: 'unresolved' } | { state: 'resolved', id, name } | { state: 'missing', offeredTypeNames: string[] } | { state: 'error', reason }`

## RoundRecord

`{ kind: 'epicIntakeClassify' | 'epicIntakeMatch' | 'epicIntakeDraft', partIndex, partCount, acceptedCount, rejected: { itemId: string | null, reason: string }[], ingestedAtIso }`

## SummaryRow (derived, never stored)

| Field | Source |
|---|---|
| `itemTitle` | `proposedTitle ?? title` |
| `owner` | owner slot, or `—` for non-work |
| `action` | `SummaryAction = 'existing' \| 'created' \| 'skippedFulfillment' \| 'notActionable' \| 'declined' \| 'failed' \| 'open'` |
| `jiraKey` / `jiraUrl` | duplicate key, or `creation.key`; URL via `buildJiraBrowseUrl` |
| `label` | label slot, only for created Epics |
| `statedSizes` | `areaSizes` rendered `Enrollment XL (1.2M) · Fulfillment M · Infra XL` |
| `reason` | the settling decision's `reason` for every row without a key (SC-006) |

## Step derivation (not stored)

`readIntakeNextStep(intake, isAiUnlocked) → { step: IntakeStepId, turn: 'ai' | 'toolbox' | 'po' | 'done', openCount, nextAction: string }`

`IntakeStepId` in fixed order: `sortNotes → decideOwners → checkDenp → match → confirmLabels → draft → create → summary`.
The current step is the **first** step with an open, applicable decision. See `contracts/decision-engine.md`.
