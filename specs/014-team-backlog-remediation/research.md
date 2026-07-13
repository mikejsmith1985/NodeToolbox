# Phase 0 Research: Per-Team Persistent Backlog Remediation

All unknowns were resolvable from the existing codebase (mapped during planning). No external research needed;
this feature is a relocation + a thin new state layer over proven modules.

## R1 — Per-team persistence pattern

- **Decision**: Persist under `tbxBacklogRemediation:<teamProfileId>:<projectKey>:<piName>`, built exactly like
  feature 012's reallocation store — `resolveTeamScopedStorageProfileId(teamProfileId)` for the profile segment and
  `deriveScopeKey(projectKey, piName)` for the scope segment.
- **Rationale**: Identical scoping to `tbxReallocationDetails`, the roster store, and the overlay — guarantees
  per-team isolation and re-uses the self-healing/legacy-migration primitives in
  `SprintDashboard/hooks/teamScopedStorage.ts` and `FeatureCanvas/overlay/overlayStorage.ts`.
- **Alternatives rejected**: A single global store keyed by JQL (today's Reports Hub behavior) — fails the
  parallel-teams requirement (SC-002). A server-side store — out of scope; inconsistent with every other per-team
  store in the app.

## R2 — Source of truth for team scope on the Sprint Dashboard

- **Decision**: Use `useSettingsStore.sprintDashboardActiveTeamProfileId` for the profile id, and the live
  `useSprintData` `state.projectKey` / `state.selectedPiValue` for the scope — the same values already handed to the
  Feature Review and PI Review tabs. Propagate them into the new store via a `setScope(...)` effect alongside the
  existing `setDashboardTeamProfileId` propagation in `SprintDashboardView`.
- **Rationale**: These are the canonical, already-synced scope values; no new source of truth introduced.
- **Alternatives rejected**: The roster's `activeTeamName` string — that is a within-roster label, not the team
  profile; wrong granularity for a storage key. (It is still useful for the *backlog JQL* — see R4.)

## R3 — Reuse vs move for the triage modules

- **Decision**: Keep `agingTriage.ts`, `agingTriageActionModel.ts`, `AgingTriageActionTable.tsx`,
  `agingBulkTransition.ts`, `AgingBulkClosePanel.tsx`, and `storyPointsField.ts` **in `ReportsHub/` and import them
  in place**. Extract only the enriched backlog fetch + `toTriageIssue` (currently inline in `IssueAgingTab.tsx`)
  into a new `agingBacklogFetch.ts`.
- **Rationale**: Those modules are already pure/portable and framework-first; `AgingBulkClosePanel` already imports
  the SprintDashboard write helpers, so cross-view import is an established norm. Moving files would add churn/risk
  for no behavioral gain. The one extraction is required because the fetch is currently trapped inside the tab.
- **Alternatives rejected**: Relocating the whole triage stack into `SprintDashboard/` — unnecessary churn; a large
  diff over shipped, tested code. (Noted as an optional future tidy-up, not part of this feature.)

## R4 — Deriving the default backlog scope from the team profile

- **Decision**: Build the scope JQL from, in order of preference: the team profile's **project key** (`project =
  <key>`), optionally narrowed by the roster's `assignee in (...)` clause via
  `buildStandupRosterAssigneeClause(rosterMembers, activeTeamName)`; wrapped by the existing
  `buildAgingJql` (`AND statusCategory != Done ORDER BY created ASC`). An operator **JQL override** replaces the
  derived scope and is remembered per team.
- **Rationale**: Reuses the exact JQL construction the Aging tab already uses, plus the roster clause the app already
  builds elsewhere — no new query logic.
- **Alternatives rejected**: Board-saved-filter resolution as the primary path — more moving parts; project + roster
  covers the common case, and the JQL override covers the rest (FR-006).

## R5 — FR-013 material-change re-entry rule

- **Decision**: Record an **ItemFingerprint** at decision time: `{ statusCategoryKey, assigneeKey }`. On refresh, a
  handled item returns to `pending` **iff** its current `statusCategoryKey` differs from the recorded one, **or** it
  is now assigned to a roster member of the active team when it previously was not. Cosmetic edits (label, rank,
  description, `updated`-only bumps) do not change the fingerprint and so never resurface the item.
- **Rationale**: Matches the operator's chosen definition (status-category change OR reassignment into the team) with
  a minimal, deterministic signal set that is already fetched.
- **Alternatives rejected**: Fingerprinting `updated` — noisy; any edit resurfaces items (the exact failure the
  operator rejected). Never re-admitting — risks missing genuinely reopened work.

## R6 — AI gating

- **Decision**: Wrap the panel in `ReportAiPanel`, which renders nothing unless `useAiAssistStore` reports unlocked —
  identical gating to today's triage.
- **Rationale**: Zero new gate logic; behavior parity with the current Reports Hub triage.
- **Alternatives rejected**: A bespoke gate — redundant with `ReportAiPanel`.

## R7 — Bulk close write path

- **Decision**: Reuse `runBulkTransition(...)` with `saveFeatureReviewTransition` (and
  `fetchFeatureReviewTransitions` for the preview), exactly as `AgingBulkClosePanel` does today. On commit, mark the
  affected items `canceled` in the persisted queue.
- **Rationale**: No new Jira write path; proven per-issue-tolerant transition flow.
- **Alternatives rejected**: A new transition helper — violates framework-first; the Feature Review helpers already
  cover it.
