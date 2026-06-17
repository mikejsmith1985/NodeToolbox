# Data Model: Sprint–Release Workflow Orchestrator

**Date**: 2026-06-17
**Storage**: `toolbox-proxy.json` (AppData) for profiles + in-memory Maps for runtime state

---

## Config entities (persisted to `toolbox-proxy.json`)

### `sprintRelease` (top-level config key)

```
sprintRelease
  └── teamProfiles: TeamWorkflowProfile[]   (list; one entry today, multi-team-ready)
```

### `TeamWorkflowProfile`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `teamProfileId` | string | `"default"` | Stable identifier; present on all runtime records for multi-team readiness |
| `isEnabled` | boolean | `true` | When false, scheduler skips this profile entirely |
| `featureProjectKey` | string | required | Jira project key for features/epics (e.g., `"DENP"`) |
| `devProjectKey` | string | required | Jira project key for development issues (e.g., `"ENFCT"`) |
| `qeProjectKey` | string | required | Jira project key for QE issues (e.g., `"INTTEST"`) |
| `btProjectKey` | string | required | Jira project key for BT issues (e.g., `"UEFT"`) |
| `boardId` | number | required | Jira Software board ID for the dev team's sprint board |
| `subStatusFieldId` | string | `"customfield_10201"` | Jira custom field ID that holds the sub-status value |
| `qeHandoffSubStatusValue` | string | `"Ready for System Integration Test"` | Sub-status value that triggers QE handoff |
| `btHandoffSubStatusValue` | string | `"Ready for UAT"` | Sub-status value that triggers BT handoff |
| `configOnlyLabel` | string | `"no-testing-required"` | Jira label on dev issues that bypasses QE/BT handoff |
| `defectIntakeLabel` | string | `"defect-intake"` | Jira label QE/BT apply to their issue to trigger defect intake |
| `freezeWindowBusinessDays` | number | `13` | Business days before release date that defines sprint end (code freeze) |
| `doneTransitionName` | string | `"Done"` | Name of the Jira workflow transition that closes a dev issue |
| `dorQeFieldId` | string | `""` | Jira custom field ID for QE acceptance criteria (DoR gate) |
| `dorBtFieldId` | string | `""` | Jira custom field ID for BT test scenarios (DoR gate) |
| `handoffDelivery.webhookUrl` | string | `""` | Optional outbound webhook for handoff notifications |
| `handoffDelivery.webhookSecret` | string | `""` | Optional HMAC secret for webhook signature |
| `pollIntervalMinutes` | number | `5` | How often the scheduler polls Jira for sub-status and label changes |

**Validation rules**:
- `featureProjectKey`, `devProjectKey`, `qeProjectKey`, `btProjectKey` must be non-empty strings validated against the connected Jira instance before saving.
- `boardId` must be a positive integer.
- `freezeWindowBusinessDays` must be between 1 and 30.
- `pollIntervalMinutes` must be between 1 and 60.
- `teamProfileId` must be unique across all profiles in the array.

---

## Runtime state (in-memory, not persisted)

### `lastSeenFixVersionDates` — Map

```
Map<string, string>
  key:   "{teamProfileId}:{fixVersionId}"
  value: ISO date string of the last known releaseDate for that fixVersion
```

**Purpose**: Detect when a fixVersion's release date has changed since the last poll.
Populated on first poll; compared on subsequent polls to trigger sprint date sync.

### `processedDefectIntakeKeys` — Set

```
Set<string>
  values: "{teamProfileId}:{issueKey}"   e.g. "default:INTTEST-4421"
```

**Purpose**: Prevent processing the same QE/BT issue defect-intake label more than
once. An issue key is added to the Set after a defect intake issue is created.
The Set is populated from recent processed-intake history on startup (see below).

### `lastHandoffByIssue` — Map

```
Map<string, { qeHandoffAt: string|null, btHandoffAt: string|null }>
  key:   "{teamProfileId}:{issueKey}"   e.g. "default:ENFCT-1012"
  value: ISO timestamps of the last QE and BT handoffs fired for that issue
```

**Purpose**: Prevent duplicate handoff notifications if the poll sees the same
sub-status value across multiple cycles.

---

## Jira entities read/written by NodeToolbox

These are not owned by NodeToolbox but are the Jira fields and issue types the
orchestrator interacts with.

### Dev issue (ENFCT or configured dev project)

| Jira field | Read | Written | Notes |
|------------|------|---------|-------|
| `key` | ✅ | — | Issue identifier |
| `summary` | ✅ | — | Included in handoff notification |
| `assignee` | ✅ | — | Read for inheritance; **never written by orchestrator** |
| `status` | ✅ | ✅ (transition) | Transition to Done via workflow transition API |
| `customfield_10201` (sub-status) | ✅ | — | Watched via changelog for handoff trigger |
| `fixVersions` | ✅ | — | Used to link issue to sprint/release cycle |
| `labels` | ✅ | ✅ | Reads `configOnlyLabel`; written on DoR violation flag |
| `parent` | ✅ | — | Used to fetch parent feature from DENP project |
| `customfield_dorQeFieldId` | ✅ | — | DoR gate check |
| `customfield_dorBtFieldId` | ✅ | — | DoR gate check |

### QE/BT issue (INTTEST / UEFT or configured projects)

| Jira field | Read | Written | Notes |
|------------|------|---------|-------|
| `key` | ✅ | — | Identifier; included in defect intake link |
| `labels` | ✅ | ✅ | Reads `defectIntakeLabel`; label removed after processing |
| `issueLinks` | ✅ | — | Used to find linked dev issue for defect intake |

### Defect intake issue (new, created in dev project)

| Jira field | Set on creation | Notes |
|------------|-----------------|-------|
| `project` | `devProjectKey` | Belongs to dev project |
| `issuetype` | `"Bug"` (configurable) | Distinct type from original dev story |
| `summary` | `"[DEFECT] " + originalSummary` | Prefixed to distinguish from original |
| `assignee` | Original dev issue's assignee | Preserved for ownership reporting |
| `fixVersions` | Original dev issue's fixVersion(s) | Keeps defect in correct release cycle; or flagged for triage if sprint is in freeze |
| `labels` | `["defect-from-testing"]` | Separates defect work from original delivery work |
| `issueLinks` | Link to original dev issue + QE/BT trigger issue | Full traceability |

### Jira FixVersion (feature project)

| Field | Read | Notes |
|-------|------|-------|
| `id` | ✅ | Key for `lastSeenFixVersionDates` map |
| `name` | ✅ | Matched to sprint name for linkage |
| `releaseDate` | ✅ | Source of truth for sprint end date calculation |

### Jira Sprint (dev board)

| Field | Read | Written | Notes |
|-------|------|---------|-------|
| `id` | ✅ | — | Needed for update call |
| `name` | ✅ | — | Matched to fixVersion name |
| `endDate` | ✅ | ✅ | Updated when fixVersion date changes |
| `state` | ✅ | — | Only active/future sprints are updated; closed sprints skipped |

---

## State transitions (dev issue lifecycle)

```
Backlog
  │ (sprint planning, DoR gate check)
  ▼
In Progress
  │ (developer sets sub-status = "Ready for System Integration Test")
  ▼  ──→ [config-only: skip handoff, go direct to Done]
Done ◀── NodeToolbox transition (on QE handoff event)
          + QE handoff notification posted
          │
          │ (3-7 days hardening in INT, then REL deploy)
          │ (sub-status = "Ready for UAT" detected)
          ▼
         BT handoff notification posted
          │
          │ (QE/BT apply defect-intake label on linked issue)
          ▼
         New defect issue created in dev project
         Linked to original (which remains Done)
         Assigned to original assignee
         Added to current sprint or flagged for triage
```

---

## Sprint–FixVersion sync calculation

```
Input:  releaseDate (ISO date from Jira fixVersion)
        freezeWindowBusinessDays (config, default 13)
Output: sprintEndDate (ISO date)

Algorithm:
  currentDate = releaseDate
  remainingDays = freezeWindowBusinessDays
  while remainingDays > 0:
    currentDate = currentDate - 1 day
    if currentDate is weekday (Mon-Fri):
      remainingDays -= 1
  return currentDate
```

Edge cases:
- If the computed sprint end date is in the past (sprint already started), log a
  warning and do not update the sprint.
- If the sprint state is "closed", log a warning and do not update.
- If no sprint name matches the fixVersion name, log a warning and surface to
  the admin via the `GET /api/sprint-release/status` endpoint.
