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

/** Jira issue link metadata used by standup, blocker, and release workflows. */
export interface JiraIssueLink {
  type?: { name?: string; inward?: string; outward?: string };
  inwardIssue?: { key: string; fields?: { summary?: string; status?: { name: string } } };
  outwardIssue?: { key: string; fields?: { summary?: string; status?: { name: string } } };
}

/** Jira comment metadata used by planning and issue detail workflows. */
export interface JiraComment {
  id: string;
  author?: { displayName?: string } | null;
  body?: unknown;
  created?: string;
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
    /** Planning sub-status custom field used by the legacy planning tab. */
    customfield_10201?: { id?: string; value?: string; name?: string } | null;
    /** Story-point estimate from the Jira custom field; null when unestimated. */
    customfield_10016?: number | null;
    /** Alternate story-point field used by some Jira instances. */
    customfield_10028?: number | null;
    /** Legacy impediment / flagged field used by some Team Dashboard parity views. */
    customfield_10021?: boolean | string | null;
    /** Program Increment field used by DSU and Team Dashboard scope filtering. */
    customfield_10301?: { value?: string; name?: string } | string | null;
    /** Legacy epic-link field variants used by planning grouping. */
    customfield_10014?: string | { key?: string } | null;
    customfield_10008?: string | { key?: string } | null;
    /** Fix versions this issue is scheduled for; empty when not assigned to a release. */
    fixVersions?: Array<{ id?: string; name: string; releaseDate?: string; released?: boolean; archived?: boolean }>;
    /** Linked Jira issues used for blocker detection and DSU / standup context. */
    issuelinks?: JiraIssueLink[];
    /** Jira issue labels used by planning and pipeline parity views. */
    labels?: string[];
    /** Parent issue used as a final epic fallback for planning grouping. */
    parent?: { key: string } | null;
    /** Jira comment collection used by planning detail previews. */
    comment?: { comments: JiraComment[]; total: number } | null;
    /** Resolution timestamp used by kanban throughput history. */
    resolutiondate?: string | null;
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
  goal?: string;
}

/** Jira version metadata used by release-oriented views. */
export interface JiraVersion {
  id: string;
  name: string;
  released?: boolean;
  archived?: boolean;
  releaseDate?: string | null;
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
