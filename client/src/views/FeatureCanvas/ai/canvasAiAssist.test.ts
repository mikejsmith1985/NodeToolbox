// canvasAiAssist.test.ts — Verifies the gated AI round-trip prompt build and strict JSON ingestion.

import { describe, expect, it } from 'vitest';

import { buildCanvasAiPrompt, describeSuggestionAction, buildScopeQueryPrompt, extractJsonPayload, parseCanvasAiResponse, parseMasterPlan, parseScopeQueryResponse } from './canvasAiAssist.ts';

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

  it('builds a Triage prompt with the WIP limit, the park target, and park/complete/breakout actions', () => {
    const prompt = buildCanvasAiPrompt(
      'parkCandidates',
      [
        { issueKey: 'DENP-1', summary: 'Login', status: 'In Progress', storyPoints: 3, businessValue: 8, priority: 'Must' },
        { issueKey: 'DENP-2', summary: 'Logout', status: 'In Progress', storyPoints: 2, businessValue: 1, priority: 'Could' },
      ],
      { wipLimit: 1, inProgressCount: 2 },
    );
    expect(prompt).toContain('WIP limit: 1');
    expect(prompt).toContain('Features in progress: 2');
    expect(prompt).toContain('park at least 1');
    expect(prompt).toContain('Could'); // the MoSCoW tag rides each issue line
    expect(prompt).toContain('"complete"');
    expect(prompt).toContain('"breakout"');
  });

  it('adds PI days-left and the Definition of Done to Prioritize and Triage prompts', () => {
    const context = { wipLimit: 3, inProgressCount: 4, daysRemainingInPi: 24, piName: 'PI 26.3' };
    const prioritize = buildCanvasAiPrompt('priorityOrder', [{ issueKey: 'DENP-1', summary: 'x', status: 'In Progress', storyPoints: null, businessValue: null, priority: null }], context);
    expect(prioritize).toContain('24 day(s) left');
    expect(prioritize).toContain('integration testing');
    expect(prioritize).toContain('Definition');

    const triage = buildCanvasAiPrompt('parkCandidates', [{ issueKey: 'DENP-1', summary: 'x', status: 'In Progress', storyPoints: null, businessValue: null, priority: null }], context);
    expect(triage).toContain('24 day(s) left');
    expect(triage).toContain('WIP limit: 3'); // triage keeps the WIP line too
  });

  it('omits the PI time line when days-remaining is unknown, and from Size prompts entirely', () => {
    const noDays = buildCanvasAiPrompt('priorityOrder', [{ issueKey: 'DENP-1', summary: 'x', status: 'To Do', storyPoints: null, businessValue: null, priority: null }], { wipLimit: null, inProgressCount: 0, daysRemainingInPi: null, piName: 'PI 26.3' });
    expect(noDays).not.toContain('day(s) left');

    const size = buildCanvasAiPrompt('sizeEstimate', [{ issueKey: 'DENP-1', summary: 'x', status: 'To Do', storyPoints: null, businessValue: null, priority: null }], { wipLimit: 3, inProgressCount: 1, daysRemainingInPi: 24, piName: 'PI 26.3' });
    expect(size).not.toContain('day(s) left'); // sizing ignores the PI-time header
  });

  it('states the limit is not set when no WIP limit is configured', () => {
    const prompt = buildCanvasAiPrompt(
      'parkCandidates',
      [{ issueKey: 'DENP-1', summary: 'Login', status: 'In Progress', storyPoints: null, businessValue: null, priority: 'Should' }],
      { wipLimit: null, inProgressCount: 1 },
    );
    expect(prompt).toContain('WIP limit: not set');
    expect(prompt).not.toContain('park at least');
  });

  it('parses a sizeEstimate reply and rejects an invalid size', () => {
    const set = parseCanvasAiResponse('sizeEstimate', '{"kind":"sizeEstimate","items":[{"issueKey":"DENP-1","size":"L","rationale":"broad scope"}]}');
    expect(set.items).toEqual([{ issueKey: 'DENP-1', proposedValue: 'L', rationale: 'broad scope', accepted: false }]);
    expect(() => parseCanvasAiResponse('sizeEstimate', '{"kind":"sizeEstimate","items":[{"issueKey":"DENP-1","size":"HUGE"}]}')).toThrow(/Invalid size/);
  });

  it('describes each suggestion action in plain language', () => {
    expect(describeSuggestionAction('priorityOrder', { issueKey: 'A', proposedValue: 'Must', rationale: '', accepted: false })).toBe('Set priority to Must');
    expect(describeSuggestionAction('sizeEstimate', { issueKey: 'A', proposedValue: 'L', rationale: '', accepted: false })).toBe('Set size to L');
    expect(describeSuggestionAction('sprintGrouping', { issueKey: 'A', proposedValue: 'Sprint 25', rationale: '', accepted: false })).toBe('Assign to sprint “Sprint 25”');
    expect(describeSuggestionAction('parkCandidates', { issueKey: 'A', proposedValue: 'park', rationale: '', accepted: false })).toBe('Park (defer)');
    expect(describeSuggestionAction('parkCandidates', { issueKey: 'A', proposedValue: 'complete', rationale: '', accepted: false })).toContain('Complete box');
    expect(describeSuggestionAction('parkCandidates', { issueKey: 'A', proposedValue: 'breakout', rationale: '', accepted: false })).toContain('Break out');
  });

  it('builds a Master plan prompt covering size, bucket, triage, and sprint', () => {
    const prompt = buildCanvasAiPrompt(
      'masterPlan',
      [{ issueKey: 'DENP-1', summary: 'x', status: 'In Progress', storyPoints: 3, businessValue: null, priority: null }],
      { wipLimit: 2, inProgressCount: 3, daysRemainingInPi: 24, piName: 'PI 26.3' },
    );
    expect(prompt).toContain('"size"');
    expect(prompt).toContain('"triage"');
    expect(prompt).toContain('"sprint"');
    expect(prompt).toContain('24 day(s) left'); // PI context
    expect(prompt).toContain('WIP limit: 2'); // WIP context
  });

  it('parses a master plan leniently — valid fields kept, bad size/bucket dropped, unknown triage → keep', () => {
    const plan = parseMasterPlan('{"kind":"masterPlan","items":['
      + '{"issueKey":"A","size":"L","bucket":"Must","triage":"park","sprint":null,"reason":"stale"},'
      + '{"issueKey":"B","size":"HUGE","bucket":"Nope","triage":"weird","sprint":"Sprint 25"},'
      + '{"sprint":"x"}]}'); // missing issueKey → skipped
    expect(plan).toEqual([
      { issueKey: 'A', size: 'L', bucket: 'Must', triage: 'park', sprint: null, reason: 'stale' },
      { issueKey: 'B', size: null, bucket: null, triage: 'keep', sprint: 'Sprint 25', reason: '' },
    ]);
  });

  it('parseMasterPlan throws when the kind does not match', () => {
    expect(() => parseMasterPlan('{"kind":"sizeEstimate","items":[]}')).toThrow(/does not match/);
  });

  it('parses a parkCandidates reply and rejects an invalid action', () => {
    const set = parseCanvasAiResponse('parkCandidates', '{"kind":"parkCandidates","items":[{"issueKey":"DENP-2","action":"park","reason":"lowest priority"}]}');
    expect(set.kind).toBe('parkCandidates');
    expect(set.items).toEqual([{ issueKey: 'DENP-2', proposedValue: 'park', rationale: 'lowest priority', accepted: false }]);
    expect(() => parseCanvasAiResponse('parkCandidates', '{"kind":"parkCandidates","items":[{"issueKey":"DENP-2","action":"delete"}]}')).toThrow(/Invalid action/);
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

  it('includes the description and acceptance criteria as sub-lines, condensed', () => {
    const prompt = buildCanvasAiPrompt('priorityOrder', [{
      issueKey: 'DENP-1', summary: 'Login', status: 'In Progress', storyPoints: null, businessValue: null, priority: null,
      description: 'Members must authenticate\n   with SSO   before access.',
      acceptanceCriteria: 'Given SSO, when a member logs in, then a session starts.',
    }]);
    expect(prompt).toContain('description: Members must authenticate with SSO before access.');
    expect(prompt).toContain('acceptance criteria: Given SSO, when a member logs in, then a session starts.');
  });

  it('truncates a very long description so the prompt stays pasteable', () => {
    const longText = 'x'.repeat(500);
    const prompt = buildCanvasAiPrompt('priorityOrder', [{
      issueKey: 'DENP-1', summary: 'Login', status: 'To Do', storyPoints: null, businessValue: null, priority: null,
      description: longText,
    }]);
    expect(prompt).toContain('…');
    expect(prompt).not.toContain(longText);
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
