# Research: Sprint–Release Workflow Orchestrator

**Date**: 2026-06-17
**Feeds into**: `plan.md` Phase 1 design decisions

---

## Decision 1: Event detection mechanism — polling vs inbound webhook

**Decision**: Poll Jira periodically (consistent with all existing schedulers).

**Rationale**: NodeToolbox has no inbound webhook listener today. All five existing
schedulers use a `setInterval` → check-and-fire pattern against the Jira changelog
or field state. Adding an inbound route would be novel infrastructure for this
codebase. The sub-status change on `customfield_10201` is detectable via the Jira
issue changelog (`/rest/api/2/issue/{key}?expand=changelog`) — the same mechanism
`scopeChangeScheduler.js` uses to detect fixVersion field changes. A 5-minute poll
interval is sufficient; the requirement is handoff within 30 minutes.

**Alternatives considered**:
- *Jira automation webhook to NodeToolbox*: More real-time, but requires
  adding an inbound route, registering a Jira webhook (admin permission), and
  managing webhook security. Adds infrastructure not present in codebase.
- *CI/CD webhook*: Ruled out in clarification Q1. Teams with manual deploys or
  locked pipelines would be excluded.

---

## Decision 2: Sub-status change detection via changelog

**Decision**: Query `GET /rest/api/2/search` with JQL targeting the dev project,
filtered to issues changed in the last N minutes, expanding `changelog`. Walk
each issue's changelog for an entry where `field == 'customfield_10201'` and
`toString` matches the configured handoff value.

**Rationale**: This is identical to how `scopeChangeScheduler.js` detects field
changes (it walks `changelog.histories` looking for `field == 'fixVersions'`). No
new query pattern is needed — only a new field name and value matcher.

**Key Jira API call**:
```
GET /rest/api/2/search?jql=project={DEV_PROJECT}+AND+updated>=-5m&expand=changelog&fields=assignee,summary,customfield_10201,fixVersions,labels,parent
```

---

## Decision 3: Sprint date synchronisation via Jira Agile API

**Decision**: Use the Jira Software Agile API (`/rest/agile/1.0/sprint/{id}`) to
read and update sprint end dates. Sprint-to-fixVersion linkage is maintained by
matching the sprint name to the fixVersion name (both share the same label, e.g.
"6/18").

**API calls needed**:
- `GET /rest/agile/1.0/board/{boardId}/sprint?state=active,future` — list sprints
- `POST /rest/agile/1.0/sprint/{id}` — update `endDate` field

**Rationale**: The Agile API is a different base path from the core Jira REST API
but uses the same authentication. `makeJiraApiRequest` in `httpClient.js` accepts
an arbitrary `apiPath`, so `/rest/agile/1.0/...` paths work without code changes.
The board ID must be in the Team Workflow Profile config.

**FixVersion date change detection**: Query `GET /rest/api/2/project/{projectKey}/versions`
on the feature project, compare `releaseDate` against cached values in an in-memory
Map (same pattern as `lastFiredDates` in existing schedulers). On change, recalculate
sprint end date = releaseDate − freezeWindowBusinessDays.

---

## Decision 4: Business day calculation

**Decision**: Pure JavaScript function, no external library.

**Implementation**: Walk backward from the release date, decrementing a counter for
each weekday (Mon–Fri). Public holidays are excluded from scope (Assumption A5 in
spec). Function signature: `calculateCodeFreezeDate(releaseDate, businessDays)`.

**Rationale**: The existing codebase uses no date math library. The calculation is
simple and self-contained. Adding a dependency (e.g., `date-fns`) would be
disproportionate to the need.

---

## Decision 5: Defect intake trigger — label polling

**Decision**: Poll QE and BT project issues for the configured `defectIntakeLabel`
(default: `defect-intake`) on issues linked to dev project issues. On detection:
create a new dev issue via `POST /rest/api/2/issue`, link it to the original and
the triggering QE/BT issue, assign to original assignee, inherit fixVersion.

**Rationale**: Consistent with polling-first approach (Decision 1). QE/BT apply
the label in their own Jira tooling — no UI change required on their side.
NodeToolbox detects it on the next poll cycle. The label name is configurable.

**New Jira API calls needed**:
- `POST /rest/api/2/issue` — create defect issue in dev project
- `POST /rest/api/2/issueLink` — link defect to original dev issue and QE/BT issue
- `DELETE /rest/api/2/issue/{issueKey}/label` — remove `defect-intake` label after
  processing to prevent reprocessing on next poll (or maintain a processed-issue
  Set in memory)

---

## Decision 6: Done transition execution

**Decision**: Fetch the available transitions for the dev issue via
`GET /rest/api/2/issue/{key}/transitions`, find the transition with `name` matching
"Done" (configurable), then execute `POST /rest/api/2/issue/{key}/transitions` with
the matching `transitionId`. Do not alter the `assignee` field.

**Rationale**: Jira workflows vary per project; the Done transition ID is not fixed.
Looking it up dynamically (and caching per project) is the correct pattern.

---

## Decision 7: Storage of workflow state

**Decision**: Extend the existing `toolbox-proxy.json` config structure with a new
`sprintRelease` top-level key. Team Workflow Profiles are stored there. Runtime
polling state (last-seen fixVersion dates, processed defect-intake issue keys) is
held in in-memory Maps initialised from the config on startup.

**Rationale**: NodeToolbox has no database. All existing schedulers use in-memory
Maps backed by AppData JSON. The processed-defect Set and last-seen-fixVersion Map
are small enough (dozens of entries at most) to fit in this model.

**Config shape** (new addition to `toolbox-proxy.json`):
```json
{
  "sprintRelease": {
    "teamProfiles": [
      {
        "teamProfileId": "default",
        "isEnabled": true,
        "featureProjectKey": "DENP",
        "devProjectKey": "ENFCT",
        "qeProjectKey": "INTTEST",
        "btProjectKey": "UEFT",
        "boardId": 0,
        "subStatusFieldId": "customfield_10201",
        "qeHandoffSubStatusValue": "Ready for System Integration Test",
        "btHandoffSubStatusValue": "Ready for UAT",
        "configOnlyLabel": "no-testing-required",
        "defectIntakeLabel": "defect-intake",
        "freezeWindowBusinessDays": 13,
        "donTransitionName": "Done",
        "dorQeFieldId": "",
        "dorBtFieldId": "",
        "handoffDelivery": {
          "webhookUrl": "",
          "webhookSecret": ""
        },
        "pollIntervalMinutes": 5
      }
    ]
  }
}
```

---

## Decision 8: DoR validation approach

**Decision**: On a configurable schedule (daily or on-demand via API), query dev
project issues assigned to active sprint(s), check that `dorQeFieldId` and
`dorBtFieldId` are non-empty. Surface violations as a Jira comment on the issue
and return them from a `GET /api/sprint-release/dor-violations` endpoint in
NodeToolbox.

**Rationale**: Non-blocking advisory flag (FR-6.2). Issues are not hard-blocked at
the Jira workflow level, keeping the Jira admin footprint minimal.

---

## Decision 9: Handoff notification delivery

**Decision**: Post a Jira comment on the dev issue (and optionally trigger the
configured `handoffDelivery.webhookUrl`) when a handoff event fires. Mirror the
delivery pattern of `hygieneMonitorScheduler.js` which posts Jira comments via
`makeJiraApiRequest('POST', '/rest/api/2/issue/{key}/comment', ...)`.

**Rationale**: Jira comment is visible to the dev assignee and QE/BT teams without
requiring Confluence page IDs or external tools. The optional webhook lets teams
forward to Teams/Slack if desired. This reuses existing delivery infrastructure.

---

## Framework-First Gate (Article VII)

Checked before proceeding to design:

| Need | Existing framework/codebase capability | Gap |
|------|----------------------------------------|-----|
| Jira changelog polling | `scopeChangeScheduler.js` (exemplar) | None — reuse pattern |
| HTTP Jira calls | `makeJiraApiRequest` in `httpClient.js` | None — reuse |
| Scheduler registration | `server.js` + `setInterval` pattern | None — reuse |
| Config persistence | `loader.js` + AppData JSON | None — extend schema |
| Outbound webhook delivery | `triggerWebhook` in `httpClient.js` | None — reuse |
| Jira Agile API (sprint update) | Not present — core API only | **Gap**: new API path, same auth |
| Inbound webhook | Not present | Not needed — polling chosen |
| Business day math | Not present | **Gap**: ~20-line pure-JS helper |
| DoR field validation | Not present | **Gap**: new logic, reuse query pattern |
| Issue creation (defect intake) | Not present as standalone | **Gap**: new Jira POST call |

All gaps are minimal extensions of existing patterns. No new external libraries required.
