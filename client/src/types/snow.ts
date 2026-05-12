// snow.ts — ServiceNow domain types shared by SNow views, hooks, and services.

/** ServiceNow user metadata used in change, approval, and incident views. */
export interface SnowUser {
  sysId: string;
  name: string;
  email: string;
}

/** ServiceNow change request data shown in release-management workflows. */
export interface ChangeRequest {
  sysId: string;
  number: string;
  shortDescription: string;
  state: string;
  assignedTo: SnowUser | null;
  plannedStartDate: string;
  plannedEndDate: string;
  risk: string;
  impact: string;
}

/** ServiceNow approval state for a change request. */
export interface SnowApproval {
  sysId: string;
  approver: SnowUser;
  state: 'requested' | 'approved' | 'rejected';
  changeRequestSysId: string;
}

/** ServiceNow incident summary data used in support dashboards. */
export interface SnowIncident {
  sysId: string;
  number: string;
  shortDescription: string;
  state: string;
  severity: string;
  assignedTo: SnowUser | null;
}

// ── My Issues integration types ──
// These types represent SNow work items fetched directly from the Table REST API
// using the field names that SNow returns (snake_case, matching the API response).

/**
 * All SNow record types surfaced in the My Issues tool.
 * Maps directly to SNow table names.
 */
export type SnowIssueType = 'incident' | 'problem' | 'sc_task' | 'change_request';

/**
 * Common SNow workflow state labels.
 * SNow returns the display_value from the choice list, not the raw integer.
 * `string` fallback allows unlisted states without breaking type narrowing.
 */
export type SnowIssueState = 'New' | 'In Progress' | 'On Hold' | 'Resolved' | 'Closed' | 'Cancelled' | string;

/**
 * A single ServiceNow work item as returned by the Table REST API.
 *
 * All fields use snake_case to match SNow API field names exactly — this avoids
 * a mapping layer and makes it easier to add fields later.
 *
 * `problem_statement` is only present on Problem records and is the field where
 * (by convention) the linked Jira key is appended during the Jira↔SNow workflow.
 */
export interface SnowMyIssue {
  /** Unique system record ID — used as React key and for deduplication. */
  sys_id: string;

  /** Human-readable record number (e.g. "INC0012345", "PRB0001234"). */
  number: string;

  /** One-line description of the issue. */
  short_description: string;

  /** Current workflow state label (e.g. "New", "In Progress"). */
  state: SnowIssueState;

  /**
   * Priority as a SNow display string: "1 - Critical", "2 - High", etc.
   * We store the raw display_value to avoid lossy numeric mapping.
   */
  priority: string;

  /** SNow table/record type — injected by the fetching hook, not the API. */
  sys_class_name: SnowIssueType;

  /** ISO 8601 timestamp when the record was created. */
  opened_at: string;

  /**
   * Full narrative description of the problem.
   * Only present on Problem records (sys_class_name = 'problem').
   * The linked Jira issue key (e.g. "TBX-123") is appended to the end of
   * this field by convention during the Jira↔SNow cross-system linking flow.
   */
  problem_statement?: string;
}

/**
 * The outer envelope the SNow Table REST API wraps all responses in.
 * `result` contains the actual array of records.
 */
export interface SnowTableResponse<RecordType> {
  result: RecordType[];
}
