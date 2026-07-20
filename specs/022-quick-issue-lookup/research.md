# Phase 0 Research: Quick Issue Lookup

All Technical-Context unknowns are resolved below. Format per decision: **Decision / Rationale / Alternatives**.

## 1. Fetch one full issue by key (the single net-new data path)

**Decision**: Add `client/src/services/issueLookup.ts` with a pure `buildIssueLookupPath(key)` and a
`fetchIssueByKey(key)` calling `jiraGet<JiraIssue>`, wrapped by a new `client/src/hooks/useIssueByKey.ts`
(`{ issue, isLoading, error, refetch }`). Request field list:
`summary,status,priority,assignee,issuetype,created,updated,duedate,description,issuelinks,labels,fixVersions,parent,comment`
plus the configured story-point custom field id(s) (`customfield_10016`/`customfield_10028`, reusing the existing
story-point id resolution). No `expand` needed — transitions and comments are fetched separately by the panel
(`fetchFeatureReviewTransitions`, `useIssueComments`).

**Rationale**: This is the one capability the spec flagged as absent. The closest precedent —
`AgileHub/search/useSimpleSearchState.ts` `buildIssueDetailPath` (`DETAIL_FIELDS`) — is a working
"fetch-one-issue-then-show-detail" flow; we mirror it and widen the field list to what `IssueDetailPanel` renders.
`jiraGet` already routes through the `/jira-proxy` base with instance auth, so no new transport.

**Alternatives**: (a) `useJiraFetch` directly in the component — rejected: the normalize + refetch-after-edit logic
belongs in a dedicated hook, and a pure path builder is unit-testable red-first. (b) JQL `search` for one key —
rejected: heavier and returns an array; a direct issue GET is the correct primitive.

## 2. Issue-key normalization (search-bar tolerance, FR-003)

**Decision**: A pure `normalizeIssueKey(raw)` returning `{ key: string | null }`: trim, collapse internal whitespace,
upper-case, and if the input contains `/browse/<KEY>` (a pasted Jira URL) extract the key; then validate against the
Jira key shape `^[A-Z][A-Z0-9]+-\d+$`. Non-matching input yields `key: null` so the UI shows the inline "Enter an
issue key like ABC-123" hint **before** any fetch (FR-012).

**Rationale**: Pure, exhaustively unit-testable, and keeps all tolerance rules in one place. Extracting-from-URL is
the highest-value "dead simple" affordance (paste a link, it just works).

**Alternatives**: Free-text/JQL fallback when the shape fails — rejected: out of scope (spec: key lookup only); a
clear hint is more honest than a surprise result list.

## 3. Recents persistence — localStorage vs sessionStorage

**Decision**: `localStorage` key `tbxRecentIssueKeys`, cap 5, storing `{ key, summary }` entries, most-recent-first
with de-dupe (a re-viewed key moves to top). Client-only; never sent to the server.

**Rationale**: The spec clarification said "ephemeral to the client, not synced." The load-bearing word is
**not synced** (no server/durable record); "ephemeral" is honored by it being a disposable convenience list, capped
and client-local. localStorage matches the app's *only* existing recents precedent — `settingsStore.recentViews`
(`tbxRecentViews`, `buildRecentViews` + `slice(0, 5)`) — and lets today's recents survive a page reload, which is
where the "re-open what I touched" value actually lands. All persistence in this app is hand-rolled `try/catch` around
`window.localStorage`; we follow that, not zustand `persist`.

**Alternatives**: sessionStorage (dies with the tab, `aiAssistStore` precedent) — rejected: a reload wiping recents
guts the feature's stickiness with no privacy gain over localStorage for non-sensitive issue keys. In-memory only —
rejected: same reload problem, and no precedent.

## 4. Where editing lives — extend `IssueDetailPanel` + new `IssueFieldEditors` (the recorded Art VII drift)

**Decision**: Build a small reusable `IssueFieldEditors/` control family (Text, Select, Assignee, Labels) whose every
write delegates to the existing `featureReviewFixes.ts` writers, and add an **optional, default-off** `fieldEditing`
capability to `IssueDetailPanel` that renders those editors beside the currently-read-only fields. QuickLookup passes
the capability; every existing caller omits it and stays byte-identical.

**Rationale**: The writers already exist but their editor UI is trapped inside `FeatureReviewQuickFixPanel` (private
`render*` helpers in `FeatureReviewTab.tsx`, not importable), and `IssueDetailPanel` today has no edit hook. Feature
021's `ReadinessFixControl` set the precedent for exactly this: new control shape, all writes delegate. Extracting the
FeatureReview editors instead would mean refactoring a shipped, heavily-used tab — regression risk that outweighs the
reuse benefit right now (017's "don't refactor merged surfaces" lesson). The optional-capability approach mirrors
017's `dashboardTeamProfileId?` optional prop ("omitted ⇒ byte-identical").

**Alternatives**: (a) Refactor FeatureReview's editors into the shared module now and retrofit both surfaces — the
architecturally purest route, but rejected for this feature to avoid destabilizing a shipped tab; explicitly left as a
future follow-up (the new module is deliberately placed to become that shared home). (b) Give QuickLookup its own full
detail layout instead of reusing `IssueDetailPanel` — rejected: duplicates links/labels/description/comments, a far
larger Art VII breach.

## 5. Editable field set precision (FR-008/009) — what actually gets a writer

**Decision**: Editable = fields with a proven `featureReviewFixes.ts` writer: **summary** (simple field),
**assignee** (user field), **priority** and other single-select **option fields** (editmeta options), **status**
(existing transition editor + `TransitionRequiredFields`), **story points** (existing panel editor), **fix versions**,
**issue links** (free-text key). **Labels** are editable via an editmeta `set` on the labels array through
`saveFeatureReviewSimpleField`; **if the issue's editmeta does not expose labels as settable, labels degrade to
read-only** (still visible). **Description** is read-only (clarified — avoids flattening wiki formatting). Everything
else defers to Jira via the key link.

**Rationale**: Honors the spec's "edit what we can safely write"; keeps every write on the single existing writer
path; the labels fallback keeps the feature honest rather than shipping a write that might silently drop formatting or
fail. Editmeta already tells us per-issue what is settable, so the editable set is data-driven, not hard-coded.

**Alternatives**: Force a bespoke labels writer regardless of editmeta — rejected: adds a second write path outside
the delegation rule; the read-only fallback is safer and matches the spec boundary.

## 6. F2 binding, `preventDefault`, and the keyboard guard (FR-001, NFR-005)

**Decision**: `QuickIssueLookupGate` mounts once in `App.tsx` (sibling to `<TodoQuickAddGate/>`) and attaches a
`window` `keydown` listener; on `F2` it `preventDefault()`s (F2 is the browser rename/rename-cell shortcut in some
contexts) and toggles the popup. The global handler ignores the event when `document.activeElement` is a text
input/textarea/contenteditable **outside** the popup (keyboard-guard). Inside the open popup, F2 re-focuses/clears the
search bar rather than stacking a second instance. Escape closes.

**Rationale**: F2 is confirmed unbound (F1 = TodoQuickAdd, Ctrl+Alt+Z = AI assist). The root-gate pattern is the
established way this app adds a global hotkey+modal; cloning `TodoQuickAdd` (which already `preventDefault`s F1 and
renders `role="dialog" aria-modal="true"`) gives us focus-trap and a11y for free.

**Alternatives**: A central hotkey registry — rejected: none exists; introducing one is out of scope and Article XI
restraint favors following the existing per-gate pattern.

## 7. PI / sprint / feature-link population in the QuickLookup context

**Decision**: QuickLookup passes the panel the fields it can read off the fetched issue; PI, sprint name, and
feature-link key — which `IssueDetailPanel` takes as **host-resolved props** (not first-class on `JiraIssue`) — are
populated best-effort from configured custom-field ids when available, and omitted otherwise (the panel already omits
empty blocks). No new resolver is built for MVP.

**Rationale**: Those props exist because different hosts resolve PI/sprint differently; QuickLookup has no team
context, so best-effort-or-omit is the honest behavior and avoids inventing a resolver. Omit-when-empty is already the
panel's contract.

**Alternatives**: Build a full PI/sprint resolver for arbitrary issues — rejected: scope creep; the deep-link covers
anyone who needs that context in Jira.

## Resolved unknowns summary

| Unknown | Resolution |
|---------|------------|
| Fetch one issue by key | New `issueLookup.ts` + `useIssueByKey` (mirror `buildIssueDetailPath`) |
| Key normalization | Pure `normalizeIssueKey` (trim/upper/URL-extract/shape-validate) |
| Recents storage | localStorage `tbxRecentIssueKeys`, cap 5, dedupe — clone `settingsStore` recents |
| Editing home | Extend `IssueDetailPanel` (optional default-off capability) + new `IssueFieldEditors` |
| Editor reuse | New control-shape family; all writes delegate to `featureReviewFixes.ts` (021 precedent) |
| Editable set / labels | Writer-backed fields; labels via editmeta set, read-only fallback; description read-only |
| F2 + guard | Root-gate clone of TodoQuickAdd; preventDefault; ignore when typing outside popup |
| PI/sprint/feature-link | Best-effort from configured field ids, else omit |

No `NEEDS CLARIFICATION` markers remain.
