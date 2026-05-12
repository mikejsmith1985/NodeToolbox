// issueLinkCalculator.ts — Pure functions for detecting Jira ↔ SNow issue links
// and computing the health status of each linked pair.
//
// Linking convention (no new fields required):
//   Jira side:  customfield_11203 on Defect and Story issue types holds the SNow reference.
//   SNow side:  The Jira issue key (e.g. "TBX-123") is appended to the SNow Problem's
//               problem_statement field.
//
// Health calculation:
//   The only mapped field today is "status". More fields can be added to
//   MAPPED_FIELD_EVALUATORS without changing the health calculation logic.

import type { JiraIssue } from '../types/jira.ts';
import type { SnowMyIssue } from '../types/snow.ts';
import type { HealthStatus, LinkedIssuePair, StatusMapping } from '../types/issueLinking.ts';

// ── Constants ──

/**
 * The Jira issue type names that participate in the Jira↔SNow linking workflow.
 * Only Defects and Stories carry customfield_11203; other types are excluded.
 */
const LINKABLE_JIRA_ISSUE_TYPES = ['Defect', 'Story', 'Bug'] as const;

/**
 * Regex that matches a Jira issue key at the END of a string.
 * Covers standard project keys: 1–10 uppercase letters, dash, 1–6 digits.
 * The `$` anchor is intentional — the Jira key is appended to problem_statement.
 */
const JIRA_KEY_AT_END_REGEX = /\b([A-Z]{1,10}-\d{1,6})\s*$/;

/**
 * The built-in Jira → SNow status equivalence that is ALWAYS applied regardless
 * of user configuration. It cannot be removed via the settings UI.
 */
const SYSTEM_STATUS_MAPPING: StatusMapping = {
  jiraStatus: 'To Do',
  snowStatus: 'New',
  isSystemDefined: true,
};

// ── Helpers ──

/**
 * Returns true if the Jira issue type is one that can be linked to a SNow Problem.
 * Comparison is case-insensitive to tolerate project-specific type name variants.
 */
function isLinkableJiraIssueType(issueTypeName: string): boolean {
  return LINKABLE_JIRA_ISSUE_TYPES.some(
    (linkableType) => linkableType.toLowerCase() === issueTypeName.toLowerCase(),
  );
}

/**
 * Extracts the Jira key appended to the end of a SNow problem_statement.
 * Returns null if no key is found.
 *
 * Example: "Network issues affecting floor 3. TBX-99." → "TBX-99"
 */
function extractJiraKeyFromProblemStatement(problemStatement: string): string | null {
  const regexMatch = JIRA_KEY_AT_END_REGEX.exec(problemStatement);
  return regexMatch !== null ? regexMatch[1] : null;
}

/**
 * Builds the full set of status mappings by merging the system-defined entry
 * with user-configured ones. System mapping takes precedence if there is a
 * conflict on the Jira status key.
 */
function buildEffectiveStatusMappings(userMappings: StatusMapping[]): StatusMapping[] {
  const nonConflictingUserMappings = userMappings.filter(
    (userMapping) => userMapping.jiraStatus !== SYSTEM_STATUS_MAPPING.jiraStatus,
  );
  return [SYSTEM_STATUS_MAPPING, ...nonConflictingUserMappings];
}

// ── Health calculation ──

/**
 * A single field evaluator tests whether one mapped field matches between
 * the Jira issue and the SNow problem.
 */
type FieldEvaluator = (
  jiraIssue: JiraIssue,
  snowProblem: SnowMyIssue,
  statusMappings: StatusMapping[],
) => boolean;

/**
 * Checks whether the current Jira status maps to the current SNow state
 * according to the active status mappings. This is the primary health indicator.
 */
function evaluateStatusFieldMatch(
  jiraIssue: JiraIssue,
  snowProblem: SnowMyIssue,
  statusMappings: StatusMapping[],
): boolean {
  const jiraStatusName = jiraIssue.fields.status.name;
  const effectiveMappings = buildEffectiveStatusMappings(statusMappings);

  const applicableMapping = effectiveMappings.find(
    (mapping) => mapping.jiraStatus.toLowerCase() === jiraStatusName.toLowerCase(),
  );

  if (applicableMapping === undefined) {
    // No mapping defined for this Jira status — count as a mismatch so the
    // user is prompted to add a mapping rather than silently passing health.
    return false;
  }

  return applicableMapping.snowStatus.toLowerCase() === snowProblem.state.toLowerCase();
}

/**
 * All field evaluators applied during health calculation.
 * Add new entries here to expand the set of mapped fields without touching
 * the calculateHealthStatus function signature.
 */
const MAPPED_FIELD_EVALUATORS: FieldEvaluator[] = [evaluateStatusFieldMatch];

/**
 * Computes the health color for a linked Jira↔SNow pair.
 *
 *   green  = ALL mapped fields match
 *   yellow = some fields match (at least one mismatch but not total failure)
 *   red    = NO fields match
 */
function calculatePairHealth(
  jiraIssue: JiraIssue,
  snowProblem: SnowMyIssue,
  statusMappings: StatusMapping[],
): { healthStatus: HealthStatus; matchingFieldCount: number; totalMappedFieldCount: number } {
  const totalMappedFieldCount = MAPPED_FIELD_EVALUATORS.length;

  const matchingFieldCount = MAPPED_FIELD_EVALUATORS.reduce(
    (matchCount, evaluator) =>
      evaluator(jiraIssue, snowProblem, statusMappings) ? matchCount + 1 : matchCount,
    0,
  );

  let healthStatus: HealthStatus;
  if (matchingFieldCount === totalMappedFieldCount) {
    healthStatus = 'green';
  } else if (matchingFieldCount === 0) {
    healthStatus = 'red';
  } else {
    healthStatus = 'yellow';
  }

  return { healthStatus, matchingFieldCount, totalMappedFieldCount };
}

// ── Public API ──

/**
 * Detects linked Jira↔SNow pairs from the live field values in both systems.
 *
 * Matching logic:
 *   1. For each Jira Defect/Story, check customfield_11203 for a SNow reference.
 *   2. For each SNow Problem, extract the trailing Jira key from problem_statement.
 *   3. A pair is confirmed when BOTH sides reference each other (bidirectional match).
 *
 * Health status and match counts are computed for each pair using the supplied
 * status mappings (user-configured + system-defined).
 *
 * @param jiraIssues - All Jira issues assigned to the current user.
 * @param snowIssues - All SNow issues assigned to the current user.
 * @param userStatusMappings - User-configured status mappings from settingsStore.
 * @returns Array of linked pairs sorted by health (red first, then yellow, then green).
 */
export function detectLinkedPairs(
  jiraIssues: JiraIssue[],
  snowIssues: SnowMyIssue[],
  userStatusMappings: StatusMapping[],
): LinkedIssuePair[] {
  // Build a lookup map of SNow Problems keyed by Jira key extracted from problem_statement.
  // This avoids an O(n²) nested loop when matching.
  const snowProblemsByJiraKey = new Map<string, SnowMyIssue>();
  for (const snowIssue of snowIssues) {
    if (snowIssue.sys_class_name !== 'problem') {
      continue;
    }

    const extractedJiraKey = extractJiraKeyFromProblemStatement(
      snowIssue.problem_statement ?? '',
    );
    if (extractedJiraKey !== null) {
      snowProblemsByJiraKey.set(extractedJiraKey.toUpperCase(), snowIssue);
    }
  }

  const linkedPairs: LinkedIssuePair[] = [];

  for (const jiraIssue of jiraIssues) {
    if (!isLinkableJiraIssueType(jiraIssue.fields.issuetype.name)) {
      continue;
    }

    const snowReference = jiraIssue.fields.customfield_11203;
    if (!snowReference) {
      continue;
    }

    // The SNow Problem must also have the Jira key in its problem_statement — we only
    // surface bidirectionally confirmed pairs to prevent stale one-sided links from
    // creating noise in the UI.
    const matchedSnowProblem = snowProblemsByJiraKey.get(jiraIssue.key.toUpperCase());
    if (matchedSnowProblem === undefined) {
      continue;
    }

    const healthResult = calculatePairHealth(jiraIssue, matchedSnowProblem, userStatusMappings);

    linkedPairs.push({
      pairId: `${jiraIssue.key}::${matchedSnowProblem.sys_id}`,
      jiraIssue,
      snowProblem: matchedSnowProblem,
      ...healthResult,
    });
  }

  // Sort pairs so the most critical (red) appear first.
  const healthSortOrder: Record<HealthStatus, number> = { red: 0, yellow: 1, green: 2 };
  linkedPairs.sort(
    (pairA, pairB) => healthSortOrder[pairA.healthStatus] - healthSortOrder[pairB.healthStatus],
  );

  return linkedPairs;
}

/**
 * Collects the sys_ids of all SNow Problems that are already part of a linked pair.
 * Used by MyIssuesView to exclude linked Problems from the standalone SNow issues list,
 * preventing the same record from appearing twice.
 */
export function collectLinkedSnowSysIds(linkedPairs: LinkedIssuePair[]): Set<string> {
  return new Set(linkedPairs.map((pair) => pair.snowProblem.sys_id));
}
