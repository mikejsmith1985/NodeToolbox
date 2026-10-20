# Research: SNow Hub Wizard (Standalone)

## R-001 — Reaching ServiceNow and Jira with no server (THE gate)

**Facts found**
- CHANGELOG ("HTTP relay bridge for Chrome (COOP fix)"): Chrome enforces `Cross-Origin-Opener-Policy: same-origin` on
  ServiceNow (and on Jira *Cloud*), which nulls `window.opener` and severs `postMessage`. Toolbox's old `file://` +
  postMessage relay survives only where COOP is relaxed by Edge group policy.
- `services/browserRelay.ts`: the bookmark runs API calls inside the logged-in tab using cookies + `g_ck`; it already
  knows how to resolve the token.
- Our Jira is **Data Center 9**, not Cloud — whether it sends COOP is unknown.
- No browser primitive carries messages between two different origins without an opener reference or a server
  (BroadcastChannel / storage / SharedWorker are same-origin only). Embedding via iframe is normally blocked by
  `X-Frame-Options`.

**Candidates**

| ID | Mechanism | ServiceNow | Jira | Needs |
|---|---|---|---|---|
| T1 | **Host in SNow origin**: bookmark on a SNow tab opens a `blob:` window created by that tab (inherits SNow's origin; a blob document has no COOP header) holding the app; SNow calls are same-origin `fetch` + `X-UserToken` | ✅ no relay | via T2 from the blob window | bookmark carries the app (R-004) |
| T2 | **Opener postMessage to Jira**: app opens the Jira tab; same bookmark there acts as agent and answers `window.opener` | — | ✅ if Jira sends no COOP | Jira COOP absent |
| T3 | `file://` page opens both tabs, postMessage to each (Toolbox legacy) | ❌ expected (COOP) | ✅ if no COOP | — |
| T4 | Host in **Jira** origin, SNow via opener | ❌ (SNow COOP) | ✅ | — |
| T5 | User-carried hand-off: one origin's window copies a payload, the other pastes it | ✅ | ✅ | an extra click per hop — degraded |
| T6 | Fallback: wizard file + running Toolbox bridge | ✅ | ✅ | Toolbox installed (owner declined) |

**Decision**: build the **Relay Probe** first (contract `relay-probe.md`) and choose by its result:
1. P-SNOW-BLOB ✅ **and** P-JIRA-OPENER-FROM-BLOB ✅ → **T1 + T2** (target design; one bookmark, two roles).
2. P-SNOW-BLOB ✅, Jira opener ❌ → T1 for ServiceNow; Jira via **T5** hand-off, presented as one "Send to Jira" step.
   Accepted by the owner (clarified 2026-10-20).
3. P-SNOW-BLOB ❌ → stop and report; T6 (Toolbox dependency) is ruled out by the owner, so only T5-style hand-off remains.

**Rationale**: the target design removes the relay for the system that blocks it (ServiceNow) by moving the app *into*
its origin, and keeps a relay only where the browser allows one. Choosing without a live test would repeat the history
recorded in the CHANGELOG.

**Alternatives rejected**: Jira PAT from the file (CORS blocks `file://`/foreign origins; also violates "no stored
credentials"); browser extension (not "HTML", needs install); ServiceNow UI Page hosting (needs admin, not shareable).

## R-002 — Reusing Toolbox code without touching it

**Decision**: esbuild `alias` maps `client/src/services/relayBridgeApi.ts` → `snowWizard/transport/relayBridgeShim.ts`
(same exports: `postRelayRequest`, `waitForRelayResult`, `fetchRelayStatus`, …); esbuild `inject` provides a module-level
`fetch` that routes `/jira-proxy/*` to the Jira transport and passes everything else to `globalThis.fetch`.
**Rationale**: `snowApi.ts` calls only `relayBridgeApi`; `jiraApi.ts` calls `fetch('/jira-proxy'+path)` (lines
134–185). Both stay byte-identical, so the wizard sends exactly the requests Toolbox sends. `alias`/`inject` are
esbuild's documented features (Framework-first: the bundler's own seam).
**Alternative rejected**: adding a transport setter to `jiraApi.ts` — edits a 448-line module every view depends on.

## R-003 — Reusing the create/update engine

**Decision**: the change wizard drives `useCrgState({ storageKey: 'snowWizard:change:<jobId>' })` — the 033 seam.
Create = `createChg`; Modify = `updateExistingChg`; outage, PRB link, CTASK dates come with it.
**Gap**: per-environment CTASK lists. `createChg` iterates `buildChangeSubmissionTargets` and stages the same CTASKs for
every target. **Drift 1**: optional `ctaskEnvironmentPlan` filters staged CTASKs per target; absent ⇒ unchanged.

## R-004 — Delivering the app into the ServiceNow origin

**Decision**: the bookmark carries the minified app (bookmark = `javascript:` URL, read `g_ck`, build a `Blob` of the
app HTML, `window.open(blobUrl)`). Budget **≤ 1.5 MB** encoded (Chromium caps URLs at 2 MB). The launcher HTML file
shows the bookmark as a big "drag me to your bookmarks bar" button, plus the version; a newer file ⇒ re-drag.
**Measured in the probe**: P-BOOKMARK-SIZE drags and runs a 1.5 MB payload.
**Fallback if the size fails**: small loader bookmark + `showOpenFilePicker` with the file handle remembered in the
ServiceNow origin's IndexedDB (one pick, then one click per session) — probe P-FILE-HANDLE.

## R-005 — Session token freshness

**Decision**: the blob window receives `g_ck` at launch; on a 401 it asks the ServiceNow tab for a fresh token over a
same-origin `BroadcastChannel('snowWizard')` (same origin ⇒ allowed); if no answer, the banner says "click SNow Wizard
on your ServiceNow tab once more". Probe P-SNOW-BROADCAST.

## R-006 — Shared checks (039)

**Decision**: the wizard consumes 039's `buildChangeReadiness(facts)` and its fact gatherer; Review (P4) consumes the same
call. If 039 has not shipped when Phase C starts, the engine is implemented **in 039's planned location** per
`specs/039-guided-flows/contracts/readiness-engine.md`, never inside `snowWizard/`. SC-005 parity is then structural.

## R-007 — CTASK × environment defaults

**Decision**: a pure default table keyed by CTASK type label: Implementation → all; Technical Checkout → all;
Business Checkout → PRD only (PFIX on); unknown types → all. User edits persist per browser as `snowWizard:ctaskEnvDefaults`.

## R-008 — Problem → Jira

**Decision**: create order Defect → SL Story → QE Story, sequential (matches `usePrbState`). Epic link through the field
the instance uses for Epic link, resolved by name via the existing field-mapping service (never a hard-coded id). Each
Story gets an issue link to the Defect (type "Relates" — Assumption in spec). Idempotency: a label
`prb-<PRBnumber>` on all three; before create, a JQL search for that label finds existing items; retry creates only the
missing ones.

## R-009 — Coaching note

**Decision**: rule-written. A pure `buildCoachingNote(items, change)` maps each non-passing readiness item to
{what is missing, why RM needs it, what good looks like} from a fixed phrase table keyed by item id; `couldNotCheck`
items go in a separate "the reviewer could not check" list, never coached. Optional AI polish uses the existing
copy-paste prompt pattern, always visible (no unlock gate — clarified).

## R-010 — Email and PDF

**Decision**: reuse `rcpApprovalEmail.ts` and `changePlanDocument.ts`. "Needed" = Production environment **and**
`rcpRules` reports approval required. The PDF is ServiceNow's own `?PDF` export, else the print-ready HTML plan saved via
the browser's "Save as PDF" (same as Toolbox).
