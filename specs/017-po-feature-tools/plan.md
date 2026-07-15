# Implementation Plan: PO Tool — Feature Splitter & Feature Composition

**Branch**: `feature/017-po-feature-tools` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/017-po-feature-tools/spec.md`

## Summary

Add a **PO Tool** — a dedicated home for Feature-level product-owner work — that **mounts the existing Feature Review
and PI Review tabs** (the same components, not copies) alongside two new authoring tabs:

- **Feature Splitter** — load a Feature by key, cut/paste/edit it into **smaller peer Features**, with deterministic
  coaching. The original is **kept and linked**, never closed. Review diff → explicit commit.
- **Feature Composition** — gather **uploaded spreadsheets, Confluence pages fetched by URL, pasted notes, and live
  Jira keys** into one referenced workspace, with deterministic DoR coaching and a live hygiene checklist. Commit
  either **updates** an existing Feature or **creates** one in a PO-chosen project.

Both tabs offer a **passphrase-gated AI assist** that only ever proposes (copy-paste prompt out, strictly-validated
JSON in, every item accept/reject/editable, **zero Jira writes** until commit), and both **persist drafts across
sessions** until committed.

**The design is overwhelmingly reuse, and Phase 0 shrank it further.** Research resolved the two things that looked
expensive:

- **The spec's flagged schedule risk (FR-005c) was overstated** (R1). Independent team selection costs **one optional
  prop on one file** (~6 lines) plus the PO Tool tracking its own profile id; **PI Review needs zero changes**; the
  team-scoped capacity singleton is a **non-issue** because neither mounted component touches it. The prop-else-store
  idiom already ships in the same folder. *Assumption A2 has been corrected in the spec.*
- **Q3=C (file upload) collapsed under the Framework-First gate** (R5). SheetJS **already ships** and is **already
  dynamically imported** to stay out of the main bundle; a `.xlsx/.xls/.csv` dropzone and a `File`→rows parser
  already exist with tests. **No new dependency.**

The genuinely new work is **four small seams** (R2b, R2c, R3, R8) plus the two authoring surfaces themselves. Work is
layered so the **reuse claim is proven first** (Layer 1 ships a working PO Tool with both existing tabs before a line
of authoring code exists), and so each risky seam lands with tests before anything depends on it.

1. **Shell + reused tabs (proves FR-003/004/005, zero-regression).** Register the tool; own team/PI selection;
   optional prop on Feature Review; mount PI Review directly. *Ships value on day one.*
2. **Shared seams (TDD, no UI).** The four new-work items in isolation, each unit-tested.
3. **Feature Splitter — deterministic core**, then its gated AI assist.
4. **Feature Composition — deterministic core** (3 ingestion paths), then its gated AI assist.
5. **CHANGELOG + polish.**

## Technical Context

**Language/Version**: TypeScript ~6.x (`typescript: ~6.0.2`), React 19, ESM. Client-only feature — **no server
changes**.

**Primary Dependencies**: **Zero new.** Reuse — `views/SprintDashboard/FeatureReviewTab.tsx`,
`views/ArtView/PiReviewTab.tsx`, `store/settingsStore.ts` (profile catalog, read-only), `store/aiAssistStore.ts`
(gate), `utils/extractJsonPayload.ts`, the planner-ingest partial-success idiom, `views/Hygiene/checks/hygieneChecks.ts`
(`evaluateHygieneIssue`), `views/Hygiene/hygieneFix.ts` + `HygieneFixControl.tsx`,
`views/AdminHub/enterpriseRules.ts`, `services/jiraApi.ts` (`createIssue`, `jiraGet/jiraPost`, createmeta),
`views/JiraTemplateMaker/lib/requiredFields.ts` + `buildCreatePayload.ts`, `views/SprintDashboard/featureReviewFixes.ts`,
`services/confluenceApi.ts` (`fetchConfluencePageByReference`, `resolveConfluencePageIdFromReference`), `xlsx`
(**already a dependency**, dynamic import), the intake dropzone/parse pattern, `components/PrimaryTabs`, the canvas
overlay draft pattern, `hooks/teamScopedStorage.ts`.

**Storage**: `localStorage` only. New keys — `tbxPoToolSelection` (the tool's own team/PI), `tbxPoFeatureSplitDraft:<profileId>:<featureKey>`,
`tbxPoFeatureCompositionDraft:<profileId>:<scopeKey>`. Reads existing keys as a catalog. **No server config, no
server state.**

**Testing**: `vitest` + `@testing-library/react`, tests **co-located** as `X.test.ts(x)` siblings (repo convention,
R9). Unit-first per Article V: pure logic (parsers, ingest, draft normalize, coaching selection, diff builders) is
fully mocked and fast; component tests use `@testing-library/user-event`.

**Target Platform**: The NodeToolbox client (browser), packaged with the Express server. Jira **Cloud and Data
Center** both supported — required because reused write helpers resolve field payload shapes against instance
metadata.

**Project Type**: Client-side view/tool inside an existing web application (React SPA + Express proxy backend).

**Performance Goals**: No measurable initial-load regression (SC-019) — enforced by keeping SheetJS **dynamically
imported**. Draft save is local and synchronous; the workspace must stay responsive with a large pasted page or a
multi-thousand-row workbook (spec edge case).

**Constraints**:

- **Zero regression in Team Dashboard** (FR-004, SC-002) — the single hardest constraint. Mitigated structurally: the
  only shared-file edit is an *optional* prop whose omission yields a byte-identical expression.
- **No Jira write outside an explicit reviewed commit** (FR-014, FR-021, SC-006).
- **No new AI channel; gate is discoverability, not security** (spec A8).
- **Article IX** — no secret is handled; all Jira/Confluence access is via the existing proxy's configured creds.

**Scale/Scope**: One new tool, 4 tabs (2 reused as-is, 2 new), ~4 small edits to existing shared files, 2 new draft
stores, 2 AI contracts. One Feature at a time, single-operator.

## Constitution Check

*GATE: must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Feature branch; PR to main | ✅ `feature/017-po-feature-tools` (see **Branching note**) |
| IV — Code Quality | Verb-first names, `is/has/can` booleans, <40-line fns, doc comments, no magic numbers | ✅ Pure helpers per concern; check ids/link types/keys are named constants; no single-letter names |
| V — Testing | TDD red→green; fast mocked units first | ✅ Layers 2–4 are unit-first; every new pure module has a co-located test written before impl |
| VI — Documentation | CHANGELOG; no ad-hoc docs | ✅ CHANGELOG at Layer 5; artifacts only under `specs/017-*` |
| VII — Framework-First | Reuse, don't rebuild | ✅ **Strongest gate result of the feature** — see note |
| VIII — Release | Local pipeline only | ✅ N/A until release (`local-release.ps1`) |
| IX — Vault | No secrets handled | ✅ No credential enters code/log/conversation; proxy uses existing server creds |
| X — Verification | Evidence, not "it compiles" | ✅ quickstart INV-1…INV-6 + scenario walkthroughs; SC-006 verified by observing **zero** write calls |
| XI — Output Restraint | ≤1 dashboard; no phase narration | ✅ A tool with tabs, not a dashboard artifact |

**Framework-First note** — the gate did real work here and **changed the plan twice**:

1. **File upload (Q3=C)** was specced as the largest new surface. The gate found SheetJS **already bundled**, already
   dynamically imported, plus an existing dropzone and workbook parser. **No new dependency**; the option the
   requester picked now costs near the cheapest option (R5).
2. **Confluence fetch-by-URL** looked like new work. The gate found the fetch **and the URL→pageId parsing** already
   shipped and in use by PI Review (R2a).

The four remaining new items are **documented gaps**, each justified at its component:

| Gap | Why the framework doesn't provide it |
|-----|-------------------------------------|
| HTTP status on Confluence client errors (R2b) | The shared error helper discards `response.status`; FR-023b/SC-018 require 404≠403≠unreachable |
| Client storage-HTML→text util (R2c) | The server's stripper is CommonJS under `src/`, unreachable from the client; no client equivalent exists |
| Client `createIssueLink` (R3) | The client Jira service has no link-create; the body shape ports verbatim from the server's proven impl |
| Export/lift the hygiene field-config loader (R8) | It is private to the Hygiene state hook; duplicating it would reproduce the very client/server drift the spec flags (A7) |

**No Complexity Tracking entry required.**

**Result: PASS.**

### Post-design re-check (after Phase 1)

Re-evaluated against the design artifacts. **Still PASS** — no gate weakened, and two got stronger:

| Article | Post-design finding |
|---------|--------------------|
| IV | The design decomposes into **pure, individually testable** modules (draft normalize, ingest parse, diff build, coaching selection, `ArtTeam` adapter). Every check id, link type, storage key, and `kind` discriminator is a named constant — **no magic strings** reach a call site. |
| V | Strengthened: Layer 1 proves the reuse premise **before** any authoring code, and each tab's **deterministic half ships before its AI half** — so FR-022/SC-005 ("works with no AI") is enforced *structurally*, not just tested. |
| VII | Strengthened: `contracts/tab-reuse.md` **forbids** mounting the Team Dashboard PI Review adapter and **forbids** extracting the shared stylesheet — two "helpful refactor" temptations that would add risk for zero user gain. The four gaps remain the only new code, each ≤ ~20 lines. |
| X | Every SC now has a **named evidence source** in quickstart. The two decisive ones are observational, not assertional: SC-006 = *zero write calls in the Dev Panel API log across a full AI cycle*; SC-019 = *SheetJS absent from the main build chunk*. |
| XI | Artifacts are the spec-tree only; no dashboard, no status docs. |

**One design decision worth flagging** (recorded in research R7, not a violation): the draft store **deliberately
diverges** from the canvas overlay pattern by surfacing a storage-unavailable flag instead of failing silently.
Silence is right for an auto-saved canvas; it is wrong for a multi-day authoring draft, where silent loss is the
exact harm FR-047 exists to prevent. Additive divergence, justified at the component.

**Branching note (Article III + a known local gotcha)**: the current worktree branch (`forge/wt-*`) is stale against
`main` and is rejected by the pre-commit hook. Implementation must branch from an up-to-date `main` as
`feature/017-po-feature-tools`. Spec artifacts are currently uncommitted.

## Project Structure

### Documentation (this feature)

```text
specs/017-po-feature-tools/
├── plan.md · spec.md · research.md · data-model.md · quickstart.md
├── contracts/  (ai-assist-json.md, jira-writes.md, tab-reuse.md)
└── checklists/requirements.md
```

### Source Code (repository root) — planned

```text
client/src/
├── views/
│   ├── PoTool/                                   # NEW — the tool
│   │   ├── PoToolView.tsx  .module.css  .test.tsx        # shell: tab defs + PrimaryTabs + switch
│   │   ├── FeatureSplitterTab.tsx  .module.css  .test.tsx
│   │   ├── FeatureCompositionTab.tsx  .module.css  .test.tsx
│   │   ├── PoTeamSelector.tsx  .test.tsx                 # the tool's OWN team/PI selection (R1)
│   │   ├── poToolArtTeam.ts  .test.ts                    # profile → ArtTeam adapter (R1; ~10 lines)
│   │   ├── hooks/
│   │   │   ├── usePoToolState.ts  .test.ts               # PoToolTab union lives here (R9)
│   │   │   └── usePoHygieneContext.ts  .test.ts          # wires evaluateHygieneIssue (R8)
│   │   ├── coaching/
│   │   │   ├── splitHeuristics.ts  .test.ts              # deterministic; no network, no gate (R10)
│   │   │   └── definitionOfReady.ts  .test.ts
│   │   ├── drafts/
│   │   │   ├── splitDraftStorage.ts  .test.ts            # overlay pattern + availability flag (R7)
│   │   │   ├── compositionDraftStorage.ts  .test.ts
│   │   │   └── draftModel.ts  .test.ts                   # schemaVersion + createEmpty*
│   │   ├── ai/
│   │   │   ├── splitAiAssist.ts  .test.ts                # kind 'featureSplitIngest' (R6)
│   │   │   ├── compositionAiAssist.ts  .test.ts          # kind 'featureCompositionIngest'
│   │   │   └── PoAiPanel.tsx  .test.tsx                  # gate → null when locked
│   │   ├── sources/
│   │   │   ├── sourceModel.ts  .test.ts                  # ReferencedSource union
│   │   │   ├── workbookSource.ts  .test.ts               # dynamic-import xlsx (R5)
│   │   │   └── confluenceSource.ts  .test.ts             # fetchConfluencePageByReference (R2a)
│   │   └── jira/
│   │       ├── buildSplitCommit.ts  .test.ts             # → CommitDiff; pure
│   │       ├── buildCompositionCommit.ts  .test.ts
│   │       └── runCommit.ts  .test.ts                    # per-item outcomes; best-effort links (R3)
│   ├── SprintDashboard/
│   │   └── FeatureReviewTab.tsx                  # EDIT — +1 optional prop (~6 lines) (R1)
│   ├── ArtView/PiReviewTab.tsx                   # UNCHANGED — mounted directly (R1)
│   ├── Hygiene/
│   │   ├── hooks/useHygieneState.ts              # EDIT — lift/export field-config loader (R8)
│   │   └── HygieneFixControl.tsx                 # EDIT — export props interface (R8)
│   └── Home/homeCardData.ts                      # EDIT — APP_CARDS entry + RECENT_VIEW_LABELS (R9)
├── services/
│   ├── jiraApi.ts                                # EDIT — + createIssueLink (~3 lines) (R3)
│   └── confluenceApi.ts                          # EDIT — attach response.status to errors (R2b)
├── utils/
│   └── confluenceStorageText.ts  .test.ts        # NEW — port of stripStorageHtml (R2c)
└── App.tsx                                       # EDIT — route + import (R9)
```

**Structure Decision**: a new `views/PoTool/` following the multi-tab convention (R9) — flat `*Tab.tsx` at the top
level, domain subfolders for pure logic, `hooks/` for hooks, tests **co-located** as siblings, one CSS module per
component, no `lib/` folder. Existing files are touched **only** where research proved a seam is required, and every
such edit is **additive and backward-compatible**.

## Complexity Tracking

> Not required — Constitution Check passes. The four new items are documented Framework-First gaps (see the table
> above), each ≤ ~20 lines and unit-tested. **No new third-party dependency.**

## Phasing & checkpoints

- **Layer 1 — Shell + reused tabs (proves the whole reuse premise).** Register the tool (card, route, recents); build
  the PO Tool's own team/PI selection + `poToolArtTeam.ts`; add the optional `dashboardTeamProfileId?` prop to
  `FeatureReviewTab`; mount `ArtView/PiReviewTab` with `mode="authoring"`; scope the roster store on mount.
  **Checkpoint**: the PO Tool shows Feature Review + PI Review working on a team **chosen independently of Team
  Dashboard**; Team Dashboard's own tabs are **unchanged** (existing tests green, manual parity check);
  `cd client && npx vitest run` + `npx vite build` clean. *This layer is independently shippable and delivers US1.*
- **Layer 2 — The four seams (TDD, no UI).** Confluence error status (R2b); `confluenceStorageText.ts` (R2c);
  `createIssueLink` (R3); lift/export the hygiene field-config loader + export the fix-control props (R8).
  **Checkpoint**: each has a co-located unit test written **first**; all existing Hygiene/Confluence/Jira tests still
  green (these are shared files — regression is the risk being managed).
- **Layer 3 — Feature Splitter.** *3a (deterministic)*: load by key (incl. `issuetype.id` + `project.key`, R4),
  coaching, increment editing, per-increment hygiene, `buildSplitCommit` → diff, `runCommit` (create + best-effort
  link, per-item outcomes), draft store. *3b (gated AI)*: `splitAiAssist.ts` + panel.
  **Checkpoint**: 3a passes quickstart Scenarios B/C/D with the gate **locked** (proves SC-005); INV-1…INV-4 green;
  3b passes Scenario E incl. malformed/wrong-kind replies (SC-009) with **zero** Jira writes observed (SC-006).
- **Layer 4 — Feature Composition.** *4a (deterministic)*: workspace + the three ingestion paths (upload/fetch/paste)
  + Jira keys; DoR coaching; live hygiene checklist; create-vs-update commit incl. required-field pre-flight (FR-034);
  draft store. *4b (gated AI)*: `compositionAiAssist.ts` reusing the panel.
  **Checkpoint**: Scenarios F/G/H; SC-018's four distinct failure messages verified; SC-019 bundle check (SheetJS
  absent from the main chunk).
- **Layer 5 — CHANGELOG + polish.** **Checkpoint**: full quickstart green; both builds clean; CHANGELOG updated.

## Dependencies & sequencing

Layer 1 → Layer 2 → (Layer 3 ∥ Layer 4) → Layer 5.

- **Layer 1 is deliberately first and self-contained**: it proves FR-003/FR-004/FR-005 (the reuse + zero-regression
  claim) before any authoring code exists. If the reuse premise were wrong, it surfaces here — cheaply.
- **Layer 2 gates 3 and 4** (both commits need `createIssueLink`/hygiene config; composition needs the Confluence
  seams), and is where the **shared-file regression risk** concentrates — so it lands isolated, unit-tested, with no
  UI depending on it yet.
- **Layers 3 and 4 are independent** once Layer 2 lands and may be parallelized (Article: multi-agent for 3+
  independent files). Each sub-layer's **deterministic half ships before its AI half**, structurally enforcing
  FR-022/SC-005 — the AI cannot become load-bearing because the tab is already complete without it.
- Every layer is independently testable; Layers 1–3 are independently shippable.
