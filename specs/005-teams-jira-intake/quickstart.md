# Quickstart / Validation — Teams → Jira Intake (Toolbox importer)

Runnable scenarios that prove Phase 2 works end-to-end. Contracts: [intake-contracts.md](./contracts/intake-contracts.md).
Data shapes: [data-model.md](./data-model.md).

## Prerequisites

- NodeToolbox client running (`cd client && npm run dev`) with the Jira + Confluence proxies
  configured (same setup the Jira Template Maker uses).
- A real exported **`Jira-Intake.xlsx`** (or CSV) from the validated Phase-1 flow — at minimum the
  header row plus one submission (see the sample in `spec.md` FR-5).
- Access to the target Jira **Data Center** project (createmeta must return its issue types).

## Setup

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npm install          # xlsx is already a dependency; no new installs expected
npm run dev
```

Open the new **Jira Intake** view from the sidebar/home card.

## Scenario 1 — Configure the intake (FR-1)

1. Pick the target **project** (search by key) and **issue type**.
2. Map each core field → a Jira field (summary→summary, description→description [wiki markup],
   acceptanceCriteria→a text field, issueType→Issue Type, priority→Priority). Optionally set a
   fixed component/default.
3. Leave **Auto-create on import** ON for Scenario 2 (toggle OFF for Scenario 5).
4. Save. **Expected**: config persists to the Confluence content property `nodetoolbox.intake.v1`
   and survives reload.

## Scenario 2 — Import + auto-create (FR-2, FR-3, SC-2, SC-6)

1. **Drag** `Jira-Intake.xlsx` onto the dropzone (or pick it).
2. **Expected**: rows appear **newest-first** with submitter, timestamp, and core values; each valid
   new row becomes exactly one Jira issue; the row shows its **Jira key** and flips to *Imported*.
3. Open the created issue in Jira. **Expected**: fields match the mapping; description text renders.

## Scenario 3 — Reporter attribution (FR-3.2, SC-3, Story D)

- A row whose `submitterEmail` matches a Jira user → that user is the **reporter** (`reporterOutcome
  = matched`).
- A row whose email matches no user → issue still created as the **integration account**, and the
  **description begins with an origin note** naming the submitter (`reporterOutcome = fallback`).

## Scenario 4 — Dedup / idempotency (FR-2.2, FR-3.4, SC-4)

1. Re-drag the **same file**.
2. **Expected**: previously created rows show as *Imported* with their existing Jira key and are
   **not** created again; issue count in Jira is unchanged.

## Scenario 5 — Review-and-pick (FR-1.3, FR-2.3)

1. Set **Auto-create on import** OFF; re-import a file with a fresh submission.
2. **Expected**: new rows sit in the queue as *new*; **no** issues created until you click **Create**
   on a row (or dismiss it). Dismissed rows become *skipped*.

## Scenario 6 — Invalid / drifted rows (FR-2.4, FR-3.3)

- A row missing the required **summary** → shown *invalid* with the reason; not created; other rows
  proceed.
- A row whose mapped choice value no longer exists in Jira → flagged via drift; not created.

## Scenario 7 — Store/file errors (FR-6.1, SC-5)

- Drop a non-spreadsheet file → clear non-technical error; queue unchanged, nothing created.

## Build / test gates (Article X)

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npx vitest run src/views/JiraIntake      # unit suites (co-located, mocked I/O, <10ms each)
npm run build                            # tsc -b && vite build must pass (stricter than --noEmit)
```

**Done when**: Scenarios 1–7 pass with real evidence (created issue keys + screenshots), unit
suites green, and the production build succeeds.
