# Phase 0 Research: Personal Workflow — Auditable Markdown Report

**Feature**: `025-personal-flow-audit` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

Nine questions settled before design. Two findings change the shape of the work: the fetch query is a **deliberate
superset** of what gets counted (R2), and there is **no markdown→Confluence writer** in the codebase (R5).

---

## R1 — What must the engine surface for the worked example? (FR-010a)

**Decision**: `computePersonalFlow` must return, for **one** nominated credited issue, the evidence it currently
computes and discards.

**What exists internally** (`personalFlow.ts:151–186`, all non-exported):

| Internal type | Holds |
|---|---|
| `OwnershipInterval` | A maximal span the target held the issue (`startMs`, `endMs`) |
| `StateSegment<T>` | A contiguous span where a reconstructed timeline holds one value |
| `CompletedContribution` | `endMs`, `handsOnDays`, `handsOnMillisByStatusId` |

**What survives today**: `PersonalFlowIssueMetric` keeps only `key`, `summary`, `storyPoints`, the **summed**
`cycleTimeDays`, and `lastActiveIso`. Every stint and span is thrown away once the total is formed.

**Rationale for surfacing one issue, not all**: the spec's Q5 decision. A single worked example proves the method;
every other issue is listed with its total and link. That keeps the engine change small — one extra field on the
result, not a per-issue explosion — and keeps the document readable for a whole roster.

**Alternatives considered**: surface evidence for every credited issue (rejected — Q5, and it would multiply by
roster size); recompute the evidence in the document generator (rejected outright — a second derivation could
disagree with the first, which is precisely NFR-001's failure mode).

**Design note**: the nominated issue must be chosen *inside* the engine, where the spans are still in scope. Picking
it afterwards would mean re-deriving.

---

## R2 — The fetch query is a superset of what is counted ⚠️ SHAPES THE FEATURE

**Decision**: Two different link kinds, for two different claims.

`buildSearchJql` (`PersonalFlowTab.tsx:258`) builds:

```
assignee WAS "<person>" AND updated >= -<N>d ORDER BY updated DESC
```

Its own comment says `updated >= -Nd` is "a cheap superset — the engine does the exact windowing by each completed
stint's end, so an over-broad fetch is harmless." Harmless for *computing*; **not** harmless for *linking*. A reader
clicking that JQL sees the **fetched** set, which is deliberately larger than the **credited** set. Linking it against
a credited count would reproduce exactly the count-vs-link mismatch this feature exists to remove (FR-012).

| Claim in the document | Link kind |
|---|---|
| "N issues were **fetched** for this person" | the fetch JQL — it is literally what ran |
| "N issues were **credited**" | `issueKey in (…)` over the credited keys |
| "N issues were **excluded** as `<reason>`" | `issueKey in (…)` over that category's keys |

**Rationale**: this maps one-to-one onto the reconciliation FR-016 already requires (fetched = credited + excluded).
Each of the three numbers gets a link that returns exactly itself, so every row of the reconciliation is checkable.

**Alternatives considered**: linking only the fetch JQL everywhere (rejected — FR-012 violation, the exact defect
under repair); attempting to express the engine's stint logic as JQL (rejected — impossible, that is R3's premise and
the whole reason the worked example exists).

---

## R3 — What already exists for per-person queries

**Decision**: Extend, don't rebuild.

- **`buildSearchJql`** is already factored out for this exact purpose. Its comment: *"Factored out so the same string
  can be BOTH queried (by `buildSearchPath`) and shown to the user for cross-checking in Jira — guaranteeing the
  displayed JQL never drifts from what actually ran."* That is NFR-001 already implemented for the fetch query.
- **`TeamFlowQueryCell`** (`:870`) already shows each person's JQL with a **Copy** button.
- **`buildJiraIssueNavigatorUrl(issueKeys, jiraBaseUrl)`** (`buildHygieneJqlUrl.ts:100`) builds the
  `issueKey in (…)` navigator URL and — usefully — **falls back to returning the raw JQL text when no base URL is
  configured**. FR-015 is therefore satisfied by the helper the spec already pointed at, with no new handling.

**Gap**: the comparison table offers *copy*, not a *one-click link*. FR-011 wants the link. That is an additive change
to an existing cell, not new machinery.

---

## R4 — Raising the ceiling (FR-019, FR-019a)

**Decision**: Page the search, and enforce two ceilings.

`buildSearchPath` (`:266`) requests `maxResults=${MAX_ISSUES}` with `MAX_ISSUES = 100` and **no `startAt`, so no
pagination** — a single page, silently truncated at 100.

The fix is paging with two bounds, per the Q6 decision: a per-person issue ceiling and an overall run budget,
whichever is reached first. Both must be reportable, because FR-019b requires naming which ceiling was hit and which
people are affected.

**Cost note**: each issue is fetched with `expand=changelog`, which is heavy. Raising the ceiling multiplies both
request count and payload size across a roster — this is the reason NFR-006/NFR-006a (progress + cancel) exist.

**Alternatives considered**: raising `maxResults` alone (rejected — Jira caps page size, so it does not actually lift
the limit); unbounded paging (rejected — "All history" is 3650 days and one click away).

---

## R5 — There is no markdown→Confluence writer ⚠️ AFFECTS P2 ONLY

**Decision**: The clipboard path (P1) needs no conversion. The direct-publish path (P2) needs a converter that does
not exist yet.

`confluenceStorageText.ts` exports **only `readConfluenceStorageText`** (storage → plain text). Nothing converts the
other way. PI Review writes Confluence storage XHTML it constructs itself; it does not render markdown.

| Path | Needs |
|---|---|
| **P1 — clipboard** | Nothing. Markdown text on the clipboard; Confluence converts on paste |
| **P2 — direct publish** | Markdown → Confluence storage XHTML, for the subset of markdown this document uses |

**Rationale for the P1/P2 split in the spec being the right sequencing**: it is not merely a preference — P1 genuinely
has no conversion dependency, so it can ship this week while the converter is built.

**Scope control for P2**: the converter only needs the constructs this document emits — headings, paragraphs, tables,
links, bold, and code spans. It is a document-specific renderer, not a general markdown engine, and should be stated
as such so it is not mistaken for one later.

---

## R6 — Clipboard

**Decision**: Reuse the existing helper.

Two exist: `FeatureCanvas/ai/clipboard.ts` (sync, fire-and-forget) and `JiraTemplateMaker/lib/copyToClipboard.ts`
(async, returns success). `PersonalFlowTab` already imports one for `TeamFlowQueryCell`'s Copy button.

**Use the async, result-returning one** for the document: a silently failed copy of a long report is much worse than
a failed copy of a short JQL string — the user would paste stale clipboard content into Confluence and not know.

---

## R7 — Cancellation (NFR-006a)

**Decision**: A cancellation flag checked between per-person fetches, not request-level aborts.

`AbortController` appears only in `services/browserRelay.ts` — there is no established pattern for cancelling a
multi-request analysis in a view.

A roster run is a **sequence of per-person analyses**. Checking a cancel flag between people (and between pages within
a person) is sufficient, far simpler than threading abort signals through the fetch layer, and matches the granularity
the user experiences: "stop after the person currently being processed".

Per NFR-006a a cancelled run **produces no document** and leaves prior results displayed, so no partial state needs
reconciling.

---

## R8 — The generator can be pure

**Decision**: Document generation is a pure function from the completed result set to a string.

`computePersonalFlow` "never reads the clock — `input.todayIso` anchors the window — so it is a pure function"
(`:190`). The generator inherits that: given the per-person results, the roster label, the window, the Jira base URL,
and a generation timestamp **passed in**, it returns markdown deterministically.

**Consequence**: the entire document — every formula, every worked example, every link — is unit-testable with no
browser, no Jira, and no clock. Given the feature's whole purpose is trustworthiness, its output being exhaustively
testable is the point, not a convenience.

---

## R9 — Roster mode is the primary path

**Decision**: Build around `TeamFlowRow[]`, not the single-person result.

The comparison table already renders `rows: TeamFlowRow[]`, where each row carries `personDisplayName`,
`roleCapabilities`, `result` (a `PersonalFlowResult` or null), `errorMessage`, `jql`, and `queryValue`. A row whose
`result` is null is already handled as a per-person error.

**Consequence**: the document generator consumes the same row list the table does — one source, two renderings
(NFR-001) — and must render a per-person failure honestly rather than omitting that person, or the roster would
silently shrink.

---

## Resolved summary

| # | Question | Status |
|---|----------|--------|
| R1 | Engine change for the worked example | ✅ One nominated issue's evidence, chosen inside the engine |
| R2 | Fetch JQL vs credited set | ⚠️ **Superset** — three link kinds, one per reconciliation row |
| R3 | Existing per-person query support | ✅ `buildSearchJql` + navigator helper; only the *link* is missing |
| R4 | Raising the ceiling | ✅ Page the search; two ceilings; both reportable |
| R5 | Markdown → Confluence storage | ⚠️ **Does not exist** — P2 only; P1 unblocked |
| R6 | Clipboard | ✅ Reuse the async, result-returning helper |
| R7 | Cancellation | ✅ Flag between per-person steps |
| R8 | Generator purity | ✅ Pure; fully unit-testable |
| R9 | Roster shape | ✅ Consume `TeamFlowRow[]` |

**No NEEDS CLARIFICATION remain.** R2 and R5 are findings, not open questions — both are resolved above.
