# Phase 0 Research: PO Tool — Feature Splitter & Feature Composition

**Feature**: `017-po-feature-tools` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

Purpose: resolve every technical unknown before design. Each item is **Decision / Rationale / Alternatives**.
Headline: **this feature is overwhelmingly reuse.** The four genuinely new pieces are small and named in R2b, R3,
R8, and R10.

---

## R1 — Independent team/PI selection: what does FR-005/FR-005a/FR-005c actually cost?

**This was the spec's flagged schedule risk. It is materially smaller than assumed — assumption A2 was corrected.**

**Decision**:

1. The PO Tool holds **its own** selected team-profile id in its own state + its own localStorage key. It **never**
   calls `setSprintDashboardActiveTeamProfileId`.
2. Mount **`views/ArtView/PiReviewTab.tsx` directly** — **not** `SprintDashboardPiReviewTab.tsx`.
3. `FeatureReviewTab` gains **one optional prop**, `dashboardTeamProfileId?: string`, resolved `?? activeId`.
4. Build the `ArtTeam` the PI Review engine wants from the PO Tool's own profile (`sprintIssues: []`).
5. Scope `useStandupRosterStore` on PO Tool mount so PI Review's "Pull Features" PO filter is right.

**Rationale**:

- `sprintDashboardTeamProfiles` is a **read-only catalog** — every field the tabs need (`boardId`, `boardName`,
  `projectKey`, `selectedPiValue`, `piReviewPages`) lives on the profile. Only the *active id* is a singleton. So a
  tool that tracks its own id has **zero contention** with Team Dashboard.
- `FeatureReviewTab` has exactly **one** team-scoped implicit input — the profile id. Its two store reads resolve the
  *same* profile, and `loadDashboardConfigFromStorage(id)` already takes the id as an **argument**. Hence ~6 lines,
  one file. With the prop omitted the expression is identical, so Team Dashboard's call site needs **no edit** and
  cannot regress (FR-004, FR-005b, SC-002).
- `ArtView/PiReviewTab` needs **zero** changes: its contract is already `{selectedPiName, teams, mode?,
  teamCapacitySummaries?}`, it is already consumed by two tools, and its one write to the app-wide active id is
  behind the **non-authoring** branch the PO Tool never renders (`mode="authoring"`). Spec A3 is confirmed correct.
- **The capacity-store singleton is a non-issue** (correcting the spec's original A2 worry), for four independent
  reasons: (a) neither mounted component touches it — it is reachable only via the Team Dashboard *adapter*;
  (b) routing is a flat `<Routes>`, so one view renders per context; (c) separate browser tabs are separate module
  instances and there is **no `storage` listener** in the repo; (d) its keys are already team-scoped, so a collision
  requires both tools on the *same* team, which is the same data by design.
- The **prop-else-store idiom already ships in the same folder** (`StandupTab.tsx` takes exactly this optional
  `dashboardTeamProfileId?` and resolves it against the profile catalog). This is a known-good pattern, not novel.

**Alternatives considered**:

- *Reuse `SprintDashboardPiReviewTab`* — **rejected**. It hardwires the active profile and drags in the capacity
  store, Capacity tab, risk, and remap panels — all Team-Dashboard execution concerns. It is the **only** path on
  which the capacity singleton would matter. Writing a ~10-line PO-Tool adapter instead is both smaller and cleaner.
- *Share the selection (Q1=B)* — rejected by the requester; would make the tools fight over one value.
- *Lift the active id into a generic per-tool context* — rejected as over-engineering for two consumers; the optional
  prop achieves FR-005 with no architectural change.
- *Extract `FeatureReviewTab.module.css` out of `SprintDashboardView.module.css`* — **rejected**. CSS Modules are
  hashed class maps; a cross-folder import costs nothing at runtime. Extracting is a pure refactor with real
  regression risk in a 3,700-line stylesheet, for zero user-visible gain.

**Residual risk (noted, not blocking)**: the team-scoped storage helper runs a one-time legacy migration that fires
only before any scoped key exists. A PO Tool reading a *different* profile first could theoretically win that race.
Requires a never-migrated user opening the PO Tool before Team Dashboard. Accepted; noted in quickstart.

---

## R2 — Confluence page fetch by URL (FR-023b)

### R2a — Fetch and URL parsing: **EXISTS, reuse as-is**

**Decision**: reuse `fetchConfluencePageByReference(pageReference)` from the existing client Confluence service; read
`page.body.storage.value` / `page.title` / `page.version.number`.

**Rationale**: URL→pageId parsing **already exists** and already handles all three forms the PO will paste — a bare
numeric id, a `?pageId=` query param, and a pretty `/pages/12345/Title` path — returning `null` otherwise. PI Review
uses exactly this today. The client talks to a transparent `/confluence-proxy` pipe using server-configured
credentials, so **no new credential and no browser OAuth** is introduced (Article IX; spec A15).

**Alternatives**: writing new URL parsing (rejected — duplicate); server-side fetch (rejected — the client path
already exists and is proven).

**Envelope trap to avoid** (documented so implementation doesn't trip): the **client** receives raw Confluence JSON
(`page.body.storage.value`), while the **server** helper wraps in `{status, body}` (`result.body.body.storage.value`).
This feature is client-side; use the client shape.

### R2b — Distinguishing 404 / 403 / unreachable: **PARTIAL → small extension (NEW WORK #1)**

**Decision**: extend the client Confluence service's error path to **attach `response.status`** to the thrown error,
then branch on it in the new tab.

**Rationale**: FR-023b **requires** not-found / permission / unreachable to be reported distinctly, and SC-018 tests
it. Today the shared error helper collapses every status into one `Error` and **discards** `response.status`;
network/DNS failures surface as a proxy 502 with only a DNS special-case. So the requirement cannot be met by reuse
alone. The change is additive (attach a field; existing consumers keep reading `.message` unchanged).

**Alternatives**: string-matching the message (rejected — brittle); leaving them merged (rejected — violates FR-023b
and the project's "an empty result may be a VPN failure, never render it as no-data" lesson).

### R2c — Storage-format HTML → readable text: **ABSENT client-side → port (NEW WORK #2)**

**Decision**: port the server's `stripStorageHtml` into a small, unit-tested client util.

**Rationale**: the server has a working stripper (`<br>`→newline, block closes→newline, tag strip, entity decode) but
it is CommonJS under `src/` and **not importable from the React client**. The client has no equivalent — its only
Confluence parsers are PI-Review-table-specific. A pure port is ~20 lines, trivially testable, and keeps the PO Tool
free of `dangerouslySetInnerHTML`.

**Alternatives**: request `body.view` and inject the returned HTML (rejected — `dangerouslySetInnerHTML` on remote
content with no sanitizer in the repo is an XSS surface for zero benefit — the workspace only needs readable
reference text); a sanitizer dependency (rejected — Framework-First: new dep for a 20-line need).

---

## R3 — Jira issue links for split→original (FR-016a)

**Decision**: **CREATE = NEW WORK #3** — add a ~3-line `createIssueLink` to the client Jira service over the existing
`jiraPost`, porting the body shape verbatim from the server's proven implementation:
`{ type: {name}, inwardIssue: {key}, outwardIssue: {key} }` → `POST /rest/api/2/issueLink`.
**Links are best-effort**: a link failure is reported, never thrown, so it cannot orphan an already-created issue.
**READ = reuse.** Offer the link type via **live discovery** (`GET /rest/api/2/issueLinkType`), defaulting to
`'relates to'`.

**Rationale**: the client service has no link-create today, but the server's sprint-release orchestrator does exactly
this — create-then-link — and deliberately swallows link errors so a failed link cannot undo a successful create.
That is precisely the FR-015 per-item-outcome semantic. Link **types must not be hard-coded**: the repo already
discovers them live and persists a configured set, and instances differ (FR-037).

**Alternatives**: hard-code `'relates to'` (rejected — FR-037: only offer what the instance reports); make links
atomic with the create (rejected — Jira has no transaction; a thrown link error would strand a created issue with no
record, the exact failure the server precedent avoids); a Jira "split" API (does not exist).

---

## R4 — Issue type for split increments (FR-016, A17)

**Decision**: read the source Feature's **own** `issuetype.id` **and** `project.key` in one call
(`GET /rest/api/2/issue/{key}?fields=project,issuetype,...`), then create increments with
`{project: {key}, issuetype: {id}}`.

**Rationale**: spec A17 — the hygiene engine treats several types as Feature-like and instances differ, so "Feature"
must never be hard-coded. No new endpoint is needed: the issue GET already returns `{id, name}` for `issuetype`; the
client simply hasn't kept the `id` before. Fetching `project` in the same call matters because required-field
discovery is keyed by **project key** — getting both at once avoids a second round-trip (FR-034).

**Alternatives**: create by type **name** (rejected — the create payload convention in this repo is id-based, and
names are not unique across schemes); a fixed "Feature" type (rejected — A17/FR-037); ask the PO every time
(rejected — the answer is knowable; offer an override instead).

---

## R5 — Spreadsheet upload (FR-023a) — Framework-First gate

**Decision**: **no new dependency.** Reuse the already-bundled SheetJS via the established **dynamic import**, and
mirror the existing intake importer's dropzone + `File`→workbook→header-keyed-rows parser with its typed,
user-facing error class.

**Rationale**: this was the spec's largest perceived scope lever (Q3=C) and the Framework-First gate collapsed it.
SheetJS already ships as a client dependency and is **already dynamically imported in three places specifically to
keep it out of the main bundle** — matching that keeps SC-019 (no load-time regression) true by construction. A
working `.xlsx/.xls/.csv` dropzone and a parse-with-clear-errors helper already exist with tests.

**Decision on reuse mechanics**: **do not** move or generalize the existing intake components in this feature.
Import the parse helper if it is import-clean; otherwise mirror the ~30-line pattern locally. Rationale: the intake
dropzone's copy and preferred-sheet logic are intake-specific, and refactoring a shipped importer to serve a new tab
adds regression risk to an unrelated tool for no user gain. Revisit extraction if a third consumer appears.

**Alternatives**: a new spreadsheet lib (rejected — Article VII: the capability exists); static import (rejected —
would pull a large parser into the main bundle, breaking SC-019); server-side parsing (rejected — no benefit; the
file is reference material, not data to persist).

**Consequence for scope**: `.xlsx` upload is now closer in cost to the paste-only option than to a new subsystem.

---

## R6 — AI round-trip: which validation idiom? (FR-018, FR-020, FR-032)

**Decision**: reuse the shared JSON-payload extractor, and adopt the **partial-success** ingest idiom — return
`{items, errors}`, never throw on business-invalid content — for **both** new surfaces. Use a **fixed `kind`
discriminator per surface** (`featureSplitIngest`, `featureCompositionIngest`), rejected outright on mismatch.
Ingested items land **`accepted: false`**; unknown Jira keys are **filtered in the UI** against live data and
reported, not silently dropped.

**Rationale**: the repo has **two** ingest idioms — a strict all-or-nothing parser that throws on the first bad item,
and a lenient collector that returns per-item error strings while keeping the good ones. For this feature the
collector is correct: a split proposes a **batch** of increments, and a PO must not lose four good ones to one bad
field (FR-020's "individually acceptable" implies per-item survival). The extractor already tolerates assistant prose
and code fences (FR-018/SC-009). The `kind` guard is what stops a stray payload from another surface being misread
(SC-009) — the existing planner ingest documents this as its explicit purpose.

**Decision on prompt shape**: embed the response schema **inline in the prompt** and **whitelist** valid values
verbatim (the planner prompt's "copy them verbatim … do not invent" construction), listing e.g. allowed project keys
and the hygiene-required field names (FR-033).

**Alternatives**: the strict throw-all idiom (rejected — hostile for batch proposals); a shared generic ingest
framework (rejected — Article VII/YAGNI: two call sites, and the existing pattern is ~100 lines of copy);
free-text/`KEY: value` parsing (rejected — the older format; JSON+discriminator is the modern, safer one).

**Contract note**: existing prompts are inconsistent — some kinds use `rationale`, others `reason`. The new contract
**pins `rationale`** for both surfaces and says so explicitly.

**Gate mechanics**: read the unlock **store** directly (`isAiAssistUnlocked`) and return `null` when locked — the
established panel pattern. Do **not** reuse the SnowHub gate hook: its `buildPrompt` is change-request-shaped and its
surface field is named differently. Reuse it only if `verifyPassphrase` is needed (it isn't — the app-root gate owns
unlocking).

---

## R7 — Draft persistence (FR-042…FR-048)

**Decision**: mirror the canvas overlay storage pattern exactly — a self-describing draft object carrying its own
`profileId`/`scopeKey`; key = `<base>:<profileId>:<scopeKey>`; a `canUseLocalStorage()` guard; **load never throws**
(bad JSON / wrong shape → empty draft); **save silently no-ops** when storage is blocked, with the in-memory copy
authoritative for the session; a `schemaVersion` stamped on write; **normalize-on-read** with field-by-field
defaulting; and identity taken from the **arguments**, not the payload, so a mis-filed entry self-corrects.

Scope keys (FR-043): split draft → `<profileId>:<sourceFeatureKey>`; composition draft → `<profileId>:<jiraKey>` for
an existing Feature, else a stable id minted per new-composition.

**Rationale**: this is a direct match for FR-046 (self-heal), FR-047 (degrade + warn), and FR-043 (scoping); the
pattern is proven for the same problem (uncommitted work that later commits to Jira). Empty-value-removes-the-entry
(from the sibling details store) gives FR-048 discard for free.

**Deviation, deliberate**: FR-047 requires **warning** the PO when persistence is unavailable. The existing pattern
fails **silently** — correct for an auto-saved canvas overlay, wrong for a multi-day authoring draft where silent
loss is the harm the requirement exists to prevent. So the new store surfaces an availability flag to the tab. This
is an additive divergence, not a rewrite.

**Alternatives**: zustand `persist` middleware (rejected — not the house pattern here; these stores hand-roll
persistence precisely to control scoping/heal/no-op); IndexedDB (rejected — no precedent in the repo, drafts are
small); server-side drafts (rejected — spec A4 and out of scope; server stores exist but for settings/state, not WIP).

**Known inconsistency inherited**: the `canUseLocalStorage` guard is duplicated across modules with slightly
different bodies and no shared util. This feature adds a third local copy rather than refactoring two shipped stores
— noted, not fixed (Article VI: don't widen scope silently).

---

## R8 — Hygiene reuse (FR-012, FR-027, FR-028, FR-039)

**Decision**: call the existing `evaluateHygieneIssue(issue, context)` and reuse the existing rules, labels, and
`HygieneFixControl` unchanged. **NEW WORK #4**: the real, Jira-name-resolved field-config loader is currently
**private** to the Hygiene state hook — **export/lift it** into a shared module so a new tab can obtain a real config
without duplicating it.

**Rationale**: the evaluator is already a pure, defaulted, `[]`-returning function over a structural issue shape that
real Jira responses satisfy; its context carries exactly what FR-027/FR-028 need. **FR-028 (skip unconfigured
fields) is already the engine's behavior** — checks whose field list is empty are skipped — so the requirement is
satisfied by correct wiring, not new logic. The rules-vs-fields split must be respected: the enterprise-standards
store holds *which checks are on* + custom rules; the field config is resolved separately from live Jira field names.
Re-implementing that loader would create exactly the client/server-style drift the spec calls out (A7).

**Alternatives**: mounting the whole Hygiene state hook to steal its config (rejected — drags in a full search/scan
lifecycle); duplicating the loader (rejected — guaranteed drift); hard-coding default field ids (rejected — FR-028
false-flags on any instance with different customfields).

**Reuse caveats to handle in design**: the fix control's props interface is unexported (export it to wrap), and it
carries the Hygiene stylesheet. Both are trivial.

**Note on the evaluator's issue shape**: it is a *local structural* type with an index signature, not the shared Jira
type — pass the raw issue; it structurally satisfies it. `self` must be requested for the Open-in-Jira fallback.

---

## R9 — Folder & tab conventions

**Decision**: `client/src/views/PoTool/` with a flat tab layout — `PoToolView.tsx` (shell: tab defs + shared tab bar +
`activeTab` switch) and one `*Tab.tsx` per tab at the top level, each with a co-located `.module.css` and
`.test.tsx`; domain subfolders (`ai/`, `coaching/`, `drafts/`, `jira/`) for pure logic; `hooks/` for hooks. The tab-key
union lives with the state hook.

**Rationale**: this mirrors the existing multi-tab tools exactly. Rules that hold repo-wide: tests are **always
co-located siblings** (no `__tests__/`), there is **no `lib/`** folder, pure logic is flat camelCase `.ts` or a domain
subfolder, and one CSS module per component. Tab chrome comes free from the shared generic tab-bar component (which
generates `${idPrefix}-${key}-tab|panel` ids — the panel wrapper must match for a11y).

**Registration** (FR-001): four touch points, no single registry — the app-card catalog (which transitively powers
Home rendering, the recents strip, and Admin Hub tool-visibility **for free**, satisfying FR-001), a route + import,
a recents label, and optionally the Personal Toolbox module map.

**Alternatives**: a `tabs/` subfolder (rejected — no precedent); adding the tabs to Team Dashboard instead (rejected —
spec's core rationale; that view is already a ~7,300-line monolith).

---

## R10 — Coaching content (FR-010, FR-026)

**Decision**: authored, deterministic constants in the tool's `coaching/` folder — split heuristics (by workflow
step, business rule, data variation, happy-path-first, CRUD, effort-vs-value) and DoR guidance — rendered as static
guidance with **no** network call and **no** gate (FR-011/FR-029: advisory, never blocking).

**Rationale**: spec A12. Deterministic content needs no infrastructure; keeping it as named constants makes it
testable and reviewable.

**Alternatives**: fetching from Confluence (rejected — a network dependency for static text, breaks SC-013);
generating it via AI (rejected — FR-010 requires it without an unlock).

---

## Summary — what is actually new

| # | New work | Size | Why it can't be reuse |
|---|----------|------|----------------------|
| 1 | Attach HTTP status to Confluence client errors | ~5 lines + tests | FR-023b/SC-018 need 404≠403≠unreachable; status is currently discarded |
| 2 | Client-side storage-HTML → text util (port) | ~20 lines + tests | Server's version is CommonJS, unreachable from the client; no client equivalent |
| 3 | Client `createIssueLink` wrapper | ~3 lines + tests | Client Jira service has no link-create; body shape ports verbatim from the server |
| 4 | Export/lift the hygiene field-config loader | move + export | Currently private; duplicating it would guarantee drift (A7) |
| — | The two authoring tabs + PO Tool shell | the real build | The documented gap this feature exists to fill |

Everything else — the AI gate, the JSON extractor + ingest idiom, the hygiene engine and fix control, the draft
storage pattern, the Jira proxy/create/required-field pre-flight, createmeta discovery, the Confluence
fetch-by-URL + URL parsing, the spreadsheet parser and dropzone, the tab chrome, and both reused tabs — is reuse.

**No new third-party dependency is introduced.**
