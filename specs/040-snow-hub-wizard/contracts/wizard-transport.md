# Contract: Wizard Transport (target design T1 + T2)

**Confirmed live 2026-10-20** (research R-001 RESULT: T1 + T2). Revised with the owner's probe findings (R-001 items 1–3, R-011).

## One bookmark, two roles (`bookmarkPayload.ts`)

| Clicked on | Role |
|---|---|
| a ServiceNow host | **Launcher**: resolve `g_ck` (resolver copied from `browserRelay.ts`), build a `Blob` of the app HTML with the token and instance URL embedded, `window.open(blobUrl, 'snowWizardApp')`; answer token requests on `BroadcastChannel('snowWizard')` |
| any other page **with an opener** | **Jira agent**: say hello, **focus the opener** (return the user to the Wizard), then answer only `{ channel: 'snowWizard', kind: 'request' }` messages whose `event.origin` is a ServiceNow host; run the fetch with the user's session; post the result to that origin. No Jira hostname is frozen into the bookmark (R-011) |
| any other page without an opener | a badge: "Open ServiceNow first, then click SNow Wizard." |

## Message protocol (Jira agent)

Request `{ channel:'snowWizard', kind:'request', requestId, method, path, headers?, body?, bodyEncoding?: 'json'|'base64' }`
Response `{ channel:'snowWizard', kind:'response', requestId, status, headers, body, bodyEncoding }`
Hello `{ channel:'snowWizard', kind:'hello', identity }` on agent start.

- `path` MUST start with `/rest/`; anything else is refused by the agent.
- Origin checks both ways: the agent answers only ServiceNow-host origins (`event.origin`); the app accepts only the
  configured Jira origin (the Jira address setting).
- Timeout 30 s → `status: 0`, `body: 'timeout'`.

## Seams in the bundle

| Toolbox module | In the wizard bundle |
|---|---|
| `services/relayBridgeApi.ts` | **aliased** to `relayBridgeShim.ts`: `postRelayRequest` + `waitForRelayResult` for system `snow` run a same-origin `fetch` with `X-UserToken`; system `jira` delegates to the opener transport |
| global `fetch` used by `services/jiraApi.ts` | **injected** `jiraProxyFetch`: `/jira-proxy/<path>` → Jira transport; every other URL → `globalThis.fetch` |
| `snowApi.ts`, `jiraApi.ts` | unchanged |

## Invariants

- No credential is stored; `g_ck` lives only in memory of the app window.
- A 401 from ServiceNow triggers one token refresh attempt (R-005) before surfacing "reconnect".
- Toolbox's own build never includes these files (separate esbuild entry).
