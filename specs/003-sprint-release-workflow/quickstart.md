# Quickstart & Validation Guide: Sprint–Release Workflow Orchestrator

**Date**: 2026-06-17
**Purpose**: End-to-end validation scenarios that prove the feature works against
the live corporate Jira instance.

---

## Prerequisites

- NodeToolbox running locally (`npm start` from repo root, default port 5555)
- Admin credentials active (standard NodeToolbox admin login)
- Access to the corporate Jira instance (DENP/ENFCT/INTTEST/UEFT projects)
- A test feature in DENP with at least one child dev issue in ENFCT
- The dev issue must be In Progress and assigned to a real user

---

## Setup: Configure the Team Workflow Profile

1. Open NodeToolbox Admin Hub → Sprint Release section
2. Set the four project keys: `DENP`, `ENFCT`, `INTTEST`, `UEFT`
3. Set `boardId` to the dev team's Jira Software board ID
4. Set `dorQeFieldId` and `dorBtFieldId` to the correct Jira custom field IDs for
   QE acceptance criteria and BT test scenarios
5. Leave sub-status values and other fields at their defaults
6. Save — NodeToolbox validates all four project keys against Jira before persisting

**Validation**: `GET /api/sprint-release/config` returns the saved profile with
`validatedProjects: ["DENP", "ENFCT", "INTTEST", "UEFT"]`

---

## Scenario 1: QE Handoff — sub-status triggers Done + notification

**Goal**: Confirm that when a dev issue's sub-status is set to
"Ready for System Integration Test", NodeToolbox transitions the issue to Done
and posts a handoff comment.

**Steps**:
1. In Jira, open a dev issue (e.g., ENFCT-1012) that is In Progress
2. Set `customfield_10201` (sub-status) to "Ready for System Integration Test"
3. Wait up to `pollIntervalMinutes` (default 5 minutes), or call
   `POST /api/sprint-release/run-now` to trigger immediately
4. Check the ENFCT-1012 status in Jira

**Expected outcomes**:
- ENFCT-1012 status = Done
- ENFCT-1012 assignee = unchanged (same as before step 2)
- A Jira comment on ENFCT-1012 begins with "QE Handoff:" and includes the
  parent feature key from DENP and confirms the INT environment
- `GET /api/sprint-release/status` → `recentHandoffs` includes ENFCT-1012
  with `handoffType: "QE"`

---

## Scenario 2: Config-only bypass — no handoff for labelled issues

**Goal**: Confirm that issues labelled `no-testing-required` are closed at the
sub-status trigger without posting a QE or BT handoff notification.

**Steps**:
1. Add label `no-testing-required` to a dev issue (e.g., ENFCT-1050)
2. Set its sub-status to "Ready for System Integration Test"
3. Trigger a poll cycle

**Expected outcomes**:
- ENFCT-1050 status = Done
- No QE handoff comment on ENFCT-1050
- `recentHandoffs` in status does not include ENFCT-1050

---

## Scenario 3: BT Handoff — sub-status "Ready for UAT"

**Goal**: Confirm BT handoff fires independently of QE handoff.

**Steps**:
1. On a dev issue that is already Done (from Scenario 1 or manually),
   set sub-status to "Ready for UAT"
2. Trigger a poll cycle

**Expected outcomes**:
- A Jira comment on the dev issue begins with "BT Handoff:" and confirms the
  REL environment
- `recentHandoffs` includes the issue with `handoffType: "BT"`
- Dev issue status remains Done (BT handoff does not re-close; it was already Done)

---

## Scenario 4: Sprint–FixVersion date sync

**Goal**: Confirm that changing a fixVersion's release date in Jira updates the
linked sprint's end date.

**Steps**:
1. Note the current sprint end date for the "6/18" sprint in Jira Software
2. In Jira, change the "6/18" fixVersion's release date by 7 days (e.g., from
   June 18 to June 25)
3. Trigger a poll cycle

**Expected outcomes**:
- The "6/18" sprint's end date in Jira is updated to June 25 − 13 business days
  (approximately June 6, depending on weekends)
- `GET /api/sprint-release/status` → `activeSprintEndDate` reflects the new date
- No change to sprint start date or any other sprint field

**Edge case to also verify**:
- Change fixVersion date so the computed sprint end date is in the past →
  NodeToolbox logs a warning; sprint end date is NOT updated; warning appears
  in `GET /api/sprint-release/status → sprintSyncWarnings`

---

## Scenario 5: DoR violations report

**Goal**: Confirm that issues in the active sprint missing QE/BT criteria are
surfaced in the violations report.

**Steps**:
1. Ensure at least one dev issue in the active sprint has `dorQeFieldId` empty
2. Call `GET /api/sprint-release/dor-violations`

**Expected outcomes**:
- Response `violations` array includes the issue with `missingFields` listing
  the empty field ID(s)
- Issues with both fields populated do not appear in the violations list
- A Jira comment on the violating issue notes the missing criteria

---

## Scenario 6: Defect intake via Jira label

**Goal**: Confirm that a QE/BT team member applying `defect-intake` to their
issue causes NodeToolbox to create a linked defect issue in the dev project.

**Steps**:
1. Use a QE issue (e.g., INTTEST-882) that is linked to ENFCT-1012 (Done)
2. In Jira, add the label `defect-intake` to INTTEST-882
3. Trigger a poll cycle

**Expected outcomes**:
- A new issue is created in ENFCT (e.g., ENFCT-1101) with:
  - Summary prefixed with "[DEFECT]"
  - Assignee = ENFCT-1012's assignee
  - Label `defect-from-testing`
  - Issue link "is caused by" → ENFCT-1012
  - Issue link "triggered by" → INTTEST-882
- ENFCT-1012 status remains Done; Done date unchanged
- The `defect-intake` label is removed from INTTEST-882
- `GET /api/sprint-release/status → recentDefectIntakes` includes the entry

**Sprint placement edge case**:
- If the current date is within the code-freeze window (sprint end has passed),
  the new defect issue is NOT added to the active sprint automatically; instead
  a `[TRIAGE REQUIRED]` label is added to the new issue

---

## Scenario 7: Ownership integrity across all transitions

**Goal**: Confirm that no status transition alters the assignee field.

**Steps**:
1. Note the assignee on ENFCT-1012 before any transitions
2. Run Scenarios 1, 3, and 6 on the same issue
3. At each step, check `GET /rest/api/2/issue/ENFCT-1012?fields=assignee`

**Expected outcome**: `assignee.accountId` is identical at every checkpoint.

---

## Observability & Cleanup

- All poll activity is logged to the NodeToolbox log buffer (visible in Admin Hub)
- `GET /api/sprint-release/status` is the primary monitoring endpoint
- To reset test state (clear processed-intake Set and handoff Map), restart NodeToolbox
- Test issues can be cleaned up manually in Jira after validation
