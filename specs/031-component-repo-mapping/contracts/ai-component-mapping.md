# Contract: AI Component Mapping (propose-only, allowlist-constrained)

**Module**: `client/src/views/PoTool/ai/componentMappingAiAssist.ts`. Rendered via the existing `PoAiPanel`, gated by
`useAiAssistStore`. Mirrors `compositionAiAssist.ts`.

## Discriminator
`COMPONENT_MAPPING_KIND = 'componentMapping'` — the assistant must echo it.

## buildComponentMappingPrompt(feature, repoAllowlist)
- Inputs: `{ key, summary, description }` and the **RepoAllowlist** (`string[]`).
- The prompt hands over the Feature's summary + description and instructs: *choose the components (repositories) this
  Feature touches, using ONLY names from this list* — the allowlist rendered inline (the same "choose exactly one of…"
  device `buildCompositionPrompt` uses for select options). It states plainly: do not invent names; if unsure, include
  fewer. Never attribute anything to AI.
- Reply template: `{"kind":"componentMapping","featureKey":"...","components":["<allowlist name>", …],"rationale":"..."}`.

## parseComponentMappingIngest(responseText, repoAllowlist): AiIngestResult<{ componentName: string }>
- **Never throws** (reuses `extractJsonPayload` + the readPayloadObject pattern).
- Guards `payload.kind === 'componentMapping'`; a wrong kind → `{ items: [], errors: [...] }`.
- For each proposed value: if it is on the **RepoAllowlist** (case-insensitive) → an item; otherwise **rejected with a
  reason** and never returned (FR-012) — a domain tag, a typo, or an unknown repo can never be proposed.
- De-dupes; preserves allowlist display casing.

## Write on accept (FR-013)
- Nothing is written until the PO accepts. On accept the chosen repo names are resolved to this project's component
  ids (`componentResolve`) and written to the Feature's `components` field:
  - **Composition**: `draft.fields.components = [{ id }, …]` → `runCompositionCommit` (existing writer).
  - **Planner**: a direct `components` edit on the Feature via `createIssue`/edit primitive.
- Field is written by its resolved id/system name `components`, never a hardcoded custom field name.
- The mapping MUST NOT blank an existing `components` value when it has nothing to propose (FR-014).

## Gating & AI rules
- `PoAiPanel` renders nothing when AI is locked (SC-005); available identically on **both** surfaces (FR-015).
- Propose-only, per-item accept, no automated/background channel, never AI-attributed (Article IX).

## Tests (componentMappingAiAssist.test.ts)
- prompt contains the Feature text + every allowlist name; reply with allowlist names → accepted; a non-allowlist value
  → rejected with reason, not returned; wrong kind → errors, no items; empty components → items empty, no throw;
  case-insensitive allowlist match; de-dupe.
