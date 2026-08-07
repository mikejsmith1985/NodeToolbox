# Contract: Rebuild Draft Isolation

**Feature**: `033-chg-rescope-rewrite`
**Surface**: `client/src/views/SnowHub/hooks/useCrgState.ts`, `client/src/views/SnowHub/hooks/crgStorageKeys.ts` (new)
**Serves**: FR-005, FR-033, SC-005

## The problem this solves

`useCrgState` persists every state change to a single hard-coded key and hydrates from it on mount
(`useCrgState.ts:184`, `:623`, `:1532`):

```ts
const CRG_STATE_STORAGE_KEY = 'ntbx-crg-state';
```

Mounting the hook for a rebuild as-is would:

1. **hydrate the operator's in-progress Create draft** — so the rebuild would not open blank, breaking FR-005; and
2. **overwrite that draft** on its first render — destroying unsaved work the operator never agreed to discard.

And FR-033 ("a rebuild is bound to the number it started from and must not be applied to a different change loaded
later") cannot be expressed at all while every rebuild shares one anonymous slot.

## Contract

```ts
// useCrgState.ts
export function useCrgState(options?: { storageKey?: string }): { state: CrgState; actions: CrgActions };
```

| Caller | Key used |
|---|---|
| `CreateChgTab` (`mode="wizard"`) | `'ntbx-crg-state'` (default — **unchanged**) |
| `CreateChgTab` (`mode="configuration"`) | `'ntbx-crg-state'` (default — **unchanged**) |
| `CreateChgTab` (`mode="rebuild"`) | `buildRebuildStorageKey(targetChangeNumber)` |

```ts
// crgStorageKeys.ts (new, pure, no I/O)
export const CRG_REBUILD_STORAGE_KEY_PREFIX = 'ntbx-crg-rebuild-state:';
export function buildRebuildStorageKey(changeNumber: string): string;
```

### Rules

- `buildRebuildStorageKey` normalises the number (trim + uppercase) so `chg0001234` and ` CHG0001234 ` resolve to
  one draft.
- Two different change numbers MUST produce different keys.
- A rebuild key MUST NEVER equal `'ntbx-crg-state'`, including for empty or whitespace input.
- Omitting `options` MUST leave behaviour byte-identical for every current caller.

### What this buys

FR-033 becomes **true by construction**: a rebuild draft for CHG0001234 is *unreachable* from CHG0009999 because it
lives at a different key — not because a runtime check compares numbers and could be forgotten.

## Retained behaviour

All existing persistence rules carry over to rebuild keys unchanged:

| Rule | Source |
|---|---|
| Transient flags (`isSubmitting`, `fetchError`, …) never restored | `createInitialCrgState` |
| `selectedIssueKeys` serialised as an array, restored as a `Set` | `loadPersistedCrgState` |
| **Environment Enabled ticks never survive a reload** | `restorePersistedEnvironmentConfig` (v0.137.1) — applies to rebuild keys too, so a rebuild never reopens with an environment pre-ticked |
| `justResetRef` suppresses the write-back immediately after a reset | persistence effect |
| Draft cleared on successful submission | `updateExistingChg` success path |
| `shortDescriptionConfig` read from its own key | `loadShortDescriptionConfigFromStorage` — shared by design (FR-006) |

## Housekeeping

A rebuild key is removed when its save succeeds. An abandoned rebuild leaves one small entry keyed by change number;
starting a rebuild for the same change again resumes it, which is the desired behaviour after a relay reconnect.
No expiry sweep is in scope for this feature.

## Tests (failing first — Article V)

| Test | Asserts |
|---|---|
| `buildRebuildStorageKey normalises case and whitespace` | ` chg0001234 ` and `CHG0001234` give one key |
| `buildRebuildStorageKey is distinct per change number` | Two numbers, two keys |
| `buildRebuildStorageKey never collides with the wizard key` | Never `'ntbx-crg-state'`, including for `''` |
| `a rebuild-keyed hook does not hydrate the wizard draft` | Seed `ntbx-crg-state`, mount with a rebuild key, state is blank |
| `a rebuild-keyed hook does not write to the wizard key` | Seed, mount, mutate — `ntbx-crg-state` byte-identical |
| `a rebuild draft survives a remount under the same key` | Relay-reconnect case |
| `a rebuild draft is not visible under a different change number` | FR-033 |
| `environment ticks do not survive a rebuild remount` | v0.137.1 rule holds for rebuild keys |
| `omitting options leaves existing behaviour unchanged` | **Existing `useCrgState` tests pass unmodified** |
