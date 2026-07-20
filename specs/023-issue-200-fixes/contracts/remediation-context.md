# Contract: US5 — Remediation Context Beside Action

Covers FR-015..018, SC-005.

## Layout (`backlogRemediation/BacklogRemediationPanel.tsx`, EDIT)

- Each remediation item renders its decision context — status, assignee, summary, acceptance criteria — **adjacent to**
  its action buttons (Keep / Dismiss / Snooze / Cancel), not in a separate table below.
- Context uses the shared `IssueMeta` chips (status/assignee) + summary/AC text, read from the item's `JiraIssue` in
  `issuesByKey`.
- Each item's action buttons stay unambiguously bound to that item (buttons within the item's own container).

## Data availability (FR-016)

- `issuesByKey` (and `acceptanceCriteriaFieldIds`) MUST be hydrated on panel load, not only after an explicit
  "Refresh backlog", so a resumed session shows context.
- While an item's detail is still loading, that item shows a compact **loading** state beside its buttons; if it can't
  be loaded, an **unavailable** note — never a silent blank next to a live button.

## Behavior preserved (FR-018)

- The remediation decision engine, verdicts, outcomes, snooze, and persistence (`useBacklogRemediationStore`) are
  UNCHANGED. This is layout + hydration only.

## Tests

- Unit/component: an item with a hydrated issue shows status/assignee/summary beside its buttons; an item pending
  detail shows the loading state; deciding still calls the same store actions.
- e2e (`remediation-context.spec.js`): open remediation on a seeded team → each item shows context beside its buttons;
  a decision persists as before; a not-yet-loaded item shows loading, not blank.
