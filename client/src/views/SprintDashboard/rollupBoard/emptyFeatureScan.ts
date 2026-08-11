// emptyFeatureScan.ts — Finds Features committed to this PI that have no work under them at all.
//
// The board builds its lanes from the work upward: a Feature earns a lane only because something rolls
// up to it. That is deliberate — empty lanes would imply work that does not exist — but it leaves one
// blind spot, and it is the most expensive one on the board. A Feature carrying forty story points and
// no stories is invisible precisely BECAUSE nobody has broken it down, which is the moment somebody
// most needs to see it. DENP-1387 sat in that gap for a whole PI.
//
// So this asks the opposite question from the rest of the board: not "what work is here and where does
// it roll up", but "what did we commit to this PI, and which of it has nothing underneath". The two
// results are reported separately rather than merged, so the lanes keep meaning "real work".

// ── Named constants ──

/** Features are their own issue type; this is the type name every project here uses. */
const FEATURE_ISSUE_TYPE_NAME = 'Feature';

/** Escapes a value for safe inclusion inside a double-quoted JQL string. */
function quoteJqlValue(rawValue: string): string {
  return `"${rawValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Builds the query for every Feature this team owns in this PI.
 *
 * Scoped by the board's own configured Feature projects rather than by the team's project, because
 * Features live somewhere else entirely — that separation is the whole reason this board exists. The
 * project list is the one the team already set in Board setup, so this can never disagree with the
 * lanes beside it.
 *
 * @returns The JQL, or null when there is nothing safe to ask — no PI, no configured Feature project,
 *          or no PI field on this instance. A null must skip the request rather than widen it.
 */
export function buildFeaturesInPiJql(
  featureProjectKeys: readonly string[],
  piName: string,
  piFieldReference: string,
): string | null {
  const trimmedPiName = piName.trim();
  if (trimmedPiName === '' || featureProjectKeys.length === 0 || !piFieldReference) {
    return null;
  }

  const projectList = featureProjectKeys.map((projectKey) => quoteJqlValue(projectKey)).join(', ');
  return [
    `issuetype = ${FEATURE_ISSUE_TYPE_NAME}`,
    `project in (${projectList})`,
    `${piFieldReference} = ${quoteJqlValue(trimmedPiName)}`,
  ].join(' AND ') + ' ORDER BY key ASC';
}

// ── Deciding which are empty ──

/** One Feature in the PI that nothing rolls up to. */
export interface FeatureWithoutWork {
  featureKey: string;
  summary: string;
  statusName: string;
  storyPoints: number | null;
  assigneeDisplayName: string | null;
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

/**
 * Keeps only the Features that have nothing rolling up to them on this board.
 *
 * A Feature with even one child is deliberately excluded: it already has a lane, and repeating it here
 * would turn a precise signal into noise that gets ignored within a week.
 */
export function selectFeaturesWithoutWork(
  piFeatureIssues: readonly { key: string; fields?: Record<string, unknown> }[],
  featureKeysWithWork: readonly string[],
  storyPointsFieldIds: readonly string[] = [],
): FeatureWithoutWork[] {
  const keysWithWork = new Set(featureKeysWithWork);

  return piFeatureIssues
    .filter((featureIssue) => !keysWithWork.has(featureIssue.key))
    .map((featureIssue) => {
      const issueFields = featureIssue.fields ?? {};
      const status = issueFields.status as { name?: string } | undefined;
      const assignee = issueFields.assignee as { displayName?: string } | undefined;

      return {
        featureKey: featureIssue.key,
        summary: String(issueFields.summary ?? ''),
        statusName: String(status?.name ?? ''),
        storyPoints: readStoryPoints(issueFields, storyPointsFieldIds),
        assigneeDisplayName: assignee?.displayName ?? null,
      };
    });
}

/**
 * Sums the points sitting in Features nobody has broken down.
 *
 * A count alone understates the problem — one Feature worth forty points matters far more than three
 * worth one each — so the headline carries the committed points that currently have no plan behind them.
 */
export function sumUnplannedStoryPoints(featuresWithoutWork: readonly FeatureWithoutWork[]): number {
  return featuresWithoutWork.reduce(
    (runningTotal, feature) => runningTotal + (feature.storyPoints ?? 0),
    0,
  );
}
