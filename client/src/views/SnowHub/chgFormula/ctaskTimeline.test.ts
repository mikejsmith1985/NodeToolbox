// ctaskTimeline.test.ts — Ordering a change's CTASKs and dating them back to back from the change's start.

import { describe, expect, it } from 'vitest';

import type { ReviewedCtask } from './ctaskReviewRecord.ts';
import {
  buildCtaskTimelinePrompt,
  isTimelinePastWindow,
  parseCtaskTimelineReply,
  rankCtaskStage,
  scheduleCtaskTimeline,
} from './ctaskTimeline.ts';

/** A change task as the risk check reads it. */
function buildCtask(overrides: Partial<ReviewedCtask> = {}): ReviewedCtask {
  return {
    sysId: 'task-1',
    number: 'CTASK0000001',
    shortDescription: 'Deploy recon service',
    description: 'Run the pipeline.',
    typeLabel: 'Implementation',
    isImplementation: true,
    configItem: { sysId: 'ci-1', displayName: 'Recon' },
    assignedTo: { sysId: 'usr-1', displayName: 'Jane Smith' },
    assignmentGroup: { sysId: 'grp-1', displayName: 'Platform Team' },
    backoutPlan: 'Redeploy v1.4.',
    backoutFieldName: 'u_backout_plan',
    ...overrides,
  };
}

const IMPLEMENTATION_TASK = buildCtask({
  number: 'CTASK0000001',
  description: 'Deploy usmg-enrollment-ingestion PR 98.\nImplementation: 30 minutes\nPost-deployment validation/monitoring: 15 minutes',
});
const TECHNICAL_TASK = buildCtask({
  sysId: 'task-2', number: 'CTASK0000002', shortDescription: 'Review Technical Checkout', typeLabel: 'Review', isImplementation: false,
});
const BUSINESS_TASK = buildCtask({
  sysId: 'task-3', number: 'CTASK0000003', shortDescription: 'Review Business Checkout', typeLabel: 'Review', isImplementation: false,
});
const ALL_TASKS = [BUSINESS_TASK, TECHNICAL_TASK, IMPLEMENTATION_TASK];
const WINDOW = { startUtc: '2026-10-10T05:00', endUtc: '2026-10-10T07:00' };

describe('rankCtaskStage', () => {
  it('puts Implementation first, then Review Technical Checkout, then Review Business Checkout', () => {
    expect(rankCtaskStage(IMPLEMENTATION_TASK)).toBeLessThan(rankCtaskStage(TECHNICAL_TASK));
    expect(rankCtaskStage(TECHNICAL_TASK)).toBeLessThan(rankCtaskStage(BUSINESS_TASK));
  });
});

describe('buildCtaskTimelinePrompt', () => {
  it('gives every task with its type, instructions and estimates, the stage order, and the reply format', () => {
    const prompt = buildCtaskTimelinePrompt(ALL_TASKS, WINDOW);

    expect(prompt).toMatch(/Implementation → Review Technical Checkout → Review Business Checkout/);
    expect(prompt).toContain('CTASK0000001');
    expect(prompt).toContain('Deploy usmg-enrollment-ingestion PR 98.');
    expect(prompt).toContain('estimated: implementation 30 min, validation 15 min');
    expect(prompt).toContain('TIMELINE:');
  });

  it('ends with a table already listing every task, for the assistant to fill in (GH #499)', () => {
    const prompt = buildCtaskTimelinePrompt(ALL_TASKS, WINDOW);

    expect(prompt.trimEnd().endsWith([
      'TIMELINE:',
      'Task | Minutes | Why it runs here',
      'CTASK0000003 — Review Business Checkout | ___ | ___',
      'CTASK0000002 — Review Technical Checkout | ___ | ___',
      'CTASK0000001 — Deploy recon service | ___ | ___',
    ].join('\n'))).toBe(true);
    expect(prompt).toContain('Do not add, remove, rename or renumber tasks');
  });
});

describe('parseCtaskTimelineReply', () => {
  it('reads the order and minutes, ignoring unknown tasks and naming any left out', () => {
    const reply = '```text\nTIMELINE:\nCTASK0000001 | 45 | deploy then validate\nCTASK0000099 | 10\nCTASK0000002 | 20\n```';

    expect(parseCtaskTimelineReply(reply, ALL_TASKS)).toMatchObject({
      entries: [{ ctaskNumber: 'CTASK0000001', minutes: 45 }, { ctaskNumber: 'CTASK0000002', minutes: 20 }],
      missingNumbers: ['CTASK0000003'],
    });
  });

  it('reads the filled-in table as a web page copies it: tabs, bold, a header, lengths in hours', () => {
    const reply = [
      'Why it runs here\tTask\tMinutes',
      'deploy first\t**CTASK0000001 — Deploy recon service**\t1.5 Hours',
      'then check\tCTASK0000002 — Review Technical Checkout\t~20 min',
      '| CTASK0000003 — Review Business Checkout | 30 | last |',
    ].join('\n');

    expect(parseCtaskTimelineReply(reply, ALL_TASKS)).toMatchObject({
      entries: [
        { ctaskNumber: 'CTASK0000001', minutes: 90 },
        { ctaskNumber: 'CTASK0000002', minutes: 20 },
        { ctaskNumber: 'CTASK0000003', minutes: 30 },
      ],
      missingNumbers: [],
      followUpPrompt: '',
    });
  });

  it('never reads a start time as minutes, and asks for the table again for every task it could not read', () => {
    // Google AI Mode's reply shape: start and end times, with its own task numbers.
    const reply = 'CTASK02 | CTASK0000002 — Review Technical Checkout | 2026-11-12T14:30 | 2026-11-12T15:30 | Release Eng';

    const parsed = parseCtaskTimelineReply(reply, ALL_TASKS);
    expect(parsed.entries).toEqual([]);
    expect(parsed.followUpPrompt).toContain('was not in the form I need');
    expect(parsed.followUpPrompt).toContain('CTASK0000002 — Review Technical Checkout | ___ | ___');
  });
});

describe('scheduleCtaskTimeline', () => {
  it('dates the tasks back to back from the window start, in stage order even when the reply mixes them', () => {
    const schedule = scheduleCtaskTimeline(
      [{ ctaskNumber: 'CTASK0000003', minutes: 30 }, { ctaskNumber: 'CTASK0000001', minutes: 45 }, { ctaskNumber: 'CTASK0000002', minutes: 20 }],
      ALL_TASKS,
      WINDOW.startUtc,
    );

    expect(schedule.map((entry) => [entry.ctask.number, entry.startUtc, entry.endUtc])).toEqual([
      ['CTASK0000001', '2026-10-10T05:00', '2026-10-10T05:45'],
      ['CTASK0000002', '2026-10-10T05:45', '2026-10-10T06:05'],
      ['CTASK0000003', '2026-10-10T06:05', '2026-10-10T06:35'],
    ]);
    expect(isTimelinePastWindow(schedule, WINDOW.endUtc)).toBe(false);
  });

  it('says when the timeline runs past the change\'s planned end', () => {
    const schedule = scheduleCtaskTimeline([{ ctaskNumber: 'CTASK0000001', minutes: 150 }], ALL_TASKS, WINDOW.startUtc);

    expect(isTimelinePastWindow(schedule, WINDOW.endUtc)).toBe(true);
  });
});
