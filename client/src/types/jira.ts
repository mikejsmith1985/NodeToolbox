// jira.ts — Jira domain types shared by React views, hooks, and API clients.

/** Jira user metadata rendered in issue and board views. */
export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress: string;
  avatarUrls: Record<string, string>;
  /** Jira Server username (absent on Jira Cloud which uses accountId instead). */
  name?: string;
  /** Jira Server user key (absent on Jira Cloud which uses accountId instead). */
  key?: string;
}


/** Jira workflow transition metadata returned by /rest/api/2/issue/{key}/transitions. */
export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string; statusCategory: { name: string } };
}

/** Jira issue link metadata used by standup, blocker, release, and issue-context workflows. */
export interface JiraIssueLink {
  type?: { name?: string; inward?: string; outward?: string };
  inwardIssue?: {
    key: string;
    fields?: { summary?: string; status?: { name: string; statusCategory?: { key?: string } }; labels?: string[] };
  };
  outwardIssue?: {
    key: string;
    fields?: { summary?: string; status?: { name: string; statusCategory?: { key?: string } }; labels?: string[] };
  };
}

/** Jira comment metadata used by planning and issue detail workflows. */
export interface JiraComment {
  id: string;
  /**
   * The comment's author. The identifier fields are optional and instance-dependent (Cloud sends
   * `accountId`, Data Center sends `name`/`key`); they let the app record this person's name for
   * free, so a mention of them elsewhere in the thread needs no extra lookup.
   */
  author?: { displayName?: string; accountId?: string; name?: string; key?: string } | null;
  body?: unknown;
  created?: string;
}

/** Jira attachment metadata returned on an issue's `attachment` field. */
export interface JiraAttachment {
  id: string;
  filename: string;
  /** File size in bytes as reported by Jira. */
  size: number;
  /** MIME type, e.g. "image/png"; absent on some Data Center versions. */
  mimeType?: string;
  /** Absolute URL Jira serves the file from (used for a read-only download link). */
  content: string;
  created?: string;
  author?: { displayName?: string } | null;
}

/** Jira issue payload returned by the backend proxy. */
export interface JiraIssue {
  id: string;
  key: string;
  changelog?: {
    histories: Array<{
      id: string;
      created: string;
      items: Array<{
        field: string;
        fieldtype: string;
        from: string | null;
        fromString: string | null;
        to: string | null;
        toString: string | null;
      }>;
    }>;
  };
  fields: {
    summary: string;
    status: { name: string; statusCategory: { key: string } };
    priority: { name: string; iconUrl: string } | null;
    assignee: JiraUser | null;
    reporter: JiraUser | null;
    issuetype: { name: string; iconUrl: string };
    created: string;
    updated: string;
    /** Jira due date used by PI Review and release tracking views. */
    duedate?: string | null;
    description: string | null;
    /** Acceptance Criteria custom field content (instance-specific payload shape). */
    customfield_10200?: unknown;
    /** Planning sub-status custom field used by the legacy planning tab. */
    customfield_10201?: { id?: string; value?: string; name?: string } | null;
    /** Story-point estimate from the Jira custom field; null when unestimated. */
    customfield_10016?: number | null;
    /** Business Value custom field used by the Feature Canvas AI prioritization prompt. */
    customfield_10274?: number | string | { value?: string } | null;
    /** Files attached to the issue, surfaced read-only in the Feature Canvas inspector. */
    attachment?: JiraAttachment[];
    /** Alternate story-point field used by some Jira instances. */
    customfield_10028?: number | null;
    /** Legacy impediment / flagged field used by some Team Dashboard parity views. */
    customfield_10021?: boolean | string | null;
    /** Feature-level point estimate used by PI Review feature reconciliation. */
    customfield_10111?: number | null;
    /** Program Increment field used by DSU and Team Dashboard scope filtering. */
    customfield_10301?: { value?: string; name?: string } | string | null;
    /** Legacy epic-link field variants used by planning grouping. */
    customfield_10014?: string | { key?: string } | null;
    customfield_10008?: string | { key?: string } | null;
    customfield_10108?: string | { key?: string } | null;
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
  /** Whether the field can be used in a JQL clause — false for registry-only fields (GH #167). */
  searchable?: boolean;
}

/** Jira project metadata returned by /rest/api/2/project. */
export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

// ── Create-metadata & issue-creation types (Jira Template Maker) ──
// Shapes returned by the classic Server/DC endpoint
// /rest/api/2/issue/createmeta?projectKeys=...&expand=projects.issuetypes.fields
// and the request/response for POST /rest/api/2/issue.

/** Type descriptor for a createmeta field; drives the internal field-model mapping. */
export interface CreateMetaFieldSchema {
  type: string;
  items?: string;
  system?: string;
  custom?: string;
}

/** A single allowed option for a choice/components/versions createmeta field. */
export interface CreateMetaAllowedValue {
  id: string;
  /** Present on priorities/components/versions and option fields. */
  name?: string;
  /** Present on custom select options instead of (or alongside) name. */
  value?: string;
}

/** One field as described by createmeta for a given issue type. */
export interface CreateMetaField {
  required: boolean;
  name: string;
  schema?: CreateMetaFieldSchema;
  allowedValues?: CreateMetaAllowedValue[];
  hasDefaultValue?: boolean;
}

/** An issue type within a createmeta project, including its create-screen fields. */
export interface CreateMetaIssueType {
  id: string;
  name: string;
  subtask: boolean;
  fields?: Record<string, CreateMetaField>;
}

/** A project entry in the createmeta response. */
export interface CreateMetaProject {
  id: string;
  key: string;
  name: string;
  issuetypes: CreateMetaIssueType[];
}

/** Top-level createmeta response (classic bulk shape — removed on Cloud / DC 10+). */
export interface CreateMetaResponse {
  projects: CreateMetaProject[];
}

// Modern createmeta endpoints (Jira Cloud + DC 8.4+):
//   GET /rest/api/2/issue/createmeta/{projectKey}/issuetypes
//   GET /rest/api/2/issue/createmeta/{projectKey}/issuetypes/{issueTypeId}
// Both return paginated `values` arrays.

/** Paginated issue-type list for a project from the modern createmeta endpoint. */
export interface CreateMetaIssueTypesResponse {
  values: CreateMetaIssueType[];
  total?: number;
  isLast?: boolean;
}

/** One field from the modern per-issue-type createmeta endpoint (carries its own fieldId). */
export interface CreateMetaFieldEntry extends CreateMetaField {
  fieldId: string;
}

/** Paginated field list for one issue type from the modern createmeta endpoint. */
export interface CreateMetaFieldsResponse {
  values: CreateMetaFieldEntry[];
  total?: number;
  isLast?: boolean;
}

/** Request body for POST /rest/api/2/issue. */
export interface CreateIssueRequest {
  fields: Record<string, unknown>;
}

/** Response body from a successful POST /rest/api/2/issue. */
export interface CreateIssueResponse {
  id: string;
  key: string;
  self: string;
}

/** Current Jira user shape from GET /rest/api/2/myself (used to record template authors). */
export interface JiraMyself {
  displayName?: string;
  name?: string;
  accountId?: string;
}
