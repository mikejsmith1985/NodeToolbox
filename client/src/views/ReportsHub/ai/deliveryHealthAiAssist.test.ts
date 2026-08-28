// deliveryHealthAiAssist.test.ts — Handing over the whole picture, and reading back a plan.

import { describe, expect, it } from 'vitest';

import {
  buildDeliveryHealthPrompt,
  DELIVERY_HEALTH_REPLY_KIND,
  parseDeliveryHealthReply,
} from './deliveryHealthAiAssist.ts';
import { scanQueues, type QueueIssueInput } from '../queueScan.ts';
import { scanRework, type ReworkIssue } from '../reworkScan.ts';

const NOW_MS = Date.parse('2026-08-28T12:00:00.000Z');

/** A moment the given number of days before now. */
function daysAgo(dayCount: number): string {
  return new Date(NOW_MS - dayCount * 86_400_000).toISOString();
}

/** One issue sitting in a status. */
function queued(key: string, statusName: string, waitedDays: number, categoryKey = 'indeterminate'): QueueIssueInput {
  return {
    key,
    summary: `Summary for ${key}`,
    statusName,
    assigneeName: 'Phatate, Smita',
    enteredStatusIso: daysAgo(waitedDays),
    storyPoints: 5,
    statusCategoryKey: categoryKey,
  };
}

/** An issue that reached delivery and came back. */
function reworked(key: string): ReworkIssue {
  return {
    key,
    summary: `Summary for ${key}`,
    storyPoints: null,
    assigneeName: 'Reynolds, Kevin',
    initialStatusName: 'To Do',
    statusTransitions: [
      { toStatusName: 'Ready for QA', atIso: daysAgo(40) },
      { toStatusName: 'Working', atIso: daysAgo(30) },
      { toStatusName: 'Ready for QA', atIso: daysAgo(20) },
    ],
  };
}

/** A queue and rework scan of the same shape as the dashboard's. */
function buildScans() {
  const queue = scanQueues([
    queued('SL-1', 'Ready for Testing', 40),
    queued('SL-2', 'Ready for Testing', 35),
    queued('TODO-1', 'To Do', 180, 'new'),
  ], NOW_MS);
  return { queue, rework: scanRework([reworked('ENCUC-9')], NOW_MS) };
}

/** A reply carrying whatever the test cares about. */
function reply(fields: Record<string, unknown>): string {
  return JSON.stringify({ kind: DELIVERY_HEALTH_REPLY_KIND, diagnosis: 'A reading.', ...fields });
}

describe('buildDeliveryHealthPrompt', () => {
  it('hands over the constraint, the stages, the holders and the rework', () => {
    const { queue, rework } = buildScans();

    const prompt = buildDeliveryHealthPrompt(queue, rework, '');

    expect(prompt).toContain('THE CONSTRAINT');
    expect(prompt).toContain('Ready for Testing');
    expect(prompt).toContain('WHO IS HOLDING THE WAITING');
    expect(prompt).toContain('Phatate, Smita');
    expect(prompt).toContain('WHAT CAME BACK AFTER REACHING DELIVERY');
  });

  it('keeps the backlog out of the stage list but states it separately', () => {
    // Ranked together, the backlog names itself the bottleneck, which is true and useless.
    const { queue, rework } = buildScans();

    const prompt = buildDeliveryHealthPrompt(queue, rework, '');

    expect(prompt).toContain('NOT STARTED AT ALL');
    expect(prompt).toContain('inventory rather than a bottleneck');
  });

  it('states the team context verbatim when it is given', () => {
    // The numbers alone produce a generic answer: "reduce work in progress" is true of almost every
    // board ever measured and useless to somebody who already knows their tester is the constraint.
    const { queue, rework } = buildScans();

    const prompt = buildDeliveryHealthPrompt(queue, rework, 'Nine developers, one shift-left tester.');

    expect(prompt).toContain('Nine developers, one shift-left tester.');
  });

  it('asks it to say where its reading would change when no context was given', () => {
    const { queue, rework } = buildScans();

    expect(buildDeliveryHealthPrompt(queue, rework, '')).toContain('where your reading would change');
  });

  it('requires every finding to cite the figure it rests on', () => {
    const { queue, rework } = buildScans();

    expect(buildDeliveryHealthPrompt(queue, rework, '')).toContain('must cite the figure it rests on');
  });

  it('requires every action to say who decides', () => {
    const { queue, rework } = buildScans();

    expect(buildDeliveryHealthPrompt(queue, rework, '')).toContain('WHO DECIDES');
  });

  it('tells it to judge the system rather than the people', () => {
    const { queue, rework } = buildScans();

    expect(buildDeliveryHealthPrompt(queue, rework, '')).toContain('Judge the SYSTEM, never the people');
  });

  it('asks for the reply shape it will actually parse', () => {
    const { queue, rework } = buildScans();

    const prompt = buildDeliveryHealthPrompt(queue, rework, '');

    expect(prompt).toContain(`"kind":"${DELIVERY_HEALTH_REPLY_KIND}"`);
    expect(prompt).toContain('questionsToAsk');
  });
});

describe('parseDeliveryHealthReply', () => {
  it('reads the diagnosis, findings, actions and questions', () => {
    const plan = parseDeliveryHealthReply(reply({
      findings: [{ observation: 'Testing is the constraint.', evidence: '557 waiting days', confidence: 'high' }],
      actions: [{ action: 'Split the SL story.', rationale: 'Frees the dev story.', effort: 'small', whoDecides: 'The PO' }],
      questionsToAsk: ['What changed after 26.3.1?'],
    }));

    expect(plan.diagnosis).toBe('A reading.');
    expect(plan.findings[0].evidence).toBe('557 waiting days');
    expect(plan.actions[0].whoDecides).toBe('The PO');
    expect(plan.questionsToAsk).toEqual(['What changed after 26.3.1?']);
  });

  it('does not promote an unstated confidence to high', () => {
    // An unqualified claim should not be made confident by the parser that read it.
    const plan = parseDeliveryHealthReply(reply({ findings: [{ observation: 'Something.' }] }));

    expect(plan.findings[0].confidence).toBe('medium');
  });

  it('refuses a confidence it does not recognise rather than showing it', () => {
    const plan = parseDeliveryHealthReply(reply({
      findings: [{ observation: 'Something.', confidence: 'absolutely certain' }],
    }));

    expect(plan.findings[0].confidence).toBe('medium');
  });

  it('says an unowned action is unowned rather than leaving it blank', () => {
    // An unowned action is the one that quietly does not happen.
    const plan = parseDeliveryHealthReply(reply({ actions: [{ action: 'Do a thing.' }] }));

    expect(plan.actions[0].whoDecides).toBe('Not stated');
  });

  it('drops an empty finding rather than showing a blank bullet', () => {
    const plan = parseDeliveryHealthReply(reply({
      findings: [{ observation: '  ' }, { observation: 'A real one.' }],
    }));

    expect(plan.findings).toHaveLength(1);
  });

  it('imports a reply that carried only a diagnosis', () => {
    const plan = parseDeliveryHealthReply(reply({}));

    expect(plan.findings).toEqual([]);
    expect(plan.actions).toEqual([]);
  });

  it('refuses a reply of the wrong kind', () => {
    // Somebody's previous answer pasted by mistake.
    expect(() => parseDeliveryHealthReply('{"kind":"agingTriage"}')).toThrow(DELIVERY_HEALTH_REPLY_KIND);
  });

  it('refuses a reply that is not JSON at all', () => {
    expect(() => parseDeliveryHealthReply('Here is my plan!')).toThrow();
  });

  it('reads a reply wrapped in chatter and a code fence', () => {
    const wrapped = `Sure!\n\`\`\`json\n${reply({})}\n\`\`\`\nHope that helps.`;

    expect(parseDeliveryHealthReply(wrapped).diagnosis).toBe('A reading.');
  });
});
