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
