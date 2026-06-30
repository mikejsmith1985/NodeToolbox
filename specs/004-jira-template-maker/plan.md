# Implementation Plan: Jira Template Maker

**Branch**: `feature/jira-template-maker` | **Date**: 2026-06-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-jira-template-maker/spec.md`

## Summary

A guided, no-jargon NodeToolbox view that lets any user build a reusable Jira issue
template through three dependent pickers — **Project → Issue Type → Field** — then enter
type-aware values, and create a real Jira issue in one action. Choices are constrained by
live Jira metadata (issue types per project, fields per issue type, allowed option values)
so a non-technical user cannot build an invalid issue. Templates are **globally shared**,
stored in the same Confluence backing store as the Shared ART Workspace, and reusable with
zero re-entry of fixed values (fields may instead be marked *prompt-at-launch*).

**Technical approach**: This is almost entirely a **frontend feature** that reuses existing
plumbing. Jira reads and the issue create both go through the existing `/jira-proxy/*` route
via `client/src/services/jiraApi.ts` (`jiraGet`/`jiraPost`); the multi-step wizard mirrors the
SnowHub CRG pattern (`CreateChgTab.tsx` + `useCrgState.ts`); allowed-option loading mirrors
`useSnowChoiceOptions`; and template persistence reuses the Confluence content-property store
behind `client/src/services/confluenceApi.ts` (a **new property key** on the existing shared
database). No new server routes or npm dependencies are required.

## Technical Context

**Language/Version**: TypeScript (React client) + Node.js 18 / JavaScript (existing Express
server). The new code is overwhelmingly client-side TypeScript.

**Primary Dependencies**: Existing only — React + the `/jira-proxy` and `/confluence-proxy`
routes (`src/routes/proxy.js`), `client/src/services/jiraApi.ts`, `client/src/services/confluenceApi.ts`.
No new npm packages (rich-text editing uses a minimal in-house editor emitting Jira wiki
markup — see research.md, framework-first gate).

**Storage**: Globally-shared templates as a JSON document under a **new Confluence
content-property key** `nodetoolbox-jira-templates` on the existing shared ART database
(`fetchConfluenceDatabasePropertyByKey` / `upsertConfluenceDatabaseProperty`). No physical
Jira issues; no browser-only persistence for the shared library.

**Testing**: Vitest (client) — unit tests for pure helpers (label dedupe, createmeta→field
model mapping, wiki-markup serialization, template load/save/merge) with mocked `jiraApi`/
`confluenceApi`; component tests for the wizard. Server side unchanged (no new routes).

**Target Platform**: NodeToolbox desktop app (React UI in the embedded client; Express server
on the local port). Browser-driven UI.

**Project Type**: Web application — React frontend over an existing Express proxy backend.

**Performance Goals** (from Success Criteria): build+save a template in < 5 min for a
first-timer (SC-1); create from a saved template in a single confirmed action and < 10 s
(SC-3); 0 invalid options offered (SC-4); 0 duplicate labels written (SC-5).

**Constraints**: All Jira/Confluence traffic through the existing proxy routes (Article IX —
no credentials in the browser); no new server endpoints; no new npm dependencies; reuse
existing components (`JiraProjectPicker`, CRG wizard shell) before building new ones
(Article VII).

**Scale/Scope**: One new client view; a handful of new components + hooks + pure helpers;
template library is a single shared JSON blob (dozens–low-hundreds of templates; see
research.md size-limit note).

**Target Jira flavor (CONFIRMED)**: **Jira Server/Data Center** (confirmed by the user
2026-06-30). v1 uses the classic `createmeta` endpoint and **wiki-markup** text fields; the
ADF/Cloud path is not built but the `lib/wikiMarkup.ts` seam preserves the option. The Q1=A
direct-create decision is unchanged. See research.md D1.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Requirement | Status |
|---------|-------------|--------|
| III — Branching | Work on `feature/jira-template-maker`; PR to `main` | ✅ Branch created before any code |
| IV — Code Quality | Self-documenting names; verb-first functions; booleans `is/has/can/should/was`; functions < 40 lines; purpose comment per file; doc comment per exported function | ✅ Enforced during implementation |
| V — Testing | TDD (red→green→refactor); unit tests mock all I/O and run fast; pure helpers unit-tested; component tests for the wizard | ✅ TDD mandated; pure-helper-first design supports it |
| VI — Documentation | `CHANGELOG.md` updated in the PR; no auxiliary status docs (spec tree exempt) | ✅ CHANGELOG at PR time |
| VII — Framework-First | Reuse `/jira-proxy` + `jiraApi`, `/confluence-proxy` + `confluenceApi`, CRG wizard pattern, `JiraProjectPicker`. Build custom only for the documented gaps (createmeta layer, issue-type picker, scoped field picker, type-aware inputs, wiki-markup editor, template store wrappers) | ✅ Gaps enumerated in research.md |
| VIII — Release | `scripts/local-release.ps1` only; no GitHub Actions | ✅ No release-mechanism changes |
| IX — Vault Zero-Knowledge | No secret ever in browser/log; all auth injected server-side by the proxy | ✅ Reads/writes via proxy; no credential surface added |
| X — Verification & Proof | All quickstart scenarios pass against a live Jira before merge; created issue verified in Jira | ✅ quickstart.md is the proof gate |
| XI — Output Restraint | One new view; no new dashboard files; no internal phase narration | ✅ Single view, no dashboards |

**Framework-First gaps justified** (detail in `research.md`):
- **Jira createmeta layer** — no existing code; built as thin typed wrappers over `jiraGet`
  (`/rest/api/2/issue/createmeta?...`), same proxy, no new infrastructure.
- **Bare `POST /rest/api/2/issue`** — not present today; uses existing `jiraPost` (body
  re-serialization already handled by the proxy).
- **Rich-text editor (core formatting)** — minimal in-house editor emitting Jira wiki markup;
  no editor library added (avoids a heavy dependency for a bounded format).
- **Template store** — reuses `confluenceApi` content-property primitives with a new key; a
  thin `loadJiraTemplates`/`saveJiraTemplates` pair plus an ART-style merge for concurrency.

No constitution violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/004-jira-template-maker/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions, framework-first gate, Jira-flavor finding
├── data-model.md        # Phase 1 — Template / FieldEntry / metadata / wire shapes
├── quickstart.md        # Phase 1 — end-to-end validation scenarios
├── contracts/
│   ├── jira-metadata.md # Phase 1 — createmeta + create-issue request/response contracts
│   └── template-store.md# Phase 1 — Confluence content-property template-store contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (all items passing)
└── tasks.md             # Phase 2 — generated by /speckit-tasks
```

### Source Code (repository root)

```text
client/src/
├── services/
│   ├── jiraApi.ts                          # MODIFIED — add createmeta + createIssue typed wrappers
│   └── confluenceApi.ts                    # MODIFIED — add loadJiraTemplates / saveJiraTemplates + new key
├── types/
│   └── jira.ts                             # MODIFIED — createmeta, field-schema, create-issue types
├── views/
│   └── JiraTemplateMaker/                  # NEW — the feature view
│       ├── JiraTemplateMaker.tsx           # NEW — wizard shell (mirrors CreateChgTab.tsx)
│       ├── hooks/
│       │   ├── useTemplateMakerState.ts    # NEW — step + form state machine (mirrors useCrgState)
│       │   ├── useJiraCreateMeta.ts        # NEW — loads issue types / fields / allowedValues
│       │   └── useTemplateLibrary.ts       # NEW — shared-store CRUD (load/save/merge templates)
│       ├── components/
│       │   ├── IssueTypePicker.tsx         # NEW — issue types for the chosen project
│       │   ├── ScopedFieldPicker.tsx       # NEW — fields for project+issuetype (supported vs unsupported)
│       │   ├── FieldValueInput.tsx         # NEW — type-aware input dispatcher
│       │   └── WikiMarkupEditor.tsx        # NEW — core-formatting rich-text → Jira wiki markup
│       └── lib/                            # NEW — PURE, no I/O (unit-test targets)
│           ├── fieldModel.ts               # createmeta → internal field model + supported-type gate
│           ├── labels.ts                   # case-sensitive dedupe + dedupe-on-create
│           ├── wikiMarkup.ts               # editor doc → wiki markup serialization
│           └── buildCreatePayload.ts       # template + launch answers → POST /issue body
└── components/
    └── JiraProjectPicker/                  # REUSED as-is — project step

client/src/views/JiraTemplateMaker/__tests__/  # NEW — Vitest unit + component tests
```

**Structure Decision**: Web-application layout. A new self-contained view under
`client/src/views/JiraTemplateMaker/` following the established SnowHub pattern (wizard shell
+ state hook + components + pure `lib/` helpers). Server is untouched: all Jira reads/writes
and Confluence persistence flow through the existing proxy routes and client services. Pure
logic is isolated in `lib/` so it is unit-testable with no I/O (Article V).

## Implementation Phases

> Detailed, dependency-ordered tasks are produced by `/speckit-tasks`. These phases frame the
> build order; each lands behind tests (red→green→refactor).

### Phase A — Types & metadata layer (no UI)
Add createmeta + create-issue + field-schema types to `types/jira.ts`; add `getCreateMeta`
and `createIssue` wrappers to `jiraApi.ts`; build pure `lib/fieldModel.ts` mapping createmeta
output to the internal field model and classifying each field as supported (Q1=B set) or
unsupported. Unit tests first.

### Phase B — Template store
Add `loadJiraTemplates`/`saveJiraTemplates` to `confluenceApi.ts` against the new property
key on the shared database, plus an ART-style 3-way merge for concurrent edits. Unit tests
with mocked content-property primitives.

### Phase C — Pure value/serialization helpers
`lib/labels.ts` (case-sensitive dedupe; dedupe-on-create), `lib/wikiMarkup.ts` (editor doc →
wiki markup for core formatting), `lib/buildCreatePayload.ts` (template + launch answers →
`POST /issue` body, honoring fixed vs prompt-at-launch). Unit tests first.

### Phase D — Wizard UI
`JiraTemplateMaker.tsx` + `useTemplateMakerState.ts` dependent-step flow (reusing
`JiraProjectPicker`), `IssueTypePicker`, `ScopedFieldPicker` (supported vs unsupported),
`FieldValueInput` dispatcher, `WikiMarkupEditor`. Component tests.

### Phase E — Library + launch
`useTemplateLibrary.ts` (list/save/edit/delete shared templates; drift detection per FR-7.3),
launch flow (prompt only for prompt-at-launch fields; required-field validation; single
confirm; open-in-Jira link). Component tests + the quickstart scenarios.

### Phase F — Wire-up, CHANGELOG, PR
Register the view in the client navigation; update `CHANGELOG.md`; verify all quickstart
scenarios against live Jira; open PR.

## Key design decisions (summary)

1. **Frontend-only, proxy-reuse.** No new server routes; reads + create via `/jira-proxy`,
   persistence via `/confluence-proxy`. Mirrors how SnowHub CRG and ArtView already work.
2. **Direct create (Q1=A) regardless of Jira flavor.** Robust on both Server/DC and Cloud;
   supersedes the prefill-URL idea. See research.md for the Server/DC finding.
3. **Templates = one shared JSON blob under a new content-property key.** Reuses all existing
   Confluence plumbing; avoids bumping the ART payload schema version (which would break
   deployed clients).
4. **Pure `lib/` core.** Field-model mapping, label rules, wiki-markup serialization, and
   payload building are I/O-free for fast TDD.
5. **Supported-field gate is explicit.** Unsupported field types (cascading selects, etc.)
   are shown-but-not-addable so the UI is honest about scope.
