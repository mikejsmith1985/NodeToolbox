# Phase 1 Data Model: Rebuild an Existing Change From Scratch

**Feature**: `033-chg-rescope-rewrite` | **Date**: 2026-08-07

This feature introduces **no new persisted record shape**. The rebuild draft is the existing `CrgState` — the whole
point of the design is that a rebuild is the Create wizard's state, stored under a different key and saved through a
different terminal action. This document therefore records what is added, what is reused verbatim, and the rules
that govern each.

---

## Entities

### Target Change

The change the rebuild will be written to. The **only** thing carried forward from the loaded change.

| Field | Source | Notes |
|---|---|---|
| `changeNumber` | `ModifyChgState.changeKey` (already loaded) | Normalised trim + uppercase. The rebuild's identity. |
| `isEditableState` | The record ModifyChgTab already fetched | Derived, not re-fetched. Unrecognised ⇒ treated as editable (see research Finding 7). |

**Lifecycle**: set when the operator confirms Start Over; cleared when they leave the rebuild or the save succeeds.

**Rules**:

- A rebuild MUST NOT begin without a `changeNumber` (FR-002).
- `changeNumber` is **immutable** for the life of a rebuild — a rebuild is bound to the number it started from
  (FR-033). Changing target means starting a new rebuild.
- A non-editable state produces a warning **before** the rebuild starts, not at save time (FR-008).

---

### Rebuild Draft

The blank-slate change under construction. **Structurally identical to `CrgState`** — no new type.

| Aspect | Value |
|---|---|
| Shape | `CrgState` (`useCrgState.ts:390`) — unchanged |
| Initial value | `createDefaultCrgState()` — every field blank; `shortDescriptionConfig` still loaded from its own key (FR-005, FR-006) |
| Persistence key | `ntbx-crg-rebuild-state:<CHG NUMBER>` — **not** `ntbx-crg-state` |
| Persisted fields | Exactly the existing `PersistedCrgState` set (`:1504`) — no additions |
| Cleared when | Save succeeds; or the operator explicitly resets |

**Rules**:

- On entry the draft MUST be blank — nothing from the Target Change pre-fills any field (FR-005).
- A rebuild draft MUST NOT hydrate from, or write to, the Create wizard's key (FR-033).
- A rebuild draft MUST survive a page reload / relay reconnect, like a Create draft does.
- Environment **Enabled** ticks never survive a reload — the v0.137.1 hydration rule applies to rebuild keys too.

**Explicitly absent** (spec Out of Scope): no prior issue set, no scope comparison, no merge state, no
concurrent-edit token. A rebuild replaces wholesale.

---

### Scope Basket

Reused unchanged from `CrgState`. Recorded here only to name the fields that carry it.

| Field | Type | Meaning |
|---|---|---|
| `fetchedIssues` | `JiraIssue[]` | Everything pulled in by one or more searches |
| `selectedIssueKeys` | `Set<string>` | Which of them are in scope; all fetched issues start selected (FR-014) |
| `fetchMode` | `'project' \| 'jql'` | Which Scope Source is active (FR-009, FR-010) |
| `projectKey` / `fixVersion` | `string` | Project + fix version source |
| `customJql` | `string` | Free-form source — also how a single issue key is added (FR-012) |
| `fetchNotice` | `string \| null` | Added-vs-already-present feedback from the additive path (FR-013) |

**Rules**: `fetchIssues` **replaces** the basket; `addIssues` **unions** into it without duplicates (FR-011,
FR-013). Only selected issues contribute to generated content and to the assist prompt (FR-018, FR-024).

---

## State transitions

```text
Loaded Change (ModifyChgTab, existing edit steps)
        │
        │  operator presses "Start Over"
        ▼
Confirmation  ──── declines ────►  Loaded Change (untouched — FR-004)
        │
        │  confirms
        ▼
Rebuild Draft (blank, bound to changeNumber, key = ntbx-crg-rebuild-state:<CHG>)
        │
        │  build scope → generate content → planning → environments → review
        │  (every existing wizard step, unchanged)
        ▼
Review  ──── 0 or ≥2 environments enabled ────►  refused, stays on Review
        │
        │  exactly 1 enabled
        │  operator presses "Update <CHG NUMBER>"
        ▼
updateExistingChg(changeNumber)
        │
        ├── PATCH succeeds → verification read → mismatch report → draft cleared
        └── PATCH fails    → draft preserved for retry (FR-032)
```

**Invariant across every transition**: nothing reaches ServiceNow until the operator presses the update button
(FR-030). Abandoning at any earlier point leaves the change byte-identical (SC-005).

---

## Additions to existing types

Two additive changes. Both are optional, so every current caller is unaffected.

```ts
// CreateChgTab.tsx — CrgTabProps
mode?: 'wizard' | 'configuration' | 'rebuild';   // 'rebuild' added; default still 'wizard'
targetChangeNumber?: string;                      // required when mode === 'rebuild', ignored otherwise

// useCrgState.ts — new options argument
useCrgState(options?: { storageKey?: string })    // defaults to 'ntbx-crg-state'
```

**Rule**: omitting both must leave `mode="wizard"` and `mode="configuration"` renders **byte-identical**. The
existing `CreateChgTab.test.tsx` and `ConfigurationTab.test.tsx` suites are the proof — they must pass unmodified.

---

## Derived values (computed, never stored)

| Value | Derivation | Serves |
|---|---|---|
| `enabledEnvironmentKeys` | `readEnabledEnvironmentKeys(state)` — exists | The one-environment guard |
| `hasExactlyOneEnabledEnvironment` | `enabledEnvironmentKeys.length === 1` | Gates the update button (FR-029) |
| `rebuildStorageKey` | `buildRebuildStorageKey(changeNumber)` | Draft isolation (FR-033) |
| `hasSelectedIssues` | `selectedIssueKeys.size > 0` | Blocks generation on an empty scope (FR-021) |
| Change payload | `buildChangeRequestPayload(state, target)` — exists | The write; same builder `createChg` uses, so field parity is structural (SC-004) |
