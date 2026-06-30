# Contract — "Today" Dashboard UI & Behaviour

UI contract for the `Today` tab in the My Issues view and its category cards. This is the
application's user-facing contract (no external API surface beyond the checklist-state API).

## Tab placement

- `Today` is the **first** entry in the My Issues sub-tab strip and the **default** active
  tab on view load (FR-001).
- Sub-tabs are addressable via `?tab=<id>` (`today`, `report`, `mentions`, `hygiene`, `time`,
  `gitsync`, `settings`). Unknown/absent → `today` (FR-009).

## Category cards

The dashboard renders one card per `CategoryId` in catalog order:

1. `mentions` — Respond to mentions → My Issues `mentions` sub-tab
2. `blockers` — Unblock issues → Sprint Dashboard `blockers`
3. `my-stale` — My stale issues → My Issues `hygiene` (or `report`)
4. `team-stale` — Team stale issues → Sprint Dashboard / DSU stale surface
5. `unassigned` — Unassigned in-progress → My Issues `hygiene`
6. `commitment-gaps` — Sprint commitment gaps → My Issues `hygiene`
7. `due-overdue` — Due / overdue today → My Issues `hygiene` / Jira
8. `untriaged` — Untriaged new issues → DSU / Sprint Dashboard new surface

Each card MUST express:

| State | Visual / behaviour |
|-------|--------------------|
| loading | per-card spinner; other cards unaffected (FR-013a) |
| ready, count > 0 | count + label + deep link + check-off control |
| ready, count = 0 | rendered **cleared/complete** (auto-complete, FR-006/FR-014) |
| error | message + **retry** affordance; other cards still render (FR-012) |
| not-configured (team scope, no board/sprint) | explicit "team not set up — configure in Sprint Dashboard" + link (FR-008); **not** a zero |
| manually completed | complete styling even if count > 0; toggle to undo (FR-015) |

Clicking a card's link MUST land on the exact destination in one action (FR-009/FR-010),
resolving per the Destination union in data-model.md.

## Dashboard-level behaviour

- **Refresh**: a Refresh control re-runs all card loads; cards also refresh on mount and when
  the user returns to the `today` tab. No background polling (FR-011).
- **Connection required**: when Jira is not connected / proxy not ready, the dashboard shows a
  connection-required state instead of zero counts (FR-013).
- **Done for today**: when every category is complete (auto and/or manual), the dashboard shows
  an unambiguous "done for today" confirmation (FR-016, SC-006).
- **No Jira mutation**: the dashboard never replies, comments, transitions, or edits fields
  from its own surface (FR-017). The only write it performs is toggling daily completion state.
- **No AI gate**: every element renders and functions with AI Assist locked/unavailable
  (FR-002, SC-004).

## Sprint-flow snapshot

- Informational panel: WIP distribution by status zone + sprint days remaining, linking to the
  Sprint Dashboard. Never a check-off item; no WIP-pileup alert in v1 (FR-005).

## Count fidelity

Each card's count MUST equal what its linked surface shows for the same scope and settings
(SC-002): mentions = Mentions tab `visibleMentions`; team categories = Hygiene findings over
the same sprint/board set; my-stale = `checkStaleIssue` over `currentUser()` issues.
