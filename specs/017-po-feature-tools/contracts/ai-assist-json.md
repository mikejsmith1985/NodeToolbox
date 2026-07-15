# Contract: AI Assist JSON Round-Trip (PO Tool — Splitter & Composition)

Both AI assists are gated behind the **existing** app-wide AI Assist passphrase mechanism (Ctrl+Alt+Z at the app
root; unlock state lives in the shared AI-assist store, seeded from a `sessionStorage` flag and therefore
session-scoped). A locked session renders **no** AI control at all — the panel reads the store and returns `null`.
This mirrors the Feature Canvas accelerator exactly. **No tab function depends on the assist**: removing it entirely
leaves both tabs fully usable (FR-022, SC-005).

Toolbox **generates a prompt** for the PO to run in an external assistant and **ingests a strict JSON reply**. It
**never calls an AI service directly** and opens **no** always-on outbound channel. Ingesting or accepting a proposal
**never writes to Jira** — writes happen only at the separate, explicit, reviewed commit (FR-021, SC-006).

> **Security note (inherited, not introduced)**: the gate is a **client-side** passphrase check and the underlying
> AI-assist endpoints are unauthenticated. This feature relies on the gate for **discoverability only, never for
> security**, and adds no capability beyond what those endpoints already expose. See spec A8; hardening is out of
> scope and flagged separately.

---

## Direction 1 — Prompt generation (Toolbox → the PO's assistant)

`buildSplitPrompt(source: SourceFeatureSnapshot, coaching: SplitHeuristic[]): string`
`buildCompositionPrompt(draft: CompositionDraft): string`

Each prompt embeds:

- **Split**: the source Feature's key, summary, description, acceptance criteria, and hygiene-relevant fields; the
  deterministic split heuristics as guidance; and the target project key.
- **Composition**: the PO's **own wording** (`poNarrative`, FR-031) plus every `ReferencedSource` — Confluence page
  text (already stripped to plain text), workbook rows, referenced Jira issues, and pasted notes.

Each prompt **whitelists valid values verbatim** and forbids invention — the established construction ("The `X` value
MUST be exactly one of these, copy them verbatim: …", "Do not invent issues, projects, or field names"). The
composition prompt names the **hygiene-required field names** so an accepted proposal starts close to complete
(FR-033).

Each prompt ends with its **own response schema inline** and the instruction `Respond ONLY with valid JSON:`.

**Article IX**: prompts carry Feature/PI content only. **No credential, token, or secret is ever embedded.**

Supported `kind` values: `featureSplitIngest`, `featureCompositionIngest`.

---

## Direction 2 — Reply ingestion (the PO's assistant → Toolbox)

`parseSplitIngest(responseText: string, options: SplitIngestOptions): AiIngestResult<ProposedIncrement>`
`parseCompositionIngest(responseText: string, options: CompositionIngestOptions): AiIngestResult<CompositionProposal>`

Pipeline:

1. **Extract** — the shared `extractJsonPayload` strips ` ``` `/` ```json ` fences and narrows to the outermost
   `{ … }`. Tolerates assistant chatter around the JSON (FR-018). Unreadable → one error:
   `'No JSON object found in the assistant response.'`
2. **Parse** — `JSON.parse`. Failure → `'The assistant response was not valid JSON.'`
3. **Kind guard (strict)** — `payload.kind` must equal the surface's fixed discriminator, else reject the whole
   payload: `` `Response kind "${kind}" is not ${EXPECTED}` ``. This is what stops a stray payload from another
   surface being misread as a split (SC-009).
4. **Per-item validation (partial success)** — each item is validated independently. **Valid items are kept**;
   invalid ones contribute a human-readable string to `errors`. **This step never throws.**
5. **Return** `{ items, errors }` with every item **`isAccepted: false`**.

Then, **in the UI**: items referencing unknown Jira keys are filtered against live data and **reported** (never
silently dropped). Every surviving item is individually **acceptable, rejectable, and editable** (FR-020, SC-010).

> **Why partial-success, not the strict all-or-nothing variant**: the repo has both idioms. A split proposes a
> **batch**; a PO must not lose four good increments to one bad field. FR-020's "individually acceptable" implies
> per-item survival. See research R6.

**Field-naming decision**: existing prompts are inconsistent (some kinds use `rationale`, others `reason`). This
contract **pins `rationale`** for both surfaces.

---

## Reply schemas (per kind)

### `featureSplitIngest`

```json
{
  "kind": "featureSplitIngest",
  "increments": [
    {
      "summary": "Submit a claim with a single document attachment",
      "description": "As a claimant I can submit one supporting document…",
      "acceptanceCriteria": "Given a claim in draft…",
      "rationale": "Happy-path-first: the single-document case delivers value without the batch-upload complexity."
    }
  ]
}
```

- `summary` — **required**, non-empty. Missing → `Increment at position N is missing a summary.`
- `description`, `acceptanceCriteria`, `rationale` — optional strings; non-strings coerce to `''`.
- `increments` missing/not-an-array → `The "increments" field is missing or is not an array.`
- **Applying an accepted item**: appends a `ProposedIncrement` (`origin:'ai'`, `isAccepted:false` until accepted) to
  the **local draft**. The increment's issue type and project are **not** taken from the reply — they come from the
  source Feature and the PO's target-project choice (A17, FR-016c). The assistant cannot choose them.

### `featureCompositionIngest`

```json
{
  "kind": "featureCompositionIngest",
  "feature": {
    "summary": "Claimant document submission",
    "description": "…",
    "acceptanceCriteria": "…",
    "fields": { "customfield_10101": "2026-08-01" },
    "rationale": "Framed against the DoR checklist; target start taken from the uploaded plan."
  }
}
```

- `feature` — **required** object. Missing → `The "feature" field is missing or is not an object.`
- `summary` — required, non-empty.
- `fields` — optional map of **field id → value**. Any id **not** in the whitelist the prompt supplied is **dropped
  with an error** (`Field "X" is not a known field for this project.`) — the assistant may not invent fields
  (FR-037).
- **Applying an accepted proposal**: fills the **local draft's** editable fields. Every value remains editable, and
  nothing is written to Jira (FR-032).

---

## Invariants

- **Gate** — no AI control renders, and no prompt/ingest path is reachable, for a locked session. Re-locking
  mid-draft removes the controls and leaves the manual draft fully intact and committable.
- **Suggestion-only** — an ingested item is never auto-applied; it lands `isAccepted:false` in the same controls the
  PO operates by hand.
- **Draft-only** — accepting mutates the **local draft**. Jira is reached only via the separate reviewed commit.
  A full unlocked draft-and-ingest cycle performs **zero** Jira writes (SC-006).
- **No AI in guidance** — the deterministic coaching (split heuristics, DoR) is authored content, never generated,
  and is fully available to a locked session (FR-010/FR-026, SC-013).
- **Validation is strict about identity, lenient about content** — a wrong `kind` kills the whole payload; a bad
  field kills only its item. Both are reported; neither corrupts the draft (SC-009).
- **The assistant never chooses structure** — project, issue type, and link type come from the instance and the PO,
  never from the reply.
