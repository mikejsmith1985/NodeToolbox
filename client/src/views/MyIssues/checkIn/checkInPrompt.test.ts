// checkInPrompt.test.ts — The round trip behind a status message somebody is about to send.

import { describe, expect, it } from 'vitest';

import { buildCheckInFollowUpPrompt, buildCheckInPrompt, parseCheckInReply, CHECK_IN_REPLY_KIND } from './checkInPrompt.ts';
import type { CheckInIssue } from './checkInModel.ts';

/** One issue on a plate, carrying only what the test is about. */
function checkInIssue(overrides: Partial<CheckInIssue> = {}): CheckInIssue {
  return {
    issueKey: 'ENCUC-1',
    issueType: 'Story',
    summary: 'Wire up the intake',
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
    ...overrides,
  };
}

/** A reply carrying whatever the test cares about. */
function reply(fields: Record<string, unknown>): string {
  return JSON.stringify({ kind: CHECK_IN_REPLY_KIND, opening: 'Quick one:', items: [], ...fields });
}

describe('buildCheckInPrompt', () => {
  it('names the person, because the message is written TO them', () => {
    const prompt = buildCheckInPrompt('Kevin', [checkInIssue()]);

    expect(prompt).toContain('Kevin');
    expect(prompt).toContain('instant-message');
  });

  it('forbids stating a status as fact — only the developer knows it', () => {
    // The entire reason for sending the message is that the ticket does not know the answer.
    const prompt = buildCheckInPrompt('Kevin', [checkInIssue()]);

    expect(prompt).toContain('NEVER state what the status of an item IS');
    expect(prompt).toContain('phrased as something to confirm');
  });

  it('asks for one specific question per item rather than a blanket request', () => {
    const prompt = buildCheckInPrompt('Kevin', [checkInIssue()]);

    expect(prompt).toContain('ONE specific question');
    expect(prompt).toContain('please provide a status update');
  });

  it('tells it to say when an item looks fine, so the reader does not learn to skim', () => {
    const prompt = buildCheckInPrompt('Kevin', [checkInIssue()]);

    expect(prompt).toContain('looksFine');
    expect(prompt).toContain('teaches the reader to skim it');
  });

  it('forbids judging the person rather than the work', () => {
    const prompt = buildCheckInPrompt('Kevin', [checkInIssue()]);

    expect(prompt).toContain('Judge the WORK, never the person');
  });

  it('states how long each item has sat and when it was last touched', () => {
    const prompt = buildCheckInPrompt('Kevin', [checkInIssue({ daysInStage: 12, daysSinceUpdate: 5 })]);

    expect(prompt).toContain('12d at this stage');
    expect(prompt).toContain('last touched 5d ago');
  });

  it('calls an overdue item overdue rather than printing a signed number', () => {
    const prompt = buildCheckInPrompt('Kevin', [checkInIssue({ dueDateIso: '2026-08-20', daysPastDue: 7 })]);

    expect(prompt).toContain('OVERDUE by 7d (due 2026-08-20)');
  });

  it('states remaining time as time remaining, which is a different conversation', () => {
    const prompt = buildCheckInPrompt('Kevin', [checkInIssue({ dueDateIso: '2026-08-30', daysPastDue: -3 })]);

    expect(prompt).toContain('due 2026-08-30 (3d away)');
    expect(prompt).not.toContain('OVERDUE');
  });

  it('names the Feature so the conversation is about an outcome, not a ticket number', () => {
    const prompt = buildCheckInPrompt('Kevin', [
      checkInIssue({ featureKey: 'FEAT-10', featureSummary: 'Online enrollment intake' }),
    ]);

    expect(prompt).toContain('delivers: FEAT-10 — Online enrollment intake');
  });

  it('carries the latest comments, newest first', () => {
    const prompt = buildCheckInPrompt('Kevin', [checkInIssue({
      comments: [
        { authorName: 'Ann', createdIso: '2026-08-26T00:00:00Z', text: 'Waiting on the Axway change.' },
        { authorName: 'Bob', createdIso: '2026-08-01T00:00:00Z', text: 'Started this.' },
      ],
    })]);

    expect(prompt).toContain('Ann: Waiting on the Axway change.');
    expect(prompt.indexOf('Ann:')).toBeLessThan(prompt.indexOf('Bob:'));
  });

  it('says outright when an item has no comments', () => {
    // An item nobody has said anything about is itself the signal.
    expect(buildCheckInPrompt('Kevin', [checkInIssue()])).toContain('no comments');
  });

  it('says nothing at all when the person has nothing assigned', () => {
    // A prompt listing no work still costs attention and gets a confidently useless answer.
    expect(buildCheckInPrompt('Kevin', [])).toBe('');
  });

  it('asks for the reply shape it will actually parse', () => {
    const prompt = buildCheckInPrompt('Kevin', [checkInIssue()]);

    // A fill-in table with every issue pre-listed — Google AI Mode completes a table, not a JSON shape (GH #499).
    expect(prompt).toContain('OPENING:');
    expect(prompt).toContain('Issue key | Summary | Observation | Question | Suggestion | Looks fine');
    expect(prompt).toContain('ENCUC-1 | Wire up the intake | ___ | ___ | ___ | ___');
    expect(prompt).not.toContain(`"kind":"${CHECK_IN_REPLY_KIND}"`);
  });

  it('keeps a summary holding a "|" from splitting its row', () => {
    const prompt = buildCheckInPrompt('Kevin', [checkInIssue({ summary: 'Intake | retry' })]);

    expect(prompt).toContain('ENCUC-1 | Intake / retry | ___');
  });
});

describe('parseCheckInReply', () => {
  it('reads the opening and one item per issue', () => {
    const parsed = parseCheckInReply(
      reply({
        opening: 'Quick check-in when you get a sec:',
        items: [{
          issueKey: 'ENCUC-1',
          observation: 'Has sat at this stage 9 days.',
          question: 'Still waiting on the Axway change?',
          suggestion: 'Chase the platform team.',
          looksFine: false,
        }],
      }),
      ['ENCUC-1'],
    );

    expect(parsed.opening).toBe('Quick check-in when you get a sec:');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].question).toBe('Still waiting on the Axway change?');
  });

  it('DROPS a question about a ticket this person does not hold', () => {
    // There is no recovering from that once it is in a chat window.
    const parsed = parseCheckInReply(
      reply({ items: [{ issueKey: 'OTHER-9', observation: 'x', question: 'y', looksFine: false }] }),
      ['ENCUC-1'],
    );

    expect(parsed.items).toEqual([]);
  });

  it('keeps the first entry when an issue was written up twice', () => {
    const parsed = parseCheckInReply(
      reply({
        items: [
          { issueKey: 'ENCUC-1', question: 'First', looksFine: false },
          { issueKey: 'ENCUC-1', question: 'Second', looksFine: false },
        ],
      }),
      ['ENCUC-1'],
    );

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].question).toBe('First');
  });

  it('treats a missing field as an emptier line rather than a failure', () => {
    const parsed = parseCheckInReply(reply({ items: [{ issueKey: 'ENCUC-1' }] }), ['ENCUC-1']);

    expect(parsed.items[0]).toEqual({
      issueKey: 'ENCUC-1',
      observation: '',
      question: '',
      suggestion: '',
      looksFine: false,
    });
  });

  it('only treats looksFine as true when it really is true', () => {
    const parsed = parseCheckInReply(
      reply({ items: [{ issueKey: 'ENCUC-1', looksFine: 'yes' }] }),
      ['ENCUC-1'],
    );

    expect(parsed.items[0].looksFine).toBe(false);
  });

  it('refuses a reply of the wrong kind', () => {
    expect(() => parseCheckInReply('{"kind":"agingTriage"}', ['ENCUC-1'])).toThrow(CHECK_IN_REPLY_KIND);
  });

  it('refuses a reply that is not JSON at all', () => {
    expect(() => parseCheckInReply('Here is your message!', ['ENCUC-1'])).toThrow();
  });

  it('reads a reply wrapped in chatter and a code fence', () => {
    const wrapped = `Sure! Here you go:\n\`\`\`json\n${reply({ items: [] })}\n\`\`\`\nLet me know.`;

    expect(parseCheckInReply(wrapped, ['ENCUC-1']).opening).toBe('Quick one:');
  });
});

describe('parseCheckInReply — Google AI Mode replies (GH #499)', () => {
  const ISSUES = [checkInIssue(), checkInIssue({ issueKey: 'ENCUC-2', summary: 'Retry the export' })];
  const KEYS = ISSUES.map((issue) => issue.issueKey);

  it('reads a markdown table under an OPENING line, ignoring the intro and the closing offer', () => {
    const replyText = [
      'Here is a check-in message you can send.',
      '',
      'OPENING: Hi Kevin, quick check on two items.',
      '',
      '| Issue key | Summary | Observation | Question | Suggestion | Looks fine |',
      '|---|---|---|---|---|---|',
      '| ENCUC-1 | Wire up the intake | Nine days in progress | Still waiting on Axway? | Pair with Sam | No |',
      '| ENCUC-2 | Retry the export | Moving steadily | ___ | ___ | Yes |',
      '',
      'If you would like, I can also make the tone more formal.',
    ].join('\n');

    const parsed = parseCheckInReply(replyText, KEYS);

    expect(parsed.opening).toBe('Hi Kevin, quick check on two items.');
    expect(parsed.items).toEqual([
      { issueKey: 'ENCUC-1', observation: 'Nine days in progress', question: 'Still waiting on Axway?', suggestion: 'Pair with Sam', looksFine: false },
      { issueKey: 'ENCUC-2', observation: 'Moving steadily', question: '', suggestion: '', looksFine: true },
    ]);
    expect(parsed.missingIssueKeys).toEqual([]);
  });

  it('reads a tab-separated table copied from the AI Mode page', () => {
    const replyText = [
      'Issue key\tSummary\tObservation\tQuestion\tSuggestion\tLooks fine',
      'ENCUC-1\tWire up the intake\tNine days in progress\tStill waiting on Axway?\t\tNo',
      'ENCUC-2\tRetry the export\tMoving steadily\t\t\tYes',
    ].join('\n');

    const parsed = parseCheckInReply(replyText, KEYS);

    expect(parsed.items.map((item) => [item.issueKey, item.question, item.looksFine])).toEqual([
      ['ENCUC-1', 'Still waiting on Axway?', false],
      ['ENCUC-2', '', true],
    ]);
    expect(parsed.opening).toBe('');
  });

  it('names the issues a reply left out, and the follow-up asks only for those — nothing is guessed', () => {
    const replyText = ['Issue key | Summary | Observation | Question | Suggestion | Looks fine', 'ENCUC-1 | x | Slow | Blocked? | ___ | No'].join('\n');

    const parsed = parseCheckInReply(replyText, KEYS);
    const followUpPrompt = buildCheckInFollowUpPrompt(ISSUES, parsed.missingIssueKeys, false);

    expect(parsed.missingIssueKeys).toEqual(['ENCUC-2']);
    expect(parsed.items).toHaveLength(1);
    expect(followUpPrompt).toContain('ENCUC-2 | Retry the export | ___');
    expect(followUpPrompt).not.toContain('ENCUC-1 |');
  });

  it('offers no follow-up when every issue was answered', () => {
    expect(buildCheckInFollowUpPrompt(ISSUES, [], false)).toBe('');
  });

  it('throws on prose with no table, and the format fix re-asks the whole form', () => {
    expect(() => parseCheckInReply('Kevin seems busy; ask him about the intake.', KEYS)).toThrow(/No JSON object found/);

    const followUpPrompt = buildCheckInFollowUpPrompt(ISSUES, [], true);
    expect(followUpPrompt).toContain('could not be read');
    expect(followUpPrompt).toContain('OPENING:');
    expect(followUpPrompt).toContain('ENCUC-1 | Wire up the intake | ___');
    expect(followUpPrompt).toContain('ENCUC-2 | Retry the export | ___');
  });

  it('still drops a table row for an issue that was never asked about', () => {
    const replyText = ['Issue key | Summary | Observation | Question | Suggestion | Looks fine', 'ENCUC-99 | x | Made up | ? | ___ | No'].join('\n');

    expect(parseCheckInReply(replyText, KEYS).items).toEqual([]);
  });
});
