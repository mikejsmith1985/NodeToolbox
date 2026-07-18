// readinessFeatureQuery.test.ts — Unit tests for the readiness Feature JQL builders + fetch.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));
vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import {
  buildReadinessFeatureJql,
  resolveReadinessScopeClause,
  deriveReadinessPiContext,
  READINESS_FEATURE_MAX_RESULTS,
} from './readinessFeatureQuery.ts';

beforeEach(() => {
  vi.clearAllMocks();
  mockJiraGet.mockResolvedValue({ issues: [] });
});

describe('resolveReadinessScopeClause — scope precedence', () => {
  it('prefers configured feature project keys', () => {
    const clause = resolveReadinessScopeClause(['PORT', 'PROG'], ['team-a']);
    expect(clause).toEqual({ clause: 'project in (PORT, PROG)', description: 'project in (PORT, PROG)' });
  });

  it('falls back to roster labels when no project keys are configured', () => {
    const clause = resolveReadinessScopeClause([], ['team-a', 'team-b']);
    expect(clause.clause).toBe('labels in ("team-a", "team-b")');
  });

  it('applies no scope clause when neither is configured, and says so', () => {
    const clause = resolveReadinessScopeClause([], []);
    expect(clause.clause).toBe('');
    expect(clause.description).toMatch(/no project or label scope/i);
  });
});

describe('buildReadinessFeatureJql', () => {
  it('builds a single-PI equality clause with the derived cf reference and scope', () => {
    const jql = buildReadinessFeatureJql(['PI 26.3'], 'customfield_10301', 'project in (PORT)');
    expect(jql).toBe('issuetype = Feature AND cf[10301] = "PI 26.3" AND project in (PORT)');
  });

  it('builds an IN clause for multiple carryover PIs', () => {
    const jql = buildReadinessFeatureJql(['PI 26.2', 'PI 26.1'], 'customfield_10301', 'project in (PORT)');
    expect(jql).toBe('issuetype = Feature AND cf[10301] in ("PI 26.2", "PI 26.1") AND project in (PORT)');
  });

  it('omits the scope clause entirely when it is empty', () => {
    const jql = buildReadinessFeatureJql(['PI 26.3'], 'customfield_10301', '');
    expect(jql).toBe('issuetype = Feature AND cf[10301] = "PI 26.3"');
  });

  it('derives the cf number from a non-default PI field id', () => {
    const jql = buildReadinessFeatureJql(['PI 26.3'], 'customfield_99999', '');
    expect(jql).toContain('cf[99999] = "PI 26.3"');
  });

  it('returns an empty string when there are no PI names to query', () => {
    expect(buildReadinessFeatureJql([], 'customfield_10301', 'project in (PORT)')).toBe('');
  });

  it('appends a project-exclusion clause for ignored projects', () => {
    const jql = buildReadinessFeatureJql(['PI 26.3'], 'customfield_10301', 'project in (PORT)', ['OTHER', 'MISC']);
    expect(jql).toBe('issuetype = Feature AND cf[10301] = "PI 26.3" AND project in (PORT) AND project not in (OTHER, MISC)');
  });

  it('excludes projects even when there is no positive scope clause', () => {
    const jql = buildReadinessFeatureJql(['PI 26.3'], 'customfield_10301', '', ['OTHER']);
    expect(jql).toBe('issuetype = Feature AND cf[10301] = "PI 26.3" AND project not in (OTHER)');
  });
});

describe('READINESS_FEATURE_MAX_RESULTS', () => {
  it('caps a scope query at 200 results, matching the existing feature-pull ceiling', () => {
    expect(READINESS_FEATURE_MAX_RESULTS).toBe(200);
  });
});

describe('deriveReadinessPiContext — newest-first PI list', () => {
  // Newest first, matching ArtView's sortPiNames output.
  const PIS = ['PI 26.5', 'PI 26.4', 'PI 26.3', 'PI 26.2', 'PI 26.1', 'PI 25.6', 'PI 25.5'];

  it('picks the newer neighbour as upcoming and up to four older PIs as carryover', () => {
    const context = deriveReadinessPiContext('PI 26.3', PIS);
    expect(context.currentPiName).toBe('PI 26.3');
    expect(context.upcomingPiName).toBe('PI 26.4');
    expect(context.carryoverPiNames).toEqual(['PI 26.2', 'PI 26.1', 'PI 25.6', 'PI 25.5']);
  });

  it('reports no upcoming PI when the selected PI is the newest', () => {
    const context = deriveReadinessPiContext('PI 26.5', PIS);
    expect(context.upcomingPiName).toBeNull();
  });

  it('flags carryover coverage as capped when more than four older PIs exist', () => {
    const context = deriveReadinessPiContext('PI 26.5', PIS);
    expect(context.carryoverPiNames).toHaveLength(4);
    expect(context.isCarryoverCapped).toBe(true);
  });

  it('yields no neighbours for a PI absent from the list', () => {
    const context = deriveReadinessPiContext('PI 99.9', PIS);
    expect(context.upcomingPiName).toBeNull();
    expect(context.carryoverPiNames).toEqual([]);
  });
});
