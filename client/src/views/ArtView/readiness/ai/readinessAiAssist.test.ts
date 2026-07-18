// readinessAiAssist.test.ts — Unit tests for the readiness AI prompt builder and reply parser.

import { describe, expect, it } from 'vitest';

import {
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
    expect(prompt).toContain(READINESS_REPLY_KIND);
    expect(prompt).toMatch(/issue keys you may use/i);
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
