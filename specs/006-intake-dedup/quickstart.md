# Quickstart / Validation — Intake Deduplication (Phase 2A)

Runnable scenarios proving dedup is authoritative in Jira. Contracts:
[dedup-contracts.md](./contracts/dedup-contracts.md). Shapes: [data-model.md](./data-model.md).

## Prerequisites

- NodeToolbox client running with the Jira (Data Center) + Confluence proxies configured.
- The feature 005 **Jira Intake** view, configured (default project and/or a project mapping saved).
- A submissions file (the real `Jira-Intake.xlsx`, or the header + a couple of rows).
- Ability to view labels on a Jira issue and run a label search in Jira.

## Setup

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npm run dev
```
Open **Jira Intake**, confirm settings are saved.

## Scenario 1 — Stamp on create (SC-006, FR-001)

1. Import a file with a brand-new submission and create it (auto or manual).
2. Open the created issue in Jira. **Expected**: it carries a label **`intake-<id>`** matching the
   submission id; searching `labels = "intake-<id>"` in Jira returns exactly that issue.

## Scenario 2 — No duplicate with an empty ledger (SC-001, SC-002, US1)

1. After Scenario 1, **clear the local ledger** (reset the intake store / use a second machine).
2. Re-import the same file.
3. **Expected**: the batched pre-scan marks the row **Imported** with the existing key; clicking
   Create / auto-create produces **0** new issues; Jira still has exactly one matching issue.

## Scenario 3 — Recover from a mid-create failure (SC-003, US2)

1. Simulate created-but-not-recorded: an issue exists and is stamped, but the submission is **not**
   in the ledger (e.g. cleared ledger but keep the Jira issue).
2. Import + create that submission.
3. **Expected**: the per-row guard finds the stamped issue, reconciles to its key, records it
   locally, and creates **no** duplicate.

## Scenario 4 — Fast path for known rows (SC-004, US3)

1. Re-import a file whose rows are already in the ledger.
2. **Expected**: those rows show **Imported** from the cache with **no** Jira existence call; only
   rows not in the ledger trigger the (single, batched) label search.

## Scenario 5 — Check fails safe (SC-005, FR-007)

1. Make Jira unreachable (disconnect/att an invalid session) and attempt create on a not-known row.
2. **Expected**: **0** issues created; the row is flagged with a clear retry reason (not silently
   skipped, not blindly created).

## Scenario 6 — Every create path is guarded (FR-008)

- Repeat Scenario 2's "already exists" case via **auto-create-on-import**, the **bulk "Create N"**
  button, **per-row Create**, and **Retry** on a failed row. **Expected**: none of them create a
  duplicate; each reconciles to the existing key.

## Build / test gates (Article X)

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npx vitest run src/views/JiraIntake src/services/jiraApi.test.ts
npm run build
```

**Done when**: Scenarios 1–6 pass with real evidence (a stamped issue + a zero-duplicate
empty-ledger re-import), unit suites green, and the production build succeeds.
