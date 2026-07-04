// canvasAiAssist.test.ts — Verifies the gated AI round-trip prompt build and strict JSON ingestion.

import { describe, expect, it } from 'vitest';

import { buildCanvasAiPrompt, buildScopeQueryPrompt, extractJsonPayload, parseCanvasAiResponse, parseScopeQueryResponse } from './canvasAiAssist.ts';

describe('canvasAiAssist', () => {
  it('builds a prompt that names the issues and demands JSON only', () => {
    const prompt = buildCanvasAiPrompt('priorityOrder', [{ issueKey: 'DENP-1', summary: 'Login', status: 'To Do', storyPoints: 3, businessValue: null }]);
    expect(prompt).toContain('DENP-1');
    expect(prompt).toContain('valid JSON');
  });

  it('includes the Business Value tag and prioritization guidance when a score is present', () => {
    const prompt = buildCanvasAiPrompt('priorityOrder', [{ issueKey: 'DENP-1', summary: 'Login', status: 'To Do', storyPoints: 3, businessValue: 8 }]);
    expect(prompt).toContain('BV 8');
    expect(prompt).toContain('Business Value');
  });

  it('omits the Business Value tag when the score is unset', () => {
    const prompt = buildCanvasAiPrompt('priorityOrder', [{ issueKey: 'DENP-2', summary: 'Logout', status: 'To Do', storyPoints: 2, businessValue: null }]);
    expect(prompt).not.toContain('BV ');
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


describe('scopeQuery NL→JQL round-trip', () => {
  it('builds a prompt that carries the description and demands JSON only', () => {
    const prompt = buildScopeQueryPrompt({ projectKey: 'ENCUC', piName: 'PI 26.3', description: 'features with the ENCUC label' });
    expect(prompt).toContain('ENCUC label');
    expect(prompt).toContain('valid JSON');
  });

  it('parses a valid reply into the proposed JQL', () => {
    const { jql } = parseScopeQueryResponse('{"kind":"scopeQuery","jql":"project = ENCUC AND labels = ENCUC"}');
    expect(jql).toBe('project = ENCUC AND labels = ENCUC');
  });

  it('rejects a missing/empty jql', () => {
    expect(() => parseScopeQueryResponse('{"kind":"scopeQuery","jql":""}')).toThrow(/Missing or empty/);
  });

  it('rejects a reply whose kind does not match', () => {
    expect(() => parseScopeQueryResponse('{"kind":"priorityOrder","jql":"x"}')).toThrow(/does not match/);
  });
});
