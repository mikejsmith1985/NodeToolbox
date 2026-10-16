// rcpApprovalEmail.test.ts — The RCP approval request email (GH #441 template), its AI Assist prompt, and the RCP switch.

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildRcpApprovalEmailPrompt,
  buildRcpApprovalEmailTemplate,
  buildRcpEmailGapPrompt,
  doesRcpWindowMatchChange,
  findRcpDraftGaps,
  findRcpEmailGaps,
  isRcpEmailQuestionReply,
  readRcpSenderDetails,
  readRcpSenderFromEmail,
  writeRcpSenderDetails,
  readApprovalEmailReply,
  readRcpConfirmedWindow,
  readRcpEmailReply,
  readRcpProcessOwnerName,
  readRcpRulesEnabled,
  writeRcpProcessOwnerName,
  writeRcpRulesEnabled,
  type RcpApprovalEmailContext,
} from './rcpApprovalEmail.ts';

// Friday 9 Oct 2026, 7:30 PM CT (daylight time, UTC-5).
const FRIDAY_NIGHT_START_UTC = '2026-10-10T00:30:00Z';
// Tuesday 13 Oct 2026, 7:30 PM CT.
const TUESDAY_NIGHT_START_UTC = '2026-10-14T00:30:00Z';

const EMAIL_CONTEXT: RcpApprovalEmailContext = {
  changeNumber: 'CHG0012345',
  shortDescription: 'Recon | deploy v1.5 | PRD',
  environmentLabel: 'PRD',
  windowText: 'Fri 2026-10-09 7:30 PM → Sat 2026-10-10 3:00 AM CT',
  plannedStartUtc: FRIDAY_NIGHT_START_UTC,
  plannedEndUtc: '2026-10-10T08:00:00Z',
  configItemName: 'Recon Service',
  ciOwnerName: 'Lee, Jordan',
  directorName: 'Lee, Jordan',
  riskLabel: 'Moderate',
  justification: 'Fixes premiums before the Nov 1 regulatory deadline.',
  backoutPlan: 'Redeploy v1.4 within 15 minutes.',
};

describe('buildRcpApprovalEmailTemplate', () => {
  it('signs off with the sender learned from their last email, else asks AI Assist to find out', () => {
    expect(buildRcpApprovalEmailTemplate({ ...EMAIL_CONTEXT, senderName: 'Smith, Mike', senderContact: 'ext 1234' }, ''))
      .toContain('Thank you,\nSmith, Mike\next 1234');
    expect(buildRcpApprovalEmailTemplate(EMAIL_CONTEXT, '')).toContain('Thank you,\n[CONFIRM: your name]');
  });

  it('fills the template\'s change summary from the change\'s own facts', () => {
    const template = buildRcpApprovalEmailTemplate(EMAIL_CONTEXT, '');

    expect(template).toContain('Hello Lee, Jordan,');
    expect(template).toContain('Please review the attached PDF of change CHG0012345 and reply with your approval');
    expect(template).toContain('Change number and title: CHG0012345 — Recon | deploy v1.5 | PRD');
    expect(template).toContain('Affected service and CI(s): Recon Service');
    expect(template).toContain('CI owner: Lee, Jordan');
    expect(template).toContain('Proposed implementation window: Fri 2026-10-09 7:30 PM → Sat 2026-10-10 3:00 AM CT');
    expect(template).toContain('Risk and expected impact: Moderate');
    expect(template).toContain('Why this must occur during RCP');
    expect(template).toContain('Impact of deferring until after RCP');
    expect(template).toContain('“I approve the RCP request for change CHG0012345, as described in the attached PDF, for the proposed window of Fri 2026-10-09 7:30 PM → Sat 2026-10-10 3:00 AM CT.”');
    expect(template).toContain('Attachment: CHG0012345 — Change Record.pdf');
  });

  it('marks every fact it does not have for the sender to confirm, rather than inventing one', () => {
    const template = buildRcpApprovalEmailTemplate({
      ...EMAIL_CONTEXT, ciOwnerName: '', riskLabel: '', windowText: '', plannedStartUtc: null, directorName: '',
    }, '');

    expect(template).toContain('Hello [CONFIRM: Director name],');
    expect(template).toContain('CI owner: [CONFIRM: CI owner]');
    expect(template).toContain('Proposed implementation window: [CONFIRM: date, start time and end time — Central Time]');
    expect(template).toContain('Risk and expected impact: [CONFIRM: risk level]');
  });

  it('asks why the work must run on a weekday only when the window starts Monday to Thursday', () => {
    expect(buildRcpApprovalEmailTemplate(EMAIL_CONTEXT, '')).not.toContain('Why must this occur during Monday - Friday?');

    const weekdayTemplate = buildRcpApprovalEmailTemplate({ ...EMAIL_CONTEXT, plannedStartUtc: TUESDAY_NIGHT_START_UTC }, '');
    expect(weekdayTemplate).toContain('Why must this occur during Monday - Friday?');
    expect(weekdayTemplate).toContain('What is the impact of deploying on a weekend?');
  });

  it('keeps the weekday questions when the window is not known yet, so they are not lost', () => {
    expect(buildRcpApprovalEmailTemplate({ ...EMAIL_CONTEXT, plannedStartUtc: null }, ''))
      .toContain('Why must this occur during Monday - Friday?');
  });
});

describe('buildRcpApprovalEmailPrompt', () => {
  it('hands AI Assist the filled template and the facts, and lets it write only the marked sections', () => {
    const prompt = buildRcpApprovalEmailPrompt(EMAIL_CONTEXT, '');

    expect(prompt).toContain('Change number and title: CHG0012345 — Recon | deploy v1.5 | PRD');
    expect(prompt).toContain('Fixes premiums before the Nov 1 regulatory deadline.');
    expect(prompt).toContain('Redeploy v1.4 within 15 minutes.');
    expect(prompt).toMatch(/\[WRITE:/);
    expect(prompt).toMatch(/word for word/i);
    expect(prompt).toMatch(/\[CONFIRM:/);
    expect(prompt).not.toMatch(/200 words/);
  });

  it('hands AI Assist everything known about the change, and has it work each section out before asking', () => {
    const prompt = buildRcpApprovalEmailPrompt({
      ...EMAIL_CONTEXT,
      requestedByName: 'Park, Alex',
      implementationPlan: 'Deploy v1.5 through the pipeline.',
      riskImpactAnalysis: 'Recon is read-only for 20 minutes.',
      testPlan: 'Regression suite in REL.',
      changeTaskLines: ['CTASK0001 — Implementation — Deploy Recon — Fri 7:30 PM → 8:30 PM CT'],
      senderName: 'Smith, Mike',
      senderContact: 'Recon Devs — ext 1234',
    }, '');

    for (const fact of ['Park, Alex', 'Deploy v1.5 through the pipeline.', 'Recon is read-only for 20 minutes.', 'Regression suite in REL.', 'CTASK0001 — Implementation', 'Smith, Mike — Recon Devs — ext 1234']) {
      expect(prompt).toContain(fact);
    }
    expect(prompt).toMatch(/Work out every marker yourself/);
    expect(prompt).toMatch(/best guess so I can simply reply "yes"/);
    expect(prompt).toMatch(/Ask your questions as normal chat messages/);
    expect(prompt).toMatch(/no \[ \] markers/);
  });
});

describe('readApprovalEmailReply', () => {
  it('takes the email out of a code block and counts its words', () => {
    expect(readApprovalEmailReply('```text\nSubject: Approval needed\n\nJordan, please approve.\n```'))
      .toEqual({ emailText: 'Subject: Approval needed\n\nJordan, please approve.', wordCount: 6 });
  });
});

describe('the Change Process Owner setting', () => {
  afterEach(() => localStorage.clear());

  it('names nobody until set — the template makes the Process Owner optional ("and/or")', () => {
    expect(readRcpProcessOwnerName()).toBe('');
    writeRcpProcessOwnerName('Smith, Pat');
    expect(readRcpProcessOwnerName()).toBe('Smith, Pat');
    writeRcpProcessOwnerName('   ');
    expect(readRcpProcessOwnerName()).toBe('');
  });

  it('adds a named Process Owner to the greeting beside the Director', () => {
    expect(buildRcpApprovalEmailTemplate(EMAIL_CONTEXT, 'Smith, Pat')).toContain('Hello Lee, Jordan and Smith, Pat,');
  });
});

describe('the RCP rules switch', () => {
  afterEach(() => localStorage.clear());

  it('is on until switched off, and remembers the choice', () => {
    expect(readRcpRulesEnabled()).toBe(true);
    writeRcpRulesEnabled(false);
    expect(readRcpRulesEnabled()).toBe(false);
  });
});


describe('isRcpEmailQuestionReply', () => {
  it('tells AI Assist\'s question apart from the finished email', () => {
    expect(isRcpEmailQuestionReply('1. Is Park, Alex the Director? (my guess: yes)')).toBe(true);
    expect(isRcpEmailQuestionReply('```text\nSubject: RCP approval request — CHG1\n\nHello Park, Alex — any questions?\n```')).toBe(false);
  });
});

describe('findRcpEmailGaps', () => {
  it('finds every placeholder left in the email, once each', () => {
    const emailText = 'Hello [CONFIRM: Director name],\nCI owner: (not set)\nWindow: TBD\n[WRITE: impact of a weekend]\nAgain [CONFIRM: Director name].';

    expect(findRcpEmailGaps(emailText)).toEqual([
      { placeholderText: '[CONFIRM: Director name]', questionText: 'Director name' },
      { placeholderText: '[WRITE: impact of a weekend]', questionText: 'impact of a weekend' },
      { placeholderText: '(not set)', questionText: 'A value the email shows as "(not set)"' },
      { placeholderText: 'TBD', questionText: 'A value the email shows as "TBD"' },
    ]);
  });

  it('finds nothing in a finished email', () => {
    expect(findRcpEmailGaps('Hello Lee, Jordan,\nPlease approve CHG0012345.')).toEqual([]);
  });
});

describe('buildRcpEmailGapPrompt', () => {
  it('names each gap and has AI Assist work it out, or ask with a best guess, then resend the whole email', () => {
    const emailText = 'Subject: RCP\n\nHello [CONFIRM: Director name],';
    const windowText = 'Start: 2026-10-09 19:30\nEnd: 2026-10-10 03:00';
    const prompt = buildRcpEmailGapPrompt(emailText, windowText, findRcpDraftGaps(emailText, windowText));

    expect(prompt).toContain('- [CONFIRM: Director name]');
    expect(prompt).toContain(emailText);
    expect(prompt).toContain('=== WINDOW ===');
    expect(prompt).toContain(windowText);
    expect(prompt).toMatch(/best guess/);
    expect(prompt).toMatch(/send it again/);
  });
});

describe('the sender', () => {
  afterEach(() => localStorage.clear());

  it('is read from a finished email\'s sign-off, stopping at the attachment line', () => {
    expect(readRcpSenderFromEmail('Please approve.\n\nThank you,\nSmith, Mike\nRecon Devs — ext 1234\n\nAttachment: CHG1 — Change Record.pdf'))
      .toEqual({ senderName: 'Smith, Mike', senderContact: 'Recon Devs — ext 1234' });
    expect(readRcpSenderFromEmail('Please approve.')).toBeNull();
  });

  it('is blank until remembered, then kept for the next email', () => {
    expect(readRcpSenderDetails()).toEqual({ senderName: '', senderContact: '' });
    writeRcpSenderDetails({ senderName: ' Smith, Mike ', senderContact: 'ext 1234' });
    expect(readRcpSenderDetails()).toEqual({ senderName: 'Smith, Mike', senderContact: 'ext 1234' });
  });
});

describe('the change window, confirmed every time', () => {
  it('has AI Assist ask about the window first, every time, even when nothing else is unclear', () => {
    const prompt = buildRcpApprovalEmailPrompt(EMAIL_CONTEXT, '');

    expect(prompt).toContain('"The window for this change is Fri 2026-10-09 7:30 PM → Sat 2026-10-10 3:00 AM CT. Is this correct? If not, when?"');
    expect(prompt).toMatch(/every time/i);
    expect(prompt).toContain('=== WINDOW ===');
    expect(prompt).toContain('=== EMAIL ===');
  });

  it('asks when the window should be when the change has none yet', () => {
    expect(buildRcpApprovalEmailPrompt({ ...EMAIL_CONTEXT, windowText: '', plannedStartUtc: null }, ''))
      .toContain('"This change has no window yet. When should it be?"');
  });

  it('no longer has AI Assist write the attachment — the PDF is ServiceNow\'s own export of the change', () => {
    const prompt = buildRcpApprovalEmailPrompt(EMAIL_CONTEXT, '');

    expect(prompt).not.toContain('=== ATTACHMENT ===');
    expect(prompt).not.toContain('## Implementation plan');
  });

  it('reads the confirmed window and the email out of the reply', () => {
    const replyText = '```text\n=== WINDOW ===\nStart: 2026-10-09 19:30\nEnd: 2026-10-10 03:00\n=== EMAIL ===\nSubject: RCP\n\nHello.\n```';

    expect(readRcpEmailReply(replyText)).toEqual({ windowText: 'Start: 2026-10-09 19:30\nEnd: 2026-10-10 03:00', emailText: 'Subject: RCP\n\nHello.' });
    expect(readRcpEmailReply('Subject: RCP\n\nHello.')).toEqual({ windowText: '', emailText: 'Subject: RCP\n\nHello.' });
  });

  it('turns the confirmed Central Time window into UTC, in daylight and standard time', () => {
    expect(readRcpConfirmedWindow('Start: 2026-10-09 19:30\nEnd: 2026-10-10 03:00'))
      .toEqual({ plannedStartUtc: '2026-10-10T00:30:00Z', plannedEndUtc: '2026-10-10T08:00:00Z' });
    expect(readRcpConfirmedWindow('Start: 2026-11-13 19:00\nEnd: 2026-11-13 23:15'))
      .toEqual({ plannedStartUtc: '2026-11-14T01:00:00Z', plannedEndUtc: '2026-11-14T05:15:00Z' });
  });

  it('reads no window from text it cannot use, or an end before the start', () => {
    expect(readRcpConfirmedWindow('')).toBeNull();
    expect(readRcpConfirmedWindow('Start: Friday night')).toBeNull();
    expect(readRcpConfirmedWindow('Start: 2026-10-10 03:00\nEnd: 2026-10-09 19:30')).toBeNull();
  });

  it('counts an unconfirmed window as a gap', () => {
    expect(findRcpDraftGaps('Subject: RCP', '')).toEqual([
      { placeholderText: '(window not confirmed)', questionText: 'The change window, confirmed with you' },
    ]);
    expect(findRcpDraftGaps('Subject: RCP', 'Start: 2026-10-09 19:30\nEnd: 2026-10-10 03:00')).toEqual([]);
  });

  it('tells whether the confirmed window is what the change holds, to the minute', () => {
    const confirmedWindow = { plannedStartUtc: '2026-10-10T00:30:00Z', plannedEndUtc: '2026-10-10T08:00:00Z' };

    expect(doesRcpWindowMatchChange(confirmedWindow, '2026-10-10T00:30:00.000Z', '2026-10-10T08:00:00Z')).toBe(true);
    expect(doesRcpWindowMatchChange(confirmedWindow, '2026-10-17T00:00:00Z', '2026-10-17T06:00:00Z')).toBe(false);
    expect(doesRcpWindowMatchChange(confirmedWindow, null, null)).toBe(false);
  });
});
