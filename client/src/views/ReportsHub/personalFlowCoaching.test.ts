// personalFlowCoaching.test.ts — Verifies the Personal Flow coaching prompt build and strict JSON ingestion.

import { describe, expect, it } from 'vitest';

import {
  buildPersonalFlowCoachingFollowUpPrompt,
  buildPersonalFlowCoachingPrompt,
  parsePersonalFlowCoachingResponse,
  type PersonalFlowCoachingInput,
} from './personalFlowCoaching.ts';

/** A representative coaching input, so a test can vary one field without restating the whole result. */
function makeInput(overrides: Partial<PersonalFlowCoachingInput> = {}): PersonalFlowCoachingInput {
  return {
    personName: 'Jordan Rivers',
    windowDays: 90,
    issuesAdvanced: 42,
    totalStoryPoints: 88,
    issuesPerWeek: 3.3,
    pointsPerWeek: 6.8,
    averageCycleTimeDays: 4.5,
    medianCycleTimeDays: 3,
    topStatusByHandsOnDays: 'Ready to Work',
    ...overrides,
  };
}

describe('buildPersonalFlowCoachingPrompt', () => {
  it('names the person and window, carries the headline numbers, and asks for labelled parts (GH #499)', () => {
    const prompt = buildPersonalFlowCoachingPrompt(makeInput());
    expect(prompt).toContain('Jordan Rivers');
    expect(prompt).toContain('90');
    expect(prompt).toContain('42'); // issues advanced
    expect(prompt).toContain('4.5'); // avg cycle time
    expect(prompt).toContain('SUMMARY:');
    expect(prompt).toContain('RECOMMENDATIONS:');
    expect(prompt).not.toContain('valid JSON');
  });

  it('names the dominant hands-on status when one is present, so the coach can flag queue time', () => {
    const prompt = buildPersonalFlowCoachingPrompt(makeInput({ topStatusByHandsOnDays: 'Ready to Work' }));
    expect(prompt).toContain('Ready to Work');
  });

  it('renders an em-dash for cycle time when it could not be measured', () => {
    const prompt = buildPersonalFlowCoachingPrompt(makeInput({ averageCycleTimeDays: null, medianCycleTimeDays: null }));
    expect(prompt).toContain('—');
  });
});

describe('parsePersonalFlowCoachingResponse', () => {
  it('parses a well-formed reply into a structured coaching summary', () => {
    const reply = JSON.stringify({
      kind: 'personalFlowCoaching',
      summary: 'Strong steady throughput.',
      strengths: ['Consistent weekly delivery'],
      concerns: ['Cycle time inflated by queue time'],
      recommendations: ['Pull work later', 'Reduce WIP'],
    });
    const coaching = parsePersonalFlowCoachingResponse(reply);
    expect(coaching.summary).toBe('Strong steady throughput.');
    expect(coaching.strengths).toEqual(['Consistent weekly delivery']);
    expect(coaching.recommendations).toHaveLength(2);
  });

  it('tolerates prose and markdown fences around the JSON', () => {
    const reply = 'Sure!\n```json\n{"kind":"personalFlowCoaching","summary":"ok","strengths":[],"concerns":[],"recommendations":[]}\n```';
    expect(parsePersonalFlowCoachingResponse(reply).summary).toBe('ok');
  });

  it('defaults missing list fields to empty arrays rather than throwing', () => {
    const reply = JSON.stringify({ kind: 'personalFlowCoaching', summary: 'only a summary' });
    const coaching = parsePersonalFlowCoachingResponse(reply);
    expect(coaching.strengths).toEqual([]);
    expect(coaching.concerns).toEqual([]);
    expect(coaching.recommendations).toEqual([]);
  });

  it('rejects a reply whose kind does not match', () => {
    const reply = JSON.stringify({ kind: 'nope', summary: 'x' });
    expect(() => parsePersonalFlowCoachingResponse(reply)).toThrow(/kind/i);
  });

  it('rejects a reply with no summary', () => {
    const reply = JSON.stringify({ kind: 'personalFlowCoaching', strengths: [] });
    expect(() => parsePersonalFlowCoachingResponse(reply)).toThrow(/summary/i);
  });
});

describe('parsePersonalFlowCoachingResponse — Google AI Mode replies (GH #499)', () => {
  it('reads a document with headings, an intro and a closing offer into the same coaching read', () => {
    const reply = [
      'Here is a coaching summary for Jordan Rivers based on the metrics provided.',
      '',
      '### Summary',
      'Jordan delivers steadily.',
      'Cycle time is inflated by queue time.',
      '',
      '### Strengths',
      '* Consistent throughput of 3.3 issues a week',
      '',
      '### Concerns',
      '1. Ready to Work holds the most hands-on time',
      '',
      '### Recommendations',
      '- Pull work only when ready',
      '- Ask for earlier reviews',
      '',
      'If you would like, I can turn this into talking points for a 1:1.',
    ].join('\n');

    expect(parsePersonalFlowCoachingResponse(reply)).toEqual({
      summary: 'Jordan delivers steadily. Cycle time is inflated by queue time.',
      strengths: ['Consistent throughput of 3.3 issues a week'],
      concerns: ['Ready to Work holds the most hands-on time'],
      recommendations: ['Pull work only when ready', 'Ask for earlier reviews'],
    });
  });

  it('reads the asked-for labels, with "None" meaning an empty list', () => {
    const reply = 'SUMMARY: Solid flow.\nSTRENGTHS:\n- Fast reviews\nCONCERNS: None\nRECOMMENDATIONS:\n- Keep going';

    expect(parsePersonalFlowCoachingResponse(reply)).toEqual({
      summary: 'Solid flow.', strengths: ['Fast reviews'], concerns: [], recommendations: ['Keep going'],
    });
  });

  it('refuses a labelled reply with no summary, and the follow-up asks only for what is missing', () => {
    const reply = 'STRENGTHS:\n- Fast reviews';

    expect(() => parsePersonalFlowCoachingResponse(reply)).toThrow(/summary/i);
    const followUpPrompt = buildPersonalFlowCoachingFollowUpPrompt(reply);
    expect(followUpPrompt).toContain('SUMMARY: [text]');
    expect(followUpPrompt).not.toContain('STRENGTHS: [text]');
  });

  it('refuses prose that follows no part of the form, and the follow-up asks for all four parts', () => {
    const reply = 'Jordan seems to be doing fine overall.';

    expect(() => parsePersonalFlowCoachingResponse(reply)).toThrow(/No JSON object found/);
    const followUpPrompt = buildPersonalFlowCoachingFollowUpPrompt(reply);
    expect(followUpPrompt).toContain('could not be read');
    expect(followUpPrompt).toContain('RECOMMENDATIONS: [text]');
  });
});
