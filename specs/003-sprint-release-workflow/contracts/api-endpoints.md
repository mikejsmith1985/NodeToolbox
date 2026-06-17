# API Contracts: Sprint–Release Workflow Orchestrator

**Date**: 2026-06-17
**Base path**: `/api/sprint-release`
**Auth**: Existing NodeToolbox admin credential hash (same as all other routes)

All request/response bodies are JSON. All endpoints follow the existing NodeToolbox
pattern: HTTP 200 on success, HTTP 400/500 with `{ error: string }` on failure.

---

## Team Workflow Profile

### `GET /api/sprint-release/config`

Returns the current Team Workflow Profile (the active single profile).

**Response 200**:
```json
{
  "teamProfileId": "default",
  "isEnabled": true,
  "featureProjectKey": "DENP",
  "devProjectKey": "ENFCT",
  "qeProjectKey": "INTTEST",
  "btProjectKey": "UEFT",
  "boardId": 42,
  "subStatusFieldId": "customfield_10201",
  "qeHandoffSubStatusValue": "Ready for System Integration Test",
  "btHandoffSubStatusValue": "Ready for UAT",
  "configOnlyLabel": "no-testing-required",
  "defectIntakeLabel": "defect-intake",
  "freezeWindowBusinessDays": 13,
  "doneTransitionName": "Done",
  "dorQeFieldId": "customfield_10300",
  "dorBtFieldId": "customfield_10301",
  "handoffDelivery": {
    "webhookUrl": "https://...",
    "webhookSecret": "***"
  },
  "pollIntervalMinutes": 5
}
```

---

### `POST /api/sprint-release/config`

Save or update the Team Workflow Profile. NodeToolbox validates all four project
keys against the live Jira instance before persisting.

**Request body**: Same shape as GET response (omit `webhookSecret` to leave unchanged).

**Response 200**:
```json
{ "saved": true, "validatedProjects": ["DENP", "ENFCT", "INTTEST", "UEFT"] }
```

**Response 400** (project key invalid):
```json
{ "error": "Project key ENFCTX not found in Jira" }
```

---

## DoR Violations

### `GET /api/sprint-release/dor-violations`

Returns all dev issues in the current active sprint that are missing QE or BT criteria.

**Query params**:
- `sprintId` (optional) — if omitted, uses the current active sprint on the configured board

**Response 200**:
```json
{
  "sprintId": 88,
  "sprintName": "6/18",
  "checkedAt": "2026-06-17T14:23:00.000Z",
  "violations": [
    {
      "issueKey": "ENFCT-1043",
      "summary": "Update payment gateway config",
      "assignee": "jane.doe",
      "missingFields": ["dorQeFieldId", "dorBtFieldId"]
    }
  ],
  "totalIssues": 12,
  "violationCount": 1
}
```

---

## Manual Triggers

### `POST /api/sprint-release/run-now`

Manually trigger a full poll cycle (sub-status scan + fixVersion date check +
defect-intake label scan). Useful for testing or after a config change.

**Request body**: `{}` (empty)

**Response 200**:
```json
{
  "triggered": true,
  "teamProfileId": "default",
  "message": "Poll cycle started. Check /api/sprint-release/status for results."
}
```

---

## Status & Audit

### `GET /api/sprint-release/status`

Returns current runtime state: last poll time, last handoffs fired, sprint sync
state, and any warnings (e.g., mismatched sprint/fixVersion names).

**Response 200**:
```json
{
  "teamProfileId": "default",
  "isEnabled": true,
  "lastPollAt": "2026-06-17T14:20:00.000Z",
  "nextPollAt": "2026-06-17T14:25:00.000Z",
  "recentHandoffs": [
    {
      "issueKey": "ENFCT-1012",
      "handoffType": "QE",
      "firedAt": "2026-06-17T11:04:00.000Z"
    }
  ],
  "recentDefectIntakes": [
    {
      "triggerIssueKey": "INTTEST-882",
      "createdIssueKey": "ENFCT-1101",
      "processedAt": "2026-06-17T09:15:00.000Z"
    }
  ],
  "sprintSyncWarnings": [],
  "activeSprintName": "6/18",
  "activeSprintEndDate": "2026-05-28"
}
```

---

## Jira API calls made by this feature (read-only reference)

These are Jira endpoints NodeToolbox calls outbound. Listed here for integration
testing reference.

| Call | Method | Path | Purpose |
|------|--------|------|---------|
| Fetch changed issues | GET | `/rest/api/2/search?jql=...&expand=changelog` | Detect sub-status changes |
| Get transitions | GET | `/rest/api/2/issue/{key}/transitions` | Find Done transition ID |
| Execute transition | POST | `/rest/api/2/issue/{key}/transitions` | Move dev issue to Done |
| Post Jira comment | POST | `/rest/api/2/issue/{key}/comment` | Handoff notification |
| List fixVersions | GET | `/rest/api/2/project/{key}/versions` | Detect date changes |
| List sprints | GET | `/rest/agile/1.0/board/{boardId}/sprint` | Find sprint by name |
| Update sprint | POST | `/rest/agile/1.0/sprint/{id}` | Sync end date |
| Create issue | POST | `/rest/api/2/issue` | Defect intake new issue |
| Create issue link | POST | `/rest/api/2/issueLink` | Link defect to original |
| Remove label | PUT | `/rest/api/2/issue/{key}` | Remove defect-intake label |
| Validate project | GET | `/rest/api/2/project/{key}` | Config save validation |
| Get sprint issues | GET | `/rest/agile/1.0/sprint/{id}/issue` | DoR violation check |
