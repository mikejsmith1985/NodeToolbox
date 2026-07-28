# Contract — Repo→Sub-task Generation (`piPlanRepoSubtasks.ts`)

Replaces 031's `repoStoryBreakdown.ts`. Turns an accepted Story + its repo set into the sub-task scaffold. Pure, no I/O.

## Functions

```ts
buildRepoCodingSubtasks(story: ScheduledStory, repoComponentNames: string[],
  resolveComponentId: (repoName: string) => string | null,
  existingChildren: ExistingChild[]): RepoCodingSubtask[]

buildStorySubtaskScaffold(story: ScheduledStory, dates: DatedItem): PlanItemProposal[]
```

## Scaffold rules (per Story)

- **One `coding` sub-task per repo** the Story touches (FR-002). Each carries `repoName`, resolved `repoComponentId`
  (set on the sub-task's `components` field), a `devPoints` share, and a load-balanced `assignee`.
- **Exactly one `slTest` sub-task** (FR-003), owned by an `internalTest`-capable person, separately pointable.
- **Exactly one each** of `deployInt`, `deployRel`, `deployProd` — **per-story, not per-repo** (FR-003, avoids
  explosion). Dates from the cadence engine (INT=Target End, REL=INT+5wd, PROD=fixVersion).
- **No** INT/REL test sub-task ever (FR-006).
- A Story with **zero** repo components → zero coding sub-tasks + honest "map repos first" state (FR-007).
- Applies to **Defects** spanning repos identically (FR-004).

## Point partition (FR: R6)

- Story dev points (70% of size) split **equally** across repos, **≥1** each, PO-editable. Remainder distributed so
  the coding sub-tasks' `devPoints` sum equals the Story's dev points.
- SL-test = the 30% portion, one sub-task.

## Idempotency (FR-005)

- A repo already represented by an existing child coding sub-task (matched by repo name / component on the child) is
  **not** re-created (`status: 'existing'`).
- An existing `slTest` / deploy child of the Story is likewise not duplicated.

## Titles & fields

- Coding sub-task summary: `[{repo}] {Story summary}` (repo identifies the sub-task; repo also on `components`).
- SL-test: `[SL] SL Test — {Story summary}`.
- Deploys: `[INT|REL|PROD] Deploy — {Story summary}` (relabel 028's `[IT]`→`[SL]`).

## Test obligations (vitest, TDD)

- A Story touching repos A,B,C → exactly 3 coding sub-tasks (A,B,C) + 1 SL-test + 1 each INT/REL/PROD.
- A single-repo Story → exactly 1 coding sub-task (no explosion) — SC-004.
- Dev-point partition sums to the Story's dev points; each ≥1.
- Idempotency: a repo with an existing child coding sub-task is `existing`, not recreated.
- Zero repos → zero coding sub-tasks + "map repos first".
- Each coding sub-task's `repoComponentId` is the resolver's output; an unresolved repo is surfaced, not written.
