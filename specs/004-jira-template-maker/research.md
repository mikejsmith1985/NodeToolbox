# Research — Jira Template Maker (Phase 0)

Resolves the Technical Context unknowns and records the framework-first gate. Each decision
is grounded in the existing codebase (file paths cited).

## D1 — Target Jira flavor & text format *(was NEEDS CLARIFICATION)*

**Finding**: The configured **default** Jira base URL in `src/config/loader.js:225` is a Jira
**Server/Data Center** host (`https://jira.healthspring-jira-prod.aws.zilverton.com`), and the
proxy prefers **PAT/Bearer** auth (`src/utils/httpClient.js:42`). Confluence, by contrast, is
Cloud (`https://zilverton.atlassian.net`, `loader.js:248`). So the spec's "Jira Cloud"
assumption (which justified rejecting the prefill URL) was **incorrect about Jira**.

**Decision**: Treat the target as **Jira Server/DC** for v1: use the classic
`/rest/api/2/issue/createmeta?projectKeys=...&expand=projects.issuetypes.fields` endpoint, and
serialize rich text as **Jira wiki markup**. Keep text serialization behind `lib/wikiMarkup.ts`
so an ADF emitter can be added if the instance is Cloud.

**Impact on Q1 (creation mechanism)**: The Q1=A **direct create** decision is unchanged and
correct — it works on both Server/DC and Cloud, supports all field types, allows label dedupe,
and is genuinely single-click. The prefill URL would *also* work on Server/DC, but direct
create remains superior (rich text, dropdown/custom fields, label dedupe, no manual Create
click). Only the *rationale* in the spec ("because Cloud") is corrected here.

**Rationale**: Config is the strongest available evidence of the live target; createmeta-classic
+ wiki markup is the correct Server/DC contract.

**Alternatives considered**: (a) Assume Cloud + ADF — contradicts config; risks wrong text
format. (b) Auto-detect flavor at runtime from the base URL — deferred; adds complexity not
needed for v1, and the abstraction seam (`lib/wikiMarkup.ts`) makes a later switch cheap.

**✅ CONFIRMED (2026-06-30)**: The user confirmed the live Jira target is **Server/Data
Center**. v1 therefore uses the classic `createmeta` endpoint and **wiki-markup** text fields.
The ADF/Cloud path is not built; the `lib/wikiMarkup.ts` seam remains so it can be added later
if an instance migrates to Cloud. No longer an open item.

## D2 — Jira reads & issue creation transport

**Decision**: Perform all Jira metadata reads and the issue create **client-side** through the
existing `/jira-proxy/*` route using `jiraGet`/`jiraPost` (`client/src/services/jiraApi.ts:118,128`).

**Rationale**: This is the established pattern for UI-driven Jira work (JiraProjectPicker,
IssueDetailPanel, ArtView all call `jiraApi` directly). The proxy injects auth server-side
(`proxyRequest`, `httpClient.js:80`) and already re-serializes POST bodies (`:149-153`), so a
bare `POST /rest/api/2/issue` works through the existing path with no server change.

**Gap (must build)**: There is **no createmeta code and no bare issue-create call** anywhere
today (confirmed by repo-wide grep). New typed wrappers `getCreateMeta` and `createIssue` go in
`jiraApi.ts`; new types in `types/jira.ts`. Existing `/rest/api/2/issue/...` calls are all
sub-resources (transitions/comments/worklog), not creation.

**Alternatives considered**: Server-side via `makeJiraApiRequest` (`httpClient.js:235`, used by
schedulers). Rejected — it is for background, headless flows; a UI feature should use the same
client proxy pattern as its sibling views, keeping the server untouched.

## D3 — Createmeta as the constraint source

**Decision**: Drive every picker and value control from a single createmeta call per
project+issuetype: issue types (`projects[].issuetypes[]`), fields
(`...issuetypes[].fields`), required flags (`fields[].required`), and dropdown options
(`fields[].allowedValues`).

**Rationale**: One authoritative live source satisfies FR-1/FR-2/FR-7 (only-valid choices, real
options, no hard-coded lists) and SC-2/SC-4 (valid-first-time, 0 invalid options). Mirrors the
SnowHub `useSnowChoiceOptions` pattern (runtime-resolved options) but sourced from Jira.

**Alternatives considered**: Global `/rest/api/2/field` (what `JiraFieldPicker` uses) — rejected:
it is not project/issuetype-scoped and omits `allowedValues`, so it cannot constrain choices.

## D4 — Supported field-type set (Q1=B) & the unsupported gate

**Decision**: v1 supports the field `schema.type`/`custom` values for: string/text (summary,
description, free-text), single & multi `option` (dropdowns), `array` of `option`, `labels`,
`user` (assignee/reporter), `date`/`datetime`, `number`, `components` (`array` of component),
and `version`/`array` of version (fix versions). Anything else — notably cascading/dependent
selects (`option-with-child`) and unknown custom types — is rendered in the field picker as
**unsupported** (visible, not addable) per the spec.

**Rationale**: Matches the resolved Q1=B scope; the explicit gate keeps the UI honest (FR-2.1)
rather than silently hiding fields.

**Alternatives considered**: Support everything (rejected for v1 — cascading selects need
dependent-option loading and a bespoke control). Minimal set (rejected — excludes people/dates
that real templates need).

## D5 — Rich-text editor (core formatting) — framework-first

**Decision**: Build a **minimal in-house editor** (`WikiMarkupEditor.tsx` + pure
`lib/wikiMarkup.ts`) covering bold, italic, headings, bullet/numbered lists, links, inline
code, and code blocks (Q3=A), emitting **Jira wiki markup**.

**Rationale**: Article VII — adding a heavyweight rich-text dependency (e.g. ProseMirror/TipTap)
for a bounded, well-defined markup target is unjustified. Core formatting maps to a small,
testable set of wiki-markup tokens. Serialization is pure → unit-testable.

**Alternatives considered**: (a) Full editor library — rejected (heavy dependency, Article VII).
(b) Plain textarea of raw wiki markup — rejected (fails the "same formatting as editing in Jira"
intent for non-technical users). (c) ADF builder — deferred to the Cloud path (D1).

## D6 — Template persistence: new content-property key

**Decision**: Persist the shared template library as a JSON document under a **new Confluence
content-property key `nodetoolbox-jira-templates`** on the **existing shared ART database id**,
via `fetchConfluenceDatabasePropertyByKey`/`upsertConfluenceDatabaseProperty`
(`confluenceApi.ts:256,276`), wrapped by new `loadJiraTemplates`/`saveJiraTemplates`.

**Rationale**: The "Shared ART Workspace" is not a real table — it is one JSON blob per
content-property key on a Confluence Database used purely as an anchor. A **separate key**
gives global sharing and reuses all existing plumbing **without** bumping
`SHARED_ART_WORKSPACE_SCHEMA_VERSION` (which `loadSharedArtWorkspace` hard-rejects on mismatch,
`confluenceApi.ts:323` — bumping it would break deployed clients).

**Alternatives considered**: (a) Add a `templates[]` field to the ART payload — rejected
(couples lifecycles; forces a schema-version bump that breaks old clients). (b) A brand-new
Confluence Database — rejected for v1 (more setup; needs its own configured id; the locked ART
id `684163133` is already available and globally shared).

**Concurrency**: Replicate the ART **3-way merge** approach (`mergeSharedArtWorkspacePayload`,
ArtView `:3263`) keyed by template id: load remote → merge against a local base snapshot →
upsert with `version.number+1`. Without it, two concurrent editors last-writer-win.

**Size limit**: Confluence content-property values have a practical ceiling (~hundreds of KB).
A large library in one blob can hit it; if it grows, shard across keyed pages. `log()`/surface
a clear message rather than silently truncating. Documented as a known limit for v1.

## D7 — Reuse inventory (framework-first gate result)

**Reused as-is / light wrap**:
- Proxy routes `/jira-proxy/*`, `/confluence-proxy/*` (`src/routes/proxy.js`) — no change.
- `jiraApi.ts` `jiraGet`/`jiraPost`; `confluenceApi.ts` content-property primitives.
- `JiraProjectPicker` (`client/src/components/JiraProjectPicker/`) for the project step.
- CRG wizard UX: `CreateChgTab.tsx` step shell + `useCrgState.ts` step-state machine;
  `useSnowChoiceOptions`/`SnowLookupField` allowed-option pattern; `useCrgTemplates` saved-
  template ergonomics (persistence differs — Confluence store, not CRG's).

**Newly built (documented gaps)**: createmeta types + wrappers; issue-type picker;
project+issuetype-scoped field picker with allowed options; type-aware value inputs;
case-sensitive label dedupe; wiki-markup editor; bare `createIssue` call; the
`loadJiraTemplates`/`saveJiraTemplates` store wrappers + merge.

## D8 — Author identity source *(resolves analysis finding AM1)*

**Decision**: Record `JiraTemplate.authorName` from the current Jira user's display name via
`GET /rest/api/2/myself` (through the existing `/jira-proxy`), the same identity source
NodeToolbox already uses for mention-state. If the lookup fails, store `unknown` and still save.

**Rationale**: The browser has no independent user identity (proxy credentials are shared), so
`myself` is the only reliable per-user signal. Non-blocking on save keeps the tool usable when
the call fails.

**Alternatives considered**: No author (rejected — FR-4.3 wants attribution on a shared
library); a free-typed author name (rejected — unreliable, spoofable).

## Open items

- None. D1 (Jira flavor) confirmed **Server/DC**; D8 (author source) resolved.
