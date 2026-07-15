# Contract: What an accepted suggestion may write

**Feature**: `016-pi-review-ai-assist` | **Consumers**: `ai/piReviewAiApply.ts`, `PiReviewSuggestionTable.tsx`

This is the feature's safety contract. It exists because the PI Review table's columns have **different owners**, and
writing to the wrong one doesn't fail loudly — it fails on the *next page load*, when reconciliation quietly rebuilds
the cell and the user's AI results appear to vanish.

Every rule below is enforced by a test, not by convention.

## The permitted write surface

**Four cells. Nothing else.**

| Column | Operation | Rule |
|---|---|---|
| `pointEstimate` | **replace** | Only when the suggestion has a resolved number (`derivedPoints`, or `userSuppliedPoints` for XXL) |
| `notes` | **append** | Via the existing `appendUniqueNoteLine` — never a raw assignment |
| `devWork` | **tick / untick** | Only on an explicit boolean verdict. `'Yes'` ticks; `''` unticks |
| `testSupport` | **tick / untick** | Same |

**Why Dev Work and Test Support are permitted** *(added 2026-07-15)*: they are the mirror image of
Dependency/Risks. Reconcile passes them straight through (`piReviewJira.ts` — they are absent from
`reconcileSinglePiReviewRow`'s `nextRow`), so they are **human-owned** and an accepted value survives
the next page load. They also carry exactly the judgement the prompt material supports: does our team
build this, or only help test what another team built.

**A `null` verdict is not `false`.** `null` means the model said nothing, and unticking a box on the
strength of silence would quietly undo a human's judgement. Only an explicit boolean moves the cell.

## The forbidden surface

| Column | Why it is forbidden |
|---|---|
| `dependency` | Rebuilt from Jira issue links on **every** load (`piReviewJira.ts:402`). Text written here is blanked and migrated into `notes` — the user watches their data move (Q1 / FR-025) |
| `risks` | Same (`piReviewJira.ts:405`) |
| `priority` | Overwritten from the Jira issue on every load; the AI was not asked to set it |
| `carryOver`, `committed` | Human judgement outside the request's scope |
| `feature` | Identity. Set once when the Feature is pulled |
| `rowId` | Internal |

**Test obligation**: apply every kind of suggestion to a row and assert that **every** field except `pointEstimate`
and `notes` is referentially unchanged. This is the single most valuable test in the feature — it is what makes the
Q1 guarantee ("an AI run and a page reload can never disagree") mechanically true instead of aspirational.

## Notes: the append rules

Reuse `appendUniqueNoteLine(notes, label, value)`, exported from `piReviewJira.ts`. **Do not reimplement the
format** — reconciliation writes into this same column with this same convention when it migrates Dependency/Risks
text, and a second implementation would drift from it (research R-4).

| Note | Label | Produces |
|---|---|---|
| `riskNote` | `Risk note` | `Risk note: <text>` |
| `dependencyNote` | `Dependency note` | `Dependency note: <text>` |
| `implementationNote` | `Implementation note` | `Implementation note: <text>` |

**`Risk note` and `Dependency note` are deliberately the labels reconciliation already uses**
(`piReviewJira.ts:402-407`). AI-authored and migration-authored notes are the same kind of thing — an explanation
that could not live in a Jira-mirrored column — and should read identically. `Implementation note` is new, for
ART/RTE content that has no migration equivalent.

What the reused function gives us for free:
- **Append-only** — existing notes are never overwritten. This is why FR-023's "don't clobber human content" concerns
  only the estimate: a note *cannot* clobber.
- **Blank guarding** — `''`, `n/a`, `none`, `no`, `-`, `--` are skipped (`isMeaningfulFreeText`).
- **Idempotence** — normalized-substring dedupe means accepting the same suggestion twice adds nothing (FR-027).
- **`\n` joining** — matches what the writer emits and the parser reads back.

Applied on top:
- **Length cap** — each note is truncated to **`MAX_AI_NOTE_LENGTH = 300`** characters (with an ellipsis) **before**
  the call, matching the house constant `MAX_TEXT_SIGNAL_LENGTH` in `canvasAiAssist.ts:84`. Nothing caps this column
  today; a model reply could otherwise write unbounded text into a Confluence cell that renders on **one line**
  (research R-4).

### Ordering

Append in a fixed order so repeat runs and reconciliation produce a stable cell:

```text
<existing notes>
Dependency note: …
Risk note: …
Implementation note: …
```

`Dependency` before `Risk` mirrors reconciliation's own order (`piReviewJira.ts:402` then `:405`).

## Point Estimate: the replace rules

| Condition | Behaviour |
|---|---|
| `size` valid, not XXL | `pointEstimate = String(derivedPoints)` |
| `size === 'XXL'` | Not acceptable until the user supplies a number (`needsPoints`, research R-7) |
| `size === null` | Estimate **untouched**; the item survives for its notes alone |
| Row already has a human estimate | **Conflict — surfaced, not silent.** Current and proposed are both shown; the human's value stands unless they choose the suggestion (FR-023) |

### The Jira consequence — must be disclosed

Accepting an estimate into a row whose **Jira** estimate is empty arms an existing write-back:
`pendingEstimateUpdate` (`piReviewJira.ts:410-416`) queues a Jira field write on the next save when Jira's estimate
is null **and** the row holds a finite number.

That is **exactly** the state an accepted AI estimate creates, and per Q2 it is intended: an accepted AI estimate is
just a value, with no special case. FR-030 therefore requires the panel to state — **before** acceptance is possible
— that an accepted estimate can update the Jira issue.

**Test obligation**: assert the disclosure renders and is visible **before** any Accept control is reachable. With no
provenance tracking by design, this copy is the only thing standing between the user and an unexpected Jira edit.

## Invariants

- **CW-1**: For any suggestion in any state, every `PiReviewRow` field other than `pointEstimate`, `notes`,
  `devWork` and `testSupport` is unchanged.
- **CW-2**: A suggestion that is not `accepted` has changed **no** field at all.
- **CW-3**: Applying the same suggestion twice equals applying it once (notes dedupe; estimate is idempotent
  replace).
- **CW-4**: Applying a suggestion never triggers a Confluence write — it only marks the page dirty (FR-022).
- **CW-5**: `description` and `acceptanceCriteria` never appear on a `PiReviewRow`. They are prompt inputs only —
  putting them on a row would enrol them in the "Jira updated N fields on load" delta and make them Jira-owned
  columns (research R-2, FR-038).
