# Contract: PI Review Scheduler API

New Express router (mirrors `src/routes/standupBriefing.js`), mounted in `server.js`. All routes are same-origin,
behind the app's existing auth, and operate on `configuration.scheduler.piReview`.

Base path: `/api/pi-review-scheduler`

## GET `/config`

Returns the current per-team schedule config for the Admin Hub panel.

**200** →
```json
{
  "teams": [
    {
      "teamName": "Transformers",
      "isEnabled": true,
      "scheduleTime": "06:30",
      "productOwnerAssignee": "C73130",
      "piFieldId": "customfield_10301",
      "dependencyLinkTypes": ["Dependency"],
      "pages": [
        { "pageUrlOrId": "https://acme.atlassian.net/wiki/spaces/ART/pages/12345/PI+26.4", "piName": "PI 26.4 (07/30/26 - 10/07/26)" }
      ]
    }
  ]
}
```

## POST `/config`

Replaces the schedule config (sanitised) and persists via `saveConfigToDisk`. Body: the same shape as GET.

- Validates `scheduleTime` (`HH:MM`), non-empty `teamName`, and page entries.
- **Never** accepts or returns any credential — the run reuses `configuration.jira`/`configuration.confluence`.

**200** → `{ "ok": true, "teams": [ ...normalised... ] }`
**400** → `{ "ok": false, "error": "<validation message>" }`

## POST `/run-now`

Runs the refresh immediately for one team (all its configured pages), bypassing the schedule and the once-per-day
fired-state. Body: `{ "teamIndex": 0 }` (or `{ "teamName": "Transformers" }`).

**200** →
```json
{
  "ok": true,
  "results": [
    { "pageUrlOrId": "…/12345/…", "status": "success", "ranAtIso": "2026-07-14T18:30:02.000Z", "featuresAppended": 2, "rowsReconciled": 9, "message": "" }
  ]
}
```
- A per-page failure does not sink the others; each page returns its own `PiReviewRunResult`.
- `status: "skipped"` with a message when the team is disabled or has no Product Owner configured.

**404** → unknown team index/name.

## GET `/status`

Returns the last known run result per team/page for the panel's status column (in-memory + last-run timestamps).

**200** →
```json
{
  "teams": [
    { "teamName": "Transformers", "lastResults": [ { "pageUrlOrId": "…/12345/…", "status": "success", "ranAtIso": "…", "message": "" } ] }
  ]
}
```

## Error taxonomy (message strings surfaced in the panel)

| Condition | status | message |
|---|---|---|
| Team disabled | skipped | "Schedule disabled." |
| Already ran today (scheduled path only) | skipped | "Already ran today." |
| No PO configured | skipped | "No Product Owner configured — run skipped." |
| Confluence not configured on server | failed | "Confluence not configured." |
| Page URL/id invalid or unresolvable | failed | "PI Review page URL is invalid." |
| Page has no recognizable PI Review table | failed | "No PI Review table found on the page." |
| Jira query returned no Features | no-op | "No Features found for this PO and PI — page left unchanged." |
| Version conflict after one retry | failed | "Confluence version conflict — try again." |
| Wrote successfully | success | "" |
