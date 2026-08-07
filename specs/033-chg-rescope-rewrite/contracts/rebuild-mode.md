# Contract: Rebuild Mode & Target Binding

**Feature**: `033-chg-rescope-rewrite` | **Surface**: `client/src/views/SnowHub/tabs/CreateChgTab.tsx`
**Serves**: FR-005, FR-006, FR-007, FR-009–FR-027, FR-031, FR-033, SC-007, SC-008

## Prop contract

```ts
export interface CrgTabProps {
  mode?: 'wizard' | 'configuration' | 'rebuild';   // 'rebuild' is new; default remains 'wizard'
  targetChangeNumber?: string;                      // required when mode === 'rebuild'
}
```

**Additive guarantee (load-bearing)**: omitting both props MUST leave the component byte-identical for every
existing caller. `ChgTab.tsx` (`<CreateChgTab />`) and `ConfigurationTab.tsx` (`<CreateChgTab mode="configuration" />`)
are edited by **zero** tasks in this feature, and their existing tests must pass **unmodified**. A test that needs
editing means the prop stopped being additive — revert the change, do not adjust the test. This follows the 017
`FeatureReviewTab.dashboardTeamProfileId?` precedent.

`targetChangeNumber` is ignored outside rebuild mode. Rebuild mode without a target number is a programming error
and must fail loudly rather than silently degrading to create.

## Behaviour by mode

| Aspect | `wizard` | `configuration` | `rebuild` |
|---|---|---|---|
| Wizard step chrome | shown | hidden | **shown** |
| Steps rendered | all six, one at a time | flat panel subset | **all six, one at a time** |
| Title / subtitle | create wording | configuration wording | **names the change being rebuilt** |
| Target number banner | — | — | **visible on every step** (FR-007, SC-008) |
| Primary terminal button | Create CHG | — | **Update `<CHG NUMBER>`** |
| Create CHG button | present | — | **not rendered at all** (FR-029 by absence, not by disabling) |
| Update Existing CHG + number input | present | — | **not rendered** — the number is bound, not typed |
| Draft storage key | `ntbx-crg-state` | `ntbx-crg-state` | **`ntbx-crg-rebuild-state:<CHG>`** |

Implementation note: `shouldShowWizardChrome` becomes `mode !== 'configuration'` rather than `mode === 'wizard'`.

## Blank on entry (FR-005, FR-006)

The rebuild opens on `createDefaultCrgState()` — every field blank. Nothing from the loaded change pre-fills any
step: not content, not planning answers, not environment selections, not schedules.

**Except** the values a *new* change would also start from, which still apply (FR-006):

- `shortDescriptionConfig` — loaded from its own `ntbx-crg-short-description-config` key;
- saved CHG templates and pinned field values, applied exactly as they are for a new change.

## Reused unchanged in rebuild mode

Every one of these ships today and needs no modification — they are listed so `/speckit-tasks` does not create work
for them:

| Requirement | Existing mechanism |
|---|---|
| FR-009 / FR-010 scope sources | `FetchIssuesStep` fetch-mode radio + `setProjectKey` / `setFixVersion` / `setCustomJql` |
| FR-011 add rather than replace | `actions.addIssues()` — "+ Add to Loaded Issues" |
| FR-012 add one issue by key | Custom JQL `key = ABC-123` through the same add path |
| FR-013 no duplicates, added-vs-present count | `addIssues` + `fetchNotice` |
| FR-014 per-issue include/exclude | `toggleIssueSelection` + select-all row |
| FR-015 Jira failure isolation | `fetchError` (distinct from the ServiceNow save error) |
| FR-017–FR-021 content generation | `fetchIssues` derives all four fields from selected issues |
| FR-022–FR-027 gated assist | `useAiAssist` + `parseAiAssistChgResponse` + the copy-out/paste-back modal |

**FR-016 (never recover the previous issue set)** is satisfied by doing nothing: the builder has no knowledge of the
loaded change. No code is needed — and none may be added.

## Review step (FR-031)

The review step MUST show the **target change number together with the full content that will be written**, before
the operator commits. The terminal action is defined in [rebuild-save.md](./rebuild-save.md).

## Tests (failing first — Article V)

| Test | Asserts |
|---|---|
| `renders the target change number on every step in rebuild mode` | Banner present on steps 1–6 |
| `does not render the Create CHG button in rebuild mode` | Absent, not merely disabled |
| `does not render the Existing CHG number input in rebuild mode` | The number is bound, not typed |
| `opens blank in rebuild mode` | Content, planning, and environment fields all empty |
| `still applies saved short-description config in rebuild mode` | FR-006 |
| `renders wizard mode unchanged` | **Existing tests, unmodified** |
| `renders configuration mode unchanged` | **Existing tests, unmodified** |
