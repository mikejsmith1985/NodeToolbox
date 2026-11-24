// enrollmentDashboardKit.ts — Pure definitions for the Enrollment Master Dashboard's Rich Filters clauses (GH #511).
//
// Background (plain English): each Jira migration wipes the Enrollment dashboard, and nobody remembers how
// it was built. The dashboard runs on ONE saved filter the owner already wrote ("All of Enrollment Query"),
// and every gadget narrows it with a Rich Filters clause (a smart filter, a view or a static filter). This
// module is the written-down recipe for those clauses. It knows the two Enrollment teams: Cleanup Crew (CUC)
// works in ENCUC and Transformers in ENFCT, and each team's Epics live in OTHER projects, owned by that team's
// Product Owner. It never talks to Jira; the Admin Hub panel feeds it live data and only ever reads.

// ── Named constants ──

/** The owner's own saved base filter that the whole dashboard runs on; the kit builds on it and never replaces it. */
export const BASE_FILTER_NAME = 'All of Enrollment Query';
/** JQL's sort suffix, which a saved filter may carry but which is not allowed inside parentheses. */
const ORDER_BY_PATTERN = /\border\s+by\b/i;
/** How far back "done recently" looks, as a JQL relative date. */
const DONE_RECENTLY_WINDOW = '-30d';
/** How long an in-progress item may sit without a status change before it counts as stuck. */
const STUCK_WINDOW = '-10d';
/** Jira's status-category key for finished work, identical on every instance. */
const DONE_CATEGORY_KEY = 'done';

/** One Enrollment team: its smart-filter label, its team-level project, and how to find its PO. */
export interface KitTeam {
  label: 'CUC' | 'TRANSFORMERS';
  displayName: string;
  projectKey: string;
  /** Typed into Jira's user search to list candidates for this team's Product Owner. */
  productOwnerSearch: string;
  /** Every word that must appear in the PO's display name for the panel to pre-select them. */
  productOwnerNameWords: readonly string[];
}

/** The two Enrollment teams, as confirmed by the owner on GH #511. */
export const KIT_TEAMS: readonly KitTeam[] = [
  {
    label: 'CUC', displayName: 'CUC', projectKey: 'ENCUC',
    productOwnerSearch: 'Phatate', productOwnerNameWords: ['phatate', 'smita'],
  },
  {
    label: 'TRANSFORMERS', displayName: 'Transformers', projectKey: 'ENFCT',
    productOwnerSearch: 'Watkins', productOwnerNameWords: ['watkins', 'jen'],
  },
];

/** Everything the JQL depends on that must be read live from the instance. */
export interface KitInputs {
  /** How JQL names the Product Owner field: a quoted display name, or cf[id] when the name is ambiguous. */
  productOwnerFieldReference: string;
  /** Each team's PO as Jira's user identifier (username on Data Center, accountId on Cloud). */
  productOwnerUserByTeam: Record<KitTeam['label'], string>;
  /** Every status name in the "done" category across both team projects. */
  doneStatusNames: readonly string[];
}

/** One clause to type into a Rich Filters tab; the rich filter's base filter already supplies the scope. */
export interface RichFilterClause {
  tab: string;
  name: string;
  clause: string;
}

// ── JQL building blocks ──

/** Wraps a JQL value in double quotes, escaping backslashes and quotes so names with punctuation stay valid. */
export function quoteJqlValue(rawValue: string): string {
  return `"${String(rawValue).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Decides how JQL should name a custom field. A quoted display name reads well inside Rich Filters, but
 * when two fields share a name Jira cannot tell them apart, so the numeric cf[id] form is used instead.
 * Returns null when the field id is not on this instance.
 */
export function buildFieldJqlReference(
  fieldId: string,
  availableFields: readonly { id: string; name: string }[],
): string | null {
  const field = availableFields.find((candidate) => candidate.id === fieldId);
  if (!fieldId || !field) return null;
  const sameNameCount = availableFields.filter((candidate) => candidate.name === field.name).length;
  if (sameNameCount === 1) return quoteJqlValue(field.name);
  const numericSuffix = /(\d+)$/.exec(fieldId);
  return numericSuffix ? `cf[${numericSuffix[1]}]` : null;
}

/** The team projects as a JQL list, e.g. "ENCUC, ENFCT". */
function listTeamProjects(): string {
  return KIT_TEAMS.map((team) => team.projectKey).join(', ');
}

/** The team projects' own Stories, Defects and Tasks: no Epics (their sizes would swamp points) and no sub-tasks. */
function buildTeamWorkScope(): string {
  return `project in (${listTeamProjects()}) AND issuetype != Epic AND issuetype not in subTaskIssueTypes()`;
}

/** One team: its own project, plus Epics anywhere whose Product Owner is that team's PO. */
function buildTeamClause(team: KitTeam, inputs: KitInputs): string {
  const productOwner = quoteJqlValue(inputs.productOwnerUserByTeam[team.label]);
  return `project = ${team.projectKey} OR (issuetype = Epic AND ${inputs.productOwnerFieldReference} = ${productOwner})`;
}

/** Both POs as a quoted JQL list. */
function listProductOwners(inputs: KitInputs): string {
  return KIT_TEAMS.map((team) => quoteJqlValue(inputs.productOwnerUserByTeam[team.label])).join(', ');
}

/**
 * The status slices every dashboard section filters on. "Done recently" is only built when the instance
 * reports done statuses, because JQL's CHANGED TO needs real status names and an empty list is invalid.
 */
function buildSliceClauses(inputs: KitInputs): Array<{ name: string; clause: string; description: string }> {
  const slices = [
    { name: 'In Progress', clause: 'statusCategory = "In Progress"', description: 'Team work being worked now.' },
    {
      name: 'Upcoming', clause: 'sprint in futureSprints() AND statusCategory != Done',
      description: 'Team work planned into a future sprint.',
    },
    {
      name: 'Flagged', clause: 'Flagged is not EMPTY AND statusCategory != Done',
      description: 'Open team work someone has flagged as blocked.',
    },
    {
      name: 'Stuck 10 Days', clause: `statusCategory = "In Progress" AND NOT status CHANGED AFTER ${STUCK_WINDOW}`,
      description: 'In-progress team work whose status has not moved in 10 days.',
    },
  ];
  if (inputs.doneStatusNames.length === 0) return slices;
  const doneList = inputs.doneStatusNames.map(quoteJqlValue).join(', ');
  return [
    ...slices.slice(0, 1),
    {
      name: 'Done 30 Days',
      clause: `statusCategory = Done AND status CHANGED TO (${doneList}) AFTER ${DONE_RECENTLY_WINDOW}`,
      description: 'Team work that reached a done status in the last 30 days.',
    },
    ...slices.slice(1),
  ];
}

// ── The clauses ──

/** Builds the clause-only JQL to type into the Rich Filters tabs (smart filter, views, static filters). */
export function buildRichFilterClauses(inputs: KitInputs): RichFilterClause[] {
  const productOwners = listProductOwners(inputs);
  return [
    ...KIT_TEAMS.map((team) => ({ tab: 'Smart filter "Team"', name: team.label, clause: buildTeamClause(team, inputs) })),
    { tab: 'View', name: 'Team Work', clause: buildTeamWorkScope() },
    {
      tab: 'View', name: 'Epics',
      clause: `issuetype = Epic AND ${inputs.productOwnerFieldReference} in (${productOwners}) AND project not in (${listTeamProjects()})`,
    },
    ...buildSliceClauses(inputs).map((slice) => ({ tab: 'Static filter', name: slice.name, clause: slice.clause })),
  ];
}

// ── Live-data readers ──

/** The slice of GET /rest/api/2/project/{key}/statuses this module reads: statuses grouped by issue type. */
export interface ProjectIssueTypeStatuses {
  name: string;
  statuses: Array<{ name: string; statusCategory?: { key?: string } }>;
}

/** Collects every done-category status name across the given projects, de-duplicated and sorted. */
export function readDoneStatusNames(projectStatuses: readonly (readonly ProjectIssueTypeStatuses[])[]): string[] {
  const doneNames = new Set<string>();
  for (const issueTypes of projectStatuses) {
    for (const issueType of issueTypes) {
      for (const status of issueType.statuses ?? []) {
        if (status.statusCategory?.key === DONE_CATEGORY_KEY) doneNames.add(status.name);
      }
    }
  }
  return [...doneNames].sort();
}

// ── The base filter ──

/** A saved filter as GET /rest/api/2/filter/favourite returns it (the fields this module reads). */
export interface SavedFilter {
  id: string;
  name: string;
  jql: string;
}

/** Finds the owner's base filter among the favourites by its exact name; '' when it is not there. */
export function pickBaseFilterId(filters: readonly SavedFilter[]): string {
  return filters.find((filter) => filter.name === BASE_FILTER_NAME)?.id ?? '';
}

/** The base filter's JQL without any ORDER BY, so it can be wrapped in parentheses and combined. */
export function stripOrderBy(jql: string): string {
  return String(jql || '').split(ORDER_BY_PATTERN)[0].trim();
}

/**
 * Runs one Rich Filters clause inside the base filter, which is exactly what the gadget will show — so the
 * live count the panel reports for a clause is the number the dashboard will display.
 */
export function scopeClauseToBase(baseJql: string, clause: string): string {
  return `(${stripOrderBy(baseJql)}) AND (${clause})`;
}
