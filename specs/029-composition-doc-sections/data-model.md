# Phase 1 Data Model: Structured Feature Documentation in Feature Composition

Plain-data contracts. Types that already exist are marked **REUSE**; new types name their owning module (`ai/featureDocSections.ts`).

## Reused (no new type)

- **`CompositionProposal`** (REUSE — `compositionAiAssist.ts`): `summary`, `description`, `acceptanceCriteria`, `fields`, `rationale`. Unchanged shape; the `description` value now arrives normalized to the nine sections and stripped of AI-attribution. (Risk links are derived from the description at commit, not carried on the proposal.)
- **`CompositionDraft`** (REUSE — `drafts/draftModel`): the editable draft the PO commits (`summary`, `description`, `acceptanceCriteria`, `fields`, `existingIssueKey`, `scopeKey`, …).
- **`CreateIssueLinkInput`** (REUSE — `jiraApi.ts`): `{ type:{name}, inwardIssue:{key}, outwardIssue:{key} }`.
- **`AiIngestResult<T>`** (REUSE — `splitAiAssist`): `{ items: T[]; errors: string[] }`.

## New — `ai/featureDocSections.ts`

### SectionLabel  *(named constant list — the canon)*
The ordered nine labels, exactly:
`['Description', 'Benefit Hypothesis', 'Acceptance Criteria', 'Assumptions', 'Dependencies', 'In Scope', 'Out of Scope', 'Risks', 'Non-Functional Requirements (NFR)']`.

### ValidationKind
`'business' | 'technical' | 'both' | null` — the kind of validation a section requires (`null` = fully substantiated, no marker).

### VALIDATION_MARKER  *(constant map)*
| kind | marker string |
|------|---------------|
| `business` | `⚠ REQUIRES BUSINESS VALIDATION` |
| `technical` | `⚠ REQUIRES TECHNICAL VALIDATION` |
| `both` | `⚠ REQUIRES BUSINESS & TECHNICAL VALIDATION` |

### DEFAULT_VALIDATION_KIND  *(constant map, label → kind)*
Used only when inserting a placeholder for a **missing** section (R2): Benefit Hypothesis / In Scope / Out of Scope / Risks → `business`; Dependencies / NFR → `technical`; Description / Acceptance Criteria / Assumptions → `both`.

### ParsedSection  *(intermediate, internal to normalization)*
| Field | Type | Notes |
|-------|------|-------|
| `label` | SectionLabel | one of the nine |
| `content` | string | the text under the label (may already contain a `⚠` marker the model wrote) |
| `isPlaceholder` | boolean | true when this section was missing and was inserted with a default-kind marker |

## Functions (contracts summarized; full detail in contracts/)

- `normalizeFeatureDescription(rawDescription: string): string` — parse by the nine labels, re-emit all nine in canonical order, insert a marker-flagged placeholder for any missing section, preserve existing content and any markers the model wrote. Idempotent (normalizing twice == once).
- `stripAiAttribution(text: string): string` — remove phrases attributing authorship to AI; leave all other content intact.
- `extractRiskLinkKeys(description: string): string[]` — return the distinct Jira issue keys found in the **Risks** section only (not the whole description), preserving order.
- `buildValidationPlaceholder(label: SectionLabel): string` — the placeholder body for a missing section (marker line + a one-line "insufficient information provided" note; never AI-attributed).

## Validation rules (from Requirements)

- The output of `normalizeFeatureDescription` MUST contain all nine labels, once each, in canonical order (FR-001/FR-004).
- A missing section's placeholder MUST carry the correct `VALIDATION_MARKER` (FR-020) and MUST NOT imply AI authorship (FR-022).
- `stripAiAttribution` MUST remove AI-authorship phrasing and MUST NOT remove legitimate content such as a validation marker (FR-003 vs FR-022).
- `extractRiskLinkKeys` MUST only read keys inside the Risks section (a key mentioned in, say, Dependencies is not a risk link) and MUST de-duplicate (FR-030).
- AC text present in the description's Acceptance Criteria section MUST equal the `acceptanceCriteria` written to the AC field (FR-010).
- A risk-link creation failure MUST NOT abort the commit; it is collected and surfaced (FR-032).
