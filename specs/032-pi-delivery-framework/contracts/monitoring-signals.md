# Contract — Monitoring Signals (`piPlanMonitor.ts`)

Turns the written plan + live Jira state into on-track signals and explicit replan triggers, so the team **monitors**
instead of re-planning (US5). Pure; clock injected; no AI.

## Function

```ts
computeMonitor(plan: WrittenPlanSnapshot, live: LiveJiraSnapshot, nowIso: string): MonitorResult
```

`WrittenPlanSnapshot` = the accepted plan (Stories, sub-tasks, planned points per sprint, planned sprint per Story).
`LiveJiraSnapshot` = current statuses, sub-task states, last GitHub-intake comment timestamps (read by the caller).

## Signals (each `isOnTrack` against a stated target)

| Kind | Computation | On-track when |
|------|-------------|---------------|
| `burnUp` | completed vs planned points per sprint | completed ≥ planned-to-date |
| `subtaskAging` | max days a sub-task has been In Progress | ≤ cycle-time target |
| `slQueueDepth` | SL-test sub-tasks awaiting/started vs SL capacity that sprint | depth ≤ capacity |
| `freshness` | days since the last GitHub-intake comment on an in-flight issue | ≤ freshness target (e.g. 2 working days) |
| `commitVsComplete` | committed vs completed Stories per sprint | completed ≥ committed × target |

Targets are configurable constants (named, not magic numbers per Article IV).

## Replan triggers (FR-030)

| Kind | Fires when |
|------|-----------|
| `storySlipped` | a Story's delivery has moved beyond its **planned** sprint |
| `slQueueOverTwoSprints` | `slQueueDepth` exceeds SL capacity for **two consecutive** sprints |

Triggers are the explicit line between "monitor" and "replan": only when one fires does the team re-plan.

## Freshness source

Reuses the **GitHub email-intake** comments already landing on issues (PR merged / commit / review). The last such
comment's timestamp is the freshness signal — no new integration.

## Test obligations (vitest, TDD)

- Burn-up flags off-track when completed < planned-to-date; on-track otherwise.
- SL-queue depth over capacity flags the signal; two consecutive over-capacity sprints raise `slQueueOverTwoSprints`.
- A Story delivered later than its planned sprint raises `storySlipped`.
- Freshness uses the last intake-comment timestamp and the injected clock.
- All signals computed against the plan snapshot without re-deriving the plan — SC-008.
