# Contract: AI Prompt + Ingest changes (`ai/compositionAiAssist.ts`)

Extends the shipped composition AI (017) — same `{kind:'featureCompositionIngest', feature:{…}}` envelope and `CompositionProposal` shape. Only the prompt guidance and the description post-processing change. Still propose-only, still gated.

## `buildCompositionPrompt(...)` — added guidance

The prompt MUST additionally instruct the assistant to:

1. Write the **description as these nine sections, in this exact order, each labeled**: Description, Benefit Hypothesis, Acceptance Criteria, Assumptions, Dependencies, In Scope, Out of Scope, Risks, Non-Functional Requirements (NFR).
2. Populate every section from the provided material; where the material is insufficient, still propose content but **begin that section with** one of: `⚠ REQUIRES BUSINESS VALIDATION`, `⚠ REQUIRES TECHNICAL VALIDATION`, or `⚠ REQUIRES BUSINESS & TECHNICAL VALIDATION`, chosen by the section's nature.
3. Put the **full acceptance criteria** both in the description's Acceptance Criteria section **and** in the `acceptanceCriteria` field of the reply.
4. In the **Risks** section, include any existing Jira issue key the material references for a risk (so it can be linked); do not invent keys.
5. **Never** state or imply the content was written, generated, or drafted by AI. A validation marker is about missing information, not about AI authorship.

The envelope template is unchanged (`{"kind":"featureCompositionIngest","feature":{"summary":"...","description":"...","acceptanceCriteria":"...","fields":{},"rationale":"..."}}`).

## `parseCompositionIngest(...)` — added post-processing

Before returning the `CompositionProposal`, the ingest MUST:

1. `description = stripAiAttribution(normalizeFeatureDescription(rawDescription))` — guarantee all nine sections in order (missing → flagged placeholder) and remove any AI self-attribution.
2. Leave `acceptanceCriteria` as-is (it is written to the AC field on commit; the same text is expected in the description's AC section from the normalizer).
3. Keep the existing strict rules: wrong `kind` → error; missing `summary` → error; non-whitelisted field ids dropped with an error (unchanged).

### Guarantees
- Every returned proposal's `description` satisfies the document-structure contract (nine sections, ordered, no AI attribution).
- No behavior change to field whitelisting, summary requirement, or the never-throws property.

## Test obligations (TDD, vitest)

- Prompt contains the nine section labels, the three marker strings, the "never say AI wrote it" instruction, and the AC-in-both instruction.
- Ingest of a reply whose description omits sections → returned description has all nine, ordered, missing ones flagged.
- Ingest strips an AI-authorship sentence from the description but keeps the sections and markers.
- Existing `compositionAiAssist.test.ts` assertions that still hold remain green; ones that intentionally change are updated.
