# Implementation Plan: Intake Deduplication (Phase 2A)

**Branch**: `feature/teams-jira-intake` (current) | **Date**: 2026-07-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-intake-dedup/spec.md`

## Summary

Make intake deduplication authoritative in Jira instead of relying only on the local ledger. On
create, stamp the issue with a label `intake-<submissionId>`. Before creating (and as a batched
pre-scan at import time), ask Jira — via a label JQL search through the existing Jira proxy —
whether an issue already carries that stamp; if so, reconcile the row to the existing key and skip
creation. The local processed ledger stays as a fast cache so already-known rows need no Jira call.

Technical approach: a pure `intakeLabel` helper (build/validate/extract), a thin
`searchIssuesByLabels` wrapper on `jiraApi` (mirrors the existing `/rest/api/2/search?jql=` GET
pattern), a pure `reconcileExisting` that maps found labels back to queue entries + ledger entries,
and additive changes to `useCreateFromSubmission` (stamp on create + per-row existence guard +
batched `reconcileExisting`). The view runs the batched scan on import, then auto-creates only the
rows still genuinely new.

## Technical Context

**Language/Version**: TypeScript 5.x (client), React 18.

**Primary Dependencies**: existing `jiraApi.ts` (`jiraGet` for `/rest/api/2/search`, `createIssue`),
the feature 005 `JiraIntake` importer (`useCreateFromSubmission`, `useIntakeQueue`, `useIntakeConfig`,
`buildIntakeFields`, `processedLedger`).

**Storage**: No new storage. The Jira label is the durable dedup record; the existing Confluence
content-property ledger continues as the local cache (reconciled from Jira results).

**Testing**: Vitest, co-located `*.test.ts(x)` (repo pre-commit rule). Unit tests mock `jiraApi`
(search/create) and `recordProcessed`; run <10ms. Build gate: `cd client && npm run build`.

**Target Platform**: NodeToolbox client (Chromium), same as feature 005.

**Project Type**: Web application — client-only change under `client/src/views/JiraIntake/` plus one
`jiraApi.ts` wrapper. No server changes.

**Performance Goals**: A re-import that is mostly already-processed resolves known rows from the
cache with zero Jira calls; unknown rows are checked in a **single batched** JQL query
(`labels in (...)`), not one request per row (FR-6, SC-004).

**Constraints**: Jira **Data Center** (labels + label JQL via the proxy). No premium connectors, no
app registration, no store write-back (out of 2A). Jira-unreachable during a check ⇒ create nothing,
flag the row (FR-7, SC-005).

**Scale/Scope**: Batches of up to a few hundred submissions per file; JQL `labels in (...)` chunked
if the id list is large.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1 design.*

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Work on a feature branch; merge via the release pipeline | ✅ |
| IV — Code Quality | Self-documenting names, booleans `is/has/...`, verb-first fns <40 lines, doc comments, named constants | ✅ Enforced in tasks |
| V — Testing (TDD) | Failing co-located test precedes impl; unit mocks all I/O <10ms | ✅ TDD sequencing |
| VI — Documentation | `CHANGELOG.md` updated; `specs/006-*` is the exempt pipeline tree | ✅ |
| VII — Framework-First | Reuse the existing search-JQL pattern, `createIssue`, the 005 create/ledger stack; build custom only for the label helper + reconcile glue | ✅ Justified below |
| VIII — Release | `scripts\local-release.ps1 patch` when shipping | ✅ |
| X — Verification | Prove with real evidence: empty-ledger re-import creates 0, issues carry the label | ✅ Quickstart |

**Framework-First justification (Article VII):** No new search mechanism — `searchIssuesByLabels`
is a thin wrapper over the same `/rest/api/2/search?jql=` GET a dozen views already use. Create still
goes through `createIssue`; the label is just another field on the existing payload. The only new
logic is intake-specific: the label format, mapping found labels back to submissions, and the
reconcile/skip decision — none of which the reused pieces provide.

No violations → Complexity Tracking omitted.

## Project Structure

### Documentation (this feature)

```text
specs/006-intake-dedup/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── dedup-contracts.md
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
client/src/views/JiraIntake/
├── lib/
│   ├── intakeLabel.ts              # buildIntakeLabel(id), isStampableId, extractSubmissionIds(labels)
│   ├── intakeLabel.test.ts
│   ├── reconcileExisting.ts        # (entries, foundIdToKey) → { entries, newLedgerEntries } (pure)
│   ├── reconcileExisting.test.ts
│   └── buildIntakeFields.ts        # + attach labels: ['intake-<id>'] to the create payload
├── hooks/
│   ├── useCreateFromSubmission.ts  # + stamp label on create; + per-row existence guard;
│   │                               #   + reconcileExisting(entries) batched pre-scan
│   └── useCreateFromSubmission.test.ts
└── JiraIntake.tsx                  # handleFile: ingest → reconcile pre-scan → auto-create remainder

client/src/services/jiraApi.ts      # + searchIssuesByLabels(labels): GET /rest/api/2/search?jql=labels in (...)
```

**Structure Decision**: Additive to the feature 005 `JiraIntake` feature. Pure logic (`intakeLabel`,
`reconcileExisting`) in `lib/`; the batched scan + per-row guard live in the existing
`useCreateFromSubmission` hook so every create path inherits them; one shared-service wrapper
(`searchIssuesByLabels`). No server code changes.

## Complexity Tracking

No constitution violations — section intentionally empty.
