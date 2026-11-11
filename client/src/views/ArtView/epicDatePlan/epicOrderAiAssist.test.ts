// epicOrderAiAssist.test.ts — The AI Assist round that proposes the order Epics are worked in.

import { describe, expect, it } from 'vitest';

import type { EpicToSchedule } from './epicDateSchedule.ts';
import { buildEpicOrderFollowUpPrompt, buildEpicOrderPrompt, parseEpicOrderReply } from './epicOrderAiAssist.ts';

const EPICS: EpicToSchedule[] = [
  { epicKey: 'DENP-1', summary: 'Recon reporting', points: 20, isStarted: false, existingTargetStart: null },
  { epicKey: 'DENP-2', summary: 'LIS fixes', points: 8, isStarted: true, existingTargetStart: '2026-09-21' },
  { epicKey: 'DENP-3', summary: 'Audit trail', points: null, isStarted: false, existingTargetStart: null },
];

describe('buildEpicOrderPrompt', () => {
  it('lists every Epic with its points, state and dependencies, and asks for an order — never dates', () => {
    const prompt = buildEpicOrderPrompt(EPICS, {
      piName: 'PI 26.5',
      piStartDate: '2026-10-12',
      piEndDate: '2026-12-30',
      dailyCapacityPoints: 10.6667,
      maxParallelEpics: 3,
      dependencyTextByKey: { 'DENP-1': 'blocked by DENP-2' },
    });

    expect(prompt).toContain('DENP-1 — Recon reporting — 20 points — not started');
    expect(prompt).toContain('DENP-2 — LIS fixes — 8 points — already in progress');
    expect(prompt).toContain('DENP-3 — Audit trail — no estimate — not started');
    expect(prompt).toContain('blocked by DENP-2');
    expect(prompt).toContain('10.7 points per working day');
    expect(prompt).not.toContain('"kind"');
    expect(prompt).toMatch(/do not give dates/i);
  });

  it('ends with the parallel-limit line and a fill-in table listing every Epic, not a JSON shape (GH #499)', () => {
    const prompt = buildEpicOrderPrompt(EPICS, {
      piName: 'PI 26.5', piStartDate: '2026-10-12', piEndDate: '2026-12-30', dailyCapacityPoints: 10, maxParallelEpics: 3, dependencyTextByKey: {},
    });

    expect(prompt).toContain('EPICS_AT_ONCE:');
    expect(prompt.split('\n').slice(-4)).toEqual([
      'Epic key | Epic | Position | Why it goes here',
      'DENP-1 | Recon reporting | ___ | ___',
      'DENP-2 | LIS fixes | ___ | ___',
      'DENP-3 | Audit trail | ___ | ___',
    ]);
  });
});

describe('parseEpicOrderReply', () => {
  it('reads the proposed order, the reasons and the parallel limit', () => {
    const reply = '```json\n{"kind":"epicDatePlan","maxParallelEpics":2,"order":[{"key":"DENP-2","rationale":"In flight."},{"key":"denp-3","rationale":"Small."},{"key":"DENP-1","rationale":"Waits on DENP-2."}]}\n```';

    expect(parseEpicOrderReply(reply, ['DENP-1', 'DENP-2', 'DENP-3'])).toEqual({
      order: ['DENP-2', 'DENP-3', 'DENP-1'],
      rationaleByKey: { 'DENP-2': 'In flight.', 'DENP-3': 'Small.', 'DENP-1': 'Waits on DENP-2.' },
      maxParallelEpics: 2,
      rejectedKeys: [],
      unplacedKeys: [],
    });
  });

  it('rejects keys it was not given, ignores repeats, and keeps any Epic it left out in its original place at the end', () => {
    const reply = '{"kind":"epicDatePlan","order":[{"key":"DENP-3"},{"key":"DENP-99"},{"key":"DENP-3"}]}';

    const parsed = parseEpicOrderReply(reply, ['DENP-1', 'DENP-2', 'DENP-3']);

    expect(parsed.order).toEqual(['DENP-3', 'DENP-1', 'DENP-2']);
    expect(parsed.rejectedKeys).toEqual(['DENP-99']);
    expect(parsed.unplacedKeys).toEqual(['DENP-1', 'DENP-2']);
    expect(parsed.maxParallelEpics).toBeNull();
  });

  it('ignores a parallel limit outside 1 to 10', () => {
    expect(parseEpicOrderReply('{"kind":"epicDatePlan","maxParallelEpics":40,"order":[]}', ['DENP-1']).maxParallelEpics).toBeNull();
  });

  it('refuses a reply meant for another AI Assist round', () => {
    expect(() => parseEpicOrderReply('{"kind":"piReview","items":[]}', ['DENP-1'])).toThrow(/epicDatePlan/);
  });
});

// ── Google AI Mode replies (GH #499) ──

const KNOWN_KEYS = ['DENP-1', 'DENP-2', 'DENP-3'];

describe('parseEpicOrderReply with an AI Mode reply', () => {
  it('reads a markdown table wrapped in an intro and a closing offer, ordering Epics by the positions written', () => {
    const reply = [
      'Based on the dependencies, here is the proposed order.',
      '',
      '**Epics at once:** 2',
      '',
      '| Epic key | Epic | Position | Why it goes here |',
      '|---|---|---|---|',
      '| DENP-1 | Recon reporting | 3 | Waits on DENP-2. |',
      '| DENP-2 | LIS fixes | 1 | In flight. |',
      '| DENP-3 | Audit trail | 2 | Small. |',
      '',
      'If you share the business value of each Epic, I can refine this order.',
    ].join('\n');

    expect(parseEpicOrderReply(reply, KNOWN_KEYS)).toEqual({
      order: ['DENP-2', 'DENP-3', 'DENP-1'],
      rationaleByKey: { 'DENP-2': 'In flight.', 'DENP-3': 'Small.', 'DENP-1': 'Waits on DENP-2.' },
      maxParallelEpics: 2,
      rejectedKeys: [],
      unplacedKeys: [],
    });
  });

  it('reads a table pasted from the web page as tab-separated cells, and the EPICS_AT_ONCE line', () => {
    const reply = ['EPICS_AT_ONCE: 3', 'Epic key\tEpic\tPosition\tWhy it goes here', 'DENP-3\tAudit trail\t1\tTiny.', 'DENP-1\tRecon\t2\tValue.', 'DENP-2\tLIS\t3\tLast.'].join('\n');

    const parsed = parseEpicOrderReply(reply, KNOWN_KEYS);

    expect(parsed.order).toEqual(['DENP-3', 'DENP-1', 'DENP-2']);
    expect(parsed.maxParallelEpics).toBe(3);
  });

  it('still ignores a parallel limit outside 1 to 10 written on the line', () => {
    const reply = 'EPICS_AT_ONCE: 40\nEpic key | Position\nDENP-1 | 1';

    expect(parseEpicOrderReply(reply, KNOWN_KEYS).maxParallelEpics).toBeNull();
  });

  it('reports an Epic left without a position as unplaced — never guessing where it goes', () => {
    const reply = 'Epic key | Position\nDENP-2 | 1\nDENP-1 | ___\nDENP-3 | 2';

    const parsed = parseEpicOrderReply(reply, KNOWN_KEYS);

    expect(parsed.order).toEqual(['DENP-2', 'DENP-3', 'DENP-1']);
    expect(parsed.unplacedKeys).toEqual(['DENP-1']);
  });
});

describe('buildEpicOrderFollowUpPrompt', () => {
  it('offers nothing when every Epic was placed', () => {
    const parsed = parseEpicOrderReply('Epic key | Position\nDENP-1 | 1\nDENP-2 | 2\nDENP-3 | 3', KNOWN_KEYS);

    expect(buildEpicOrderFollowUpPrompt(EPICS, parsed)).toBe('');
  });

  it('asks for the whole form again when the reply could not be read', () => {
    expect(() => parseEpicOrderReply('Start with DENP-2, it is in flight.', KNOWN_KEYS)).toThrow(/No JSON object found/);

    const followUp = buildEpicOrderFollowUpPrompt(EPICS, null);

    expect(followUp).toMatch(/^Your last reply was not in the form I need/);
    expect(followUp).toContain('EPICS_AT_ONCE:');
    expect(followUp).toContain('DENP-3 | Audit trail | ___ | ___');
  });

  it('names the Epics the reply did not place', () => {
    const parsed = parseEpicOrderReply('Epic key | Position\nDENP-2 | 1', KNOWN_KEYS);

    expect(buildEpicOrderFollowUpPrompt(EPICS, parsed)).toMatch(/no position for DENP-1, DENP-3/);
  });
});
