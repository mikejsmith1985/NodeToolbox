// agingTriage.test.ts — Verifies the Aging report's gated AI triage prompt build and strict JSON ingestion.

import { describe, expect, it } from 'vitest';

import {
  buildAgingTriageFollowUpPrompt,
  buildAgingTriagePrompt,
  findMissingTriageKeys,
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
    daysInStatus: 120,
    daysSinceUpdate: 190,
    assignee: 'Jane Dev',
    storyPoints: 5,
    hasDescription: true,
    hasAcceptanceCriteria: true,
    priority: 'Low',
    featureKey: 'ENCUC-1',
    featureSummary: 'Reporting epic',
    featureStatus: 'Done',
    ...overrides,
  };
}

describe('buildAgingTriagePrompt', () => {
  it('names the issues, lists the three verdicts, and ends with a pre-filled table (GH #499)', () => {
    const prompt = buildAgingTriagePrompt([makeIssue()]);
    expect(prompt).toContain('ENCUC-100');
    expect(prompt).toContain('cancel-safe');
    expect(prompt).toContain('review');
    expect(prompt).toContain('must-remain');
    // Google AI Mode ignores a JSON reply format but completes a table that already lists every issue.
    expect(prompt).toContain('TRIAGE_TABLE:');
    expect(prompt).toContain('ENCUC-100 | Add export button | ___ | ___');
    expect(prompt).not.toContain('valid JSON');
  });

  it('surfaces the decision signals — age, recent activity, importance, and the related feature + its status', () => {
    const prompt = buildAgingTriagePrompt([makeIssue()]);
    expect(prompt).toContain('210d old');
    expect(prompt).toContain('updated 190d ago');
    expect(prompt).toContain('priority Low');
    expect(prompt).toContain('ENCUC-1');
    expect(prompt).toContain('Done'); // the parent feature's status rides the issue line
  });

  it('frames the triage aggressively — must-remain must be earned and absence leans cancel', () => {
    const prompt = buildAgingTriagePrompt([makeIssue()]);
    expect(prompt).toMatch(/aggressively/i);
    expect(prompt).toMatch(/do NOT default to must-remain/i);
    expect(prompt).toMatch(/EARNS its place|positive.*sign it is active/i);
  });

  it('surfaces the ownership, time-in-status, and size signals', () => {
    const prompt = buildAgingTriagePrompt([makeIssue({ assignee: 'Jane Dev', daysInStatus: 45, storyPoints: 8 })]);
    expect(prompt).toContain('assignee Jane Dev');
    expect(prompt).toContain('in status 45d');
    expect(prompt).toContain('8 pts');
  });

  it('flags an unassigned, undefined issue as explicit cancel signals', () => {
    const prompt = buildAgingTriagePrompt([
      makeIssue({ assignee: null, hasDescription: false, hasAcceptanceCriteria: false }),
    ]);
    const issueLine = prompt.split('Issues:\n')[1];
    expect(issueLine).toContain('unassigned');
    expect(issueLine).toContain('no description');
    expect(issueLine).toContain('no acceptance criteria');
  });

  it('omits signals that are absent rather than printing empty tags', () => {
    const prompt = buildAgingTriagePrompt([
      makeIssue({
        daysInStatus: null, daysSinceUpdate: null, storyPoints: null,
        priority: null, featureKey: null, featureSummary: null, featureStatus: null,
      }),
    ]);
    // Assert against the rendered issue data line only — the instruction paragraph legitimately mentions
    // "priority" and "feature", so scope the check to the "- KEY …" line that carries the signal tags.
    const issueLine = prompt.split('Issues:\n')[1];
    expect(issueLine).toContain('ENCUC-100');
    expect(issueLine).not.toContain('in status');
    expect(issueLine).not.toContain('updated');
    expect(issueLine).not.toContain('pts');
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

describe('parseAgingTriageResponse — Google AI Mode replies (GH #499)', () => {
  const ISSUES = [makeIssue(), makeIssue({ issueKey: 'ENCUC-101', summary: 'Old spike' })];
  const EXPECTED = [
    { issueKey: 'ENCUC-100', verdict: 'cancel-safe', rationale: 'Feature is Done.' },
    { issueKey: 'ENCUC-101', verdict: 'must-remain', rationale: 'Active work.' },
  ];

  it('reads a markdown table wrapped in an intro and a closing offer into the same verdicts', () => {
    const replyText = [
      'Here is the triage of your backlog.',
      '',
      '| Issue key | Summary | Verdict | Rationale |',
      '| :--- | :--- | :--- | :--- |',
      '| **ENCUC-100** | Add export button | Cancel safe | Feature is Done. |',
      '| ENCUC-101 | Old spike | must-remain | Active work. |',
      '',
      'If you provide sprint data, I can refine these verdicts.',
    ].join('\n');

    expect(parseAgingTriageResponse(replyText)).toEqual(EXPECTED);
  });

  it('reads a tab-separated table copied from the AI Mode page', () => {
    const replyText = [
      'Issue key\tSummary\tVerdict\tRationale',
      'ENCUC-100\tAdd export button\tcancel-safe\tFeature is Done.',
      'ENCUC-101\tOld spike\tMust remain\tActive work.',
    ].join('\n');

    expect(parseAgingTriageResponse(replyText)).toEqual(EXPECTED);
  });

  it('still refuses a verdict outside the three, even from a table', () => {
    const replyText = ['Issue key | Summary | Verdict | Rationale', 'ENCUC-100 | x | archive | Old.'].join('\n');

    expect(() => parseAgingTriageResponse(replyText)).toThrow(/Invalid verdict/);
  });

  it('treats a row left blank as unanswered and asks a follow-up for only that issue', () => {
    const replyText = [
      'Issue key | Summary | Verdict | Rationale',
      'ENCUC-100 | Add export button | cancel-safe | Feature is Done.',
      'ENCUC-101 | Old spike | ___ | ___',
    ].join('\n');

    const suggestions = parseAgingTriageResponse(replyText);
    const missingKeys = findMissingTriageKeys(ISSUES, suggestions);
    const followUpPrompt = buildAgingTriageFollowUpPrompt(ISSUES, missingKeys, false);

    expect(suggestions).toHaveLength(1);
    expect(missingKeys).toEqual(['ENCUC-101']);
    expect(followUpPrompt).toContain('ENCUC-101 | Old spike | ___ | ___');
    expect(followUpPrompt).not.toContain('ENCUC-100 |');
    expect(buildAgingTriageFollowUpPrompt(ISSUES, [], false)).toBe('');
  });

  it('throws on prose with no table, and the format fix re-asks every issue', () => {
    expect(() => parseAgingTriageResponse('Most of these look stale to me.')).toThrow(/No JSON object found/);

    const followUpPrompt = buildAgingTriageFollowUpPrompt(ISSUES, [], true);
    expect(followUpPrompt).toContain('could not be read');
    expect(followUpPrompt).toContain('ENCUC-100 | Add export button | ___ | ___');
    expect(followUpPrompt).toContain('ENCUC-101 | Old spike | ___ | ___');
  });
});
