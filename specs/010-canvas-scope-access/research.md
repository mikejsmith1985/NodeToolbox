# Phase 0 Research: Canvas Surface Scoping & AI-Tools Access Hardening

All findings are grounded in the current codebase (file:line cited) and the resolved spec
(Q1=A full query, Q2=A remove admin AI checkbox, Q3=work-as-designed admin gate).

---

## Area 1 — Surface scoping

### R1 — Health/completion for an arbitrary (non-PI) feature set

**Decision**: Export a new `fetchFeatureNodesByKeys(featureKeys, options)` from
`client/src/views/ArtView/blueprintHierarchy.ts` that reuses the module's existing **private**
child-discovery JQL (`"Epic Link" in (...) OR parent in (...)`, `blueprintHierarchy.ts:564`) and
node builder (`createBlueprintFeatureNode`, `:670`), returning `BlueprintFeatureNode[]` with
`health` and `completionPercent` populated.

**Rationale**: `computeBlueprintHealth` (`:206-230`) and `computeCompletionPercent` (`:255-269`) are
**PI-independent** pure functions — they take only `BlueprintStoryNode[]`. They are already invoked
inside `createBlueprintFeatureNode` (`:703-704`), so if we build feature nodes from caller-supplied
keys, health/completion come "for free." The only obstacle is that the child-fetch + node builder
are private and the current entry (`fetchBlueprintQuerySourceData`) hard-scopes the query to a
team+PI (`:433-445`). Exporting a key-driven variant is the minimum extraction; it does **not**
reimplement any health/completion math (Framework-First / Article VII).

**Alternatives considered**:
- **Re-derive health/completion in the canvas** — rejected; duplicates non-trivial weighted math
  (`readStoryCompletionWeight` `:232`, `readStoryPointWeight` `:271`) and violates Article VII.
- **Export the two pure functions and rebuild the child fetch in the canvas** — rejected; the child
  fetch + `createBlueprintStoryNode` (`:643`) are the hard part and already exist; re-authoring them
  is more code and drift risk than exporting the key-driven fetch.

### R2 — JQL-sourced feature items

**Decision**: Add `fetchFeatureReviewItemsByJql(jql, fieldConfig?, customStoryPointsFieldId?)` to
`client/src/views/SprintDashboard/featureReview.ts`. It (a) runs the user JQL via
`jiraGet('/rest/api/2/search?jql=…')` to get feature issue keys, (b) calls
`fetchFeatureNodesByKeys` (R1) for health/completion + children, (c) runs the **same** per-item
build + hygiene loop the existing `fetchFeatureReviewItems` uses. Extract that loop into a shared
`buildFeatureReviewItem(featureNode, featureIssue, ctx)` so both functions share it.

**Rationale**: Keeps all feature-review item construction (child counts at `featureReview.ts:226-242`,
hygiene via `evaluateHygieneIssue` at `:233`) in one place, shared by the PI path and the JQL path.
Hygiene is already per-issue and PI-independent (`hygieneChecks.ts:448`), and the field config comes
from the existing `fetchFeatureReviewFieldConfig()` (`featureReview.ts:69`).

**Alternatives considered**: Build items inside the canvas — rejected; would duplicate the hygiene +
child-count logic that already lives in `featureReview.ts`.

### R3 — Query execution

**Decision**: Run raw JQL with the existing `jiraGet('/rest/api/2/search?jql=<encoded>&fields=…')`
pattern (already used by `useCanvasFeatures.enrichWithIssueLinks`, `useCanvasFeatures.ts:47`; and by
`useMyIssuesState` for user-entered JQL, `:198`). Do **not** extract `buildScopedProjectJql`
(`SprintDashboardView.tsx:386`, private) — 009 research already recorded that its extraction was
deliberately avoided.

**Rationale**: There is no shared `searchIssues(jql)` helper today; the inline `jiraGet` search is
the established idiom. A malformed/unauthorized JQL surfaces a Jira error which the fetch surfaces as
an error state (FR-1.6) without touching the overlay.

### R4 — Surface control placement & fetch trigger

**Decision**: Add a **Surface scope bar** as a header region in `FeatureCanvasView` (above the board),
and change `useCanvasFeatures` from an auto team+PI effect to a **JQL string + explicit "surface"
trigger** model: it holds the current JQL and a `surfaceGeneration` counter; it fetches only when the
user presses Surface (or on first mount with the default JQL). Team/project/PI are still resolved (for
the overlay scope key + commit) and used to build the default JQL.

**Rationale**: Surfacing is **view-level** (it changes the whole feature set), so it belongs in the
view header, not the CoachPanel (which mutates per-node overlay state and receives no fetch
controller). The current auto-effect keyed on `[team, piName, requestKey]`
(`useCanvasFeatures.ts:99`) is exactly what makes surfacing implicit; replacing it with an explicit
trigger is the localized change.

**Alternatives considered**: Put the control in CoachPanel's stage-1 branch (`CoachPanel.tsx:130`) —
rejected; would thread a fetch controller through the CoachPanel whose role is overlay mutation, and
surfacing affects the view, not a stage's node state.

### R5 — Default prefill JQL

**Decision**: Compose the default in a pure `buildDefaultScopeJql({ projectKey, piName, piFieldId })`
→ `project = "<KEY>" AND cf[<num>] = "<PI>" AND issuetype in (Feature, Epic)` (omit the PI
clause when no PI is known), where `<num>` is `piFieldId` with the `customfield_` prefix stripped
(mirroring `blueprintHierarchy.ts:434`). Inputs already co-located in `useCanvasFeatures`: `team.projectKey`,
`piName`, and `readArtFeatureScopeSettings().piFieldId` (`artFeatureScopeSettings.ts:34`, default
`customfield_10301`).

**Rationale (updated per I2)**: The default targets the PI custom field **by id** (`cf[<num>]`), not
the display name, so it works on any instance — a name-based clause silently returns nothing where the
PI field is not named exactly "Program Increment". **Parity note (I1)**: this default is a **superset**
of today's canvas (it surfaces all Feature/Epic in the project+PI; the old PI rollup at
`scopedTeamFeatures.ts:108` excluded childless features), which is intentional for triage; SC-2 /
quickstart V1 reflect a superset, not an exact match. Zero-config start (SC-2) still holds — the
pre-filled query runs as-is. `feature`/`epic` are the app's feature-like types (`hygieneChecks.ts:17`). Human-readable
`"Program Increment"` is used in the box (Jira accepts field-name JQL); the numeric `cf[…]` form
(`blueprintHierarchy.ts:434`) is an internal detail, not shown to the user.

### R6 — Deterministic refine filters

**Decision**: The scope bar offers quick **client-side** refine filters (label, free-text summary
match, status) applied to the already-surfaced set — instant, no refetch — in a pure
`applyScopeFilters(items, filters)`. The JQL box remains the source of what is fetched; filters narrow
what is shown.

**Rationale**: FR-2 asks for simple, deterministic refinement; client-side filtering is immediate and
needs no round-trip. Users who want server-side scoping edit the JQL directly.

### R7 — Hidden NL→JQL accelerator

**Decision**: Add a `scopeQuery` kind to `client/src/views/FeatureCanvas/ai/canvasAiAssist.ts`
(`buildCanvasAiPrompt('scopeQuery', …)` produces a prompt that asks for a single JQL string;
`parseCanvasAiResponse('scopeQuery', …)` extracts/validates it). A small **passphrase-gated** control
in the Surface scope bar (guarded by `aiAssistStore.isAiAssistUnlocked`) lets the owner paste the
result into the JQL box. It only proposes; the box is fully usable without it (FR-3).

**Rationale**: Reuses the exact hidden copy-paste round-trip already built for the canvas
(`canvasAiAssist.ts`) and the existing Ctrl+Alt+Z gate. No new AI channel; invisible when locked.

**Alternatives considered**: A JSON payload like the other kinds — the scope query is a single string,
so the reply schema is `{ "kind": "scopeQuery", "jql": "…" }`; simpler and validated the same way.

---

## Area 2 — AI-tools access hardening

### R8 — Remove the admin "Hidden prompt tools" checkbox + orphan flag

**Decision**: Delete the checkbox (`AdminHubView.tsx:525-536`), its props
(`:444, :449, :473, :2619`), and the `isAiEnabled`/`FEATURE_AI_KEY` field + persistence in
`useAdminHubState.ts` (`:30, :99, :396, :725-740`). Update the admin test fixture
(`AdminHubView.test.tsx:27`).

**Rationale**: A full grep confirms `isAiEnabled`/`tbxFeatureAIVisible`/`FEATURE_AI_KEY` has **zero
consumers outside AdminHub** — it is an orphan flag that gates nothing. Removing it therefore needs
**no** downstream rewiring, and it is the *only* AI element visible when admin is unlocked (the leak
the user reported). Satisfies FR-4.2/4.3.

### R9 — Preserve the Ctrl+Alt+Z passphrase path (do NOT remove it)

**Decision**: Leave the Ctrl+Alt+Z passphrase machinery and the passphrase-gated "⚡ AI Assist" tab
(`AdminHubView.tsx:2703-2753, 2794-2815, 2900-2904`) **in place**.

**Rationale**: That tab appears **only after the Ctrl+Alt+Z passphrase**, never on admin (password)
unlock — so it does not violate "no AI on admin unlock." It *is* the owner-only path the user
explicitly wants to keep ("available via the special key command"), and it hosts the AI Assist
automation config (`AiAssistAutomationPanel`) reachable nowhere else. The passphrase has five
independent listeners (AdminHub, CreateChgTab, two in SprintDashboard, RiskManagementSection), so the
gate survives regardless. Removing this tab would delete an owner feature — out of scope and contrary
to intent.

### R10 — Fix the silent admin unlock

**Decision**: In `useAdminHubState.ts` `tryUnlock` (`:749-757`), require **non-empty** entered
username and password before submitting, and remove the `|| DEFAULT_ADMIN_USERNAME` /
`|| DEFAULT_ADMIN_PASSWORD` fallbacks (`:750-751`). If either field is empty, set the unlock error and
do not POST. The server (`api.js:642-675`) is unchanged: it still accepts a correctly-entered default
`admin:toolbox` when no `credentialHash` is configured, so the designed first-run behavior is intact —
the user just has to type the credential.

**Rationale**: The bug is purely client-side: the `|| DEFAULT_…` substitution means blank fields
submit `admin:toolbox`, which the server accepts on an unconfigured install → silent unlock. Removing
the substitution restores "enter admin credentials" (FR-5.1/5.2) without changing the server or
forcing custom-credential setup (FR-5.3). No default-credential warning is added (per Q3).

### R11 — Dev Panel gating (optional, pending confirmation)

**Decision**: *Optionally* gate the Dev Panel behind `isAdminUnlocked`. The Dev Panel tab is in the
static `ADMIN_HUB_TAB_OPTIONS` (`AdminHubView.tsx:79`) and its panel (`:2829-2880`) has **no**
`isAdminUnlocked` check today — it is always accessible. The user's model is "admin unlocks SNow
access and the Dev Panel," which implies it should be gated.

**Rationale**: This is a *new* gate, not a preserved one, so it is flagged as pending. If confirmed,
the fix hides the Dev Panel tab (and/or its panel) unless `isAdminUnlocked`, matching the intended
admin scope and reducing exposure of internal diagnostics. If declined, the Dev Panel stays as-is and
FR-5.5 is dropped. The genuinely admin-gated operational features (SNow/GitHub proxy URLs at `:267`,
service-connectivity credentials at `:1306`, advanced controls + dev utilities at `:499-549`) are
preserved unchanged either way.

---

## Resolved unknowns

All Technical Context items are resolved; **no `NEEDS CLARIFICATION` remains**. No new dependency is
introduced. The only open product decision is **R11 (Dev Panel gating)**, surfaced for the user to
confirm or decline — it does not block the rest of the plan.
