# Contract: Rebuild Entry Point & Destructive Confirmation

**Feature**: `033-chg-rescope-rewrite` | **Surface**: `client/src/views/SnowHub/tabs/ModifyChgTab.tsx`
**Serves**: FR-001, FR-002, FR-003, FR-004, FR-008, SC-005, SC-006

This is the only destructive affordance the feature adds. It is a **UI contract**, not an API contract — nothing
here touches ServiceNow.

## Availability

| Condition | Start Over control |
|---|---|
| No change loaded (`state.change === null`) | **Not rendered** (FR-002) |
| Change loaded by number | Rendered |
| Change selected from "Load My Open Changes" | Rendered |
| Change loaded but not in an editable state | Rendered, with the warning surfaced **before** the confirmation (FR-008) |

The control sits alongside the loaded change's existing step chrome. It never replaces or disables the existing
edit steps — targeted edits remain available to an operator who does not want a rebuild.

## Confirmation

Choosing Start Over MUST present an explicit confirmation before anything is cleared (FR-003). The confirmation MUST:

- name the change number that will be overwritten;
- state plainly that the change's **current content will be discarded and rebuilt from scratch**;
- offer a clearly-labelled cancel path;
- **not** be the default/auto-focused action.

| Operator action | Result |
|---|---|
| Cancels | Loaded change untouched, existing edit steps continue exactly as before (FR-004). No state written anywhere. |
| Confirms | `rebuildTargetNumber` is set; the builder is mounted blank and bound (see [rebuild-mode.md](./rebuild-mode.md)). |

**Nothing is written to ServiceNow by either path** (FR-030). "Discarded" means discarded from the local editing
session — the record in ServiceNow is untouched until the operator saves the rebuild (SC-005).

## Leaving a rebuild

| Operator action | Result |
|---|---|
| Returns to the loaded change / leaves the rebuild | `rebuildTargetNumber` cleared; ServiceNow still holds the original content |
| Loads a different change | The new change gets its own rebuild; a draft from the previous number is unreachable (FR-033) |

## Non-editable state (FR-008)

Derived from the record ModifyChgTab already fetched — **no additional request**.

- Recognised non-editable state ⇒ warn before the rebuild starts, not at the save.
- Unrecognised state value ⇒ **treat as editable and say nothing.** A false warning on every rebuild is worse than
  a missing one, and the save itself still fails loudly if ServiceNow refuses.

## Styling

Per the project's UI rule, reuse `CreateChgTab.module.css` — the module ModifyChgTab already imports. Use the
existing class vocabulary (`panelCard`/`sectionTitle`/`errorText`/`primaryButton`/`secondaryButton`, and the
`passphraseOverlay` + modal pattern already used for the assist prompt). New classes are a last resort.

## Tests (failing first — Article V)

| Test | Asserts |
|---|---|
| `does not offer Start Over before a change is loaded` | Control absent on step 1 with no change |
| `offers Start Over once a change is loaded` | Control present after a fetch, and after a My-Open-Changes selection |
| `requires confirmation before discarding` | Clicking Start Over does not clear anything; the confirmation names the change number |
| `leaves the loaded change untouched when cancelled` | Loaded field values unchanged; builder not mounted |
| `mounts the builder bound to the change number when confirmed` | Builder rendered, target number visible, fields blank |
| `warns before rebuilding a non-editable change` | Warning shown for a closed/cancelled change |
| `stays silent for an unrecognised state value` | No warning rendered |
