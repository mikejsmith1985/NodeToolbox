// agingTriageActionModel.test.ts — Verifies the ingested triage verdicts roll up recommendation → feature → issue.

import { describe, expect, it } from 'vitest';

import type { AgingTriageIssue, AgingTriageSuggestion } from './agingTriage.ts';
import { buildTriageActionModel } from './agingTriageActionModel.ts';

/** A triage issue with sensible defaults so a test overrides only the fields it exercises. */
function makeIssue(overrides: Partial<AgingTriageIssue> = {}): AgingTriageIssue {
  return {
    issueKey: 'ENCUC-100',
    issueType: 'Story',
    summary: 'Add export button',
    status: 'To Do',
    ageDays: 100,
    daysInStatus: 60,
    daysSinceUpdate: 90,
    assignee: 'Jane Dev',
    storyPoints: 3,
    hasDescription: true,
    hasAcceptanceCriteria: true,
    priority: 'Low',
    featureKey: 'FEAT-1',
    featureSummary: 'Reporting feature',
    featureStatus: 'Done',
    ...overrides,
  };
}

function verdict(issueKey: string, value: AgingTriageSuggestion['verdict'], rationale = 'because'): AgingTriageSuggestion {
  return { issueKey, verdict: value, rationale };
}

describe('buildTriageActionModel', () => {
  it('groups by verdict in cancel-safe → review → must-remain order, only including non-empty verdicts', () => {
    const issues = [
      makeIssue({ issueKey: 'A-1' }),
      makeIssue({ issueKey: 'A-2' }),
    ];
    const suggestions = [verdict('A-1', 'must-remain'), verdict('A-2', 'cancel-safe')];
    const model = buildTriageActionModel(suggestions, issues);

    expect(model.verdictGroups.map((group) => group.verdict)).toEqual(['cancel-safe', 'must-remain']);
    expect(model.verdictGroups[0].issueCount).toBe(1);
  });

  it('within a verdict, groups issues by feature and puts the No-feature bucket last', () => {
    const issues = [
      makeIssue({ issueKey: 'A-1', featureKey: 'FEAT-2', featureSummary: 'Beta', featureStatus: 'In Progress' }),
      makeIssue({ issueKey: 'A-2', featureKey: 'FEAT-1', featureSummary: 'Alpha', featureStatus: 'Done' }),
      makeIssue({ issueKey: 'A-3', featureKey: null, featureSummary: null, featureStatus: null }),
    ];
    const suggestions = [verdict('A-1', 'cancel-safe'), verdict('A-2', 'cancel-safe'), verdict('A-3', 'cancel-safe')];
    const model = buildTriageActionModel(suggestions, issues);

    const featureGroups = model.verdictGroups[0].featureGroups;
    // Real features sorted by summary (Alpha before Beta), then the null-feature bucket last.
    expect(featureGroups.map((group) => group.featureKey)).toEqual(['FEAT-1', 'FEAT-2', null]);
    expect(featureGroups[0].featureSummary).toBe('Alpha');
    expect(featureGroups[2].issues[0].issueKey).toBe('A-3');
  });

  it('carries the verdict, rationale, and the issue signals onto each row, oldest issue first', () => {
    const issues = [
      makeIssue({ issueKey: 'A-1', ageDays: 30 }),
      makeIssue({ issueKey: 'A-2', ageDays: 300 }),
    ];
    const suggestions = [verdict('A-1', 'cancel-safe', 'stale one'), verdict('A-2', 'cancel-safe', 'stale two')];
    const model = buildTriageActionModel(suggestions, issues);

    const group = model.verdictGroups[0].featureGroups[0];
    // Oldest (300d) first.
    expect(group.issues.map((issue) => issue.issueKey)).toEqual(['A-2', 'A-1']);
    expect(group.issues[0].rationale).toBe('stale two');
    expect(group.issues[0].ageDays).toBe(300);
    expect(group.issues[1].verdict).toBe('cancel-safe');
  });

  it('drops verdicts whose issue was not in the shown set (unknown keys)', () => {
    const model = buildTriageActionModel([verdict('GHOST-9', 'cancel-safe')], [makeIssue({ issueKey: 'A-1' })]);
    expect(model.verdictGroups).toHaveLength(0);
  });

  it('returns an empty model when there are no suggestions', () => {
    expect(buildTriageActionModel([], [makeIssue()]).verdictGroups).toEqual([]);
  });
});
