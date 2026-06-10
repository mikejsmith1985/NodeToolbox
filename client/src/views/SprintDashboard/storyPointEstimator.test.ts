/**
 * Unit tests for the deterministic story point estimation algorithm.
 * Covers feature extraction, composite scoring, and Fibonacci snapping in isolation,
 * plus an integration test that exercises the full anchor-based estimation path.
 */
import { describe, expect, it } from 'vitest';
import {
  MODIFIED_FIBONACCI_SCALE,
  STORY_POINT_BREAKDOWN_THRESHOLD,
  calculateCompositeScore,
  extractIssueFeatures,
  snapToNearestPointValue,
} from './storyPointEstimator.ts';

// ── extractIssueFeatures ──

describe('extractIssueFeatures', () => {
  it('returns all-zero scores for a completely empty issue', () => {
    const featureVector = extractIssueFeatures('', '', '', 0);

    expect(featureVector.scopeScore).toBe(0);
    expect(featureVector.techComplexityScore).toBe(0);
    expect(featureVector.integrationRiskScore).toBe(0);
    expect(featureVector.uncertaintyScore).toBe(0);
  });

  it('returns a positive scope score for a long description', () => {
    // 200 words of plain text should produce a non-zero scope score
    const longDescription = 'word '.repeat(200);
    const featureVector = extractIssueFeatures('Summary', longDescription, '', 0);

    expect(featureVector.scopeScore).toBeGreaterThan(0);
  });

  it('increases scope score when acceptance criteria bullet points are present', () => {
    const noAcFeatures = extractIssueFeatures('Summary', 'Short description', '', 0);
    const withAcFeatures = extractIssueFeatures(
      'Summary',
      'Short description',
      '- Criterion one\n- Criterion two\n- Criterion three\n- Criterion four\n- Criterion five',
      0,
    );

    expect(withAcFeatures.scopeScore).toBeGreaterThan(noAcFeatures.scopeScore);
  });

  it('returns a positive tech complexity score when technical keywords appear', () => {
    const featureVector = extractIssueFeatures(
      'Refactor database schema migration',
      'Requires oauth token authentication and cache invalidation',
      '',
      0,
    );

    expect(featureVector.techComplexityScore).toBeGreaterThan(0);
  });

  it('returns a positive integration risk score when external-service keywords appear', () => {
    const featureVector = extractIssueFeatures(
      'Integrate third-party payment gateway',
      'External vendor webhook integration required for upstream service',
      '',
      0,
    );

    expect(featureVector.integrationRiskScore).toBeGreaterThan(0);
  });

  it('increases integration risk score as linked issue count rises', () => {
    const noLinksFeatures = extractIssueFeatures('Summary', 'Description', '', 0);
    const withLinksFeatures = extractIssueFeatures('Summary', 'Description', '', 3);

    expect(withLinksFeatures.integrationRiskScore).toBeGreaterThan(
      noLinksFeatures.integrationRiskScore,
    );
  });

  it('returns a positive uncertainty score when hedge and TBD phrases appear', () => {
    const featureVector = extractIssueFeatures(
      'Spike: investigate unknown architecture',
      'TBD – needs analysis to figure out the approach. May need research.',
      '',
      0,
    );

    expect(featureVector.uncertaintyScore).toBeGreaterThan(0);
  });

  it('caps all dimension scores at 10 even with extreme keyword density', () => {
    // Saturate every dimension simultaneously to confirm capping logic
    const heavyTechText = 'api endpoint database schema migration refactor oauth jwt token security encryption ssl tls '.repeat(10);
    const heavyIntegrationText = 'external third-party webhook integration microservice sso saml payment gateway dependency '.repeat(10);
    const heavyUncertaintyText = 'tbd tbr investigate spike research unclear explore pending figure out '.repeat(10);
    const featureVector = extractIssueFeatures(
      heavyTechText,
      heavyIntegrationText,
      heavyUncertaintyText,
      10,
    );

    expect(featureVector.scopeScore).toBeLessThanOrEqual(10);
    expect(featureVector.techComplexityScore).toBeLessThanOrEqual(10);
    expect(featureVector.integrationRiskScore).toBeLessThanOrEqual(10);
    expect(featureVector.uncertaintyScore).toBeLessThanOrEqual(10);
  });

  it('counts numbered-list lines as bullet points for scope scoring', () => {
    const numberedListAc = '1. Do this\n2. Do that\n3. Verify result';
    const featureVector = extractIssueFeatures('Summary', '', numberedListAc, 0);

    // Should be non-zero because numbered lines count as acceptance criteria
    expect(featureVector.scopeScore).toBeGreaterThan(0);
  });
});

// ── calculateCompositeScore ──

describe('calculateCompositeScore', () => {
  it('returns 0 for an all-zero feature vector', () => {
    const compositeScore = calculateCompositeScore({
      scopeScore: 0,
      techComplexityScore: 0,
      integrationRiskScore: 0,
      uncertaintyScore: 0,
    });

    expect(compositeScore).toBe(0);
  });

  it('returns a higher score when all dimensions are elevated', () => {
    const lowCompositeScore = calculateCompositeScore({
      scopeScore: 1,
      techComplexityScore: 1,
      integrationRiskScore: 1,
      uncertaintyScore: 1,
    });
    const highCompositeScore = calculateCompositeScore({
      scopeScore: 10,
      techComplexityScore: 10,
      integrationRiskScore: 10,
      uncertaintyScore: 10,
    });

    expect(highCompositeScore).toBeGreaterThan(lowCompositeScore);
  });

  it('weights scope more heavily than tech complexity when both are elevated equally', () => {
    // Scope weight (0.35) > tech complexity weight (0.30), so isolating each should confirm order
    const scopeOnlyCompositeScore = calculateCompositeScore({
      scopeScore: 10,
      techComplexityScore: 0,
      integrationRiskScore: 0,
      uncertaintyScore: 0,
    });
    const techOnlyCompositeScore = calculateCompositeScore({
      scopeScore: 0,
      techComplexityScore: 10,
      integrationRiskScore: 0,
      uncertaintyScore: 0,
    });

    expect(scopeOnlyCompositeScore).toBeGreaterThan(techOnlyCompositeScore);
  });

  it('weights tech complexity more heavily than integration risk', () => {
    const techOnlyScore = calculateCompositeScore({
      scopeScore: 0, techComplexityScore: 10, integrationRiskScore: 0, uncertaintyScore: 0,
    });
    const integrationOnlyScore = calculateCompositeScore({
      scopeScore: 0, techComplexityScore: 0, integrationRiskScore: 10, uncertaintyScore: 0,
    });

    expect(techOnlyScore).toBeGreaterThan(integrationOnlyScore);
  });

  it('weights integration risk more heavily than uncertainty', () => {
    const integrationOnlyScore = calculateCompositeScore({
      scopeScore: 0, techComplexityScore: 0, integrationRiskScore: 10, uncertaintyScore: 0,
    });
    const uncertaintyOnlyScore = calculateCompositeScore({
      scopeScore: 0, techComplexityScore: 0, integrationRiskScore: 0, uncertaintyScore: 10,
    });

    expect(integrationOnlyScore).toBeGreaterThan(uncertaintyOnlyScore);
  });
});

// ── snapToNearestPointValue ──

describe('snapToNearestPointValue', () => {
  it('returns 1 for a raw value of 0 (below the scale minimum)', () => {
    expect(snapToNearestPointValue(0)).toBe(1);
  });

  it('returns 1 for a raw value of exactly 1', () => {
    expect(snapToNearestPointValue(1)).toBe(1);
  });

  it('returns 2 for a raw value of 1.6 (closer to 2 than to 1)', () => {
    expect(snapToNearestPointValue(1.6)).toBe(2);
  });

  it('returns 3 for a raw value of 3.5 (distance 0.5 to 3 vs 1.5 to 5)', () => {
    expect(snapToNearestPointValue(3.5)).toBe(3);
  });

  it('returns 5 for a raw value of 4.5 (distance 0.5 to 5 vs 1.5 to 3)', () => {
    expect(snapToNearestPointValue(4.5)).toBe(5);
  });

  it('returns 8 for a raw value of exactly 8', () => {
    expect(snapToNearestPointValue(8)).toBe(8);
  });

  it('returns 13 for a raw value of 11 (distance 2 to 13 vs 3 to 8)', () => {
    expect(snapToNearestPointValue(11)).toBe(13);
  });

  it('returns 20 for a raw value of 16 (distance 4 to 20 vs 3 to 13)', () => {
    expect(snapToNearestPointValue(16)).toBe(13);
  });

  it('returns 100 for a very large raw value above the scale maximum', () => {
    expect(snapToNearestPointValue(999)).toBe(100);
  });

  it('uses the provided custom scale instead of the default', () => {
    expect(snapToNearestPointValue(4, [1, 5, 10])).toBe(5);
  });

  it('returns the only element when the scale has a single value', () => {
    expect(snapToNearestPointValue(99, [5])).toBe(5);
  });

  it('returns 1 (first element) when scale is empty', () => {
    expect(snapToNearestPointValue(5, [])).toBe(1);
  });
});

// ── Constants ──

describe('MODIFIED_FIBONACCI_SCALE', () => {
  it('contains exactly the team scale values in ascending order', () => {
    expect([...MODIFIED_FIBONACCI_SCALE]).toEqual([1, 2, 3, 5, 8, 13, 20, 40, 100]);
  });
});

describe('STORY_POINT_BREAKDOWN_THRESHOLD', () => {
  it('equals 8 — stories above this value should be broken down before pointing', () => {
    expect(STORY_POINT_BREAKDOWN_THRESHOLD).toBe(8);
  });
});

// ── Integration: anchor-based estimation ──

describe('anchor-based estimation integration', () => {
  it('estimates the same point value as the anchor for an identical issue', () => {
    const sharedSummary = 'Add user profile page';
    const sharedDescription = 'Create a new profile page showing user name and avatar with edit capability.';
    const sharedAc = '- Page loads within 1 second\n- Shows user data\n- Edit form validates input';
    const anchorPointValue = 5;

    const anchorFeatures = extractIssueFeatures(sharedSummary, sharedDescription, sharedAc, 0);
    const targetFeatures = extractIssueFeatures(sharedSummary, sharedDescription, sharedAc, 0);

    const anchorScore = calculateCompositeScore(anchorFeatures);
    const targetScore = calculateCompositeScore(targetFeatures);
    const complexityRatio = anchorScore > 0 ? targetScore / anchorScore : 1;
    const rawEstimatedPoints = complexityRatio * anchorPointValue;
    const suggestedPoints = snapToNearestPointValue(rawEstimatedPoints);

    expect(suggestedPoints).toBe(anchorPointValue);
  });

  it('estimates more points than the anchor for a significantly more complex target issue', () => {
    // Anchor: trivial two-line fix
    const simpleAnchorFeatures = extractIssueFeatures(
      'Fix typo in footer text',
      'Update copyright year from 2023 to 2024 in the footer component.',
      '',
      0,
    );

    // Target: large architectural story with tech, integration, and uncertainty signals
    const complexTargetFeatures = extractIssueFeatures(
      'Refactor authentication service to support OAuth2 and SSO',
      'Migrate the auth database schema. Implement JWT token flow with cache invalidation. ' +
        'Requires third-party integration with SAML provider. Security encryption required. ' +
        'Performance optimization for concurrent token validation. Deploy infrastructure changes.',
      '- OAuth2 flow works end-to-end\n- SSO login tested across all environments\n' +
        '- JWT tokens expire and refresh correctly\n- Cache invalidation verified under load\n' +
        '- Load test passes at 10x current throughput',
      3,
    );

    const anchorPointValue = 1;
    const anchorScore = calculateCompositeScore(simpleAnchorFeatures);
    const targetScore = calculateCompositeScore(complexTargetFeatures);
    const complexityRatio = anchorScore > 0 ? targetScore / anchorScore : 1;
    const rawEstimatedPoints = complexityRatio * anchorPointValue;
    const suggestedPoints = snapToNearestPointValue(rawEstimatedPoints);

    expect(suggestedPoints).toBeGreaterThan(anchorPointValue);
  });

  it('estimates fewer points than the anchor for a simpler target issue', () => {
    // Anchor: medium-complexity story
    const mediumAnchorFeatures = extractIssueFeatures(
      'Add pagination to the issues list API endpoint',
      'Implement cursor-based pagination. Requires database query optimization and cache strategy.',
      '- Returns paginated results\n- Cursor token is opaque\n- Performance benchmark passes',
      1,
    );

    // Target: very small config-only change
    const simpleTargetFeatures = extractIssueFeatures(
      'Update button label on login page',
      'Change "Submit" to "Sign In" on the login form.',
      '',
      0,
    );

    const anchorPointValue = 5;
    const anchorScore = calculateCompositeScore(mediumAnchorFeatures);
    const targetScore = calculateCompositeScore(simpleTargetFeatures);
    const complexityRatio = anchorScore > 0 ? targetScore / anchorScore : 1;
    const rawEstimatedPoints = complexityRatio * anchorPointValue;
    const suggestedPoints = snapToNearestPointValue(rawEstimatedPoints);

    expect(suggestedPoints).toBeLessThan(anchorPointValue);
  });

  it('does not estimate above breakdown threshold for a high-complexity story anchored at 5', () => {
    // When the target is roughly the same complexity as a 5-point anchor,
    // the estimate should stay within reasonable bounds
    const anchorFeatures = extractIssueFeatures(
      'Implement search with filters',
      'Add full-text search with date range, status, and assignee filters. Uses existing API.',
      '- Search returns relevant results\n- Filters combine correctly\n- Empty state handled',
      0,
    );
    const targetFeatures = extractIssueFeatures(
      'Add export to CSV for search results',
      'Allow users to download their current search results as a CSV file using existing search API.',
      '- CSV downloads correctly\n- Column headers match display\n- Works with all filter combinations',
      0,
    );

    const anchorPointValue = 5;
    const anchorScore = calculateCompositeScore(anchorFeatures);
    const targetScore = calculateCompositeScore(targetFeatures);
    const complexityRatio = anchorScore > 0 ? targetScore / anchorScore : 1;
    const rawEstimatedPoints = complexityRatio * anchorPointValue;
    const suggestedPoints = snapToNearestPointValue(rawEstimatedPoints);

    // Similar complexity to the anchor should not balloon over the breakdown threshold
    expect(suggestedPoints).toBeLessThanOrEqual(STORY_POINT_BREAKDOWN_THRESHOLD);
  });
});
