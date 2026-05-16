// jira.ts — Jira domain types shared by React views, hooks, and API clients.

/** Jira user metadata rendered in issue and board views. */
export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress: string;
  avatarUrls: Record<string, string>;
}

/** Jira workflow transition metadata returned by /rest/api/2/issue/{key}/transitions. */
export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string; statusCategory: { name: string } };
}

/** Jira issue payload returned by the backend proxy. */
export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory: { key: string } };
    priority: { name: string; iconUrl: string } | null;
    assignee: JiraUser | null;
    reporter: JiraUser | null;
    issuetype: { name: string; iconUrl: string };
    created: string;
    updated: string;
    description: string | null;
    /** Acceptance Criteria custom field content (instance-specific payload shape). */
    customfield_10200?: unknown;
    /** Story-point estimate from the Jira custom field; null when unestimated. */
    customfield_10016?: number | null;
    /** Fix versions this issue is scheduled for; empty when not assigned to a release. */
    fixVersions?: Array<{ name: string }>;
    /**
     * Linked ServiceNow record reference.
     * Populated on Defect and Story issue types when the issue has been associated
     * with a SNow Problem via the Jira↔SNow cross-system linking workflow.
     * The value is a SNow record identifier or URL (e.g. "PRB0001234").
     */
    customfield_11203?: string | null;
  };
}

/** Jira board metadata used by sprint and backlog views. */
export interface JiraBoard {
  id: number;
  name: string;
  type: 'scrum' | 'kanban';
  projectKey: string;
}

/** Jira sprint metadata displayed in sprint dashboards. */
export interface JiraSprint {
  id: number;
  name: string;
  state: 'active' | 'closed' | 'future';
  startDate: string;
  endDate: string;
}

/** Jira filter metadata used for saved-query workflows. */
export interface JiraFilter {
  id: string;
  name: string;
  jql: string;
  isFavorite: boolean;
}

/** Jira field metadata returned by /rest/api/2/field. */
export interface JiraField {
  id: string;
  name: string;
  schema?: { type: string };
}

/** Jira project metadata returned by /rest/api/2/project. */
export interface JiraProject {
  id: string;
  key: string;
  name: string;
}
