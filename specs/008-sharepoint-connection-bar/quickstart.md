# Quickstart / Validation — SharePoint Relay in the Connection Bar

Runnable scenarios proving the unified connect experience. Contracts:
[connection-bar-contracts.md](./contracts/connection-bar-contracts.md). Shapes:
[data-model.md](./data-model.md).

## Prerequisites

- NodeToolbox client + local bridge running; features 006/007 in place.
- A reachable SharePoint site with the `Jira-Intake` List; intake settings hold the site + list.

## Setup

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npm run dev
```

## Scenario 1 — Connect SharePoint from the Connection Bar (SC-001, US1)

1. In the **Connection Bar**, open the **SharePoint** indicator's panel.
2. **Expected (disconnected)**: red dot; panel shows a **draggable** "NodeToolbox SharePoint Relay"
   link (not raw text) + drag-to-bookmarks steps.
3. Drag the bookmarklet to the bookmarks bar, open SharePoint, click it.
4. **Expected**: within ~one poll cycle the SharePoint dot turns **green (connected)**.

## Scenario 2 — Intake panel is slim and points to the bar (SC-003, US2)

- Open **Jira Intake**. **Expected**: the SharePoint pull area shows connection status + **Pull**
  and, when disconnected, a short "connect from the Connection Bar" pointer — **no** bookmarklet or
  connect steps in the intake view.

## Scenario 3 — Pull still works when connected (SC-004, US2)

- With the SharePoint relay connected (via the bar), click **Pull** in the intake panel. **Expected**:
  the List loads into the queue and flows through dedup + create exactly as in feature 007 (0
  duplicates).

## Scenario 4 — Both relays independent (SC-002, US3)

1. Connect the **ServiceNow** relay (as usual) and the **SharePoint** relay.
2. **Expected**: both indicators show connected simultaneously; connecting/disconnecting one does
   **not** change the other's dot.

## Scenario 5 — ServiceNow unaffected (SC-005, US3)

- With SharePoint connected, exercise the existing ServiceNow relay (open its panel, relay a
  request). **Expected**: SNow connect/status/relaying behave exactly as before — no regression.

## Scenario 6 — Disconnect reflects quickly (SC-006)

- Close the SharePoint relay tab. **Expected**: within one poll cycle the SharePoint dot returns to
  not-connected; the intake Pull becomes unavailable with the pointer; SNow is unaffected.

## Build / test gates (Article X)

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npx vitest run src/store/connectionStore.test.ts src/components/ConnectionBar src/views/JiraIntake
npm run build
```

**Done when**: Scenarios 1–6 pass with real evidence (both relays connected independently, intake
panel free of connect UI, SNow unaffected), unit suites green, and the production build succeeds.
