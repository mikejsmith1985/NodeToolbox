// taskTimeline.test.ts — Proves the AI timing round asks for real estimates (never "unknown"), reads them back per card,
// and dates each change's tasks back to back in stage order inside that change's window.

import { describe, expect, it } from 'vitest';

import type { CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState } from './changeDraft.ts';
import {
  buildEnvironmentTimelines, buildTaskTimelinePrompt, dateTaskCards, describeEnvironmentTimeline, describeTaskTiming,
  isTaskTimed, listTimelineOverruns, listUntimedTaskProblems, readTaskTimelineReply, scheduleTaskCards,
} from './taskTimeline.ts';

const BLANK = { sysId: '', displayName: '' };
const TIMED = { implementationMinutes: '30', validationMinutes: '15', backoutMinutes: '20' };

function buildCard(cardId: string, shortDescription: string, overrides: Partial<CtaskTemplate> = {}): CtaskTemplate {
  return {
    id: cardId, name: '', createdAt: '', shortDescription, description: '', assignmentGroup: BLANK, assignedTo: BLANK,
    plannedStartDate: '', plannedEndDate: '', closeNotes: '', changeTaskType: '', ...overrides,
  };
}

function buildDraft(changeTasks: CtaskTemplate[], prdEnd = '2026-10-24T23:00'): CrgDraftState {
  const issue = { key: 'ABC-1', fields: { summary: 'Fix login', status: { name: 'Done' }, issuetype: { name: 'Story' } } };
  const offEnvironment = { isEnabled: false, plannedStartDate: '', plannedEndDate: '' };
  return {
    fetchedIssues: [issue], selectedIssueKeys: new Set(['ABC-1']),
    relEnvironment: { isEnabled: true, plannedStartDate: '2026-10-22T19:00', plannedEndDate: '2026-10-22T21:00' },
    prdEnvironment: { isEnabled: true, plannedStartDate: '2026-10-24T22:00', plannedEndDate: prdEnd },
    pfixEnvironment: offEnvironment,
    changeTasks,
  } as unknown as CrgDraftState;
}

const DEPLOY = buildCard('c1', 'Deploy payments', { changeTaskType: 'implementation', durationEstimates: TIMED });
const BUSINESS = buildCard('c2', 'Business Checkout', { durationEstimates: { implementationMinutes: '20', validationMinutes: '10', backoutMinutes: '5' }, environmentKeys: ['PRD'] });
const TECHNICAL = buildCard('c3', 'Technical Checkout', { durationEstimates: { implementationMinutes: '10', validationMinutes: '5', backoutMinutes: '5' } });

describe('the timing prompt', () => {
  it('states every window with its length, every task, and the Jira work', () => {
    const promptText = buildTaskTimelinePrompt(buildDraft([DEPLOY, BUSINESS]));
    expect(promptText).toContain('REL: 2026-10-22T19:00 → 2026-10-22T21:00 (2 hours)');
    expect(promptText).toContain('T1 — Deploy payments (type: implementation; on the REL and PRD change)');
    expect(promptText).toContain('T2 — Business Checkout (type: not chosen; on the PRD change)');
    expect(promptText).toContain('ABC-1');
  });

  it('demands a best estimate from the context, never "unknown" or a question', () => {
    const promptText = buildTaskTimelinePrompt(buildDraft([DEPLOY]));
    expect(promptText).toContain('estimate it from the Jira work');
    expect(promptText).toContain('Never answer "unknown", "TBD", "not estimated", 0 or a range, and do not ask me');
    expect(promptText).toContain('<task id> | <implementation minutes> | <validation minutes> | <backout minutes> | <why this long>');
  });
});

describe('reading the timing reply', () => {
  const cards = [buildCard('c1', 'Deploy'), buildCard('c2', 'Checkout')];

  it('gives each card its three estimates, through code fences and minute words', () => {
    const reply = readTaskTimelineReply('```\nTIMELINE:\nT1 | 30 min | 15 | 20 | build and deploy\n- T2 | 10 | 5 | 5 | smoke test\n```', cards);
    expect(reply.isUsable).toBe(true);
    expect(reply.estimatesByTaskId).toEqual({
      c1: { implementationMinutes: '30', validationMinutes: '15', backoutMinutes: '20' },
      c2: { implementationMinutes: '10', validationMinutes: '5', backoutMinutes: '5' },
    });
    expect(reply.message).toContain('Every task is timed (2)');
  });

  it('refuses a zero estimate and names the card the reply left untimed', () => {
    const reply = readTaskTimelineReply('TIMELINE:\nT1 | 30 | 15 | 20 | ok\nT2 | 0 | 5 | 5 | unknown', cards);
    expect(Object.keys(reply.estimatesByTaskId)).toEqual(['c1']);
    expect(reply.message).toContain('left out Checkout');
  });

  it('says plainly when the reply has no timings at all', () => {
    const reply = readTaskTimelineReply('Sure, which tasks?', cards);
    expect(reply.isUsable).toBe(false);
    expect(reply.message).toContain('No task timings could be read');
  });

  it('reads the task title echoed after the id, and lengths in hours', () => {
    const reply = readTaskTimelineReply('TIMELINE:\nT1 — Deploy | 1h 30m | 0.5 hours | 45 min | three modules\nT2 - Checkout | 10 mins | 5 | 2 hrs | smoke', cards);
    expect(reply.estimatesByTaskId).toEqual({
      c1: { implementationMinutes: '90', validationMinutes: '30', backoutMinutes: '45' },
      c2: { implementationMinutes: '10', validationMinutes: '5', backoutMinutes: '120' },
    });
  });

  it('reads a markdown table with bold ids, skipping its header and divider rows', () => {
    const tableReply = [
      '| Task | Implementation | Validation | Backout | Why |',
      '|---|---|---|---|---|',
      '| **T1** | 30 | 15 | 20 | deploy |',
      '| **T2** | 10 | 5 | 5 | checkout |',
    ].join('\n');
    expect(Object.keys(readTaskTimelineReply(tableReply, cards).estimatesByTaskId)).toEqual(['c1', 'c2']);
  });

  it('matches a modify\'s cards by their CTASK number or their title, and names that number in the prompt', () => {
    const loadedCards = [{ ...buildCard('m1', 'Implementation - Payments'), name: 'CTASK0012345' }, buildCard('m2', 'Business Checkout')];
    const reply = readTaskTimelineReply('CTASK0012345 | 45 | 15 | 30 | modules\nBusiness Checkout | 20 | 10 | 5 | smoke', loadedCards);
    expect(Object.keys(reply.estimatesByTaskId)).toEqual(['m1', 'm2']);
    expect(buildTaskTimelinePrompt(buildDraft(loadedCards))).toContain('T1 — Implementation - Payments [CTASK0012345]');
  });
});

describe('the schedule', () => {
  it('dates the timed cards back to back, implementation first and the checkouts after, in the card order within a stage', () => {
    const schedule = scheduleTaskCards([BUSINESS, TECHNICAL, DEPLOY], '2026-10-24T22:00');
    expect(schedule.map((scheduled) => [scheduled.card.id, scheduled.plannedStartDate, scheduled.plannedEndDate])).toEqual([
      ['c1', '2026-10-24T22:00', '2026-10-24T22:45'],
      ['c3', '2026-10-24T22:45', '2026-10-24T23:00'],
      ['c2', '2026-10-24T23:00', '2026-10-24T23:30'],
    ]);
  });

  it('never invents a length: an untimed card keeps the dates it had', () => {
    const untimed = buildCard('c9', 'Notify');
    const datedCards = dateTaskCards([DEPLOY, untimed], '2026-10-24T22:00');
    expect(datedCards[0]).toMatchObject({ plannedStartDate: '2026-10-24T22:00', plannedEndDate: '2026-10-24T22:45' });
    expect(datedCards[1]).toBe(untimed);
    expect(scheduleTaskCards([DEPLOY], '')).toEqual([]);
  });

  it('times each change separately with only its own tasks, and says how far they overrun the window', () => {
    const timelines = buildEnvironmentTimelines(buildDraft([DEPLOY, BUSINESS], '2026-10-24T23:00'));
    expect(timelines.map((timeline) => [timeline.label, timeline.schedule.length, timeline.overrunMinutes])).toEqual([['REL', 1, 0], ['PRD', 2, 15]]);
    expect(listTimelineOverruns(buildDraft([DEPLOY, BUSINESS]))).toEqual([
      "On the PRD change the tasks run 15 minutes past the window's end. Make the window longer, or shorten the tasks.",
    ]);
  });

  it('describes a change\'s timeline for the AI with the window length and each task\'s times and estimates', () => {
    const [, prdTimeline] = buildEnvironmentTimelines(buildDraft([DEPLOY, BUSINESS], '2026-10-25T01:00'));
    expect(describeEnvironmentTimeline(prdTimeline)).toEqual([
      'PRD: 2026-10-24T22:00 → 2026-10-25T01:00 (3 hours)',
      '  1. Deploy payments: 22:00 → 22:45 (implementation 30 minutes, validation 15 minutes, backout 20 minutes)',
      '  2. Business Checkout: 22:45 → 23:15 (implementation 20 minutes, validation 10 minutes, backout 5 minutes)',
    ]);
  });
});

describe('what holds the tasks step', () => {
  it('names every task with no timing, and nothing once all are timed', () => {
    const untimed = buildCard('c9', 'Notify', { durationEstimates: { implementationMinutes: '10', validationMinutes: '', backoutMinutes: '5' } });
    expect(isTaskTimed(untimed)).toBe(false);
    expect(describeTaskTiming(untimed)).toBe('');
    expect(listUntimedTaskProblems(buildDraft([DEPLOY, untimed]))).toEqual(['Notify has no timing yet. Use “Time the tasks with AI” below.']);
    expect(listUntimedTaskProblems(buildDraft([DEPLOY]))).toEqual([]);
  });
});
