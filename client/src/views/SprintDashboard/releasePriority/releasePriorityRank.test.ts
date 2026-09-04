// releasePriorityRank.test.ts — The ranking prompt, the reply parser, and the "01 … NN" values.

import { describe, expect, it } from 'vitest';

import {
  buildReleasePriorityPrompt,
  buildStatusSummaryPlan,
  calculateAgeDays,
  formatStatusSummaryValue,
  parseReleasePriorityReply,
  RELEASE_PRIORITY_REPLY_KIND,
  type ReleasePriorityPromptInput,
  type ReleasePriorityPromptIssue,
} from './releasePriorityRank.ts';

function promptIssue(issueKey: string, overrides: Partial<ReleasePriorityPromptIssue> = {}): ReleasePriorityPromptIssue {
  return {
    issueKey,
    summary: `Summary ${issueKey}`,
    issueTypeName: 'Story',
    statusName: 'Working',
    priorityName: 'Medium',
    assigneeName: 'Smith, Michael (CTR)',
    createdIso: '2026-06-01T10:00:00.000Z',
    ageDays: 95,
    dueDateIso: null,
    currentStatusSummary: null,
    featureKey: null,
    featureSummary: '',
    featureTargetEndIso: null,
    featureDueDateIso: null,
    ...overrides,
  };
}

const SAMPLE_INPUT: ReleasePriorityPromptInput = {
  projectKey: 'ENCUC',
  releaseName: '09/24/2026',
  releaseDate: '2026-09-24',
  todayIso: '2026-09-04',
  issues: [
    promptIssue('ENCUC-1', { priorityName: 'High', ageDays: 3 }),
    promptIssue('ENCUC-2', {
      priorityName: 'Medium',
      ageDays: 95,
      featureKey: 'FEAT-10',
      featureSummary: 'Online enrollment intake',
      featureTargetEndIso: '2026-09-10',
      featureDueDateIso: '2026-09-30',
      currentStatusSummary: '03',
    }),
    promptIssue('ENCUC-3', { issueTypeName: 'Defect', dueDateIso: '2026-09-01' }),
  ],
};

const KNOWN_KEYS = ['ENCUC-1', 'ENCUC-2', 'ENCUC-3'];

describe('calculateAgeDays', () => {
  it('counts whole calendar days from creation to today', () => {
    expect(calculateAgeDays('2026-08-30T09:00:00.000Z', '2026-09-04T12:00:00.000Z')).toBe(5);
  });

  it('never goes negative for an issue created later today', () => {
    expect(calculateAgeDays('2026-09-04T23:00:00.000Z', '2026-09-04T12:00:00.000Z')).toBe(0);
  });

  it('reads null and an unreadable date as unknown rather than zero', () => {
    expect(calculateAgeDays(null, '2026-09-04')).toBeNull();
    expect(calculateAgeDays('not a date', '2026-09-04')).toBeNull();
  });
});

describe('buildReleasePriorityPrompt', () => {
  const prompt = buildReleasePriorityPrompt(SAMPLE_INPUT);

  it('names the release and every issue key, and demands each exactly once', () => {
    expect(prompt).toContain('Release: 09/24/2026');
    expect(prompt).toContain('Issue keys you must rank: ENCUC-1, ENCUC-2, ENCUC-3');
    expect(prompt).toContain('Every key appears exactly once');
  });

  it('lays the driver and the signals that may overrule it beside each issue', () => {
    // The whole point: Priority says one thing, age and the Feature's dates may say another.
    expect(prompt).toContain('priority: High · age: 3 days');
    expect(prompt).toContain('priority: Medium · age: 95 days');
    expect(prompt).toContain('feature: FEAT-10 — Online enrollment intake · feature target end: 2026-09-10 · feature due: 2026-09-30');
    expect(prompt).toContain('due: 2026-09-01');
    expect(prompt).toContain('current Status Summary: 03');
  });

  it('asks for the envelope the parser accepts, with rank 1 as the top', () => {
    expect(prompt).toContain(`"kind": "${RELEASE_PRIORITY_REPLY_KIND}"`);
    expect(prompt).toContain('Rank 1 is the most important item');
  });
});

describe('parseReleasePriorityReply', () => {
  it('orders by the ranks the assistant gave, top first', () => {
    const reply = JSON.stringify({
      kind: RELEASE_PRIORITY_REPLY_KIND,
      items: [
        { issueKey: 'ENCUC-1', rank: 3, rationale: 'New and not blocking anything.' },
        { issueKey: 'ENCUC-3', rank: 1, rationale: 'Overdue defect.' },
        { issueKey: 'ENCUC-2', rank: 2, rationale: 'Feature target end is next week.' },
      ],
    });

    const result = parseReleasePriorityReply(reply, KNOWN_KEYS);

    expect(result.rankedItems.map((item) => item.issueKey)).toEqual(['ENCUC-3', 'ENCUC-2', 'ENCUC-1']);
    expect(result.rankedItems.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(result.rankedItems[0].rationale).toBe('Overdue defect.');
    expect(result.unknownKeys).toEqual([]);
    expect(result.unrankedKeys).toEqual([]);
  });

  it('falls back to reply order when ranks are missing, and re-numbers gaps away', () => {
    const reply = JSON.stringify({
      kind: RELEASE_PRIORITY_REPLY_KIND,
      items: [{ issueKey: 'ENCUC-2', rank: 10 }, { issueKey: 'ENCUC-1' }, { issueKey: 'ENCUC-3', rank: 40 }],
    });

    const result = parseReleasePriorityReply(reply, KNOWN_KEYS);

    // Ranked items sort by rank; the unranked one sorts after every ranked one.
    expect(result.rankedItems.map((item) => item.issueKey)).toEqual(['ENCUC-2', 'ENCUC-3', 'ENCUC-1']);
    expect(result.rankedItems.map((item) => item.rank)).toEqual([1, 2, 3]);
  });

  it('appends a key the assistant forgot at the bottom and FLAGS it, so nothing is silently lost', () => {
    const reply = JSON.stringify({
      kind: RELEASE_PRIORITY_REPLY_KIND,
      items: [{ issueKey: 'ENCUC-3', rank: 1 }, { issueKey: 'ENCUC-1', rank: 2 }],
    });

    const result = parseReleasePriorityReply(reply, KNOWN_KEYS);

    expect(result.rankedItems.map((item) => item.issueKey)).toEqual(['ENCUC-3', 'ENCUC-1', 'ENCUC-2']);
    expect(result.rankedItems[2].wasRankedByAssistant).toBe(false);
    expect(result.rankedItems[0].wasRankedByAssistant).toBe(true);
    expect(result.unrankedKeys).toEqual(['ENCUC-2']);
  });

  it('drops a key that is not in the release and reports it, never writing to an invented issue', () => {
    const reply = JSON.stringify({
      kind: RELEASE_PRIORITY_REPLY_KIND,
      items: [
        { issueKey: 'ENCUC-999', rank: 1 },
        { issueKey: 'encuc-1', rank: 2 },
        { issueKey: 'ENCUC-2', rank: 3 },
        { issueKey: 'ENCUC-3', rank: 4 },
      ],
    });

    const result = parseReleasePriorityReply(reply, KNOWN_KEYS);

    expect(result.unknownKeys).toEqual(['ENCUC-999']);
    expect(result.rankedItems.map((item) => item.issueKey)).toEqual(['ENCUC-1', 'ENCUC-2', 'ENCUC-3']);
  });

  it('keeps the first mention of a key the assistant listed twice', () => {
    const reply = JSON.stringify({
      kind: RELEASE_PRIORITY_REPLY_KIND,
      items: [
        { issueKey: 'ENCUC-2', rank: 1, rationale: 'first' },
        { issueKey: 'ENCUC-2', rank: 3, rationale: 'second' },
        { issueKey: 'ENCUC-1', rank: 2 },
        { issueKey: 'ENCUC-3', rank: 4 },
      ],
    });

    const result = parseReleasePriorityReply(reply, KNOWN_KEYS);

    expect(result.rankedItems.map((item) => item.issueKey)).toEqual(['ENCUC-2', 'ENCUC-1', 'ENCUC-3']);
    expect(result.rankedItems[0].rationale).toBe('first');
  });

  it('reads a reply wrapped in prose and a code fence', () => {
    const reply = `Here you go:\n\`\`\`json\n${JSON.stringify({
      kind: RELEASE_PRIORITY_REPLY_KIND,
      items: [{ issueKey: 'ENCUC-1', rank: 1 }, { issueKey: 'ENCUC-2', rank: 2 }, { issueKey: 'ENCUC-3', rank: 3 }],
    })}\n\`\`\`\nHope that helps.`;

    expect(parseReleasePriorityReply(reply, KNOWN_KEYS).rankedItems).toHaveLength(3);
  });

  it('rejects a reply from another AI surface by its kind', () => {
    const reply = JSON.stringify({ kind: 'piReview', items: [] });

    expect(() => parseReleasePriorityReply(reply, KNOWN_KEYS)).toThrow(/does not match the requested "releasePriority"/);
  });
});

describe('formatStatusSummaryValue', () => {
  it('pads to two digits so "01" sorts before "10" as text', () => {
    expect(formatStatusSummaryValue(1, 9)).toBe('01');
    expect(formatStatusSummaryValue(7, 12)).toBe('07');
    expect(formatStatusSummaryValue(12, 12)).toBe('12');
  });

  it('grows to three digits when the release is long enough to need them', () => {
    expect(formatStatusSummaryValue(1, 120)).toBe('001');
    expect(formatStatusSummaryValue(120, 120)).toBe('120');
  });
});

describe('buildStatusSummaryPlan', () => {
  it('produces one write per item, top of the list as 01', () => {
    const result = parseReleasePriorityReply(JSON.stringify({
      kind: RELEASE_PRIORITY_REPLY_KIND,
      items: [{ issueKey: 'ENCUC-3', rank: 1 }, { issueKey: 'ENCUC-1', rank: 2 }, { issueKey: 'ENCUC-2', rank: 3 }],
    }), KNOWN_KEYS);

    expect(buildStatusSummaryPlan(result.rankedItems)).toEqual([
      { issueKey: 'ENCUC-3', rank: 1, value: '01' },
      { issueKey: 'ENCUC-1', rank: 2, value: '02' },
      { issueKey: 'ENCUC-2', rank: 3, value: '03' },
    ]);
  });
});
