// checkInMessage.test.ts — The thing that actually gets pasted into a chat window.

import { describe, expect, it } from 'vitest';

import { buildCheckInMessage, describeCheckInMessage } from './checkInMessage.ts';
import type { CheckInIssue } from './checkInModel.ts';
import type { CheckInItem, CheckInReply } from './checkInPrompt.ts';

/** An issue on the plate, so the message can name what a key refers to. */
function checkInIssue(issueKey: string, summary: string): CheckInIssue {
  return {
    issueKey,
    issueType: 'Story',
    summary,
    status: 'In Progress',
    daysInStage: 9,
    daysSinceUpdate: 2,
    dueDateIso: null,
    daysPastDue: null,
    priority: null,
    storyPoints: null,
    featureKey: null,
    featureSummary: null,
    description: '',
    comments: [],
  };
}

/** One reply item, carrying only what the test is about. */
function item(issueKey: string, overrides: Partial<CheckInItem> = {}): CheckInItem {
  return {
    issueKey,
    observation: 'Has sat at this stage 9 days.',
    question: 'Still waiting on the Axway change?',
    suggestion: '',
    looksFine: false,
    ...overrides,
  };
}

/** A whole reply. */
function reply(items: CheckInItem[], opening = 'Quick check-in when you get a sec:'): CheckInReply {
  return { opening, items };
}

describe('buildCheckInMessage', () => {
  const issues = [checkInIssue('ENCUC-1', 'Wire up the intake'), checkInIssue('ENCUC-2', 'Billing grid')];

  it('opens with the assistant line, then one block per item to ask about', () => {
    const message = buildCheckInMessage(reply([item('ENCUC-1')]), issues);

    expect(message).toContain('Quick check-in when you get a sec:');
    expect(message).toContain('ENCUC-1 — Wire up the intake');
    expect(message).toContain('Still waiting on the Axway change?');
  });

  it('leads every block with the issue key, which is what the reader searches for', () => {
    const message = buildCheckInMessage(reply([item('ENCUC-2')]), issues);

    expect(message.split('\n\n')[1].startsWith('ENCUC-2')).toBe(true);
  });

  it('collapses everything that looks fine into ONE closing line', () => {
    // A block each would bury the two questions that matter.
    const message = buildCheckInMessage(
      reply([
        item('ENCUC-1'),
        item('ENCUC-2', { looksFine: true, question: '', observation: '' }),
      ]),
      issues,
    );

    expect(message).toContain('Everything else looks on track from here (ENCUC-2)');
    expect(message).not.toContain('ENCUC-2 — Billing grid');
  });

  it('says outright when nothing looks stuck, rather than sending an empty-looking message', () => {
    // A message that lists nothing reads as a mistake, and the reader asks what it was meant to say.
    const message = buildCheckInMessage(reply([item('ENCUC-1', { looksFine: true })]), issues);

    expect(message).toContain('Nothing looks stuck from here');
  });

  it('includes a suggestion only when there is one', () => {
    const withSuggestion = buildCheckInMessage(
      reply([item('ENCUC-1', { suggestion: 'Chase the platform team.' })]),
      issues,
    );
    const withoutSuggestion = buildCheckInMessage(reply([item('ENCUC-1')]), issues);

    expect(withSuggestion).toContain('Might help: Chase the platform team.');
    expect(withoutSuggestion).not.toContain('Might help:');
  });

  it('falls back to a sensible opening when the assistant gave none', () => {
    expect(buildCheckInMessage(reply([item('ENCUC-1')], ''), issues)).toContain('Quick check-in on where these are at');
  });

  it('still names an item whose issue is not on the plate any more', () => {
    const message = buildCheckInMessage(reply([item('ENCUC-9')]), issues);

    expect(message).toContain('ENCUC-9');
  });

  it('uses no Markdown, because it renders as raw asterisks in half of all chat clients', () => {
    const message = buildCheckInMessage(
      reply([item('ENCUC-1', { suggestion: 'Chase them.' })]),
      issues,
    );

    expect(message).not.toContain('**');
    expect(message).not.toContain('# ');
    expect(message).not.toContain('| ');
  });

  it('keeps the order the reply gave, which is the order the plate was sent in', () => {
    // Overdue first, then longest-sitting — the reader meets the most pressing thing first without
    // anyone having to say it is the most pressing thing.
    const message = buildCheckInMessage(reply([item('ENCUC-2'), item('ENCUC-1')]), issues);

    expect(message.indexOf('ENCUC-2')).toBeLessThan(message.indexOf('ENCUC-1'));
  });
});

describe('describeCheckInMessage', () => {
  it('says how many items need asking about before the sender reads it', () => {
    const summary = describeCheckInMessage(reply([
      item('ENCUC-1'),
      item('ENCUC-2', { looksFine: true }),
    ]));

    expect(summary).toBe('1 item to ask about, 1 noted as on track');
  });

  it('does not pluralise a single item', () => {
    expect(describeCheckInMessage(reply([item('ENCUC-1')]))).toBe('1 item to ask about');
  });

  it('pluralises several', () => {
    expect(describeCheckInMessage(reply([item('ENCUC-1'), item('ENCUC-2')]))).toBe('2 items to ask about');
  });

  it('says there is nothing to send before a reply has been pasted', () => {
    expect(describeCheckInMessage(reply([]))).toBe('Nothing to send yet — paste the reply above.');
  });
});
