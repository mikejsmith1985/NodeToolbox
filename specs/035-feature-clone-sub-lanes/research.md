# Research: Cloned-Feature Sub-Lanes

**Feature**: `specs/035-feature-clone-sub-lanes` | **Date**: 2026-08-12

All NEEDS CLARIFICATION items from the spec were resolved in conversation on 2026-08-12 and recorded in the spec's
Clarifications section. This document records the technical findings behind the plan, and the decisions taken because
of them.

---

## R-001 — How a clone is recognised

**Decision**: Read Jira's Cloners issue link, in both directions, and require the clone to live in a **configured
discipline project**.

**Rationale**: A sampled dev Feature's Issue Links panel reads:

```
is cloned by
   DENP-1359   H Contract Migration - Blue Plans to Purple Platforms for plan year 2028
   QEINT-610   Enrollment- Migration - H Contract Consolidation (Blue to Purple) - Oklahoma plan for 1/1/2027
```

Two facts follow, and both shape the design:

1. **The link alone is not enough.** `DENP-1359` is in the dev team's *own* Feature project — a peer Feature created
   by cloning to split scope, not another discipline's copy. Only `QEINT-610` is a sub-lane. **The project decides,
   not the link.** This became FR-001c.
2. **Name matching is nearly useless here.** The QE clone's summary shares almost no words with its original: a
   discipline rewrites the title to describe its own scope and plan year. The name fallback the user chose (option 1-D)
   is retained as a safety net for hand-created Features, but the plan must not depend on it. This is recorded in
   FR-001 and gated hard by FR-001b (exact match, trimmed, inside configured projects only).

**Alternatives considered and rejected**:

| Alternative | Why rejected |
|---|---|
| `Spark ID` / `USM Clarity ID` / `EN Clarity ID` | All three read `30703` on **both** DENP-1398 and DENP-1429, two unrelated Features. They identify a programme, not a Feature, so they cannot pair a clone with its original. |
| Summary/Feature Name matching as the primary test | Disproven by the sample above — the QE clone's title is entirely different. |
| A new custom field holding the dev Feature key | Correct in principle, but requires every discipline to populate it. The Cloners link already exists and is free. |

**Existing code**: There is **no** clone-link handling anywhere in `rollupBoard/`. There is no shared issue-link
helper either — four private readers exist (`featureRollup.ts:200`, `defectRollup.ts:43`, `masterCards.ts:36`,
`rollupBoardFetch.ts:247`), each re-casting `fields.issuelinks`. `normalizeLinkPhrase` (`featureRollup.ts:185`) is the
one existing phrase normaliser; the new reader follows its shape rather than inventing another.

**Direction**: Jira records the Cloners link on whichever side pressed Clone, so both `is cloned by` and `clones` must
be read (A-008). The sample shows the dev Feature holding `is cloned by`, but that is not guaranteed.

---

## R-002 — Determining a clone's project

**Decision**: Infer the project from the **issue key prefix**, as the board already does everywhere.

**Rationale**: `BASE_ISSUE_FIELDS` (`rollupBoardFetch.ts:57`) does **not** request `project`. Every existing
project decision in this feature area reads the key prefix instead — `readProjectKey` (`featureScope.ts:89`),
`RollupBoardTab.tsx:413`, `FeatureScopePanel.tsx:57`. Following that costs no extra field on an already-wide fetch and
keeps one convention rather than two.

---

## R-003 — Where sub-lanes fit the existing lane model

**Finding**: `RenderedLane` (`rollupBoardTypes.ts:298`) is **flat**. Lanes are a plain array keyed by `featureKey`,
with no parent/child relationship, and `buildBoardLayout` (`boardLayout.ts:186`) produces them from a flat
`MasterCard[]`.

**Decision**: Add sub-lanes as a **field on the existing lane** (`RenderedLane.subLanes`), not as extra top-level
lanes filtered afterwards.

**Rationale**: Extra top-level lanes would flow into `allFeatureKeys` (`RollupBoardTab.tsx:1008`), which feeds the
`SortableContext` and the lane-reorder detection in `detectCollisions` (`:995`) and `handleBoardDragEnd` (`:1200`) —
making a sub-lane independently draggable and reorderable against its own parent. Nesting the data avoids inventing a
rule to suppress that.

**Ordering is untouched**: `orderLanesLikePiReview` (`masterCards.ts:190`) and `orderLanes` (`boardLayout.ts:135`)
continue to see only primary lanes.

---

## R-004 — The two figures (dev and family)

**Finding**: `computeFeatureProgress(items)` (`featureProgress.ts:34`) takes a flat item list and is called from
`buildVitals` (`masterCards.ts:63`) **before any filtering** — an invariant documented at `boardLayout.ts:3-5`.

**Decision**: Compute the family figure with the **same function**, over the concatenation of the primary items and
every sub-lane's items. No second progress implementation.

**Rationale**: Two implementations of "percent complete" would drift, and the repo already has a standing rule that
two surfaces showing one metric must consume one computation. Reusing `computeFeatureProgress` also inherits its
story-points-vs-issue-count basis rule for free — including the honest consequence that a family whose QE stories are
unpointed falls back to issue count.

**Consequence to state in the UI**: the dev figure and family figure may have **different bases** (points vs count).
The lane must not present them as directly comparable when they are not.

---

## R-005 — Making sub-lanes read-only

**Finding**: Every card is **unconditionally draggable** — `useDraggable({ id: item.key })` at `ChildCard.tsx:89`,
with `{...listeners} {...attributes}` spread on the root div (`:129-130`) and no gating prop on `ChildCardProps`.

**Precedent**: `BoardColumnHeaderRow.tsx:43-46` already does exactly what is needed:
`useSortable({ id: column.id, disabled: !isReorderable })` plus a conditional listener spread at `:69`.

**Decision**: Add `isReadOnly` to `ChildCard`, following that precedent exactly — `disabled` on the hook AND withheld
listeners, because the hook's `disabled` alone still leaves the attributes advertising a draggable element to
assistive technology.

**Rationale**: This is the smallest change that cannot half-work. Filtering sub-lane drops inside `resolveCardDrop`
instead would let the drag start, the card lift, and then silently snap back — precisely the "discovered rather than
announced" failure FR-006a forbids.

---

## R-006 — Per-discipline colour

**Finding**: `tokens.css` defines seven semantic tone pairs (`--color-tone-info-bg/fg`, `-success-`, `-warning-`,
`-danger-`, `-neutral-`, `-orange-`, `-purple-`), each with a light-theme redefinition. **None is currently used in
`RollupBoardTab.module.css`** — the board uses flat hues for card stripes only.

**Decision**: Assign each discipline one tone pair, by its position in the team's configured discipline list, from a
fixed rotation. Never generate a colour.

**Rationale**: Tone pairs carry a matched foreground, so contrast holds in both themes without new colour work.
Assigning by configured position makes the colour stable across reloads and viewers (US2 scenario 2) without storing
a colour anywhere.

**Accessibility**: FR-004 requires a text label regardless, so colour is reinforcement, never the sole signal.

---

## R-007 — Fetching the clones

**Finding**: `fetchFeaturesByKeys` (`rollupBoardFetch.ts:165`) already fetches arbitrary Features by key in chunks of
`FEATURE_KEY_CHUNK_SIZE` (50), and `fetchTeamIssuesForFeatures` (`:444`) already fetches the work rolling up to a set
of Feature keys in another project.

**Decision**: Reuse both. Clone discovery is one extra pass over links the board **already loads** —
`issuelinks` is in `BASE_ISSUE_FIELDS` (`rollupBoardFetch.ts:57`) — so finding the clone keys costs **no request at
all**. Only fetching the clones' own child work is new traffic, and it is the same shape as the existing team-issues
call.

**Cost**: one additional `key in (…)` read for the clone Features (often already present) and one
`Feature Link in (…)` read per discipline project for their work.

---

## R-008 — Framework-first gate (Constitution Article VII)

Checked before designing anything:

| Capability needed | Provided by | Verdict |
|---|---|---|
| Reading issue links | Jira REST `issuelinks`, already fetched | **Use it** — no custom link store |
| Clone relationship | Jira's built-in Cloners link type | **Use it** — no custom field invented |
| Chunked key reads | `chunkList` + `FEATURE_KEY_CHUNK_SIZE` | **Use it** |
| Percent complete | `computeFeatureProgress` | **Use it** — no second implementation |
| Drag gating | dnd-kit `disabled` option | **Use it** — precedent at `BoardColumnHeaderRow.tsx:43` |
| Colour with theme support | existing `--color-tone-*` pairs | **Use it** — no new palette |
| Per-team storage | `boardScopeStore.ts` | **Extend it** — one new field, no new store |

No documented gap requires custom infrastructure. **Gate passes with no drift.**
