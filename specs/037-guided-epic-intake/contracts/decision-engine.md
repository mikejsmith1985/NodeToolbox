# Contract: Decision Engine (the "twenty questions" core)

**Module**: `client/src/views/PoTool/intake/intakeChecklist.ts` — pure, no I/O, no clock (ISO time is passed in).
**Covers**: FR-004 – FR-010, FR-016, US6-1.

## 1. Purpose

Given an intake record, answer three questions and nothing else:

1. **Which decisions are still open?**
2. **Whose turn is each one?** (AI / Toolbox / PO)
3. **What is the single next action?**

The UI renders these answers; it never stores a step cursor. Resuming a saved intake is therefore correct by
construction (R-002).

## 2. Exports

```ts
export const MAX_AI_ATTEMPTS_PER_DECISION = 2;

export const INTAKE_STEP_ORDER: readonly IntakeStepId[] =
  ['sortNotes', 'decideOwners', 'checkDenp', 'match', 'confirmLabels', 'draft', 'create', 'summary'];

export function listOpenDecisions(intake: EpicIntake): OpenDecision[];
export function readIntakeNextStep(intake: EpicIntake, isAiUnlocked: boolean): IntakeNextStep;
export function recordAiRejection<TValue>(decision: Decision<TValue>, reason: string): Decision<TValue>;
export function settleDecision<TValue>(decision: Decision<TValue>, value: TValue, settledBy: SettledBy, reason: string): Decision<TValue>;
export function refreshApplicability(item: IntakeItem): IntakeItem;
```

`OpenDecision = { itemId, slot: DecisionSlot, step: IntakeStepId, turn: 'ai' | 'toolbox' | 'po' }`

## 3. Slot → step mapping

| Slot | Step |
|---|---|
| `kind` | `sortNotes` |
| `owner` | `decideOwners` |
| `searchTerms` | `sortNotes` (asked in the same exchange as `kind`) |
| candidate search (item `searchStatus = notRun`) | `checkDenp` |
| `duplicate` | `match` |
| `label` | `confirmLabels` |
| `draftAccepted` (and `draft === null`) | `draft` |
| `creation.state ∈ notStarted/failed/creating` with `draftAccepted = accepted` | `create` |

Coverage incompleteness (`proveLineCoverage` not complete) is treated as an open `sortNotes` decision with no item id.

## 4. Turn rules — in precedence order

1. Slot settled or `notApplicable` → not open.
2. Slot `label` or `draftAccepted` → **PO** (never AI — FR-020, FR-022). A draft that does not exist yet is the AI's
   turn when unlocked, else PO's (PO writes it from the prefilled template).
3. Candidate search not yet run, or `failed` → **Toolbox** (the PO triggers "Check DENP"; retrying is allowed).
4. AI locked → **PO**.
5. `aiAttempts ≥ MAX_AI_ATTEMPTS_PER_DECISION` → **PO** (FR-007).
6. Otherwise → **AI**.

## 5. Step derivation

`readIntakeNextStep` returns the **first** step in `INTAKE_STEP_ORDER` that has any open decision. Within a step, if
**any** open decision is the AI's turn, `turn = 'ai'` (one exchange answers them all); else if any is Toolbox's,
`'toolbox'`; else `'po'`. With nothing open: `{ step: 'summary', turn: 'done' }`.

**Why strict step order**: later steps consume earlier answers (search needs terms; matching needs candidates; labels
only matter for create-new). Answering out of order is allowed for the PO — a PO answer settles its slot whenever it
arrives — but the *next action* always points at the earliest gap.

## 6. Applicability (`refreshApplicability`)

Run after every settle. Pure function of the item's settled slots:

- `kind ≠ work` → `owner`, `searchTerms`, `duplicate`, `label`, `draftAccepted` = `notApplicable` (reason: the kind).
- `owner ≠ enrollment` → `searchTerms`, `duplicate`, `label`, `draftAccepted` = `notApplicable`.
- `duplicate.verdict ≠ createNew` → `label`, `draftAccepted` = `notApplicable`.
- Reversals re-open: if the PO changes `kind` back to `work`, downstream slots that were `notApplicable` return to
  `open` with `aiAttempts: 0`. Slots already settled by the PO are kept.

## 7. Invariants (each is a test)

- **INV-1** A slot with `settledBy: 'po'` is returned unchanged by every function except a later PO `settleDecision`.
- **INV-2** `readIntakeNextStep` is a pure function of `(intake, isAiUnlocked)` — same input, same output.
- **INV-3** `turn = 'done'` ⇔ `listOpenDecisions(intake).length === 0` ⇔ coverage complete (FR-010).
- **INV-4** An item with `searchStatus: 'failed'` can never reach `create` (FR-019).
- **INV-5** No slot is ever the AI's turn when `isAiUnlocked === false` (FR-026).
- **INV-6** `openCount` shown to the PO equals `listOpenDecisions(intake).length` (FR-009) — one computation.
