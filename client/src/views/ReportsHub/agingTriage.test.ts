// agingTriage.test.ts — Verifies the Aging report's gated AI triage prompt build and strict JSON ingestion.

import { describe, expect, it } from 'vitest';

import {
  buildAgingTriagePrompt,
  parseAgingTriageResponse,
  type AgingTriageIssue,
} from './agingTriage.ts';

/** A fully-populated triage candidate, so tests can omit fields by overriding just what they need. */
function makeIssue(overrides: Partial<AgingTriageIssue> = {}): AgingTriageIssue {
  return {
    issueKey: 'ENCUC-100',
    issueType: 'Story',
    summary: 'Add export button',
    status: 'To Do',
    ageDays: 210,
    daysSinceUpdate: 190,
    priority: 'Low',
    featureKey: 'ENCUC-1',
    featureSummary: 'Reporting epic',
    featureStatus: 'Done',
    ...overrides,
  };
}

describe('buildAgingTriagePrompt', () => {
  it('names the issues, lists the three verdicts, and demands JSON only', () => {
    const prompt = buildAgingTriagePrompt([makeIssue()]);
    expect(prompt).toContain('ENCUC-100');
    expect(prompt).toContain('cancel-safe');
    expect(prompt).toContain('review');
    expect(prompt).toContain('must-remain');
    expect(prompt).toContain('valid JSON');
  });

  it('surfaces the decision signals — age, recent activity, importance, and the related feature + its status', () => {
    const prompt = buildAgingTriagePrompt([makeIssue()]);
    expect(prompt).toContain('210d old');
    expect(prompt).toContain('updated 190d ago');
    expect(prompt).toContain('priority Low');
    expect(prompt).toContain('ENCUC-1');
    expect(prompt).toContain('Done'); // the parent feature's status rides the issue line
  });

  it('omits signals that are absent rather than printing empty tags', () => {
    const prompt = buildAgingTriagePrompt([
      makeIssue({ daysSinceUpdate: null, priority: null, featureKey: null, featureSummary: null, featureStatus: null }),
    ]);
    // Assert against the rendered issue data line only — the instruction paragraph legitimately mentions
    // "priority" and "feature", so scope the check to the "- KEY …" line that carries the signal tags.
    const issueLine = prompt.split('Issues:\n')[1];
    expect(issueLine).toContain('ENCUC-100');
    expect(issueLine).not.toContain('updated');
    expect(issueLine).not.toContain('priority');
    expect(issueLine).not.toContain('feature');
  });
});

describe('parseAgingTriageResponse', () => {
  it('parses a well-formed reply into per-issue verdicts', () => {
    const reply = JSON.stringify({
      kind: 'agingTriage',
      items: [
        { issueKey: 'ENCUC-100', verdict: 'cancel-safe', rationale: 'Stale, parent already Done.' },
        { issueKey: 'ENCUC-101', verdict: 'must-remain', rationale: 'Active feature, high priority.' },
      ],
    });
    const items = parseAgingTriageResponse(reply);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ issueKey: 'ENCUC-100', verdict: 'cancel-safe', rationale: 'Stale, parent already Done.' });
    expect(items[1].verdict).toBe('must-remain');
  });

  it('tolerates prose and markdown fences around the JSON', () => {
    const reply = 'Here is my analysis:\n```json\n{"kind":"agingTriage","items":[{"issueKey":"ENCUC-1","verdict":"review","rationale":"x"}]}\n```\nHope that helps!';
    const items = parseAgingTriageResponse(reply);
    expect(items).toHaveLength(1);
    expect(items[0].verdict).toBe('review');
  });

  it('rejects a reply whose kind does not match', () => {
    const reply = JSON.stringify({ kind: 'somethingElse', items: [] });
    expect(() => parseAgingTriageResponse(reply)).toThrow(/kind/i);
  });

  it('rejects an unknown verdict value', () => {
    const reply = JSON.stringify({ kind: 'agingTriage', items: [{ issueKey: 'ENCUC-1', verdict: 'delete-now', rationale: 'x' }] });
    expect(() => parseAgingTriageResponse(reply)).toThrow(/verdict/i);
  });

  it('rejects an item missing its issue key', () => {
    const reply = JSON.stringify({ kind: 'agingTriage', items: [{ verdict: 'review', rationale: 'x' }] });
    expect(() => parseAgingTriageResponse(reply)).toThrow(/issueKey/i);
  });
});
