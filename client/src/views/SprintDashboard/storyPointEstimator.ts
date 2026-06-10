/**
 * Deterministic story point estimation using anchor-based rubric scoring.
 * No LLM or AI is used — all scoring derives from keyword density,
 * text length, and structural signals extracted from Jira issue fields.
 *
 * Algorithm overview:
 *   1. Extract a four-dimension feature vector from the issue's plain-text fields.
 *   2. Compute a weighted composite score (0–10).
 *   3. Divide by the anchor's composite score to get a relative complexity ratio.
 *   4. Multiply the ratio by the anchor's known point value, then snap to the point scale.
 */

// ── Constants ──

/**
 * Modified Fibonacci scale used by this team for story pointing.
 * Stories estimated above STORY_POINT_BREAKDOWN_THRESHOLD should be split into smaller tickets.
 */
export const MODIFIED_FIBONACCI_SCALE = [1, 2, 3, 5, 8, 13, 20, 40, 100] as const;

/** Stories estimated above this value are flagged for breakdown rather than pointed as-is. */
export const STORY_POINT_BREAKDOWN_THRESHOLD = 8;

// Dimension weights — must sum to 1.0.
// Scope carries the most weight because description length and acceptance-criteria count
// are the strongest predictors of team estimation disagreements in practice.
const SCOPE_WEIGHT = 0.35;
const TECH_COMPLEXITY_WEIGHT = 0.30;
const INTEGRATION_RISK_WEIGHT = 0.20;
const UNCERTAINTY_WEIGHT = 0.15;

// Scope scoring sub-constants
const SCOPE_WORDS_PER_SCORE_UNIT = 50;   // each 50 words adds 1 point to the word-count component
const SCOPE_MAX_WORD_SCORE = 7;           // word count contributes at most 7 of 10 points
const SCOPE_MAX_CRITERIA_SCORE = 3;       // bullet-point count contributes the remaining 3
const SCOPE_CRITERIA_DIVISOR = 5;         // 5 criteria = max criteria score

// Keyword hit multipliers — how many score points each keyword occurrence adds
const TECH_POINTS_PER_KEYWORD = 2;
const INTEGRATION_POINTS_PER_KEYWORD = 2;
const INTEGRATION_LINKED_ISSUE_BONUS = 1.5;       // per linked issue
const INTEGRATION_MAX_LINKED_ISSUE_SCORE = 4.5;   // cap at 3 linked issues worth of bonus
const UNCERTAINTY_POINTS_PER_KEYWORD = 3;
const DIMENSION_SCORE_CAP = 10;

/**
 * Technical complexity signals — terms that indicate non-trivial engineering effort
 * such as system-level changes, security concerns, or significant algorithm work.
 */
const TECH_COMPLEXITY_KEYWORDS: readonly string[] = [
  'api', 'endpoint', 'database', 'schema', 'migration', 'refactor',
  'authentication', 'authorization', 'async', 'query', 'cache', 'redis',
  'index', 'performance', 'optimize', 'algorithm', 'concurrency', 'transaction',
  'configuration', 'deploy', 'infrastructure', 'architecture', 'security',
  'encryption', 'ssl', 'tls', 'oauth', 'jwt', 'token', 'event', 'stream',
];

/**
 * Integration risk signals — terms that indicate a dependency on external systems
 * or cross-team work, which historically widens estimation spread.
 */
const INTEGRATION_RISK_KEYWORDS: readonly string[] = [
  'external', 'third-party', 'third party', 'webhook', 'integration',
  'microservice', 'sso', 'saml', 'payment', 'gateway', 'service call',
  'dependency', 'provider', 'vendor', 'downstream', 'upstream',
];

/**
 * Uncertainty signals — phrases that indicate the scope is not fully understood,
 * which increases the risk of the estimate being significantly wrong.
 */
const UNCERTAINTY_KEYWORDS: readonly string[] = [
  'tbd', 'tbr', 'tbc', 'unknown', 'investigate', 'spike', 'research',
  'unclear', 'explore', 'to be determined', 'to be decided', 'pending',
  'needs analysis', 'figure out', 'look into', 'may need', 'might need',
];

// ── Types ──

/** Decomposed complexity signals extracted from a Jira issue's plain-text fields. */
export interface IssueFeatureVector {
  /** How much written content and acceptance criteria the issue contains (0–10). */
  scopeScore: number;
  /** Density of technical-keyword hits across all text fields (0–10). */
  techComplexityScore: number;
  /** Density of cross-system keyword hits plus a bonus for each linked Jira issue (0–10). */
  integrationRiskScore: number;
  /** Density of uncertainty / TBD phrase hits (0–10). */
  uncertaintyScore: number;
}

// ── Private text helpers ──

/**
 * Counts how many times each keyword in the list appears in the given text.
 * Case-insensitive; counts every occurrence, not just the first.
 */
function countKeywordMatches(text: string, keywords: readonly string[]): number {
  const lowerCaseText = text.toLowerCase();
  return keywords.reduce(
    (totalCount, keyword) => totalCount + (lowerCaseText.split(keyword).length - 1),
    0,
  );
}

/**
 * Counts bullet-point lines in plain text — a lightweight proxy for how many
 * distinct acceptance criteria or sub-steps the story requires.
 */
function countBulletLines(text: string): number {
  return text
    .split('\n')
    .filter((line) => /^\s*[-*•·]\s+/.test(line) || /^\s*\d+\.\s+/.test(line))
    .length;
}

/** Returns the number of non-empty words in the given string. */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}

// ── Core algorithm (exported for testing) ──

/**
 * Extracts a numeric feature vector from a Jira issue's plain-text content.
 * All text parameters must already be plain text (Atlassian Document Format stripped).
 * Returns four dimension scores, each capped in the range [0, 10].
 */
export function extractIssueFeatures(
  summaryText: string,
  descriptionText: string,
  acceptanceCriteriaText: string,
  linkedIssueCount: number,
): IssueFeatureVector {
  const combinedText = [summaryText, descriptionText, acceptanceCriteriaText].join(' ');

  // Scope: proportional to total word count (up to 7 pts) + bullet count (up to 3 pts).
  // Long, well-documented stories with explicit criteria consistently take more effort.
  const totalWordCount = countWords(combinedText);
  const wordCountScore = Math.min(totalWordCount / SCOPE_WORDS_PER_SCORE_UNIT, 1) * SCOPE_MAX_WORD_SCORE;
  const criteriaCount = countBulletLines(acceptanceCriteriaText) || countBulletLines(descriptionText);
  const criteriaScore = Math.min(criteriaCount / SCOPE_CRITERIA_DIVISOR, 1) * SCOPE_MAX_CRITERIA_SCORE;
  const scopeScore = Math.min(wordCountScore + criteriaScore, DIMENSION_SCORE_CAP);

  // Tech complexity: each matching keyword adds TECH_POINTS_PER_KEYWORD, capped at 10.
  const techMatchCount = countKeywordMatches(combinedText, TECH_COMPLEXITY_KEYWORDS);
  const techComplexityScore = Math.min(techMatchCount * TECH_POINTS_PER_KEYWORD, DIMENSION_SCORE_CAP);

  // Integration risk: keyword density plus a bonus for every linked Jira issue, since
  // each link usually represents a cross-team dependency that widens actual cycle time.
  const integrationMatchCount = countKeywordMatches(combinedText, INTEGRATION_RISK_KEYWORDS);
  const linkedIssueBonus = Math.min(
    linkedIssueCount * INTEGRATION_LINKED_ISSUE_BONUS,
    INTEGRATION_MAX_LINKED_ISSUE_SCORE,
  );
  const integrationRiskScore = Math.min(
    integrationMatchCount * INTEGRATION_POINTS_PER_KEYWORD + linkedIssueBonus,
    DIMENSION_SCORE_CAP,
  );

  // Uncertainty: hedge-word density. High uncertainty means the team will likely discover
  // more work once they start, raising the effective complexity regardless of the current text.
  const uncertaintyMatchCount = countKeywordMatches(combinedText, UNCERTAINTY_KEYWORDS);
  const uncertaintyScore = Math.min(
    uncertaintyMatchCount * UNCERTAINTY_POINTS_PER_KEYWORD,
    DIMENSION_SCORE_CAP,
  );

  return { scopeScore, techComplexityScore, integrationRiskScore, uncertaintyScore };
}

/**
 * Collapses the four dimension scores into a single composite complexity number.
 * The weights are ordered by their empirical correlation with estimation variance:
 * scope → technical → integration → uncertainty.
 */
export function calculateCompositeScore(features: IssueFeatureVector): number {
  return (
    features.scopeScore * SCOPE_WEIGHT
    + features.techComplexityScore * TECH_COMPLEXITY_WEIGHT
    + features.integrationRiskScore * INTEGRATION_RISK_WEIGHT
    + features.uncertaintyScore * UNCERTAINTY_WEIGHT
  );
}

/**
 * Rounds a raw estimated point value to the nearest value in the provided scale.
 * Falls back to the team's modified Fibonacci scale when no scale is given.
 * Ties are broken in favour of the higher value (closer to the next scale step).
 */
export function snapToNearestPointValue(
  rawPoints: number,
  scale: readonly number[] = MODIFIED_FIBONACCI_SCALE,
): number {
  if (scale.length === 0) {
    return 1;
  }
  return [...scale].reduce((closestValue, currentValue) =>
    Math.abs(currentValue - rawPoints) < Math.abs(closestValue - rawPoints)
      ? currentValue
      : closestValue,
  );
}
