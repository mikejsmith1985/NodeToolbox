// enrollmentDashboardKit.ts — Pure definitions for the Enrollment Master Dashboard's saved Jira filters (GH #511).
//
// Background (plain English): each Jira migration wipes the Enrollment dashboard, and nobody remembers how
// it was built. This module is the written-down recipe. It knows the two Enrollment teams: Cleanup Crew
// (CUC) works in ENCUC and Transformers in ENFCT, and each team's Epics live in OTHER projects, owned by
// that team's Product Owner. From that it builds the JQL for every saved filter the dashboard needs, and it
// plans the safe set of writes (create what is missing, update what drifted, leave the rest alone). It never
// talks to Jira; the Admin Hub panel feeds it live data and carries out the plan.

// ── Named constants ──

/** Every kit filter starts with this, so a re-run finds its own filters by name and never duplicates them. */
export const KIT_FILTER_PREFIX = 'Enrollment Kit — ';
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

/** One saved Jira filter the kit owns. */
export interface KitFilterDefinition {
  name: string;
  jql: string;
  description: string;
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

// ── The filters and clauses ──

/** Builds every saved Jira filter the Enrollment dashboard uses, each standalone so plain gadgets can use it too. */
export function buildKitFilters(inputs: KitInputs): KitFilterDefinition[] {
  const teamWorkScope = buildTeamWorkScope();
  const filters: KitFilterDefinition[] = [
    {
      name: `${KIT_FILTER_PREFIX}All Work`,
      jql: `project in (${listTeamProjects()}) OR (issuetype = Epic AND ${inputs.productOwnerFieldReference} in (${listProductOwners(inputs)}))`,
      description: 'Base filter for the Enrollment rich filter: both team projects plus each PO\'s Epics.',
    },
    ...KIT_TEAMS.map((team) => ({
      name: `${KIT_FILTER_PREFIX}Team ${team.displayName}`,
      jql: buildTeamClause(team, inputs),
      description: `${team.displayName}: ${team.projectKey} plus Epics its Product Owner owns.`,
    })),
    { name: `${KIT_FILTER_PREFIX}Team Work`, jql: teamWorkScope, description: 'Stories, Defects and Tasks only.' },
    {
      name: `${KIT_FILTER_PREFIX}Epics`,
      jql: `issuetype = Epic AND ${inputs.productOwnerFieldReference} in (${listProductOwners(inputs)}) AND project not in (${listTeamProjects()})`,
      description: 'Enrollment Epics, which live outside the team projects.',
    },
  ];
  for (const slice of buildSliceClauses(inputs)) {
    filters.push({ name: `${KIT_FILTER_PREFIX}${slice.name}`, jql: `(${teamWorkScope}) AND ${slice.clause}`, description: slice.description });
  }
  return filters;
}

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

// ── Write planning ──

/** A saved filter that already exists on Jira. */
export interface ExistingFilter {
  id: string;
  name: string;
  jql: string;
}

/** What the apply step will do with one kit filter. */
export interface FilterPlanRow extends KitFilterDefinition {
  action: 'create' | 'update' | 'unchanged';
  existingId: string | null;
}

/** Collapses whitespace so cosmetic spacing differences never count as drift. */
function normalizeJql(jql: string): string {
  return String(jql || '').replace(/\s+/g, ' ').trim();
}

/** Matches each wanted filter to an existing one by exact name, then decides create, update or leave alone. */
export function planFilterActions(
  desired: readonly KitFilterDefinition[],
  existing: readonly ExistingFilter[],
): FilterPlanRow[] {
  return desired.map((filter) => {
    const match = existing.find((candidate) => candidate.name === filter.name);
    if (!match) return { ...filter, action: 'create', existingId: null };
    const isSame = normalizeJql(match.jql) === normalizeJql(filter.jql);
    return { ...filter, action: isSame ? 'unchanged' : 'update', existingId: match.id };
  });
}

/** The slice of GET /rest/api/2/filter/{id}/permission this module reads. */
export interface SharePermission {
  type: string;
  project?: { id?: string };
}

/** Returns the project ids a filter still needs sharing with, so re-runs never add a duplicate share. */
export function planMissingProjectShares(
  existingPermissions: readonly SharePermission[],
  wantedProjectIds: readonly string[],
): string[] {
  const sharedProjectIds = new Set(
    existingPermissions.filter((permission) => permission.type === 'project').map((permission) => String(permission.project?.id)),
  );
  return wantedProjectIds.filter((projectId) => !sharedProjectIds.has(projectId));
}
