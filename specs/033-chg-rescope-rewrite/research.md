# Phase 0 Research: Rebuild an Existing Change From Scratch

**Feature**: `033-chg-rescope-rewrite` | **Date**: 2026-08-07

This is the Article VII (Framework-First) gate. The question answered here is not "how do we build a rebuild
flow" but **"how much of a rebuild flow does this codebase already ship?"** — asked before any design was sketched.

The answer changes the shape of the feature: **the terminal action already exists.** What is missing is the entry
point, the binding, one safety guard, and draft isolation.

---

## Finding 1 — The write path already exists: `updateExistingChg`

**Decision**: Reuse `useCrgState.updateExistingChg(chgNumber)` unchanged as the rebuild's save. Do **not** write a
new PATCH path.

**Evidence** (`client/src/views/SnowHub/hooks/useCrgState.ts:1984`):

```ts
const changeSysId = await fetchChangeSysIdByNumber(normalizedChangeNumber);
const changeRequestPayload = buildChangeRequestPayload(state, readPrimaryChangeSubmissionTarget(state));
// … change_manager alias resolution …
await snowFetch(`/api/now/table/change_request/${changeSysId}`, { method: 'PATCH', … });
const verifiedChangeRecord = await fetchChangeRecordByNumber(normalizedChangeNumber);
const mismatchMessages = buildSubmissionMismatchMessages(state, verifiedChangeRecord);
```

It already delivers, unmodified, five things the spec requires:

| Spec requirement | Already satisfied by |
|---|---|
| FR-028 update in place | PATCH to `change_request/{sysId}` resolved from the number |
| FR-029 never creates a record | No POST to the collection anywhere in this path |
| SC-004 no stale value survives | `buildChangeRequestPayload` is the **same** payload builder `createChg` uses — full field parity with a new change, including planning aliases, custom SNow fields, and the change-manager dual-alias write |
| Article X verification | Re-reads the record after the PATCH and reports field-by-field mismatches rather than trusting a 200 |
| Out of Scope: CTASKs | This path creates no change tasks (unlike `createChg`, which reconciles and creates them) |

**Rationale**: A second write path would duplicate the payload builder, the alias resolution, and the verification
read — and would drift from `createChg` the first time a SNow field is added. Article VII forbids exactly this.

**Alternatives considered**:

- *PATCH via the existing relay endpoint* `PATCH /api/snow-relay/change/:changeKey` (`src/routes/api.js:1027`), which
  `ModifyChgTab` already uses. **Rejected**: its server-side payload map is a strict subset — it writes no
  `requested_by`, `assigned_to`, `u_tester`, `u_service_manager`, `u_expedited`, `change_manager`, custom SNow
  fields, or dynamic planning aliases. A rebuild saved through it would silently fail to write fields the operator
  filled in, breaking FR-005 ("as if new") and SC-004. It is the right endpoint for *targeted edits*, which is what
  ModifyChgTab's existing steps do; it is the wrong endpoint for a full rebuild.
- *A new client PATCH helper*. **Rejected**: it is `updateExistingChg` with the verification removed.

---

## Finding 2 — The builder already accepts a mode prop

**Decision**: Mount the existing builder from ModifyChgTab as `<CreateChgTab mode="rebuild" targetChangeNumber={…} />`.
Do **not** create a second wizard.

**Evidence** (`client/src/views/SnowHub/tabs/CreateChgTab.tsx:2368`):

```ts
export interface CrgTabProps { mode?: 'wizard' | 'configuration'; }
export default function CrgTab({ mode = 'wizard' }: CrgTabProps) { … }
```

and the precedent that proves the seam works (`tabs/ConfigurationTab.tsx:10`):

```tsx
return <CreateChgTab mode="configuration" />;
```

`ConfigurationTab` already renders the same component with a different mode, a different title/subtitle, wizard
chrome suppressed, and a different subset of steps — all driven off that one prop.

**Rationale**: This is the 017 optional-prop precedent (`FeatureReviewTab`'s `dashboardTeamProfileId?`): a new
optional prop, omitted by every existing caller, so `mode="wizard"` and `mode="configuration"` stay byte-identical.
Adding `'rebuild'` extends a proven seam rather than opening a new one.

**Alternatives considered**:

- *A third top-level mode on `ChgTab`* (`create | modify | rebuild`). **Rejected**: the spec places the entry point
  **inside** the loaded change (FR-001), and a top-level mode has no way to inherit the loaded change number.
- *Copy the six steps into ModifyChgTab*. **Rejected outright** — it duplicates ~2,700 lines and guarantees drift.

---

## Finding 3 — The scope machinery needs nothing new

**Decision**: US2, US3, and US4 are satisfied by existing behaviour once the builder is mounted.

**Evidence**:

| Spec requirement | Already ships |
|---|---|
| FR-009 project + fix version | `FetchIssuesStep` fetch-mode radio, `setProjectKey` / `setFixVersion` (`CreateChgTab.tsx:1070`) |
| FR-010 free-form query | Same selector, `customJql` mode |
| FR-011 add rather than replace | `actions.addIssues()` — the **"+ Add to Loaded Issues"** button (`CreateChgTab.tsx:1141`), which exists precisely to "pull in the odd story that doesn't share the release's fixVersion" |
| FR-012 add one issue by key | Custom JQL `key = ABC-123` through the same add path — the operator's "quick key search" is a narrow search, not a new mechanism |
| FR-013 no duplicates, added-vs-present count | `addIssues` reports a `fetchNotice`; behaviour to be confirmed by test, not assumed |
| FR-014 per-issue include/exclude | `toggleIssueSelection` + the select-all row (`CreateChgTab.tsx:1198`) |
| FR-017–FR-021 content generation | `fetchIssues` derives all four fields from the selected issues (`useCrgState.ts:1727`) |
| FR-022–FR-027 gated assist | `useAiAssist` (prompt build + `parseAiAssistChgResponse`), gated on `aiAssistStore`, copy-out/paste-back modal (`CreateChgTab.tsx:2742`) |

**Rationale**: The operator's request describes the Create flow verbatim. Nothing here is a gap.

---

## Finding 4 — GAP: multi-environment fan-out is unsafe for a rebuild

**Decision**: A rebuild MUST require **exactly one** enabled environment, refused with an explanation otherwise.
This is genuinely new logic and the feature's main correctness risk.

**Evidence**: `createChg` loops (`useCrgState.ts:2141`):

```ts
const changeSubmissionTargets = buildChangeSubmissionTargets(state, environmentValueByKey);
for (const changeSubmissionTarget of changeSubmissionTargets) { … POST … }
```

One CHG is created **per enabled environment**. But `updateExistingChg` calls `readPrimaryChangeSubmissionTarget`
(`:1449`), which silently takes `buildChangeSubmissionTargets(state)[0]`.

So today, enabling REL + PRD and pressing *Update Existing CHG* writes **only REL** to the target and discards PRD
without a word. For a rebuild — where the whole point is that the saved change describes the release accurately —
that is a silent data-loss defect.

**Chosen resolution**: block at the review step. A rebuild with zero enabled environments is refused (as creation
already is, via `NO_ENABLED_ENVIRONMENT_MESSAGE`, `useCrgState.ts:137`); a rebuild with two or more is refused with
a message naming the enabled environments and stating that a rebuild targets one change number.

**Alternatives considered**:

- *Silently use the first* — the status quo. **Rejected**: silent loss.
- *Create additional changes for the extra environments* — **Rejected**: violates FR-029 outright.
- *Let the operator pick which environment lands on the number* — **Rejected for now**: an extra decision on a
  destructive path, and the excluded environments would still vanish silently. Refusing is honest and reversible.

---

## Finding 5 — GAP: the draft store is global and would collide

**Decision**: `useCrgState` must accept an optional storage key so a rebuild persists under a
number-scoped key, and hydrates only from its own.

**Evidence**: persistence is hard-wired to one key (`useCrgState.ts:184`, `:1532`, `:623`):

```ts
const CRG_STATE_STORAGE_KEY = 'ntbx-crg-state';
localStorage.setItem(CRG_STATE_STORAGE_KEY, JSON.stringify(persistedState));   // every state change
function createInitialCrgState() { const persisted = loadPersistedCrgState(); … }
```

Two consequences if a rebuild mounts the hook as-is:

1. **It would not open blank** — it would hydrate the operator's in-progress *Create* draft, breaking FR-005.
2. **It would destroy that draft** — the rebuild's own state overwrites the same key on its first render, so
   switching back to Create loses unsaved work.

And FR-033 (a rebuild is bound to the number it started from) cannot be expressed at all while every rebuild shares
one anonymous slot.

**Chosen resolution**: `useCrgState(options?: { storageKey?: string })`, defaulting to `'ntbx-crg-state'` so every
current caller is unchanged. The rebuild passes `ntbx-crg-rebuild-state:<CHG NUMBER>`.

**Rationale**: This mirrors the project's existing `buildTeamScopedStorageKey` idea (drafts scoped by owner) and
makes FR-033 true by construction — a rebuild draft is *unreachable* from a different change number rather than
guarded against by a runtime check. It also survives the relay reconnect that persistence exists for.

**Alternatives considered**:

- *No persistence for rebuilds*. **Rejected**: the SNow relay navigates the tab away and back — persistence is the
  reason the operator does not lose the whole rebuild mid-flow. Removing it for the longest, most destructive flow
  is backwards.
- *One key plus a `rebuildTargetNumber` field checked on hydrate*. **Rejected**: still lets a rebuild clobber the
  create draft, and turns FR-033 into a runtime check that can be forgotten.

---

## Finding 6 — "Blank" is already available; the confirmation is not

**Decision**: Entry = confirm → `actions.reset()` on the number-scoped store → land on step 1.

**Evidence**: `reset()` (`useCrgState.ts:2089`) already sets `createDefaultCrgState()` and clears the persisted
entry, with a `justResetRef` guard so the persistence effect does not immediately rewrite defaults. And
`createDefaultCrgState` (`:509`) loads `shortDescriptionConfig` from its **own** key — so FR-006 ("reusable defaults
a new change would apply") is satisfied for free, while nothing from the loaded change carries over (FR-005).

**Gap**: nothing in the codebase asks "are you sure — this discards the change's current content". FR-003 is new UI.

---

## Finding 7 — Editable-state warning (FR-008)

**Decision**: Derive from the change record ModifyChgTab already fetched; do not add a request.

**Evidence**: `fetchChangeFromSnow` (`ModifyChgTab.tsx:475`) queries `change_request?number=…` with
`sysparm_display_value=all`, and `MY_ACTIVE_CHANGE_QUERY` already encodes what "active" means for the operator's
open-changes list. The record's state field is available at load time.

**Open item for `/speckit-tasks`**: confirm which field/values this instance uses for a non-editable change
(`state`, `u_state`, closed/cancelled/implemented). Treat an unrecognised value as **editable** and say nothing —
a false warning on every rebuild is worse than a missing one, and the save itself still fails loudly if SNow
refuses.

---

## Resolved unknowns

| Unknown | Resolution |
|---|---|
| Does a PATCH-by-number path exist? | Yes — `updateExistingChg`, with full create-payload parity and post-write verification |
| Can the builder be re-mounted? | Yes — `CrgTabProps.mode`, precedent `ConfigurationTab` |
| Is the "+ add one story" behaviour new? | No — `actions.addIssues()` ships today |
| What is actually new? | Entry point + confirmation, the `'rebuild'` mode and target binding, the one-environment guard, and the scoped draft key |
| Biggest risk? | Draft collision (Finding 5) and silent multi-environment loss (Finding 4) — both are correctness, not UI |

## Drift justifications (Article VII)

Two additions are custom because no existing seam covers them. Both are recorded here and must be repeated as a
one-line comment at the component:

1. **`useCrgState` storage-key option** — the hook hard-codes one global key; there is no existing scoping seam, and
   FR-033 cannot be satisfied without one.
2. **Rebuild environment guard** — `readPrimaryChangeSubmissionTarget` deliberately tolerates ambiguity for the
   existing manual "Update Existing CHG" button; a rebuild cannot, because it is the whole record.
