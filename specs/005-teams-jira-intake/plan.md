# Implementation Plan: Teams → Jira Issue Intake (Phase 2, Toolbox importer)

**Branch**: `feature/teams-jira-intake` | **Date**: 2026-07-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-teams-jira-intake/spec.md`

## Summary

Phase 1 (Teams + Power Automate) is built and validated: submissions land in `Jira-Intake.xlsx`,
table `Submissions`, as flat rows with the confirmed 10-column contract. This plan covers **Phase 2
only** — the in-Toolbox importer: a new view where a Toolbox user **drag-and-drops the exported
Excel/CSV**, sees an **intake queue** (newest-first) with submitter + core values, and — per an
**intake configuration** (project + issue type + core-field→Jira-field mapping, reusing the Jira
Template Maker) — creates Jira issues with the **reporter set to the submitter** (integration-account
fallback, origin recorded in the description). Dedup is **local by submission `id`**; re-importing the
same or a superset file never double-creates. Auto-create-on-import vs review-and-pick is a toggle.

Technical approach: a pure client-side pipeline. Parse the dropped file with the already-bundled
**SheetJS (`xlsx`)** into normalized `IntakeSubmission` records (tolerant of nested JSON or flat
columns). Persist the intake config and the local processed-`id` ledger in the **shared Confluence
content property** the Template Maker already uses (Rovo-independent, team-visible). Reuse
`buildCreatePayload`, `fieldModel`, `requiredFields`, `drift`, and `wikiMarkup` for create; add one
thin Jira user-search wrapper (the DC `user/search?query=` → `username=` fallback pattern already
proven in SprintDashboard) for reporter resolution.

## Technical Context

**Language/Version**: TypeScript 5.x (client), React 18.

**Primary Dependencies**: React, React Router; **SheetJS `xlsx@^0.18.5`** (already a dependency) for
client-side workbook/CSV parsing; existing `jiraApi.ts` (`createIssue`, `getMyself`, `getProject`,
`getProjectIssueTypes`, `getIssueTypeFields`, `jiraGet`) and `confluenceApi.ts` (content-property
store); the Jira Template Maker `lib/` (`buildCreatePayload`, `fieldModel`, `requiredFields`, `drift`,
`wikiMarkup`, `templateTypes`, `labels`).

**Storage**: No new server tables. Intake config + processed-`id` ledger live in the **shared
Confluence content property** (same mechanism as `useTemplateLibrary`). The submission source is a
**user-dropped file** (never persisted to the server). No write-back to the dropped file in v1.

**Testing**: Vitest, **co-located `*.test.ts(x)`** next to each source file (repo pre-commit rule).
Unit tests mock all I/O (`jiraApi`/`confluenceApi`/`FileReader`) and the parser boundary; run <10ms.
Production build gate: `cd client && npm run build` (`tsc -b && vite build` — stricter than `--noEmit`).

**Target Platform**: NodeToolbox desktop/web client (Chromium), same as the Template Maker.

**Project Type**: Web application — client feature under `client/src/views/`, no server changes.

**Performance Goals**: Parse + queue-render a 10-submission file in well under the 2-minute
end-to-end SC-6 budget; UI stays responsive with a paged/limited queue for large backlogs.

**Constraints**: Standard-connector world only — **no premium Power Automate, no inbound endpoint,
no SharePoint/Graph auth in v1** (file drag-and-drop is the sole ingest). Jira is **Data Center**
(reporter set by `name`/username). Dark-theme CSS must use only the real theme tokens (see research).

**Scale/Scope**: One active intake configuration (v1). Backlogs up to a few hundred rows per file;
queue is paged/limited with a visible count.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1 design.*

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Work on `feature/teams-jira-intake`; merge via PR | ✅ On feature branch |
| IV — Code Quality | Self-documenting names, booleans `is/has/...`, verb-first fns <40 lines, per-file purpose + doc comments, named constants | ✅ Enforced in tasks |
| V — Testing (TDD) | Failing co-located test precedes impl; unit mocks all I/O <10ms | ✅ TDD sequencing in tasks.md |
| VI — Documentation | `CHANGELOG.md` updated; no ad-hoc status docs; `specs/005-*` is the exempt pipeline tree | ✅ Planned |
| VII — Framework-First | Reuse SheetJS, Template Maker `lib/`, Confluence content-property store, existing Jira proxy + DC user-search pattern; build custom only for the queue/parse/reporter gap | ✅ Justified below |
| VIII — Release | `scripts\local-release.ps1 minor` when shipping | ✅ Planned |
| X — Verification | Prove behavior with real dropped file + created-issue evidence, not "200 OK" | ✅ Quickstart scenarios |

**Framework-First justification (Article VII):** No custom spreadsheet parser (SheetJS is bundled).
No custom create/field logic (reuse Template Maker `lib/`). No new persistence layer (reuse the
Confluence content-property store). The only genuinely new code is the **intake-specific glue**: file
normalization to the submission contract, the queue state machine, config↔template binding, local
`id` dedup ledger, and submitter→reporter resolution — none of which the reused pieces provide.

No violations → Complexity Tracking omitted.

## Project Structure

### Documentation (this feature)

```text
specs/005-teams-jira-intake/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── intake-contracts.md
├── phase1-teams.md      # Phase-1 build guide (existing)
├── phase1-copilot-brief.md
├── reference-confluence-webhook-delivery.md
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
client/src/views/JiraIntake/
├── JiraIntake.tsx                     # View shell: config panel + dropzone + queue
├── JiraIntake.module.css
├── JiraIntake.test.tsx
├── lib/
│   ├── intakeTypes.ts                 # IntakeSubmission, IntakeConfig, QueueEntry, statuses
│   ├── parseSubmissions.ts            # SheetJS workbook/CSV → raw rows (I/O-thin boundary)
│   ├── parseSubmissions.test.ts
│   ├── normalizeSubmission.ts         # raw row (nested OR flat) → IntakeSubmission + validation
│   ├── normalizeSubmission.test.ts
│   ├── mapToTemplateFields.ts         # core fields → TemplateFieldEntry values via IntakeConfig
│   ├── mapToTemplateFields.test.ts
│   ├── resolveReporter.ts             # submitter email → Jira user or integration-account fallback
│   ├── resolveReporter.test.ts
│   ├── describeSubmitter.ts           # builds the "origin" wiki-markup note for the description
│   ├── describeSubmitter.test.ts
│   ├── processedLedger.ts             # local dedup by id (serialize/merge for the store)
│   └── processedLedger.test.ts
├── hooks/
│   ├── useIntakeConfig.ts             # load/save intake config in the Confluence content property
│   ├── useIntakeConfig.test.ts
│   ├── useIntakeQueue.ts              # dropped file → parsed/normalized/deduped queue state
│   ├── useIntakeQueue.test.ts
│   ├── useCreateFromSubmission.ts     # single/bulk create orchestration + ledger update
│   └── useCreateFromSubmission.test.ts
└── components/
    ├── SubmissionDropzone.tsx         # drag-and-drop + file picker
    ├── SubmissionDropzone.test.tsx
    ├── IntakeQueue.tsx                # newest-first list, per-row status/flags/Jira key
    ├── IntakeQueue.test.tsx
    ├── IntakeConfigPanel.tsx          # project + issue type + field mapping + auto-create toggle
    └── IntakeConfigPanel.test.tsx

client/src/services/jiraApi.ts         # + searchUsers() wrapper (DC query→username fallback)
client/src/App.tsx                     # + JIRA_INTAKE_ROUTE <Route>
client/src/<home + sidebar reg>        # + one intake card/shortcut (mirror Template Maker)
```

**Structure Decision**: A self-contained `client/src/views/JiraIntake/` feature mirroring the
Template Maker's `lib/ hooks/ components/` split, with pure logic in `lib/` (fast unit tests) and I/O
isolated to hooks. The one shared-service change is a `searchUsers()` wrapper in `jiraApi.ts`. No
server code changes.

## Complexity Tracking

No constitution violations — section intentionally empty.
