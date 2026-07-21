// hygieneRules.test.js — Parity tests for the server-side hygiene rule evaluator.
//
// Each test seeds a minimal Jira issue object that mirrors what the Jira REST API
// returns and asserts that evaluateHygieneRules() flags (or does not flag) the
// same check ID as the equivalent client-side predicate in hygieneChecks.ts.
// These tests are the TDD anchor for T021 (implementation).

'use strict';

const { evaluateHygieneRules } = require('./hygieneRules');

// ── Minimal test-fixture builders ────────────────────────────────────────────

/** Creates a minimal open Story issue with no custom fields set. */
function buildStory(overrides = {}) {
  return {
    key: 'TEST-1',
    fields: {
      summary: 'A story summary',
      issuetype: { name: 'Story' },
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { displayName: 'Alice' },
      fixVersions: [],
      updated: new Date().toISOString(),
      ...overrides,
    },
  };
}

/** Creates a minimal open Feature issue. */
function buildFeature(overrides = {}) {
  return {
    key: 'TEST-2',
    fields: {
      summary: 'A feature summary',
      issuetype: { name: 'Feature' },
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      assignee: { displayName: 'Bob' },
      fixVersions: [],
      updated: new Date().toISOString(),
      ...overrides,
    },
  };
}

/** An empty field config — no custom field IDs configured. */
const EMPTY_FIELD_CONFIG = {
  acceptanceCriteriaFieldIds: [],
  applicationFieldIds: [],
  featureLinkFieldIds: [],
  initiativeTypeFieldIds: [],
  parentLinkFieldIds: [],
  productOwnerFieldIds: [],
  programIncrementFieldIds: [],
  targetEndFieldIds: [],
  targetStartFieldIds: [],
};

function extractCheckIds(flags) {
  return flags.map((flag) => flag.checkId);
}

// ── no-assignee check ─────────────────────────────────────────────────────────

describe('evaluateHygieneRules — no-assignee', () => {
  it('flags no-assignee when the issue has no assignee and is not done', () => {
    const issue = buildStory({ assignee: null });
    const flags = evaluateHygieneRules(issue, EMPTY_FIELD_CONFIG);
    expect(extractCheckIds(flags)).toContain('no-assignee');
  });

  it('does not flag no-assignee when an assignee is set', () => {
    const issue = buildStory({ assignee: { displayName: 'Alice' } });
    const flags = evaluateHygieneRules(issue, EMPTY_FIELD_CONFIG);
    expect(extractCheckIds(flags)).not.toContain('no-assignee');
  });

  it('does not flag no-assignee when the issue is Done', () => {
    const issue = buildStory({
      assignee: null,
      status: { name: 'Done', statusCategory: { key: 'done' } },
    });
    const flags = evaluateHygieneRules(issue, EMPTY_FIELD_CONFIG);
    expect(extractCheckIds(flags)).not.toContain('no-assignee');
  });

  it('does not flag no-assignee when the issue is still in To Do — only active work needs an owner', () => {
    const issue = buildStory({
      assignee: null,
      status: { name: 'To Do', statusCategory: { key: 'new' } },
    });
    const flags = evaluateHygieneRules(issue, EMPTY_FIELD_CONFIG);
    expect(extractCheckIds(flags)).not.toContain('no-assignee');
  });
});

// ── stale-issue check ─────────────────────────────────────────────────────────

describe('evaluateHygieneRules — stale-issue', () => {
  // Staleness counts BUSINESS days against the 5-business-day default (one work week), matching every client
  // surface. The gaps below give the same outcome whatever weekday the test runs on: any 7-calendar-day span is
  // exactly 5 business days (5 weekdays + 2 weekend days), and any 3-calendar-day span is at most 3 business days.
  it('flags stale-issue once an In Progress issue has 5+ business days (one week) of no update', () => {
    const staleDateString = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const issue = buildStory({
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      updated: staleDateString,
    });
    const flags = evaluateHygieneRules(issue, EMPTY_FIELD_CONFIG);
    expect(extractCheckIds(flags)).toContain('stale-issue');
  });

  it('does not flag stale-issue when updated within the last 5 business days', () => {
    const recentDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const issue = buildStory({
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      updated: recentDate,
    });
    const flags = evaluateHygieneRules(issue, EMPTY_FIELD_CONFIG);
    expect(extractCheckIds(flags)).not.toContain('stale-issue');
  });
});

// ── no-ac check ───────────────────────────────────────────────────────────────

describe('evaluateHygieneRules — no-ac', () => {
  it('flags no-ac on a Story when all configured AC fields are blank', () => {
    const fieldConfig = {
      ...EMPTY_FIELD_CONFIG,
      acceptanceCriteriaFieldIds: ['customfield_10200'],
    };
    const issue = buildStory({ customfield_10200: '' });
    const flags = evaluateHygieneRules(issue, fieldConfig);
    expect(extractCheckIds(flags)).toContain('no-ac');
  });

  it('does not flag no-ac when an AC field has content', () => {
    const fieldConfig = {
      ...EMPTY_FIELD_CONFIG,
      acceptanceCriteriaFieldIds: ['customfield_10200'],
    };
    const issue = buildStory({ customfield_10200: 'Given user exists, when they log in, then they see dashboard.' });
    const flags = evaluateHygieneRules(issue, fieldConfig);
    expect(extractCheckIds(flags)).not.toContain('no-ac');
  });
});

// ── missing-sp check ─────────────────────────────────────────────────────────

describe('evaluateHygieneRules — missing-sp', () => {
  it('flags missing-sp on a Story with null story points (modern field)', () => {
    const issue = buildStory({ customfield_10028: null });
    const flags = evaluateHygieneRules(issue, EMPTY_FIELD_CONFIG);
    expect(extractCheckIds(flags)).toContain('missing-sp');
  });

  it('does not flag missing-sp when story points are set', () => {
    const issue = buildStory({ customfield_10028: 3 });
    const flags = evaluateHygieneRules(issue, EMPTY_FIELD_CONFIG);
    expect(extractCheckIds(flags)).not.toContain('missing-sp');
  });

  it('does not flag missing-sp for Feature issues', () => {
    const issue = buildFeature({ customfield_10028: null });
    const flags = evaluateHygieneRules(issue, EMPTY_FIELD_CONFIG);
    expect(extractCheckIds(flags)).not.toContain('missing-sp');
  });
});

// ── missing-target-end check ─────────────────────────────────────────────────

describe('evaluateHygieneRules — missing-target-end', () => {
  it('flags missing-target-end on a Feature when configured target-end field is absent', () => {
    const fieldConfig = {
      ...EMPTY_FIELD_CONFIG,
      targetEndFieldIds: ['customfield_10099'],
    };
    const issue = buildFeature({ customfield_10099: null });
    const flags = evaluateHygieneRules(issue, fieldConfig);
    expect(extractCheckIds(flags)).toContain('missing-target-end');
  });

  it('does not flag missing-target-end when the field has a value', () => {
    const fieldConfig = {
      ...EMPTY_FIELD_CONFIG,
      targetEndFieldIds: ['customfield_10099'],
    };
    const issue = buildFeature({ customfield_10099: '2026-12-31' });
    const flags = evaluateHygieneRules(issue, fieldConfig);
    expect(extractCheckIds(flags)).not.toContain('missing-target-end');
  });
});

// ── missing-feature-link check ────────────────────────────────────────────────

describe('evaluateHygieneRules — missing-feature-link', () => {
  it('flags missing-feature-link on a Story when configured feature-link field is absent', () => {
    const fieldConfig = {
      ...EMPTY_FIELD_CONFIG,
      featureLinkFieldIds: ['customfield_10014'],
    };
    const issue = buildStory({ customfield_10014: null });
    const flags = evaluateHygieneRules(issue, fieldConfig);
    expect(extractCheckIds(flags)).toContain('missing-feature-link');
  });

  it('does not flag missing-feature-link when the feature link is set', () => {
    const fieldConfig = {
      ...EMPTY_FIELD_CONFIG,
      featureLinkFieldIds: ['customfield_10014'],
    };
    const issue = buildStory({ customfield_10014: { key: 'FEAT-10' } });
    const flags = evaluateHygieneRules(issue, fieldConfig);
    expect(extractCheckIds(flags)).not.toContain('missing-feature-link');
  });
});

// ── evaluateHygieneRules integration ────────────────────────────────────────

describe('evaluateHygieneRules — result shape', () => {
  it('returns an array of flag objects with checkId, label, and severity', () => {
    const issue = buildStory({ assignee: null });
    const flags = evaluateHygieneRules(issue, EMPTY_FIELD_CONFIG);
    expect(Array.isArray(flags)).toBe(true);
    const flag = flags.find((flag) => flag.checkId === 'no-assignee');
    expect(flag).toBeDefined();
    expect(typeof flag.label).toBe('string');
    expect(['warn', 'error']).toContain(flag.severity);
  });

  it('returns an empty array when the issue has no violations', () => {
    const issue = buildStory({
      assignee: { displayName: 'Alice' },
      updated: new Date().toISOString(),
      customfield_10028: 3,
      // A Story with no fix version now trips the missing-fix-version check, so a truly healthy
      // fixture must carry one — otherwise this "no violations" case is never actually clean.
      fixVersions: [{ name: '2026.7' }],
    });
    // Use an empty field config so no custom-field checks fire.
    const flags = evaluateHygieneRules(issue, EMPTY_FIELD_CONFIG);
    // A healthy story with no issues should produce no flags.
    expect(flags).toEqual([]);
  });
});
