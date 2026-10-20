# Contract: Relay Probe (Phase A gate)

A standalone HTML file, `snow-wizard-probe.html`, attached to a release. The owner opens it in production, follows its
numbered steps, and copies the result block back. **No wizard work starts until the result is recorded in research.md.**

## Probes

| ID | What it does | Pass when |
|---|---|---|
| P-HEADERS | Shows how to read the `Cross-Origin-Opener-Policy` and `X-Frame-Options` headers of the SNow and Jira home pages (DevTools → Network), with two paste boxes | values recorded |
| P-SNOW-BLOB | Probe bookmark on the SNow tab opens a `blob:` window; it calls `GET /api/now/table/sys_user?sysparm_query=user_name=javascript:gs.getUserName()&sysparm_limit=1` with `X-UserToken` | 200 + the user's name shown |
| P-SNOW-WRITE-SAFE | From the blob window, `GET /api/now/table/change_request?sysparm_limit=1` (read-only stand-in for write auth) | 200 |
| P-SNOW-BROADCAST | Blob window asks the SNow tab for `g_ck` over `BroadcastChannel` | token received |
| P-JIRA-OPENER-FROM-BLOB | Blob window opens Jira; probe bookmark on Jira posts `GET /rest/api/2/myself` result to `window.opener` | name received in blob window |
| P-JIRA-OPENER-FROM-FILE | Same, from the `file://` probe page | name received |
| P-SNOW-OPENER-FROM-FILE | `file://` page opens SNow; bookmark answers `window.opener` (expected ❌, confirms R-001) | recorded either way |
| P-BOOKMARK-SIZE | Drag a 1.5 MB bookmark; click it on the SNow tab | it runs and reports its size |
| P-FILE-HANDLE | On the SNow tab: pick the probe file once, reload, re-open with one click (IndexedDB handle) | file read twice |

## Output

**Two** copyable lines, because no channel connects the two contexts (that is the very thing being probed):

- `PROBE v1 | file-page | <browser> | P-HEADERS=… | P-JIRA-OPENER-FROM-FILE=… | P-SNOW-OPENER-FROM-FILE=… | P-BOOKMARK-SIZE=…`
- `PROBE v1 | snow-window | <browser> | P-SNOW-BLOB=… | P-SNOW-WRITE-SAFE=… | P-SNOW-BROADCAST=… | P-JIRA-OPENER-FROM-BLOB=… | P-FILE-HANDLE=…`

The browser and its major version sit in each line's header (formerly a separate P-BROWSER row). If the
ServiceNow window shows "the browser blocked this window's script", record `P-SNOW-BLOB=fail(script blocked)` — that is
ServiceNow's content policy refusing inline script in the blob window. Nothing is sent anywhere by the probe; every call
is read-only.

## Local rehearsal (2026-10-20, Edge 155, mock systems on `*.localhost`, no COOP)

`P-JIRA-OPENER-FROM-FILE=pass`, `P-SNOW-OPENER-FROM-FILE=pass`, `P-SNOW-BLOB=pass` (blob window had the ServiceNow
origin and its same-origin call carried the token), `P-SNOW-WRITE-SAFE=pass`, `P-SNOW-BROADCAST=pass`; token never on
the page. This proves the mechanics only — production adds ServiceNow's COOP and CSP, which only the live run can test.

## Invariants

- The probe performs **no writes** to ServiceNow or Jira.
- Each probe reports `fail(reason)` with the browser's own error text, never a silent skip.
