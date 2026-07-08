// planIngest.test.ts — Verifies the capacity-plan write-back translate prompt and its strict JSON ingest.

import { describe, expect, it } from 'vitest';

import type { CanvasNode } from '../logic/canvasTypes.ts';
import { buildTranslatePrompt, parsePlanIngest, resolveIngestPlacements } from './planIngest.ts';

/** A minimal feature node carrying the given child story keys, for placement resolution tests. */
function buildNode(issueKey: string, childKeys: string[]): CanvasNode {
  return {
    issueKey, position: { x: 0, y: 0 }, size: null, priority: null, containerId: null,
    isExpanded: false, isParked: false, parkReason: null, storyPlacements: {}, pendingComment: '',
    summary: issueKey, status: 'To Do', statusCategoryKey: 'new', assignee: null, storyPoints: null,
    businessValue: null, description: null, acceptanceCriteria: null, health: 'green', completionPercent: 0,
    hygieneFlags: [], dependencies: [], attachments: [], effectivePoints: 0,
    childStories: childKeys.map((key) => ({ key, summary: key, status: 'To Do', statusCategoryKey: 'new', storyPoints: 3 })),
  };
}

/** The sprint names Toolbox knows about; only these are legal targets for a re-sprint. */
const VALID_SPRINT_NAMES: readonly string[] = ['26.3.4', '26.3.5', '26.4.1'];

/** The roster Toolbox recognises; only these are legal assignee values when reassignment is on. */
const ROSTER_NAMES: readonly string[] = ['Jane Doe', 'Alan Turing'];

// ── buildTranslatePrompt ──

describe('buildTranslatePrompt', () => {
  it('states the "convert the agreed plan" instruction and demands JSON-only output', () => {
    const prompt = buildTranslatePrompt(VALID_SPRINT_NAMES, ROSTER_NAMES, { allowAssignee: false });
    expect(prompt).toContain('Convert the capacity plan we just agreed on in this conversation');
    expect(prompt).toContain('Output ONLY the JSON, no prose.');
  });

  it('embeds the exact JSON schema with the ingest kind', () => {
    const prompt = buildTranslatePrompt(VALID_SPRINT_NAMES, ROSTER_NAMES, { allowAssignee: false });
    expect(prompt).toContain('"kind":"capacityPlanIngest"');
    expect(prompt).toContain('{"issueKey":"KEY","sprint":"SPRINT"}');
  });

  it('lists every valid sprint name and requires an exact match', () => {
    const prompt = buildTranslatePrompt(VALID_SPRINT_NAMES, ROSTER_NAMES, { allowAssignee: false });
    for (const sprintName of VALID_SPRINT_NAMES) {
      expect(prompt).toContain(sprintName);
    }
    expect(prompt).toContain('MUST be exactly one of');
  });

  it('includes the assignee clause and roster names when assignee is allowed', () => {
    const prompt = buildTranslatePrompt(VALID_SPRINT_NAMES, ROSTER_NAMES, { allowAssignee: true });
    expect(prompt).toContain('{"issueKey":"KEY","sprint":"SPRINT","assignee":"NAME"}');
    for (const rosterName of ROSTER_NAMES) {
      expect(prompt).toContain(rosterName);
    }
    expect(prompt).toContain('assignee');
  });

  it('omits the assignee field and instructs not to include it when assignee is disallowed', () => {
    const prompt = buildTranslatePrompt(VALID_SPRINT_NAMES, ROSTER_NAMES, { allowAssignee: false });
    expect(prompt).not.toContain('"assignee":"NAME"');
    expect(prompt).toContain('Do NOT include');
    // Roster names must not leak when reassignment is off.
    expect(prompt).not.toContain('Alan Turing');
  });

  it('instructs one entry per moved story using exact keys and no invention', () => {
    const prompt = buildTranslatePrompt(VALID_SPRINT_NAMES, ROSTER_NAMES, { allowAssignee: false });
    expect(prompt).toContain('one entry per');
    expect(prompt).toContain('Do not invent');
  });

  it('is deterministic — identical inputs yield identical output', () => {
    const first = buildTranslatePrompt(VALID_SPRINT_NAMES, ROSTER_NAMES, { allowAssignee: true });
    const second = buildTranslatePrompt(VALID_SPRINT_NAMES, ROSTER_NAMES, { allowAssignee: true });
    expect(first).toBe(second);
  });
});

// ── parsePlanIngest ──

describe('parsePlanIngest', () => {
  it('parses a clean, valid payload', () => {
    const responseText = JSON.stringify({
      kind: 'capacityPlanIngest',
      assignments: [
        { issueKey: 'NT-1', sprint: '26.3.4' },
        { issueKey: 'NT-2', sprint: '26.4.1' },
      ],
    });
    const result = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: false });
    expect(result.errors).toEqual([]);
    expect(result.assignments).toEqual([
      { issueKey: 'NT-1', sprint: '26.3.4' },
      { issueKey: 'NT-2', sprint: '26.4.1' },
    ]);
  });

  it('tolerates ```json fences and surrounding prose', () => {
    const responseText = [
      'Sure! Here is the JSON you asked for:',
      '```json',
      '{"kind":"capacityPlanIngest","assignments":[{"issueKey":"NT-9","sprint":"26.3.5"}]}',
      '```',
      'Let me know if you need anything else.',
    ].join('\n');
    const result = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: false });
    expect(result.errors).toEqual([]);
    expect(result.assignments).toEqual([{ issueKey: 'NT-9', sprint: '26.3.5' }]);
  });

  it('returns an error (never throws) when no JSON object is present', () => {
    const result = parsePlanIngest('there is no json here at all', {
      validSprintNames: VALID_SPRINT_NAMES,
      allowAssignee: false,
    });
    expect(result.assignments).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('No JSON object found');
  });

  it('returns an error (never throws) when the JSON is malformed', () => {
    const result = parsePlanIngest('{ this is : not valid json }', {
      validSprintNames: VALID_SPRINT_NAMES,
      allowAssignee: false,
    });
    expect(result.assignments).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it('rejects a payload whose kind is not capacityPlanIngest', () => {
    const responseText = JSON.stringify({ kind: 'somethingElse', assignments: [] });
    const result = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: false });
    expect(result.assignments).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('somethingElse');
    expect(result.errors[0]).toContain('capacityPlanIngest');
  });

  it('errors when assignments is not an array', () => {
    const responseText = JSON.stringify({ kind: 'capacityPlanIngest', assignments: 'nope' });
    const result = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: false });
    expect(result.assignments).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it('skips an entry with an unknown sprint but keeps the valid ones, recording an error', () => {
    const responseText = JSON.stringify({
      kind: 'capacityPlanIngest',
      assignments: [
        { issueKey: 'NT-1', sprint: '26.3.4' },
        { issueKey: 'NT-2', sprint: '99.9.9' },
      ],
    });
    const result = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: false });
    expect(result.assignments).toEqual([{ issueKey: 'NT-1', sprint: '26.3.4' }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('99.9.9');
    expect(result.errors[0]).toContain('NT-2');
  });

  it('sprint matching is case-sensitive and exact', () => {
    const responseText = JSON.stringify({
      kind: 'capacityPlanIngest',
      assignments: [{ issueKey: 'NT-1', sprint: '26.3.4 ' }],
    });
    // Trailing space is trimmed, so this should still match.
    const trimmed = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: false });
    expect(trimmed.assignments).toEqual([{ issueKey: 'NT-1', sprint: '26.3.4' }]);
  });

  it('errors on an entry missing issueKey or sprint', () => {
    const responseText = JSON.stringify({
      kind: 'capacityPlanIngest',
      assignments: [
        { sprint: '26.3.4' },
        { issueKey: 'NT-3' },
        { issueKey: '', sprint: '26.3.4' },
      ],
    });
    const result = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: false });
    expect(result.assignments).toEqual([]);
    expect(result.errors).toHaveLength(3);
  });

  it('trims issueKey and sprint on valid entries', () => {
    const responseText = JSON.stringify({
      kind: 'capacityPlanIngest',
      assignments: [{ issueKey: '  NT-7  ', sprint: '  26.4.1  ' }],
    });
    const result = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: false });
    expect(result.assignments).toEqual([{ issueKey: 'NT-7', sprint: '26.4.1' }]);
  });

  it('keeps a trimmed assignee when reassignment is enabled', () => {
    const responseText = JSON.stringify({
      kind: 'capacityPlanIngest',
      assignments: [{ issueKey: 'NT-1', sprint: '26.3.4', assignee: '  Jane Doe  ' }],
    });
    const result = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: true });
    expect(result.errors).toEqual([]);
    expect(result.assignments).toEqual([{ issueKey: 'NT-1', sprint: '26.3.4', assignee: 'Jane Doe' }]);
  });

  it('drops the assignee field entirely when reassignment is disabled', () => {
    const responseText = JSON.stringify({
      kind: 'capacityPlanIngest',
      assignments: [{ issueKey: 'NT-1', sprint: '26.3.4', assignee: 'Jane Doe' }],
    });
    const result = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: false });
    expect(result.errors).toEqual([]);
    expect(result.assignments).toEqual([{ issueKey: 'NT-1', sprint: '26.3.4' }]);
    expect(result.assignments[0]).not.toHaveProperty('assignee');
  });

  it('omits assignee when allowed but the value is empty or missing', () => {
    const responseText = JSON.stringify({
      kind: 'capacityPlanIngest',
      assignments: [
        { issueKey: 'NT-1', sprint: '26.3.4', assignee: '   ' },
        { issueKey: 'NT-2', sprint: '26.3.5' },
      ],
    });
    const result = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: true });
    expect(result.errors).toEqual([]);
    expect(result.assignments).toEqual([
      { issueKey: 'NT-1', sprint: '26.3.4' },
      { issueKey: 'NT-2', sprint: '26.3.5' },
    ]);
  });

  it('is deterministic — identical inputs yield identical output', () => {
    const responseText = JSON.stringify({
      kind: 'capacityPlanIngest',
      assignments: [{ issueKey: 'NT-1', sprint: '26.3.4' }],
    });
    const first = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: false });
    const second = parsePlanIngest(responseText, { validSprintNames: VALID_SPRINT_NAMES, allowAssignee: false });
    expect(first).toEqual(second);
  });
});

describe('resolveIngestPlacements', () => {
  const nodes = [buildNode('DENP-1', ['DENP-11', 'DENP-12']), buildNode('DENP-2', ['DENP-21'])];

  it('resolves a story key to its parent feature for a story-level placement', () => {
    const { placements, unknownIssueKeys } = resolveIngestPlacements(
      [{ issueKey: 'DENP-11', sprint: '26.3.4' }], nodes,
    );
    expect(placements).toEqual([{ featureKey: 'DENP-1', storyKey: 'DENP-11', sprint: '26.3.4' }]);
    expect(unknownIssueKeys).toEqual([]);
  });

  it('resolves a feature key to a feature-level placement (storyKey null)', () => {
    const { placements } = resolveIngestPlacements([{ issueKey: 'DENP-2', sprint: '26.4.1' }], nodes);
    expect(placements).toEqual([{ featureKey: 'DENP-2', storyKey: null, sprint: '26.4.1' }]);
  });

  it('reports issue keys that are on neither a story nor a feature as unknown', () => {
    const { placements, unknownIssueKeys } = resolveIngestPlacements(
      [{ issueKey: 'GHOST-9', sprint: '26.3.5' }], nodes,
    );
    expect(placements).toEqual([]);
    expect(unknownIssueKeys).toEqual(['GHOST-9']);
  });
});
