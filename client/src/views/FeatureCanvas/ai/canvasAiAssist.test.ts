// canvasAiAssist.test.ts — Verifies the gated AI round-trip prompt build and strict JSON ingestion.

import { describe, expect, it } from 'vitest';

import { buildCanvasAiPrompt, buildScopeQueryPrompt, extractJsonPayload, parseCanvasAiResponse, parseScopeQueryResponse } from './canvasAiAssist.ts';

describe('canvasAiAssist', () => {
  it('builds a prompt that names the issues and demands JSON only', () => {
    const prompt = buildCanvasAiPrompt('priorityOrder', [{ issueKey: 'DENP-1', summary: 'Login', status: 'To Do', storyPoints: 3, businessValue: null, priority: null }]);
    expect(prompt).toContain('DENP-1');
    expect(prompt).toContain('valid JSON');
  });

  it('includes the Business Value tag and prioritization guidance when a score is present', () => {
    const prompt = buildCanvasAiPrompt('priorityOrder', [{ issueKey: 'DENP-1', summary: 'Login', status: 'To Do', storyPoints: 3, businessValue: 8, priority: null }]);
    expect(prompt).toContain('BV 8');
    expect(prompt).toContain('Business Value');
  });

  it('omits the Business Value tag when the score is unset', () => {
    const prompt = buildCanvasAiPrompt('priorityOrder', [{ issueKey: 'DENP-2', summary: 'Logout', status: 'To Do', storyPoints: 2, businessValue: null, priority: null }]);
    expect(prompt).not.toContain('BV ');
  });

  it('builds a Reduce WIP prompt with the limit, the park target, and MoSCoW-aware guidance', () => {
    const prompt = buildCanvasAiPrompt(
      'wipReduction',
      [
        { issueKey: 'DENP-1', summary: 'Login', status: 'In Progress', storyPoints: 3, businessValue: 8, priority: 'Must' },
        { issueKey: 'DENP-2', summary: 'Logout', status: 'In Progress', storyPoints: 2, businessValue: 1, priority: 'Could' },
      ],
      { wipLimit: 1, inProgressCount: 2 },
    );
    expect(prompt).toContain('WIP limit: 1');
    expect(prompt).toContain('Features in progress: 2');
    expect(prompt).toContain('Park at least 1');
    expect(prompt).toContain('Could'); // the MoSCoW tag rides each issue line
    expect(prompt).toContain('PARK');
  });

  it('states the limit is not set when no WIP limit is configured', () => {
    const prompt = buildCanvasAiPrompt(
      'wipReduction',
      [{ issueKey: 'DENP-1', summary: 'Login', status: 'In Progress', storyPoints: null, businessValue: null, priority: 'Should' }],
      { wipLimit: null, inProgressCount: 1 },
    );
    expect(prompt).toContain('WIP limit: not set');
    expect(prompt).not.toContain('Park at least');
  });

  it('parses a wipReduction reply into park proposals', () => {
    const set = parseCanvasAiResponse('wipReduction', '{"kind":"wipReduction","items":[{"issueKey":"DENP-2","reason":"lowest priority"}]}');
    expect(set.kind).toBe('wipReduction');
    expect(set.items).toEqual([{ issueKey: 'DENP-2', proposedValue: 'lowest priority', rationale: 'lowest priority', accepted: false }]);
  });

  it('includes the real feature signals (health, completion, active stories, blockers) in each line', () => {
    const prompt = buildCanvasAiPrompt('priorityOrder', [{
      issueKey: 'DENP-1', summary: 'Login', status: 'In Progress', storyPoints: null, businessValue: null, priority: null,
      health: 'red', completionPercent: 40, activeChildCount: 2, totalChildCount: 5, blockerCount: 1,
    }]);
    expect(prompt).toContain('health red');
    expect(prompt).toContain('40% done');
    expect(prompt).toContain('2/5 stories active');
    expect(prompt).toContain('1 blocker/link');
    // And it instructs the model not to fabricate the missing Business Value / effort.
    expect(prompt).toContain('do NOT invent');
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
