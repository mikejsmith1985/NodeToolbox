# Research: Guided Epic Intake

**Feature**: 037-guided-epic-intake | **Date**: 2026-09-18 | **Plan**: [plan.md](./plan.md)

Every decision below is backed by what the codebase actually does today, with the line that proves it.
Paths are relative to `client/src/` unless stated.

---

## R-001 — Where the mode lives inside Feature Composition

**Decision**: Add a `compose | intake` toggle at the root of `FeatureCompositionTab` (above the load bar, line 443).
In intake mode, render `<EpicIntakeWorkspace …/>` **instead of** the existing body. Leave the existing body's JSX and
state **exactly where they are**.

**Rationale**: The tab has no mode concept today. Create-vs-update is implied by `draft.existingIssueKey`
(`FeatureCompositionTab.tsx:439`), so there is nothing to extend. Because all of the composition state lives in
`useState` hooks at the top of the component (lines 76–97, 340), it **stays mounted** while the intake is shown.
Switching back finds the composition draft exactly as it was (FR-001). This holds by construction, with no persistence
round-trip.

**Alternatives rejected**: Moving the 830-line body into a `CompositionWorkspace` child is cleaner, but it is a refactor
of a shipped surface for no functional gain, and the project's standing rule is additive edits only. A fourth PO Tool
tab was rejected by the user ("mode inside feature composition").

**Guard**: `FeatureCompositionTab.test.tsx` passes **unmodified**. The default mode is `compose`, so every existing
assertion sees today's DOM.

## R-002 — The engine is a pure decision checklist, not a wizard

**Decision**: The intake's state is a list of items, each with **seven decision slots**. One pure function,
`readIntakeNextStep(intake, isAiUnlocked)`, derives from that state alone which step is current and whose turn it is.
The UI never stores "current step".

**Rationale**: This is the "twenty questions" property the user asked for. The next question depends only on which
answers are still missing, so resuming a saved intake (US6) is automatically correct. The approach is the same as Bulk
Re-write's `readRewriteJourney(batch) → {steps, nextAction, isComplete}` (`views/PoTool/rewrite/rewriteJourney.ts:128`),
which derives its flow from state and has no stored cursor. That precedent is proven in production.

**Alternatives rejected**: A stored step index (a state machine with transitions). It duplicates what the data already
says, and it drifts the moment a PO answers a question "out of order" or a reply settles a decision early.

## R-003 — Deterministic before AI: the outline baseline

**Decision**: Before any AI round, Toolbox groups the notes into items **by outline structure**:

- A line with a top-level marker (`•`, `-`, `*`, `1.`) starts an item.
- A line with a second-level marker (`o`, `◦`, `▪`, `–`) or deeper indentation attaches to the item above it.
- An unmarked line is set aside as *heading or prose*.

If **no** line carries a marker, every non-blank line is its own item.

**Rationale**: GH #387's pasted Outlook text uses exactly `•\t` and `o\t`. The baseline therefore already gets most of
the grouping right with no AI. It gives the AI round something concrete to correct instead of something to invent, and
it makes the AI-locked path (FR-026) workable: the PO starts from a sensible grouping, not from 60 loose lines.

**Alternatives rejected**: Letting the AI group from scratch makes coverage failures more likely and leaves the locked
path with nothing.

## R-004 — Ownership by stated size is Toolbox's call, not the AI's

**Decision**: Toolbox parses area sizes from each item's attached lines (`XL Enrollment`, `Fulfillment M`,
`Fulfilment dev M`, `Vendor size L`, `(1.2M) XL Enrollment`). The size scale comes from `FeatureSizeName` /
`isFeatureSizeName` in `views/ArtView/ai/piReviewSizing.ts:14,48`, whose ascending order XS…XXL already exists. The
ownership rule (contract `deterministic-rules.md` §4) settles the owner before the AI is asked.

**Rationale**: FR-014 says stated sizes decide. If the AI decided, the same notes could give a different owner on a
second run. The notes also spell it "Fulfilment" (GH #387, *Invoice overhaul*), so the parser carries both spellings.

**Reuse note**: `piReviewSizing.ts` and `FeatureCanvas/logic/sizing.ts` hold two separate scales; they are not unified
(XXL is `null` in one and 100 in the other). Only the **order** is needed here, and `FEATURE_SIZING_SCALE`'s order is
used. No points are read.

## R-005 — AI reply envelopes and validation

**Decision**: There are three reply kinds, each an object envelope parsed via the shared `extractJsonPayload`
(`utils/extractJsonPayload.ts:113`):

| Kind | Round | Validated against |
|---|---|---|
| `epicIntakeClassify` | Sort the notes | line numbers, item ids, closed enums |
| `epicIntakeMatch` | Match | each item's own candidate keys (allowlist) |
| `epicIntakeDraft` | Draft | item ids marked create-new |

The parsers never throw. They return `{ accepted, rejected: {itemId?, reason}[] }` so the UI can list every rejection,
following `piReviewAiAssist`'s structured-result precedent (`ArtView/ai/piReviewAiAssist.ts:81-88`). Keys and enums are
matched case-insensitively and written back in canonical casing, following the component-mapping precedent
(`PoTool/ai/componentMappingAiAssist.ts:93-115`).

**Rationale**: `extractJsonPayload` needs an object root; it strips fences and surrounding prose, which is why every
existing envelope is `{kind,…}`. Rejecting a key that is not among that item's candidates is FR-018. It is the same
anti-invention spine as 032's fact sheet and 031's allowlist.

**Nine-section text**: There is **no** shared prompt-instructions builder. The nine-section wording is duplicated
inline in `compositionAiAssist.ts:99-108` and `bulkRewriteAiAssist.ts:77-82`. The draft prompt builds its own copy from
`SECTION_LABELS` + `VALIDATION_MARKER` (`ai/featureDocSections.ts:12,27`), so the list can never drift from the
normaliser. Consolidating the two existing copies is out of scope.

## R-006 — Prompt size and chunking

**Decision**: Reuse `MAX_CHARS_PER_PROMPT = 9000` (exported, `rewrite/ai/bulkRewriteAiAssist.ts:26`, sized for
chat-box paste limits per GH #376). The classify round is split **only at item boundaries** from the outline baseline
(R-003). Parts are ingested independently, and coverage is proven across the union of parts (FR-011).

**Rationale**: GH #387 is about 3,100 characters, so it fits in one part. The limit is inherited rather than re-derived.
Splitting at item boundaries means no item's lines straddle two parts.

## R-007 — Duplicate search: project-scoped type, OR-ed phrase clauses

**Decision**:

- **Epic type, one source for create and search**: resolve DENP's Epic type through `getProjectIssueTypes('DENP')`
  (`services/jiraApi.ts:284`), matching the name `Epic` case-insensitively. That single lookup yields both the **id**
  for create and the **name** as the instance spells it for JQL.
- **Query per item**:
  `project = "DENP" AND issuetype = "<name>" AND statusCategory != Done AND (<term clauses>) ORDER BY updated DESC`,
  `maxResults = 20`.
- **Term clauses**: each AI search term (a short phrase) becomes its own
  `(summary ~ "<t>" OR description ~ "<t>")`, and the clauses are OR-ed together. Terms are sanitised with Hygiene's
  reserved-character rule.
- **Named keys**: each is fetched individually through `fetchIssueByKey` (`services/issueLookup.ts:34`). A 404 is
  classified via `extractHttpStatus` (`:43`).

**Rationale**:

- **Why not `loadFeatureIssueTypeNames()`**: it falls back to `['Feature']` when it cannot reach the instance
  (`services/jiraIssueTypes.ts:83`). After DENP's rename that fallback names a type that no longer exists, which is the
  exact GH #376 failure mode (JQL 400, silently empty). For intake, a failed lookup means **"not checked"** (FR-019),
  never a guess.
- **Why OR per phrase**: Jira's `~` matches whole words, and a multi-word value requires all of its words. OR-ing short
  phrases widens recall without matching every Epic in DENP.
- **Why per-key fetch and not `key in (…)`**: JQL answers `key in (…)` with **400** when any listed key does not exist.
  One typo in the notes would blind the whole batch.

**Drift, recorded**: Hygiene's `JIRA_TEXT_RESERVED_PATTERN` and `buildIssueTextMatchTerms`
(`views/Hygiene/HygieneFixControl.tsx:752,772`) are private on purpose, because a second non-component export from a
`.tsx` trips fast-refresh. They **move** to `utils/jqlTextTerms.ts`, and `HygieneFixControl` imports them from there.
**`HygieneFixControl.test.tsx` passes unmodified or the move is reverted.** Intake uses the reserved-character strip
**without** the trailing wildcard: a trailing `*` exists for somebody still typing, and these terms are finished
phrases.

## R-008 — Creating Epics: required fields and Epic Name

**Decision**:

- **Required fields**: create through `createIssue` (`services/jiraApi.ts:307`) with
  `{project:{key}, issuetype:{id}, summary, description, labels:[label]}`. Before the first create, read
  `getIssueTypeFields('DENP', epicTypeId)` (`:295`). Any required field that has no default and that intake does not
  supply is asked of the PO **once for the batch** through the existing `TransitionRequiredFields` picker
  (`components/TransitionRequiredFields/index.tsx:33`), and the answers are applied to every Epic.
- **Epic Name**: when the create screen requires a field whose **name** is `Epic Name` (case-insensitive), it is filled
  from the Epic's summary.

**Rationale**:

- **Required fields**: this is the GH #384 lesson (ask the create screen what it needs) applied to Epics.
- **Epic Name**: Jira DC classically requires Epic Name on Epics, and the codebase has **no** Epic Name handling
  anywhere (repo-wide grep `epic.?name`: zero hits). Discovering the field by name at runtime keeps every new file
  **field-blind** for the `fieldMappingBoundary.test.ts` ratchet, which fails on any new file naming a `customfield_*`
  id.

**Reuse caveat**: GH #384's `readUnansweredRequiredFields` (`views/SnowHub/prb/prbRequiredFields.ts`) lives only on the
unmerged `fix/prb-required-fields-and-ordering`, inside a SnowHub folder. Intake maps `CreateMetaFieldEntry` →
`TransitionRequiredField` itself; the mapping is about ten lines. If #384 merges first and its helper is moved
somewhere shared, the task switches to importing it.

**Why not `runCompositionCommit`**: it commits one composition draft through a diff built around a single
`existingIssueKey` (`jira/buildCompositionCommit.ts:124,137`) and writes no labels. Intake's loop calls `createIssue`
per accepted draft. It reuses the **pattern** from `runSplitCommit` (`jira/runCommit.ts:114`): sequential, with a
failure isolated to its own item. It also reuses `readFailureReason` (`:47`), which gets **exported** so Jira's own
message is shown (US4-5).

## R-009 — Idempotency across sessions

**Decision**: Each created key is written to the intake record **immediately** after its create succeeds, before the
next create starts. An item whose outcome is `created` is never posted again (US4-6).

**Residual risk, accepted and surfaced**: if the browser dies between Jira's 201 and the save, a retry would create a
second Epic. Mitigation: before re-posting an item that is marked `creating`, Toolbox searches DENP for an open Epic
whose summary matches the draft exactly and that the current user created today. If one exists, it is adopted instead
of creating another.

## R-010 — Persistence

**Decision**: Use a new store, `intake/epicIntakeStore.ts`, keyed `tbxPoEpicIntake:<intakeId>:<teamProfileId>` via
`buildTeamScopedStorageKey` (which appends the profile id) (`views/SprintDashboard/hooks/teamScopedStorage.ts:11`). It is guarded by
`canPersistDrafts()` (`drafts/splitDraftStorage.ts:20`). The record carries a `schemaVersion` and is **normalised on
read**.

**Rationale**: Bulk Re-write's store (`rewrite/rewriteBatchStore.ts`) is the template, but it uses a raw
`JSON.parse` cast with no version. Intake records are longer-lived and change shape round to round, so a malformed
record must degrade to "cannot resume" rather than crash the tab. Export/import is **not** built; Bulk Re-write's
export/import has no UI caller today, so demand is unproven.

## R-011 — AI-locked behaviour and the no-AI copy scan

**Decision**:

- **Locked**: every AI turn is replaced by PO controls over the same decisions, as closed selects (kind, owner, label,
  match). The one exception is the draft: its summary and description are editable text, prefilled from the item's
  title and source lines.
- **Unlocked**: `PoAiPanel` (`ai/PoAiPanel.tsx`) is used unchanged. It returns `null` when locked (`:37`), and only one
  instance is on screen at a time, which avoids its fixed element ids colliding.

**Constraint**: `poToolWithoutAi.test.tsx` scans the **rendered DOM** of `FeatureCompositionTab`. When locked, it must
find none of: `AI` (as a word), `assistant`, `unlock`, `⚡`, a button named `/prompt|reply/i`, or a textbox named
`/prompt|assistant/i`. Every intake label and step name is written to pass this, for example "Sort the notes" and
"Check DENP", never "AI round". One **additive** case is added to that test to render the tab in intake mode. Existing
cases are untouched.

## R-012 — Copying the summary as a real table

**Decision**: Write both `text/html` (a `<table>`) and `text/plain` (Markdown) through `ClipboardItem`. When
`ClipboardItem` is unavailable, fall back to plain text. The precedents are `utils/downloadElementImage.ts:197-272` and
`ArtView.tsx:2508`.

**Rationale**: US5-2 requires the table to paste **as a table** into email, Teams and Confluence, and all three take
`text/html`. Markdown alone pastes as pipes into Outlook.

## R-013 — Framework-First ledger

| Capability | Verdict | Where |
|---|---|---|
| Source intake (paste / PDF / .msg / workbook / Confluence) | **reuse** | `sources/*` readers, `readSourceText` |
| Rich paste → text | **reuse** | `sources/pastedRichText.ts:137` |
| AI gate + copy/paste panel | **reuse** | `useAiAssistStore`, `PoAiPanel` |
| JSON extraction + repair | **reuse** | `utils/extractJsonPayload.ts` |
| Prompt size cap | **reuse** | `MAX_CHARS_PER_PROMPT` |
| Nine-section normalise / de-attribute | **reuse** | `featureDocSections.ts` |
| T-shirt order | **reuse** | `piReviewSizing.ts` |
| Epic type id + name | **reuse** | `getProjectIssueTypes` |
| Required-field discovery | **reuse** | `getIssueTypeFields` |
| Required-field picker | **reuse** | `TransitionRequiredFields` |
| Create | **reuse** | `createIssue`, `readFailureReason` (export) |
| Fetch by key + 404 | **reuse** | `fetchIssueByKey`, `extractHttpStatus` |
| Reserved-char term sanitising | **move** (drift) | → `utils/jqlTextTerms.ts` |
| Team-scoped storage + probe | **reuse** | `buildTeamScopedStorageKey`, `canPersistDrafts` |
| Journey strip styling | **reuse** | `rewrite/rewrite.module.css` journey classes |
| Rich clipboard | **reuse** (pattern) | `ClipboardItem` precedent |
| Outline grouping of notes | **new** — nothing parses bullets | `intake/notesOutline.ts` |
| Area-size parsing + ownership rule | **new** | `intake/ownershipRule.ts` |
| Jira key extraction (case-insensitive) | **new** — only private per-module regexes exist | `intake/namedKeys.ts` |
| Decision checklist + next step | **new** — the feature itself | `intake/intakeChecklist.ts` |
| Three reply parsers + prompts | **new** | `intake/ai/*` |
| Duplicate search orchestration | **new** (over reused primitives) | `intake/duplicateSearch.ts` |
| Epic create loop | **new** (over reused primitives) | `intake/epicCreate.ts` |
| Summary rows + table render | **new** | `intake/intakeSummary.ts` |
| Intake store | **new** (030 template) | `intake/epicIntakeStore.ts` |

**Totals**: 17 of 26 capabilities are reuse, including one recorded move. The nine new ones are eight pure modules
plus the store.

## R-014 — Adjacent defects found, not fixed here

- `drafts/draftModel.ts:225` `normalizeSource` keeps only `confluence|workbook|jira|paste`. Composition drafts that hold
  PDF, email or SharePoint sources lose them on reload. Intake has its own store and is unaffected. File separately.
- Four surfaces query `issuetype = Feature` (`piReviewPullFeatures.ts:90`, `readinessFeatureQuery.ts:83`,
  `piFeatureRemap.ts`, `productOwnerFeatureReview.ts`). After DENP's rename they likely 400 or come back empty. These
  are out of scope per the spec; file as a `fix/` branch.
- The `services/jiraIssueTypes.ts` header comment ("this instance defines no Epic") is stale after the rename.
