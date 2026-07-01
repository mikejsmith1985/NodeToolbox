# Reference: how the existing Scope/Feature Change report delivery uses the Confluence webhook

> Reference for Phase 1. Captures exactly how NodeToolbox's existing Scope Change / Feature
> Change report delivery works, so the Teams intake can mirror the proven pattern. Source:
> `src/services/scopeChangeScheduler.js` (`runTeamReportDelivery`), `src/services/featureChangeScheduler.js`
> (mirrors it), and `triggerWebhook` in `src/utils/httpClient.js`.

## The short version

NodeToolbox **writes the report to a Confluence page via the REST API**, then **POSTs a small JSON
payload to a Confluence Automation "incoming webhook" URL** (secret in the
`X-Automation-Webhook-Token` header), and a **Confluence Automation rule reacts to that webhook to
send the notification**. The webhook is the *notification trigger*, not the content delivery.

## The two steps (per team)

### Step 1 — Write the report into Confluence (the actual content)

- `GET /wiki/rest/api/content/{pageId}?expand=version,body.storage` then
  `PUT /wiki/rest/api/content/{pageId}` (via `makeConfluenceApiRequest`), prepending the new HTML
  above existing content so each run stacks newest-on-top.
- `pageId` is extracted from the team's configured `targetBlogUrl`.

### Step 2 — Fire the Automation webhook (the notification signal)

Only when there are **real changes** (never on an empty run):

```js
triggerWebhook(triggerUrl, webhookPayload, sslVerify, triggerSecret)
```

## Exact webhook mechanics (`triggerWebhook`)

| Aspect | Value |
|--------|-------|
| Method | `POST` |
| URL | the team's configured `triggerUrl` — an Atlassian Confluence Automation *incoming webhook*, e.g. `https://api-private.atlassian.com/automation/webhooks/confluence/a/<tenant-uuid>/<webhook-uuid>` |
| Auth | the secret goes in the header **`X-Automation-Webhook-Token: <triggerSecret>`** |
| Headers | `Content-Type: application/json`, `Content-Length`, `User-Agent` |
| Body | flat JSON (below) |
| Success | any HTTP 2xx from `api-private.atlassian.com` |

⚠️ **Critical gotcha (documented in the code):** the token MUST be the `X-Automation-Webhook-Token`
header. Passing it as a `?token=` / `?secret=` query parameter is rejected with
`{"errorMessages":["Missing token"],"status":400}`.

### Exact payload the Scope Change scheduler POSTs

```json
{
  "teamName": "Transformers",
  "projectKey": "ENFCT",
  "postUrl": "https://zilverton.atlassian.net/wiki/.../Scope+Change+Report...",
  "generatedAt": "2026-06-26T14:00:51.000Z",
  "releaseChangeCount": 3,
  "sprintChangeCount": 2
}
```

This is a **flat** payload — it does **not** use the `payloadContext` envelope (that envelope is a
different/newer helper, `src/services/reportWebhookDelivery.js`, used by other report surfaces). The
Feature Change scheduler sends an equivalent flat payload.

## The Atlassian side (what "the Confluence automation" is)

Someone created a **Confluence Automation rule** whose **trigger is "Incoming webhook."** Saving
that trigger generated the `triggerUrl` + secret. When NodeToolbox POSTs to it with the token
header, the rule runs its actions (e.g., send an email), reading the posted body via smart values
such as `{{webhookData.postUrl}}`, `{{webhookData.projectKey}}`, `{{webhookData.releaseChangeCount}}`.
**NodeToolbox just pulls the trigger; the Automation rule does the actual notification.**

## Behavioral notes

- **Fire-and-forget**: the webhook call is not awaited — failures are logged
  (`⚠ … webhook trigger failed`) and never block or fail the report.
- **Only on real changes**: empty-data runs update nothing and never fire the webhook.
- `triggerUrl` / `triggerSecret` / `targetBlogUrl` are per-team config (secret stored
  base64-obfuscated, decoded before sending); TLS verification follows `configuration.sslVerify`.

## Why this matters for the Teams intake (Phase 1)

This is how NodeToolbox itself triggers Confluence Automation. **Note it does NOT translate to the
Teams intake path**: NodeToolbox does this from its own Node server (any outbound HTTP + a stored
secret), but **Power Automate's HTTP action and Confluence connector are premium**, which the
target tenant does not have. So the Teams intake cannot POST to Confluence this way.

The Teams intake therefore uses **standard** Power Automate connectors (SharePoint list / Excel)
to store submissions, and Toolbox ingests an **exported Excel/CSV file** via drag-and-drop — see
`phase1-teams.md` and `spec.md`. This document remains as an accurate reference for the *existing
report delivery*, not the intake design.
