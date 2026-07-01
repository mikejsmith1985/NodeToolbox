# Quickstart / Validation — SharePoint Relay Pull (Phase 2B)

Runnable scenarios proving one-click pull from the SharePoint List. Contracts:
[sharepoint-pull-contracts.md](./contracts/sharepoint-pull-contracts.md). Shapes:
[data-model.md](./data-model.md).

## Prerequisites

- NodeToolbox client + local bridge running; Jira (DC) + Confluence proxies configured.
- Feature 005/006 in place (queue, dedup). Intake settings saved (default project / project map).
- The SharePoint `Jira-Intake` List populated (from the Excel import), reachable in your browser.
- Intake settings include the **SharePoint site-relative URL** (e.g. `/sites/CUCIntake`) and **list
  name** (`Jira-Intake`).

## Setup

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npm run dev
```
Open **Jira Intake**; in settings, enter the SharePoint site URL + list name and save.

## Scenario 1 — Connect + one-click pull (SC-001, US1)

1. In the SharePoint Pull panel, use **Connect** (drag the SharePoint bookmarklet once, open the
   SharePoint site, click it) — status shows **connected**.
2. Click **Pull from SharePoint**.
3. **Expected**: the List's submissions fill the queue newest-first with all fields populated — no
   file export or drag. Rows flow through the same dedup + create pipeline (auto-create or review).

## Scenario 2 — Internal column names resolve (SC-002, US2)

- On a List where the GUID column's internal name is not `id` (SharePoint reserved `ID`), pull and
  confirm each submission's **`id`** is correct (dedup label `intake-<id>` matches) and every field
  maps — **without** entering any internal names.

## Scenario 3 — Pagination (SC-003)

- Point at a List with more items than one page; pull and confirm **all** items arrive (count
  matches the List), or a clear "limit applied, N remain" message if ever capped.

## Scenario 4 — No duplicates via pull (SC-004)

- Pull a List whose rows were already created (feature-006 stamp): confirm those rows show Imported
  with existing keys and **0** new issues — identical result to the file path.

## Scenario 5 — Disconnected / error is safe (SC-005, US1.3)

- With the relay **not** connected, click Pull → clear "connect the relay" message, **0** rows
  ingested; the **drag-and-drop dropzone still works** as a fallback.
- Disconnect mid-session (close the SharePoint tab) → status shows disconnected; auto-refresh stops.

## Scenario 6 — Refresh (SC-006, US3)

- After a pull, add a submission in SharePoint, click **Refresh** (or wait for auto-refresh) →
  the new submission appears; previously imported rows are not duplicated.

## Build / test gates (Article X)

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npx vitest run src/views/JiraIntake src/services/sharepointIntakeApi.test.ts
npm run build   # + go/server change: relayBridge supported-systems test
```

**Done when**: Scenarios 1–6 pass with real evidence (a live relay pull populating the queue with
zero duplicates), unit suites green, and the production build succeeds.
