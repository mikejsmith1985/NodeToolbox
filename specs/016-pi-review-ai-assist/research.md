# Phase 0 Research: Single AI Unlock + PI Review AI Assistance

**Feature**: `016-pi-review-ai-assist` | **Date**: 2026-07-15

Every unknown carried by the spec is resolved below. Each decision names what was chosen, why, and what was
rejected. Article VII (Framework-First) is the governing lens: this feature builds **one** new component, and only
against a gap that was verified to exist.

---

## R-1: Which unlock gate survives, and is removal safe?

**Decision**: Keep the app-level `AiAssistUnlockGate` (`client/src/components/AiAssistUnlockGate/index.tsx:18`,
mounted once at `App.tsx:135`). Delete the shortcut listener, passphrase state, submit handler and modal JSX from
the four per-view gates. Those views keep reading `isUnlocked` and keep their AI affordances.

**Rationale**: The four per-view gates are **functional twins** of the app-level gate, verified line by line against
`RiskManagementSection.tsx:286-325`:

| Behaviour | Gate A (app) | Gate D (Risk Mgmt) |
|---|---|---|
| Chord | `ctrlKey && altKey && key==='z'` | identical |
| Locked → open prompt | ✅ | ✅ |
| Unlocked → `setAiAssistUnlocked(false)` (toggle/re-lock) | ✅ | ✅ |
| Verify | `useAiAssist().verifyPassphrase` | identical |
| Writes | shared `aiAssistStore` | identical |

There is **no behaviour in B–E that A lacks** — including the re-lock toggle, which A already implements
(`index.tsx:32-36`) and which its test suite already covers (`AiAssistUnlockGate/index.test.tsx:49`). The state is
already centralised in `aiAssistStore.ts` (sessionStorage `tbxAiAssistUnlocked`); the duplicates never held their own
unlocked flag. Removal is therefore pure deletion with no behavioural gap to backfill.

**Alternatives rejected**:
- *Keep one per-view gate and drop the app-level one* — reverses the deliberate direction of `f840779`, which
  centralised the unlock so it works from any screen.
- *Deduplicate at runtime (first-listener-wins guard)* — solves a symptom with new machinery; the listeners simply
  should not exist.

**Consequence for tests**: `SprintDashboardView.test.tsx:877, 909, 948, 1024, 1075` assert on
`getByLabelText('Protected tools passphrase')` — the label the duplicates render. They encode the behaviour being
removed and must be rewritten to drive the app-level gate. This is expected work, not collateral damage.

---

## R-2: How does the AI reach description and acceptance criteria?

**Decision**: The AI panel performs **its own on-demand Jira fetch** with its own field list. `DEFAULT_LINK_FIELDS`
(`piReviewJira.ts:16`) and the server's `RECONCILE_FIELDS` (`src/services/piReviewRefresh.js:16`) are **not touched**.
Acceptance criteria field ids come from the existing `resolveAcceptanceCriteriaFieldIds()`; description and AC text
are flattened with the existing `normalizeRichTextToPlainText()` / `readAcceptanceCriteriaText()`.

**Rationale**: Three independent reasons converge:

1. **It keeps a fragile contract intact.** `RECONCILE_FIELDS` is a *hand-maintained duplicate* of
   `DEFAULT_LINK_FIELDS`, with a comment asserting they are identical and **nothing enforcing it** — no shared
   import, no equality test. Adding `description` to one and not the other would make that comment a lie. Adding it
   to both would make the server fetch a field its reconcile never reads.
2. **It keeps page load cheap.** `DEFAULT_LINK_FIELDS` is fetched on **every** PI Review load for every Feature.
   Description and AC are large rich-text fields needed only when a user clicks AI Assistance. Putting them on the
   hot path taxes every load to serve an occasional action.
3. **It keeps reconcile untouched.** `reconcileSinglePiReviewRow` does not iterate a field list — it hardcodes each
   field, and its change-detection loop uses a fixed `fieldLabelsByKey` map (`piReviewJira.ts:435-441`). Description
   and AC therefore **must not** enter `PiReviewRow`: doing so would enrol them in the "Jira updated N fields on
   load" delta banner and make them Jira-owned columns, contradicting FR-038 and feature 015's contract. They stay
   read-only inputs to the prompt, sourced from the issue map and never written to a row.

**Framework-First finding — nothing new is needed.** `client/src/utils/acceptanceCriteria.ts` already exists and does
exactly this job: `resolveAcceptanceCriteriaFieldIds()` queries `/rest/api/2/field`, matches every field named
"Acceptance Criteria" case-insensitively, falls back to `customfield_10200`, and is fully error-tolerant.
`readAcceptanceCriteriaText(issue, fieldIds)` returns `null` when absent — which maps directly onto FR-015 ("absent
fields MUST be conveyed as absent"). It is already used by the Aging backlog report.

**This retires spec assumption A-8** (*"acceptance criteria will need to be configurable or discovered"*): it already
is, with no new setting and no new UI. **A-7 stands but narrows**: the fetch is extended, but only the AI panel's own
fetch, not the shared one.

**Alternatives rejected**:
- *Add `description` to `DEFAULT_LINK_FIELDS`* — taxes every page load and forces the `RECONCILE_FIELDS` question.
- *Add a `piReviewAcceptanceCriteriaFieldId` setting* — the naming convention would support it
  (`ArtView.tsx:3112-3144`), but it is redundant given runtime resolution, and every new ART setting must also be
  registered in `SHARED_ART_SETTINGS_FIELD_NAMES` (`ArtView.tsx:3189`) — an easily-missed step for no gain.
- *Export `DEFAULT_LINK_FIELDS` from the engine barrel so the server imports it instead of redeclaring* — a genuinely
  good fix for real drift risk, but **out of scope**: it changes the server refresh path this feature otherwise never
  touches. Recorded in Deferred Work below.

---

## R-3: What is the reply contract for a whole-table run?

**Decision**: A single JSON object envelope, keyed by issue key, parsed with the shared `extractJsonPayload`:

```jsonc
{"kind":"piReview","items":[
  {"issueKey":"ALPHA-1","size":"M","points":40,"notes":"…","rationale":"…"}
]}
```

**Rationale**: The spec supposed a whole-table reply was novel ("all existing AI Assist surfaces are
single-subject"). **That premise was wrong.** Multi-item, issue-keyed replies are the *dominant* contract here:
Canvas suggestions, Canvas master plan, Aging triage, Risk refinement and the ART monthly report are all multi-item.
The `{kind, items[]}` envelope (`canvasAiAssist.ts:128-172`) is the established shape and buys three things free:

- **`parsed.kind !== kind` rejects a wrong reply** pasted from another surface (`canvasAiAssist.ts:274`).
- **The shared `extractJsonPayload` works unmodified** — it is object-rooted. The two surfaces that chose a bare
  top-level array (`ArtView.tsx:2636`, `RiskManagementSection.tsx:134`) each had to hand-roll a duplicate extractor.
  That is a mistake not to repeat.
- **`issueKey` enables filtering to known keys**, which is exactly FR-021 (*a suggestion for a Feature not on the
  page MUST be reported and ignored*) — the same guard as `AiSuggestionPanel.tsx:197`.

**Strictness**: **per-field leniency, per-row survival.** An invalid field drops to `null` and the row survives with
its remaining fields; only a missing/unknown `issueKey` discards the item. `parseCanvasAiResponse` throws on any bad
enum, which is right for a small canvas batch but wrong here — with one item per Feature across a whole PI, a single
bad enum must not throw away every good suggestion. This directly serves FR-024 (*a partial or malformed reply MUST
yield the valid suggestions plus a clear report of the rest*). Precedent exists: `parseMasterPlan`
(`canvasAiAssist.ts:314-334`) is deliberately lenient for exactly this reason.

**Alternatives rejected**:
- *KEY: value markers* (as `useAiAssist.ts:118-166` uses for CHG) — the one legacy surface, justified there because
  its values are long free prose. Our items are enumerable and keyed; JSON is what every comparable surface uses.
- *Bare top-level array* — forces a duplicate extractor and loses the `kind` guard.

---

## R-4: How do AI notes get written without losing anything?

**Decision**: Reuse the existing note convention verbatim — `appendUniqueNoteLine(notes, label, value)` producing
`` `${label}: ${value}` `` lines joined by `\n`. Export it from `piReviewJira.ts` (it is currently module-private) and
call it with AI-specific labels rather than reimplementing the format.

**Rationale**: The reconciliation already writes into this column using this exact convention when it migrates
Dependency/Risks text (`piReviewJira.ts:402-407`, producing e.g.
`Existing note\nDependency note: Legacy dependency note\nRisk note: Legacy risk note`). AI-authored notes must sit
alongside migrated notes legibly, and FR-027 requires exactly that. The function also already gives us:

- **Blank-value guarding** via `isMeaningfulFreeText` — `''`, `n/a`, `none`, `no`, `-`, `--` are skipped
  (`piReviewJira.ts:11, 94-96`), which serves FR-015 for free.
- **Idempotence on re-runs** via normalized-substring dedupe (`piReviewJira.ts:277-278`) — accepting the same
  suggestion twice does not duplicate the line. This directly serves FR-027's "not duplicated on repeat runs".
- **Append-only semantics** — it never overwrites existing notes. This is why FR-023 (don't clobber human content)
  effectively concerns only the Point Estimate: a note can never overwrite.

**Two limitations found, both accepted and mitigated rather than fixed**:

1. **Confluence flattens the newlines.** Notes are written as a bare text node in the `<td>`
   (`piReviewTable.ts:873`) — no `<br>`, no `<p>`. The `\n` survives the Toolbox parse round-trip
   (`textContent`, `piReviewTable.ts:556`) and renders correctly in the Toolbox textarea, but **Confluence renders it
   as a space**. Multi-line AI notes will read as one run-on paragraph on the published page.
   *Mitigation*: this is **pre-existing** behaviour that already affects migrated notes — not a regression. We
   respond by keeping AI notes **short and few**, not by changing the storage format (which would be a breaking
   change to the shared engine that feature 015 also runs).
2. **The dedupe is substring-based, not line-aware.** A short candidate line that happens to be a substring of the
   existing notes blob is silently dropped. *Mitigation*: AI note lines carry a distinct label prefix and real
   content, making a false-negative collision vanishingly unlikely. Not worth changing shared behaviour for.

**Decision on length**: introduce the column's **first** length cap, applied **only to AI-generated note text**, as a
named constant. Nothing caps this column today. An uncapped model reply could otherwise write an unbounded wall of
text into a Confluence cell — and per limitation 1, on one line.

**Alternatives rejected**:
- *Reimplement the format in a new AI module* — duplicates a convention the reconcile owns; the two would drift.
- *Change notes to `<br>`-separated so Confluence renders line breaks* — a storage-format change to the shared
  engine, affecting the 015 scheduler and every existing page. Wholly disproportionate; belongs in its own feature.

---

## R-5: Which columns can an accepted suggestion touch?

**Decision**: Exactly two — **Point Estimate** and **Implementation Notes**. Nothing else.

**Rationale**: This falls directly out of the resolved clarifications and the verified reconcile behaviour:

| Column | Touchable? | Why |
|---|---|---|
| Dependency, Risks | ❌ Never | Rebuilt from Jira links unconditionally on every load (Q1 / FR-025) |
| Priority | ❌ Never | Overwritten from Jira on every load; the AI has nothing to add |
| Carry-Over, Committed to PI? | ❌ Never | Human judgement the AI was not asked to make; out of the request's scope |
| Feature | ❌ Never | Identity — set once when the Feature is pulled |
| Point Estimate | ✅ | The one Jira-owned field with a real gap: when Jira's estimate is empty the table's value is kept (`piReviewJira.ts:409-411`) |
| Implementation Notes | ✅ | Human-owned free text; append-only; survives reconcile |

This makes the review UI far simpler than a general field-diff: **two cells per row**, one replace + one append.

**Estimate write-back is real and must be disclosed (FR-030).** `pendingEstimateUpdate` (`piReviewJira.ts:410-416`)
queues a Jira write when Jira's estimate is empty **and** the row has a finite number — precisely the state an
accepted AI estimate creates. Per Q2 this is intended and gets no special case; the panel must therefore say so
**before** acceptance. Treat that copy as a requirement, not decoration.

---

## R-6: Does a review-and-accept component already exist?

**Decision**: **No.** Build one: `PiReviewSuggestionTable`. This is the feature's only genuinely new component, and
the Article VII drift justification is recorded here and at the component.

**Rationale**: The gap was verified, not assumed:

- `AiSuggestionPanel.tsx:266-280` — the only per-item Accept/Reject UI in the codebase. It is ~15 lines of inline
  JSX with hardcoded styles and FeatureCanvas-local `controlStyles`. Not a component, not exported, not
  parameterised. It also applies on accept with a **single** `proposedValue` per item; we need current-vs-proposed
  for two cells.
- `AgingTriageActionTable.tsx` — a browsing/action table whose rows expand to detail. No accept/reject gate.
- `RiskManagementSection.tsx:466-508` — per-row *save status* (`Saving… / ✓ Saved`), but AI items are applied to
  Jira **wholesale with no review** (`:381-407`). That is write-outcome feedback, not consent.

**What we reuse instead of rebuilding**:

| Need | Reused | Source |
|---|---|---|
| Unlock gating | `useAiAssistStore` | `store/aiAssistStore.ts:32` |
| Auto dispatch + poll | `useAiAssistExchange` | `SnowHub/hooks/useAiAssistExchange.ts:49` |
| Copy/paste shell, self-hides when locked | `ReportAiPanel` | `ReportsHub/ReportAiPanel.tsx:32` |
| JSON extraction | `extractJsonPayload` | `utils/extractJsonPayload.ts:13` |
| AC field ids + text | `resolveAcceptanceCriteriaFieldIds`, `readAcceptanceCriteriaText` | `utils/acceptanceCriteria.ts:30, 45` |
| Rich text → plain | `normalizeRichTextToPlainText` | `utils/richTextPlainText.ts:58` |
| Note line convention | `appendUniqueNoteLine` (export it) | `piReviewJira.ts:271` |
| Clipboard | `copyToClipboard` | `FeatureCanvas/ai/clipboard.ts` |
| Issue fetch + batching | `fetchPiReviewFeatureIssues` shape | `piReviewJira.ts:542` |

**`ReportAiPanel` gets a small extension, not a fork.** It is manual-paste-only today (no `useAiAssistExchange`, no
`isRunning`). FR-011 needs both paths. Adding optional `onRunAuto` / `isRunning` props is a clean, additive change
its two existing consumers (`BacklogRemediationPanel`, `PersonalFlowTab`) ignore. Forking it would create the third
copy of a shell that already exists — exactly what Article VII forbids.

**Both paths call one apply function.** `RiskManagementSection.tsx:356-408` is the reference: auto is a shortcut past
the paste box, not a second pipeline. `runAiAssistExchange` **never throws** — every failure returns
`{ok:false, message}` — which satisfies FR-012 without new error plumbing.

---

## R-7: How is `XXL = 100+` resolved?

**Decision**: The scale maps XS→10, S→20, M→40, L→60, XL→80. **XXL has no automatic number.** An XXL suggestion is
surfaced as `XXL (100+) — set a value`, is **not acceptable as-is**, and requires the user to enter the number before
the row can be accepted.

**Rationale**: The source table says "100+", which is a floor, not a value (GitHub #147). Spec assumption A-10 is
explicit that this resolves to a number **chosen by the user, not invented by the AI**. Silently writing `100` would
be the app inventing data — and an XXL Feature is precisely the case where the number matters most and a human should
look. This also aligns with FR-020 (never coerce a value the scale does not define).

**Alternatives rejected**:
- *Default XXL to 100* — invents data at the exact moment human judgement is most warranted.
- *Let the AI pick a number above 100* — contradicts A-10 and FR-020.
- *Reject XXL suggestions as unparsed* — throws away the AI's most valuable signal ("this is too big"); the size is
  correct, only the number is missing.

---

## R-8: Where does the sizing scale live in the app?

**Decision**: A small presentational component rendering the scale table plus a link to the Confluence guidance page,
shown on the PI Review tab **independently of the AI unlock** (FR-035). The scale is a module constant, shared by the
component and the prompt builder — one definition, two readers.

**Rationale**: FR-035 requires it visible whether or not AI Assist is unlocked, because it serves *manual* sizing —
the norm. Sharing the constant with the prompt builder means the rubric shown to the user and the rubric given to the
model can never disagree. The scale is fixed for this feature (spec A-3), so a constant is right; a setting would be
unjustified.

---

## Deferred work (explicitly out of scope)

Recorded so it is not rediscovered or silently absorbed:

1. **`RECONCILE_FIELDS` / `DEFAULT_LINK_FIELDS` drift.** The server duplicates the client's field list as a literal
   string, with a comment claiming they are identical and no test enforcing it. The clean fix — export the list from
   `piReviewEngine.entry.ts` (which already exports engine functions) and have `piReviewRefresh.js` read it — turns a
   comment-enforced contract into a compiler-enforced one. This feature does not touch either list, so the risk is
   unchanged, not increased. Worth its own chore.
2. **`customfield_10111` (estimate) is hardcoded in four places** — `piReviewJira.ts:23, 409, 615` and
   `piReviewRefresh.js:16` — while `piFieldId` and the date fields are configurable. An inconsistency this feature
   inherits and does not worsen.
3. **Two ad-hoc array-capable JSON extractors** exist (`ArtView.tsx:2636`, `RiskManagementSection.tsx:134`) because
   the shared `extractJsonPayload` is object-only. Our envelope is object-rooted, so we use the shared util and add
   no third copy.

## Resolved spec assumptions

| Assumption | Outcome |
|---|---|
| **A-7** — description/AC not fetched today; fetch needs extending | **Confirmed, narrowed.** Extended only in the AI panel's own on-demand fetch (R-2) |
| **A-8** — AC field id needs to be configurable or discovered | **Retired.** Already solved by `resolveAcceptanceCriteriaFieldIds()`; no new setting (R-2) |
| **A-10** — XXL resolves to a user-chosen number | **Confirmed and specified** (R-7) |
| Spec premise — multi-item AI replies are novel here | **Wrong; corrected.** `{kind, items[]}` is the dominant established shape (R-3) |
