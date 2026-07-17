# Contract — Route Redirects (020)

Every retired or gated path lands somewhere sensible with parameters intact (FR-010, SC-005). All redirects are
`replace` navigations; none chain (single hop).

| Old path | Destination | Notes |
|---|---|---|
| /sprint-dashboard | /agile-hub?space=team + original query | Today cards' `?hygieneFilter=…` rides verbatim; tab selection continues to flow through the settings store the mounted view already reads |
| /po-tool | /agile-hub?space=product + original query | PO selection untouched (017) |
| /art | /agile-hub?space=train + original query | |
| /sprint-planning | /agile-hub?space=team | repointed legacy redirect |
| /pointing | /agile-hub?space=team | repointed |
| /standup | /agile-hub?space=team | repointed |
| /dsu-daily | /agile-hub?space=team | repointed |
| /metrics | /agile-hub?space=team | repointed |
| /pipeline | /agile-hub?space=team | repointed |
| /defects | /agile-hub?space=team | repointed |
| /release-monitor | /agile-hub?space=team | repointed |
| /snow-hub (admin locked) | / | entry gate; unlocked renders the tool |
| any hidden tool's route | / | visibility gate |
| all other existing routes | unchanged | |

## Rules

1. The redirect element reads `location.search`, sets/overrides only `space`, and preserves everything else.
2. In-app links may keep using old paths indefinitely — the redirects are the compatibility layer; updating call
   sites to `/agile-hub` is optional cleanup, never a correctness requirement.
3. Recents: `sprint-dashboard`, `po-tool`, `art`, `dsu-board` ids resolve to the `agile-hub` card/label.

## Test hooks

- Unit: a route table test asserting each old path renders a redirect to the expected destination with query
  preserved.
- e2e: bookmark journey `/sprint-dashboard?hygieneFilter=stale` (the acceptance case) + one legacy path spot-check.
