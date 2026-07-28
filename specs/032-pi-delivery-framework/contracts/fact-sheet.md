# Contract — PI Planning Fact Sheet (`piPlanFactSheet.ts`)

The deterministic bundle that (a) feeds the engine and (b) is embedded verbatim in the AI prompt. This is the
**anti-hallucination spine**: the AI never supplies a fact it could get wrong.

## Function

```ts
assembleFactSheet(inputs: FactSheetInputs): PiPlanningFactSheet
```

Pure — no I/O inside. The caller performs the queries (via existing fetchers) and passes their results in; the
assembler validates, normalizes, applies the load factor, and computes the delivery deadline. Injectable clock.

## Query set → field mapping (each an EXISTING source; FR-018)

| Fact-sheet field | Query source | Notes |
|------------------|--------------|-------|
| `features[]` | `piReviewPullFeatures` | only Features committed in PI Review |
| `features[].repoComponentNames` / `domainComponentNames` | `componentClassificationStore` (031) | split by classification; unclassified excluded from both |
| `people[]` (roles, pointsPerSprint) | `useStandupRosterStore` + `workflowDelivery` velocity | roles mapped to `DeliveryRole` |
| `people[].pointsPerSprint` | velocity **× 0.80** | the single load-factor choke point (FR-012) |
| `sprints[]` | `getBoardSprints` | reuse-first; missing derived; last sprint split into delivery + innovation week |
| `deliveryDeadlineIso` | end of Sprint 5 Week 1 | computed from the sprint calendar (FR-013) |
| `features[].existingChildren` | `featureChildren` | for idempotency |
| `releaseSchedule` | `piPlanReleaseSchedule` | fixVersion dates for PROD |
| `fieldConfig` | `loadHygieneFieldConfig` | in-INT / SL-done / done-category status names |
| `repoAllowlist` | union of all `repoComponentNames` | the ingest allowlist (FR-020) |

## Determinism contract

- Same inputs → byte-identical fact sheet (no clock-dependent fields except where a date is derived from the injected
  clock, which is itself an input).
- `repoAllowlist` is the **authoritative** set of nameable repos; nothing downstream may introduce a repo not here.
- The fact sheet is **immutable** once assembled; the engine and the prompt consume the same instance.
- No secrets, no PII beyond roster display names + Jira account ids already used elsewhere.

## Honest states surfaced (not thrown)

- A Feature with no `repoComponentNames` → carried, flagged "map repos first" (no coding sub-tasks downstream).
- A Feature with `sizePoints == null` → carried, flagged "not sized".
- Empty roster / no `internalTest`-capable person / empty release schedule → each surfaced as a fact-sheet note.

## Test obligations (vitest, TDD)

- Applies the 0.80 load factor exactly once, to every person.
- Splits repo vs domain components correctly; unclassified excluded.
- `repoAllowlist` = de-duped union of repo names across Features.
- `deliveryDeadlineIso` equals the end of Sprint-5 Week-1 for a standard 5×2-week calendar.
- Immutability: mutating a returned nested array does not affect a second assemble with the same inputs.
