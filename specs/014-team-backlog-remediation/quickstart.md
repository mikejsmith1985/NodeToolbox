# Quickstart / Validation Guide: Per-Team Persistent Backlog Remediation

Behavioral checks that prove the feature works end-to-end. Run the client with the usual dev command
(`cd client && npm run dev`); unit tests with `cd client && npx vitest run`.

## Prerequisites

- Two configured Team Dashboard team profiles (Team A, Team B), each with a project key (and ideally a roster).
- AI Assist unlockable (Ctrl+Alt+Z) — the panel is gated exactly like the Reports Hub triage.
- A Jira instance reachable with a NOT-Done backlog for at least one team.

## Part 1 — Placement & gating (FR-001–FR-003)

1. Open the Team Dashboard for Team A. **With AI locked**: the Backlog Remediation tab/panel is hidden or locked;
   the rest of the dashboard is unaffected.
2. Unlock AI Assist → the Backlog Remediation panel appears.
3. Open the Reports Hub → **Aging** tab: the **metrics** report (counts, avg/median age, buckets) is unchanged; the
   actionable triage is **no longer** there (moved to the dashboard).

## Part 2 — Team-scoped run without typing JQL (FR-004–FR-006, SC-004)

4. In the panel, do **not** type a JQL. Run/refresh → the backlog is scoped from Team A's profile (project [+ roster
   clause]). Copy the generated prompt; confirm issue lines show the enriched signals (assignee/`unassigned`,
   `in status Nd`, `N pts`, `no description`/`no acceptance criteria`, priority, feature + status).
5. Paste into Copilot, paste the JSON reply back, ingest → verdicts appear in the grouped
   cancel-safe → review → must-remain table.
6. (Override) Type a JQL override, refresh → the override scope is used and is remembered for Team A only.

## Part 3 — Persistence & parallel teams (FR-007, FR-011, SC-001, SC-002)

7. Mark a few items (cancel one, keep one, dismiss one, snooze one to a future date). **Reload the app.** Reopen
   Team A's panel → the verdicts and your four decisions are intact with **zero** re-runs.
8. Switch to Team B → the panel shows Team B's own (empty or different) queue. Act in B. Switch back to A → A's
   state is unchanged; B's actions did not touch A.

## Part 4 — No resurfacing (FR-009, FR-010, FR-013, SC-003)

9. Refresh Team A's backlog. The `canceled`/`kept`/`dismissed` items do **not** reappear as untouched; the
   `snoozed` item stays hidden.
10. Advance the snooze date (or set a past date) and refresh → the snoozed item returns to the actionable queue.
11. In Jira, move a `dismissed` item's status to a different **category** (or reassign it to a Team A roster
    member), then refresh → it re-enters as `pending` (material change). Make only a cosmetic edit (label/rank) to
    another handled item → it stays hidden.

## Part 5 — Enact cleanup (FR-014–FR-016, SC-005)

12. On a **cancel-safe** feature group, open **Close feature + N items** → preview lists the target status from the
    transitions those issues actually offer; opt one item out; **nothing is written until Commit**.
13. Commit → each item transitions individually with its own ✅/⏭/✕ result; the persisted queue records the
    committed items as `canceled`. Reload → they remain canceled.

## Part 6 — Regression guard (SC-006, SC-007)

14. Aging **metrics** in the Reports Hub still show the same numbers/queries as before the move.
15. Story points and time-in-status are populated (non-blank) in the prompt for issues that have them (the feature
    016 data fix is preserved via the shared `storyPointsField` reader).

## Unit validation (Layer 1, must be green first)

- `remediationReconcile.test.ts` — drop out-of-scope, new→pending, snooze elapse, terminal hold, material-change
  re-entry (status category / reassignment), cosmetic-no-op, determinism.
- `useBacklogRemediationStore.test.ts` — decision round-trip, team isolation, corrupt-blob tolerance, per-team
  override.
- `remediationScope.test.ts` — override wins, derived project (+ roster) clause, empty-when-nothing-derivable.
