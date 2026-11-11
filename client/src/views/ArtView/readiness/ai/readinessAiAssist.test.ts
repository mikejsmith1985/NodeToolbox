// readinessAiAssist.test.ts — Unit tests for the readiness AI prompt builder and reply parser.

import { describe, expect, it } from 'vitest';

import {
  buildReadinessAiFollowUpPrompt,
  buildReadinessAiPrompt,
  parseReadinessAiReply,
  READINESS_REPLY_KIND,
} from './readinessAiAssist.ts';
import type { ReadinessFeature } from '../readinessScan.ts';

function buildFeature(key: string, overrides: Partial<ReadinessFeature> = {}): ReadinessFeature {
  return {
    issue: { key, fields: {} },
    key,
    summary: `Feature ${key}`,
    statusName: 'Analyzing',
    statusBucket: 'todo',
    assigneeDisplayName: null,
    productOwnerDisplayName: null,
    estimateValue: null,
    pcodeValue: null,
    targetEndIso: null,
    dueDateIso: null,
    ageDays: 5,
    impedimentReasons: [],
    alerts: ['missing-estimate'],
    ...overrides,
  } as unknown as ReadinessFeature;
}

describe('buildReadinessAiPrompt', () => {
  it('covers every feature in the active lens and lists the usable keys', () => {
    const prompt = buildReadinessAiPrompt([buildFeature('F-1'), buildFeature('F-2')]);

    expect(prompt).toContain('F-1');
    expect(prompt).toContain('F-2');
    expect(prompt).not.toContain(READINESS_REPLY_KIND);
    expect(prompt).toMatch(/issue keys you may use/i);
  });

  it('ends with a fill-in table listing every Feature, not a JSON shape (GH #499)', () => {
    const prompt = buildReadinessAiPrompt([buildFeature('F-1'), buildFeature('F-2', { summary: 'Pay | card' })]);

    expect(prompt.split('\n').slice(-4)).toEqual([
      'READINESS_TABLE:',
      'Issue key | Feature | Estimate | Target end | Due date | Ownership | Insight',
      'F-1 | Feature F-1 | ___ | ___ | ___ | ___ | ___',
      'F-2 | Pay   card | ___ | ___ | ___ | ___ | ___',
    ]);
  });

  it('states each feature\'s alerts so the model targets the real gaps', () => {
    const prompt = buildReadinessAiPrompt([buildFeature('F-1', { alerts: ['missing-estimate', 'missing-pcode'] })]);

    expect(prompt).toMatch(/missing-estimate/);
  });
});

describe('parseReadinessAiReply', () => {
  const KNOWN = ['F-1', 'F-2'];

  it('parses a well-formed reply into per-feature proposals', () => {
    const reply = JSON.stringify({
      kind: 'featureReadiness',
      items: [
        { issueKey: 'F-1', estimateSuggestion: '8', targetEndSuggestion: '2026-08-15', insight: 'At risk' },
        { issueKey: 'F-2', dueDateSuggestion: '2026-09-01', ownershipSuggestion: 'Route to eligibility PO' },
      ],
    });

    const result = parseReadinessAiReply(reply, KNOWN);

    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0]).toMatchObject({ issueKey: 'F-1', estimateSuggestion: '8', targetEndSuggestion: '2026-08-15', insight: 'At risk' });
    expect(result.proposals[1]).toMatchObject({ issueKey: 'F-2', dueDateSuggestion: '2026-09-01', ownershipSuggestion: 'Route to eligibility PO' });
  });

  it('rejects a reply whose kind does not match', () => {
    const reply = JSON.stringify({ kind: 'piReview', items: [] });
    expect(() => parseReadinessAiReply(reply, KNOWN)).toThrow(/kind/i);
  });

  it('reports unknown issue keys and drops them', () => {
    const reply = JSON.stringify({ kind: 'featureReadiness', items: [{ issueKey: 'NOPE-9', estimateSuggestion: '3' }] });

    const result = parseReadinessAiReply(reply, KNOWN);

    expect(result.proposals).toHaveLength(0);
    expect(result.unknownKeys).toContain('NOPE-9');
  });

  it('tolerates items missing every optional field by dropping them as unparsed', () => {
    const reply = JSON.stringify({ kind: 'featureReadiness', items: [{ issueKey: 'F-1' }] });

    const result = parseReadinessAiReply(reply, KNOWN);

    expect(result.proposals).toHaveLength(0);
    expect(result.unparsedCount).toBe(1);
  });
});

// ── Google AI Mode replies (GH #499) ──

describe('parseReadinessAiReply with an AI Mode reply', () => {
  const KNOWN = ['F-1', 'F-2'];

  it('reads a markdown table wrapped in an intro and a closing offer into the same proposals', () => {
    const reply = [
      'Here is the readiness assessment for your Features.',
      '',
      '| Issue key | Feature | Estimate | Target end | Due date | Ownership | Insight |',
      '|---|---|---|---|---|---|---|',
      '| **F-1** | Feature F-1 | 8 | 2026-08-15 | ___ | ___ | At risk |',
      '| F-2 | Feature F-2 | ___ | ___ | 2026-09-01 | Route to eligibility PO | ___ |',
      '',
      'If you provide the team capacity, I can refine the dates.',
    ].join('\n');

    const result = parseReadinessAiReply(reply, KNOWN);

    expect(result.proposals).toEqual([
      { issueKey: 'F-1', estimateSuggestion: '8', targetEndSuggestion: '2026-08-15', dueDateSuggestion: null, ownershipSuggestion: null, insight: 'At risk' },
      { issueKey: 'F-2', estimateSuggestion: null, targetEndSuggestion: null, dueDateSuggestion: '2026-09-01', ownershipSuggestion: 'Route to eligibility PO', insight: null },
    ]);
  });

  it('reads a table pasted from the web page as tab-separated cells, still dropping an invented key', () => {
    const reply = 'Issue key\tFeature\tEstimate\nF-1\tFeature F-1\t5\nNOPE-9\tGhost\t3';

    const result = parseReadinessAiReply(reply, KNOWN);

    expect(result.proposals.map((proposal) => [proposal.issueKey, proposal.estimateSuggestion])).toEqual([['F-1', '5']]);
    expect(result.unknownKeys).toEqual(['NOPE-9']);
  });
});

describe('buildReadinessAiFollowUpPrompt', () => {
  const FEATURES = [buildFeature('F-1'), buildFeature('F-2')];

  it('asks for the whole table again when the reply could not be read', () => {
    expect(() => parseReadinessAiReply('F-1 is at risk.', ['F-1', 'F-2'])).toThrow(/No JSON object found/);

    const followUp = buildReadinessAiFollowUpPrompt(FEATURES, null);

    expect(followUp).toMatch(/^Your last reply was not in the form I need/);
    expect(followUp).toContain('F-2 | Feature F-2 | ___');
  });

  it('asks only for the Features the reply dropped — a row left blank was an answer, never guessed at', () => {
    const result = parseReadinessAiReply('Issue key | Estimate | Insight\nF-1 | ___ | ___', ['F-1', 'F-2']);

    const followUp = buildReadinessAiFollowUpPrompt(FEATURES, result);

    expect(result.proposals).toEqual([]);
    expect(followUp).toContain('left out F-2');
    expect(followUp).not.toContain('F-1 | Feature F-1');
  });

  it('offers nothing when every Feature was answered', () => {
    const result = parseReadinessAiReply('Issue key | Estimate\nF-1 | 3\nF-2 | 5', ['F-1', 'F-2']);

    expect(buildReadinessAiFollowUpPrompt(FEATURES, result)).toBe('');
  });
});
