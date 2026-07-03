// canvasAiAssist.test.ts — Verifies the gated AI round-trip prompt build and strict JSON ingestion.

import { describe, expect, it } from 'vitest';

import { buildCanvasAiPrompt, extractJsonPayload, parseCanvasAiResponse } from './canvasAiAssist.ts';

describe('canvasAiAssist', () => {
  it('builds a prompt that names the issues and demands JSON only', () => {
    const prompt = buildCanvasAiPrompt('priorityOrder', [{ issueKey: 'DENP-1', summary: 'Login', status: 'To Do', storyPoints: 3 }]);
    expect(prompt).toContain('DENP-1');
    expect(prompt).toContain('valid JSON');
  });

  it('extracts JSON from a reply wrapped in chatter and code fences', () => {
    const reply = 'Sure! Here you go:\n```json\n{"kind":"priorityOrder","items":[]}\n```\nHope that helps.';
    expect(extractJsonPayload(reply)).toBe('{"kind":"priorityOrder","items":[]}');
  });

  it('parses a valid priorityOrder reply with items defaulting to un-accepted', () => {
    const set = parseCanvasAiResponse('priorityOrder', '{"kind":"priorityOrder","items":[{"issueKey":"DENP-1","bucket":"Must","rationale":"blocks work"}]}');
    expect(set.items).toHaveLength(1);
    expect(set.items[0]).toMatchObject({ issueKey: 'DENP-1', proposedValue: 'Must', accepted: false });
  });

  it('rejects an invalid MoSCoW bucket with a descriptive error', () => {
    expect(() => parseCanvasAiResponse('priorityOrder', '{"kind":"priorityOrder","items":[{"issueKey":"DENP-1","bucket":"Urgent"}]}'))
      .toThrow(/Invalid bucket/);
  });

  it('rejects a reply whose kind does not match the request', () => {
    expect(() => parseCanvasAiResponse('priorityOrder', '{"kind":"staleCandidates","items":[]}'))
      .toThrow(/does not match/);
  });

  it('throws when no JSON object is present', () => {
    expect(() => extractJsonPayload('no json here')).toThrow(/No JSON object/);
  });

  it('flattens a sprintGrouping reply into per-issue suggestions', () => {
    const set = parseCanvasAiResponse('sprintGrouping', '{"kind":"sprintGrouping","groups":[{"containerTitle":"Sprint 25","issueKeys":["DENP-1","DENP-2"]}]}');
    expect(set.items.map((item) => item.issueKey)).toEqual(['DENP-1', 'DENP-2']);
    expect(set.items[0].proposedValue).toBe('Sprint 25');
  });
});
