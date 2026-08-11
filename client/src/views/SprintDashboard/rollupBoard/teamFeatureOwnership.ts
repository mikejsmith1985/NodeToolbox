// teamFeatureOwnership.ts — Decides which Features in a PI actually belong to the team looking at them.
//
// A PI holds every team's Features. Asking "which Features in this PI have no work under them" without
// narrowing by team produced 77 rows for a team that owns a handful — most of them other people's, many
// of them cancelled. A list that long is not a signal; it is wallpaper, and it gets scrolled past.
//
// Ownership has three tests because the data supports three, and any one of them is enough:
//   • the team's Product Owner is the ASSIGNEE,
//   • the team's Product Owner is the REPORTER,
//   • the Feature already has a child issue in the team's own project.
// The third catches Features nobody assigned properly but the team is demonstrably working on; the
// first two catch Features that are owned but not yet broken down — which is the entire point here.

// ── Named constants ──

/** Jira's status category for finished work, whatever the status on top of it is named. */
const DONE_STATUS_CATEGORY_KEY = 'done';

/** One Feature the team owns that nothing rolls up to. */
export interface TeamOwnedEmptyFeature {
  featureKey: string;
  summary: string;
  statusName: string;
  storyPoints: number | null;
  assigneeDisplayName: string | null;
  /** Which test placed this Feature with the team, so the reason is never a mystery. */
  ownershipReason: 'assigned-to-po' | 'reported-by-po' | 'has-team-child';
}

/** The identities that count as this team's Product Owner, from the roster. */
export interface TeamOwnershipInputs {
  productOwnerQueryValues: readonly string[];
  /** Features already proven to have a child issue in the team's project. */
  featureKeysWithTeamChildren: readonly string[];
  /** Features that already have a lane, because work rolls up to them. */
  featureKeysWithWork: readonly string[];
  storyPointsFieldIds?: readonly string[];
}

/** True when Jira considers this Feature finished — cancelled and done alike. */
export function isFeatureDone(featureIssue: { fields?: Record<string, unknown> }): boolean {
  const status = featureIssue.fields?.status as { statusCategory?: { key?: string } } | undefined;
  return String(status?.statusCategory?.key ?? '').toLowerCase() === DONE_STATUS_CATEGORY_KEY;
}

/** Every identity a Jira user object might be matched by, lowercased for comparison. */
function readUserIdentities(user: unknown): string[] {
  if (!user || typeof user !== 'object') return [];
  const jiraUser = user as { name?: string; key?: string; accountId?: string; displayName?: string };
  return [jiraUser.name, jiraUser.key, jiraUser.accountId, jiraUser.displayName]
    .filter((identity): identity is string => Boolean(identity))
    .map((identity) => identity.trim().toLowerCase());
}

/** True when this Jira user is one of the team's Product Owners. */
function isProductOwner(user: unknown, productOwnerQueryValues: readonly string[]): boolean {
  const wantedIdentities = productOwnerQueryValues
    .map((queryValue) => queryValue.trim().toLowerCase())
    .filter((queryValue) => queryValue !== '');
  if (wantedIdentities.length === 0) return false;

  return readUserIdentities(user).some((identity) => wantedIdentities.includes(identity));
}

/** Reads the first story-point value this instance actually carries on the issue. */
function readStoryPoints(
  issueFields: Record<string, unknown>,
  storyPointsFieldIds: readonly string[],
): number | null {
  for (const fieldId of storyPointsFieldIds) {
    const pointValue = issueFields[fieldId];
    if (typeof pointValue === 'number') return pointValue;
  }
  return null;
}

/** Which of the three ownership tests this Feature passes, or null when it belongs to another team. */
function resolveOwnershipReason(
  featureIssue: { key: string; fields?: Record<string, unknown> },
  inputs: TeamOwnershipInputs,
): TeamOwnedEmptyFeature['ownershipReason'] | null {
  const issueFields = featureIssue.fields ?? {};

  if (isProductOwner(issueFields.assignee, inputs.productOwnerQueryValues)) return 'assigned-to-po';
  if (isProductOwner(issueFields.reporter, inputs.productOwnerQueryValues)) return 'reported-by-po';
  if (inputs.featureKeysWithTeamChildren.includes(featureIssue.key)) return 'has-team-child';
  return null;
}

/**
 * Narrows a PI's Features to the ones this team owns and has not broken down.
 *
 * Three filters, in the order that discards the most first: finished Features are irrelevant however
 * they were finished, Features another team owns are none of this board's business, and a Feature that
 * already has a lane must not be listed twice.
 */
export function selectTeamOwnedEmptyFeatures(
  piFeatureIssues: readonly { key: string; fields?: Record<string, unknown> }[],
  inputs: TeamOwnershipInputs,
): TeamOwnedEmptyFeature[] {
  const keysWithWork = new Set(inputs.featureKeysWithWork);
  const storyPointsFieldIds = inputs.storyPointsFieldIds ?? [];

  return piFeatureIssues
    .filter((featureIssue) => !isFeatureDone(featureIssue))
    .filter((featureIssue) => !keysWithWork.has(featureIssue.key))
    .map((featureIssue) => ({ featureIssue, ownershipReason: resolveOwnershipReason(featureIssue, inputs) }))
    .filter((candidate): candidate is {
      featureIssue: { key: string; fields?: Record<string, unknown> };
      ownershipReason: TeamOwnedEmptyFeature['ownershipReason'];
    } => candidate.ownershipReason !== null)
    .map(({ featureIssue, ownershipReason }) => {
      const issueFields = featureIssue.fields ?? {};
      const status = issueFields.status as { name?: string } | undefined;
      const assignee = issueFields.assignee as { displayName?: string } | undefined;

      return {
        featureKey: featureIssue.key,
        summary: String(issueFields.summary ?? ''),
        statusName: String(status?.name ?? ''),
        storyPoints: readStoryPoints(issueFields, storyPointsFieldIds),
        assigneeDisplayName: assignee?.displayName ?? null,
        ownershipReason,
      };
    });
}

/**
 * Reads which Features a set of team-project issues points at.
 *
 * This is the third ownership test made concrete: any Feature named by an issue living in the team's
 * own project is one the team is demonstrably working on, whoever it happens to be assigned to.
 */
export function readFeatureKeysFromTeamIssues(
  teamIssues: readonly { fields?: Record<string, unknown> }[],
  featureLinkFieldId: string,
): string[] {
  const featureKeys = new Set<string>();

  for (const teamIssue of teamIssues) {
    const rawValue = teamIssue.fields?.[featureLinkFieldId];
    const featureKey = typeof rawValue === 'string'
      ? rawValue
      : (rawValue as { key?: string } | undefined)?.key ?? '';
    if (featureKey) featureKeys.add(String(featureKey));
  }

  return [...featureKeys];
}
