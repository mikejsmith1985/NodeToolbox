# Implementation Plan: Issue #200 Review Fixes — hygiene fidelity, transparency, and My Issues personas

**Branch**: `feature/023-issue-200-fixes` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/023-issue-200-fixes/spec.md`

## Summary

Six independent fixes from GH #200, ordered so the data-correctness bug lands first and designed so each touches a
largely disjoint file area (enabling parallel, worktree-isolated implementation):

1. **US1 (P1) — fix-version check correctness**: `checkMissingFixVersion` is gated to Feature/Epic via
   `isFeatureLikeIssue`, so a PI's Stories/Tasks/Defects lacking a fix version are never counted (→ 0 of 72). Fix:
   evaluate the delivery types that carry a fix version (Story/Task/Defect/Feature/Epic; Sub-tasks excluded), reading
   the native `fixVersions` field (already fetched). No config key.
2. **US2 (P1) — verifiable hygiene nodes**: each tile gains a distinct "open in Jira ↗" affordance that opens the
   family's **semantic JQL** (scope AND the family's condition clause) in Jira; the tile's existing in-app filter is
   unchanged. The JQL clause is co-located with each check's predicate so count and link **agree by construction**.
3. **US3 (P2) — linked issue → F2 lookup**: lift the Quick Issue Lookup's open state into a tiny store with an
   imperative `open(seedKey)`; make the linked-issue key in the detail panel a control that calls it. (This is exactly
   the "click a linked-issue key to load it in place" that feature 022 deferred.)
4. **US4 (P2) — PO PI dropdown**: replace the free-text PI input with a `<select>` populated by the same
   `loadAvailablePiNamesFromJira` loader ArtView/PI Review already use for the selected team.
5. **US5 (P2) — remediation context beside action**: render each remediation item's decision context next to its
   Keep/Dismiss/Snooze/Cancel buttons, hydrated without a separate manual refresh (loading state when detail is
   pending).
6. **US6 (P3) — My Issues personas**: a "simulate as" Jira user-search (swap `currentUser()` → `assignee = <user>`), a
   role lens (default from roster role capabilities, manually overridable), and SM/PO team views (roster-defined
   membership). Largest story; may be split during `/speckit-tasks`.

**Framework-first**: every fix extends an existing surface; the only net-new abstractions are (a) a per-family
hygiene **JQL clause** (US2), (b) an **imperative open** path for the F2 lookup (US3), and (c) a pure **role→criteria**
mapping (US6) — each justified below.

## Technical Context

**Language/Version**: TypeScript + React (client SPA); CSS Modules on the existing token system. US1's predicate is
also mirrored server-side if the shared hygiene rules run there (verify `src/services/hygieneRules.js` parity).

**Primary Dependencies**: zero new dependencies. Reuse — US1: `hygieneChecks.ts` predicates + `FEATURE_ISSUE_TYPE_NAMES`
pattern; US2: `buildJiraIssueNavigatorUrl` + `buildJqlFieldReference`/`readConfiguredPiFieldId`
(`checks/hygieneFieldConfig.ts`) + `buildHygieneSearchPath` (`hooks/hygieneScan.ts`); US3: `QuickIssueLookup*`
(feature 022) + `useIssueByKey` + `renderIssueLinkRow` (`IssueDetailPanel`); US4: `loadAvailablePiNamesFromJira`
(`ArtView/hooks/artHelpers.ts`) + ArtView PI-select pattern; US5: `BacklogRemediationPanel` +
`AgingTriageActionTable` + `IssueMeta`/`IssueDetailPanel`; US6: `useMyIssuesState`, `searchFeatureReviewUsers` (Jira
user search, reused from PO/feature-review), `useStandupRosterStore` (role capabilities + membership),
`settingsStore` team profiles.

**Storage**: US3 lookup-open state in a Zustand store (in-memory; seed key transient). US6 "simulate as" + role lens
selection are ephemeral view state (optionally last-used persisted via the existing MyIssues settings). No server
schema changes.

**Testing**: vitest + @testing-library (unit — the fix-version predicate, each check's JQL clause, the open-store
reducer, role→criteria mapping, PI-option selection; all red-first); Playwright e2e (`test/e2e/`) for the hygiene
count+link agreement, linked-issue→lookup, PO dropdown, remediation layout, and a MyIssues simulate/role/team flow;
Jest for any server-side hygiene-rule parity (US1).

**Target Platform**: NodeToolbox SPA (browser + exe-embedded client); light and dark themes.

**Project Type**: web application; primarily client-only (US1 may touch the shared server hygiene rule).

**Performance Goals**: US2 links are pure string building (no fetch); US3 open is state-only; US6 simulation is one
report query per selected subject.

**Constraints**: **agree-by-construction** (NFR-002) — a check's count and its Jira JQL derive from one source, never
re-specified; additive-only changes to shipped surfaces (F2 lookup, IssueDetailPanel, roster) with no caller
regressions (NFR-003); standing responsive/theme/text-size + no-color-only rules (NFR-001); simulation is read-only
under the viewer's own credentials, never a write as another user (FR-023).

**Scale/Scope**: 6 stories; hygiene families ~6–20 tiles; MyIssues personas the largest surface.

## Constitution Check

*GATE — evaluated pre-Phase-0 and re-checked post-design: PASS (no violations; three recorded Art VII drifts, each a
capability no existing module provides).*

- **Art I (Best route)**: reuse-first; each new piece is one nothing existing provides. US1 fixes the correctness bug
  at its root (predicate scope) rather than patching symptoms. ✅
- **Art III (Branching)**: work on `feature/023-issue-200-fixes`; merge via PR. The six stories are intended for
  parallel worktree agents — see Structure Decision for the disjoint file areas and the one shared-file caveat. ✅
- **Art IV (Code quality)**: verb-first functions, `is/has/can`-prefixed booleans, ≤40-line functions, purpose/doc
  comments; enforced by pre-commit gates. ✅
- **Art V (Testing)**: red-first unit tests for every pure function (fix-version predicate, JQL clauses, open-store
  reducer, role→criteria map, PI selection); Playwright for the cross-cutting flows; server Jest if US1 touches
  `hygieneRules.js`. ✅
- **Art VI (Docs)**: CHANGELOG entry per story in the implementation PR(s); no auxiliary status docs (this `specs/`
  tree is pipeline-exempt). ✅
- **Art VII (Framework-first)**: **Recorded drifts** — (1) per-family hygiene **JQL clause** (US2): no existing module
  emits a semantic per-check JQL (only issue-key lists); built co-located with each predicate so it cannot drift from
  the count. (2) **Imperative open** for the F2 lookup (US3): the gate is keydown-only; a minimal store adds the open
  path 022 deferred. (3) **role→criteria mapping** (US6): no existing role-lens logic; pure and roster-driven. Each
  justification is repeated at its module head. ✅
- **Art X (Verification)**: the fix-version count-matches-Jira claim (SC-001/002) is proven by an e2e that asserts the
  Toolbox count equals the count from the generated JQL; layout/persona claims proven with Playwright evidence. ✅
- **Art XI (Output restraint)**: no new dashboard artifact; no phase narration. ✅

## Project Structure

### Documentation (this feature)

```text
specs/023-issue-200-fixes/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions + rationale (per story)
├── data-model.md        # Phase 1 — entities across the six stories
├── quickstart.md        # Phase 1 — validation guide (maps to SC-001..006)
├── contracts/
│   ├── hygiene-fix-version.md   # US1 — predicate scope + count/JQL agreement
│   ├── hygiene-jira-links.md    # US2 — per-family JQL clause + scope + navigator URL
│   ├── quick-lookup-open.md     # US3 — imperative open store + seed key + linked-issue trigger
│   ├── po-pi-dropdown.md        # US4 — PI options source + select control
│   ├── remediation-context.md   # US5 — context-beside-action + hydration
│   └── myissues-personas.md     # US6 — simulate-as / role lens / team views
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
client/src/
├── views/Hygiene/
│   ├── checks/hygieneChecks.ts          # US1 EDIT — carriesFixVersion() type scope (Story/Task/Defect/Feature/Epic);
│   │                                     #   US2 EDIT — co-locate each check's JQL clause with its predicate
│   ├── checks/hygieneFieldConfig.ts     # US2 reuse — buildJqlFieldReference / readConfiguredPiFieldId
│   ├── hooks/hygieneScan.ts             # US2 reuse — buildHygieneSearchPath (scope JQL); BASE_HYGIENE_FIELDS
│   ├── utils/buildHygieneJqlUrl.ts      # US2 EXTEND — buildHygieneCheckJql(checkId, scope) + navigator URL
│   └── HygieneView.tsx                  # US2 EDIT — add "open in Jira ↗" affordance per tile (keep filter onClick)
├── views/PoTool/
│   └── PoTeamSelector.tsx               # US4 EDIT — PI <input> → <select> from loadAvailablePiNamesFromJira
├── views/SprintDashboard/backlogRemediation/
│   └── BacklogRemediationPanel.tsx      # US5 EDIT — context beside each item's action buttons + hydrate on load
├── components/
│   ├── QuickIssueLookup/
│   │   ├── quickLookupStore.ts          # US3 NEW — useQuickLookupStore { isOpen, seedKey, open(key?), close() }
│   │   ├── QuickIssueLookupGate.tsx     # US3 EDIT — subscribe to store; F2 calls open(); seed key on open
│   │   └── QuickIssueLookup.tsx         # US3 EDIT — accept seedKey to preset lookupKey
│   └── IssueDetailPanel/index.tsx       # US3 EDIT — renderIssueLinkRow: linked key becomes a button → open(key)
├── views/MyIssues/
│   ├── MyIssuesView.tsx                 # US6 EDIT — simulate-as control, role lens, team switch (SM/PO)
│   ├── hooks/useMyIssuesState.ts        # US6 EDIT — subject: viewer | simulated user | team; assignee JQL
│   └── myIssuesRoleLens.ts              # US6 NEW — pure role → emphasized-criteria mapping (roster-driven)
└── (server) src/services/hygieneRules.js # US1 EDIT (if parity) — mirror the fix-version type scope

test/e2e/
├── hygiene-jira-links.spec.js           # US1+US2 — count matches generated JQL; tile link opens search
├── linked-issue-lookup.spec.js          # US3 — click linked key → F2 lookup on that key
├── po-pi-dropdown.spec.js               # US4 — PI select populated; invalid PI impossible
├── remediation-context.spec.js          # US5 — context beside action, loading state
└── myissues-personas.spec.js            # US6 — simulate / role lens / team view
```

**Structure Decision**: the six stories map to **disjoint file areas**, so they can be built in parallel worktree
agents. The one caveat: **US1 and US2 both edit `checks/hygieneChecks.ts`** (US1 the predicate scope, US2 the
co-located JQL clause) — they should share one worktree/agent or be sequenced (US1 then US2) to avoid a merge
conflict. US3 edits the shipped `IssueDetailPanel` and the 022 lookup additively (default-safe). Every other story is
independent. Recommended parallel grouping: **{US1+US2}**, **US3**, **US4**, **US5**, **US6** — five concurrent tracks.

## Complexity Tracking

| Drift | Why needed | Simpler alternative rejected because |
|-------|------------|--------------------------------------|
| Per-family hygiene JQL clause (US2) | FR-005/006: the link must open the *same condition* the scan evaluated, not a key list — a key list can't verify "0" and can't prove the scan's logic. | Reusing `buildCheckIssueKeys` (issue-key `in (...)`) only echoes what Toolbox already found; it cannot show the semantic query or a zero-result search. Co-locating the clause with the predicate keeps count and link single-sourced (NFR-002). |
| Imperative open store for F2 lookup (US3) | FR-010/011: a linked-issue click must open the lookup; the gate is keydown-only with no external entry point. | A window CustomEvent works but is less testable and less idiomatic than the app's Zustand stores; a store also gives one reusable open path for future callers. |
| role→criteria mapping (US6) | FR-021: role lenses need a defined criteria set per role; none exists. | Hard-coding per-role sections inline would scatter the logic; a pure mapping is testable and roster-driven. |

No unjustified violations. All three drifts are bounded and single-sourced.
