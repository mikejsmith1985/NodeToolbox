// epicOrderAiAssist.test.ts — The AI Assist round that proposes the order Epics are worked in.

import { describe, expect, it } from 'vitest';

import type { EpicToSchedule } from './epicDateSchedule.ts';
import { buildEpicOrderPrompt, parseEpicOrderReply } from './epicOrderAiAssist.ts';

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
    expect(prompt).toContain('"kind": "epicDatePlan"');
    expect(prompt).toMatch(/do not give dates/i);
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
    });
  });

  it('rejects keys it was not given, ignores repeats, and keeps any Epic it left out in its original place at the end', () => {
    const reply = '{"kind":"epicDatePlan","order":[{"key":"DENP-3"},{"key":"DENP-99"},{"key":"DENP-3"}]}';

    const parsed = parseEpicOrderReply(reply, ['DENP-1', 'DENP-2', 'DENP-3']);

    expect(parsed.order).toEqual(['DENP-3', 'DENP-1', 'DENP-2']);
    expect(parsed.rejectedKeys).toEqual(['DENP-99']);
    expect(parsed.maxParallelEpics).toBeNull();
  });

  it('ignores a parallel limit outside 1 to 10', () => {
    expect(parseEpicOrderReply('{"kind":"epicDatePlan","maxParallelEpics":40,"order":[]}', ['DENP-1']).maxParallelEpics).toBeNull();
  });

  it('refuses a reply meant for another AI Assist round', () => {
    expect(() => parseEpicOrderReply('{"kind":"piReview","items":[]}', ['DENP-1'])).toThrow(/epicDatePlan/);
  });
});
