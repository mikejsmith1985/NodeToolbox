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
    chgBasicInfo: { category: 'Software', changeType: 'Normal' },
    chgPlanningAssessment: { impact: '3 - Low', canBeBackedOut: '' },
    chgPlanningContent: { implementationPlan: '', backoutPlan: '', testPlan: '' },
    generatedShortDescription: 'Payments | deploy | v2', generatedDescription: '', generatedJustification: 'Fixes login', generatedRiskImpact: '',
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
    expect(promptText).toContain('<task id> | <implementation minutes> | <validation minutes> | <backout minutes> | <in order');
  });
});

describe('the timing prompt asks how each task runs', () => {
  it('states what the earlier steps said, and only what they said', () => {
    const promptText = buildTaskTimelinePrompt(buildDraft([DEPLOY]));
    expect(promptText).toContain('What the earlier steps say about this change:');
    expect(promptText).toContain('  Short description: Payments | deploy | v2');
    expect(promptText).toContain('  Why it is needed: Fixes login');
    expect(promptText).toContain('  impact: 3 - Low');
    expect(promptText).not.toContain('What is changing:');
  });

  it('asks for stand-by, parallel and not-before placements, with the window clock named', () => {
    const promptText = buildTaskTimelinePrompt(buildDraft([DEPLOY]));
    expect(promptText).toMatch(/The change windows \(one change per environment\), on the .+ clock:/);
    expect(promptText).toContain('"whole window": a task kept only for awareness or on stand-by');
    expect(promptText).toContain('"with T<n>": a task that can run at the same time as task T<n>');
    expect(promptText).toContain('add "; not before HH:MM <zone>" in 24-hour time');
    expect(promptText).toContain('<in order / whole window / with T<n>, then "; not before HH:MM <zone>" if any> | <why>');
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

  it('reads how each task runs from the cell after its lengths, and leaves an older reply\'s placements alone', () => {
    const threeCards = [buildCard('c1', 'Deploy'), buildCard('c2', 'Checkout'), buildCard('c3', 'Prod Support - awareness')];
    const reply = readTaskTimelineReply(
      'TIMELINE:\nT1 | 30 | 15 | 20 | in order; not before 17:00 UTC | deploy\nT2 | 10 | 5 | 5 | with T1 | smoke\nT3 | 15 | 5 | 5 | whole window | awareness',
      threeCards, '2026-10-24T22:00',
    );
    expect(reply.placementsByTaskId.c2).toEqual({ runMode: 'alongside', alongsideTaskTitle: 'Deploy' });
    expect(reply.placementsByTaskId.c3).toEqual({ runMode: 'wholeWindow' });
    expect(reply.placementsByTaskId.c1.runMode).toBe('inOrder');
    expect(readTaskTimelineReply('TIMELINE:\nT1 | 30 | 15 | 20 | build and deploy', threeCards).placementsByTaskId).toEqual({});
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

describe('placing tasks that need not wait (GH #475)', () => {
  const window = { start: '2026-10-24T20:00', end: '2026-10-25T05:00' };
  const deploy = buildCard('p1', 'Approve and deploy', { changeTaskType: 'implementation', durationEstimates: { implementationMinutes: '45', validationMinutes: '15', backoutMinutes: '30' } });
  const reprocess = buildCard('p2', 'Reprocess feedback file', { changeTaskType: 'implementation', durationEstimates: { implementationMinutes: '30', validationMinutes: '60', backoutMinutes: '20' } });
  const aws = buildCard('p3', 'Enrollment - AWS', { changeTaskType: 'implementation', durationEstimates: { implementationMinutes: '30', validationMinutes: '15', backoutMinutes: '20' } });
  const checkout = buildCard('p4', 'Technical Checkout', { durationEstimates: { implementationMinutes: '30', validationMinutes: '30', backoutMinutes: '15' } });
  const slots = (cards: CtaskTemplate[]) => scheduleTaskCards(cards, window.start, window.end).map((scheduled) => [scheduled.card.id, scheduled.plannedStartDate.slice(11), scheduled.plannedEndDate.slice(11)]);

  it('spans a stand-by task across the whole window and holds nobody up behind it', () => {
    const standBy = { ...deploy, id: 'p0', shortDescription: 'Prod Support - awareness', timelinePlacement: { runMode: 'wholeWindow' as const } };
    expect(slots([standBy, deploy, checkout])).toEqual([['p0', '20:00', '05:00'], ['p1', '20:00', '21:00'], ['p4', '21:00', '22:00']]);
  });

  it('starts an "alongside" task with its partner, and the next task waits for both', () => {
    const parallelAws = { ...aws, timelinePlacement: { runMode: 'alongside' as const, alongsideTaskTitle: 'Approve and deploy' } };
    expect(slots([deploy, reprocess, parallelAws, checkout])).toEqual([
      ['p1', '20:00', '21:00'], ['p3', '20:00', '20:45'], ['p2', '21:00', '22:30'], ['p4', '22:30', '23:30'],
    ]);
  });

  it('holds a task until its "not before" time, and treats an alongside task with no partner here as in order', () => {
    const lateReprocess = { ...reprocess, timelinePlacement: { runMode: 'inOrder' as const, notBeforeTime: '23:00' } };
    const orphan = { ...aws, timelinePlacement: { runMode: 'alongside' as const, alongsideTaskTitle: 'Not on this change' } };
    expect(slots([deploy, lateReprocess, orphan])).toEqual([['p1', '20:00', '21:00'], ['p2', '23:00', '00:30'], ['p3', '00:30', '01:15']]);
  });

  it('does not count a stand-by task as running past the window, and names placements for the AI', () => {
    const standBy = { ...deploy, id: 'p0', shortDescription: 'Prod Support - awareness', environmentKeys: ['PRD' as const], timelinePlacement: { runMode: 'wholeWindow' as const } };
    const [, prdTimeline] = buildEnvironmentTimelines(buildDraft([standBy, DEPLOY], '2026-10-24T23:00'));
    expect(prdTimeline.overrunMinutes).toBe(0);
    expect(describeEnvironmentTimeline(prdTimeline)[1]).toContain('— on stand-by for the whole window — not a step the other tasks wait for');
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
