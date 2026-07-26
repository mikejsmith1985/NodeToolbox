# Contract: Commit writes — AC field + risk links (`FeatureCompositionTab` / `compositionCommit`)

The commit already creates/updates the Feature and writes the description + AC field. This adds "relates to" risk links, non-fatally. Propose-only: runs only when the PO commits.

## Existing (unchanged, reused)
- `buildCompositionCommit({ draft, requiredFieldDescriptors, acceptanceCriteriaFieldId, existingFieldValues })` → the pure commit diff.
- `runCompositionCommit(diff, { createIssue, saveField })` → creates (new) or updates (existing) the Feature; writes `description` and the AC field (`acceptanceCriteriaFieldId`); returns an outcome with `createdKeysByLocalId.feature` and per-field success.

## Added

### `buildCompositionCommit` — compute risk links
- Adds `riskLinkKeys: string[] = extractRiskLinkKeys(draft.description)` to the diff (keys from the Risks section only).

### `runCompositionCommit` — create the links
- Signature gains an injected `createIssueLink` dependency.
- After the Feature exists, resolve its key (`outcome.createdKeysByLocalId.feature` for a new Feature, else `draft.existingIssueKey`) and, for each `riskLinkKey`, call:
  `createIssueLink({ type: { name: 'Relates' }, inwardIssue: { key: featureKey }, outwardIssue: { key: riskLinkKey } })`.
- **Non-fatal**: each link is tried independently; a failure (unresolvable key / API error) is captured into the outcome (e.g. `riskLinkResults: { key, ok, reason? }[]`) and surfaced, and **never** fails the commit or orphans the Feature (mirrors `createIssueLink`'s documented contract, FR-032).
- No links are attempted when `riskLinkKeys` is empty (FR-031).

### Guarantees
- Nothing is written until the PO commits (FR-041); the update path shows the proposed nine-section description in the draft first (FR-042).
- AC is written to the AC field (existing) and remains in the description's AC section (FR-010).
- The tool never searches Jira for risk tickets — keys come only from the description (FR-033).

## Test obligations (TDD, vitest, mocked deps)
- `buildCompositionCommit` puts the Risks-section keys (and only those) into `riskLinkKeys`.
- `runCompositionCommit` creates one `Relates` link per key with `inwardIssue = feature`, `outwardIssue = riskKey`.
- A failing `createIssueLink` is captured in the outcome and does not throw / does not fail the commit.
- Empty `riskLinkKeys` ⇒ `createIssueLink` never called.
- Existing commit tests (create/update, AC field write) stay green.
