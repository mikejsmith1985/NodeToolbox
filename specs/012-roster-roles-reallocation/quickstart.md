# Quickstart: Role-Aware Roster + Canvas Work Re-Allocation Plan

A behavioral validation guide — proves the feature works end to end. Not implementation detail (that is
`tasks.md`). References `data-model.md` and `contracts/` rather than repeating them.

## Prerequisites

- Client dev server running (`cd client && npm run dev`) against a Jira instance with an ART team + PI whose
  features have child stories with assignees.
- A Team-Dashboard roster with a few members on the active team (Team Dashboard → Roster).
- A Feature Canvas with at least one **sprint** container holding features whose child stories are assigned
  (Feature Canvas → surface features → Stage 5 box into a sprint).
- AI Assist unlocked (Ctrl+Alt+Z) for the Part 2 checks.

## Part 1 — Role-aware roster (no AI needed)

1. **Set roles**: On the roster, toggle a member to **Developer** + **Internal Tester**.
   - ✅ Both chips appear; External Tester stays off. Reload the app → both persist. *(SC-1, SC-2)*
2. **Independence**: Give a second member only **External Tester**.
   - ✅ Each member reads back exactly its own roles; no forced single role.
3. **Team scope**: Set roles on Team A, switch active team to Team B.
   - ✅ Team B members show their own (independent) role state. *(FR-1.3)*
4. **Manual parity**: Lock AI (if unlocked) and repeat step 1.
   - ✅ Roles are fully settable/visible; no re-allocation panel is shown anywhere. *(SC-7)*

## Part 2 — Work Re-Allocation Plan (AI unlocked)

5. **Open the panel**: On the canvas with AI unlocked, open **Work Re-Allocation**.
   - ✅ A target-sprint selector, an additional-details box, a prompt preview, and a Copy button appear. When
     AI is locked, the panel renders nothing. *(FR-7.2)*
6. **Prompt content**: Select a sprint that has assigned child work.
   - ✅ The preview contains: every active-team roster member with their roles (incl. members with no work);
     each person's items with **key · summary · points · raw status (+category) · days-in-status**; explicit
     **Unassigned** / **off-roster** buckets; the **PI start and end dates** + days remaining; and the
     **story-point ≈ one day** convention. Nothing invented. *(SC-3, SC-9)*
7. **Constraints verbatim**: Type `ESI only has two devs who can work it` into additional-details.
   - ✅ That exact text appears in the prompt, framed as a rule the assistant must honor. *(SC-4)*
8. **Persistence**: Close and reopen the canvas for the same team/scope.
   - ✅ The additional-details text is still present; clearing it removes it. *(FR-4.3)*
9. **Plan + risks requested**: Read the prompt's instruction block.
   - ✅ It asks for both a re-allocation plan grouped by person (role-legal moves only) **and** an explicit
     risk assessment (role bottlenecks, overloaded people, unstaffed testing, unassigned/blocked work).
     *(SC-5)*
10. **No side effects**: Click **Copy prompt**; inspect the canvas overlay and the underlying Jira issues.
    - ✅ Nothing changed on the canvas overlay or in Jira; there is no ingest/apply control. *(SC-6)*
11. **Round-trip (manual)**: Paste the copied prompt into Copilot.
    - ✅ Copilot returns a documented re-allocation plan and a risk list a reader can act on. *(Story B, D)*

## Empty & degraded states

12. Select a sprint with **no assigned work** → panel says so, no hollow prompt. *(FR-8.1)*
13. Canvas with **no sprint** → panel says define a sprint first. *(FR-8.1)*
14. Active team with **no roster** → panel points to Roster settings. *(FR-8.1)*
15. Roster present but **no member has any role** → panel warns reasoning is degraded, points to the role
    editor. *(FR-8.2)*
16. A PI name with **no parseable date range** → prompt states the runway is unknown but still generates. *(R7)*

## Regression guard

17. Open the existing **AI suggestions** panel (size / prioritize / WIP / sequence / master plan).
    - ✅ Each behaves exactly as before — same prompts, same ingest/accept-reject. *(SC-8)*

## Automated coverage (see `tasks.md`)

- **Unit (<10ms)**: `reallocationModel` target-sprint grouping + resolved-box logic + unassigned/off-roster
  flags + spare-capacity list; `reallocationPrompt` string assembly + guardrails; days-in-status math (today
  injected); roster store roles round-trip + preservation across upsert.
- **Component (RTL + user-event)**: `RosterTab` role toggles/chips; `WorkReallocationPanel` target-sprint
  select, details persistence, copy, empty/degraded states, gate-locked → renders nothing.
