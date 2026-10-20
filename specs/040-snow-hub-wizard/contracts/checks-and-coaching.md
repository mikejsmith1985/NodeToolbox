# Contract: Checks and Coaching

## Checks (shared — FR-011, FR-020, SC-005)

The wizard's step 9 and the Review wizard both call **039's** `gatherChangeReadinessFacts(changeNumber | draft)` →
`buildChangeReadiness(facts)`. Neither `snowWizard/` nor any other surface re-implements a rule. Item set, order, and
the `couldNotCheck` rule are owned by `specs/039-guided-flows/contracts/readiness-engine.md`, extended with the formula
quality-gate items (formula sections 1–7) if 039 has not already included them.

Parity test: one fixture fed through both wizard surfaces yields identical item ids + states.

## Coaching (`review/coachingNote.ts`, pure)

`buildCoachingNote(items: ReadinessItem[], change: { number, creatorName, shortDescription }): CoachingNote`

- One coaching item per `needsAction`, in engine order, text from `COACHING_PHRASES[itemId]`:
  `missing` (one sentence), `whyItMatters` (one sentence, RM's reason), `goodExample` (a short example).
- `couldNotCheck` → `notCheckedLabels`, never coached.
- All pass → a one-line "ready for review" note.
- No jargon: field names and rule ids never appear (copy-scan test).

`renderCoachingNoteText(note): string` — greeting to the creator by name, the items as a numbered list, sign-off left
blank for the reviewer. Copy button + `mailto:` with subject `CHG <number> — changes needed before approval`.

## Read-only guarantee

The Review wizard receives a transport wrapper that **refuses** any non-GET request (throws `ReviewIsReadOnlyError`);
a test asserts no write reaches the transport during a full review.
