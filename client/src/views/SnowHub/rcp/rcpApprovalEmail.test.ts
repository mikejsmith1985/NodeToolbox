// rcpApprovalEmail.test.ts — The RCP approval request email (GH #441 template), its AI Assist prompt, and the RCP switch.

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildRcpApprovalEmailPrompt,
  buildRcpApprovalEmailTemplate,
  buildRcpAttachmentTitle,
  buildRcpEmailGapPrompt,
  DEFAULT_RCP_PROCESS_OWNER_NAME,
  findRcpDraftGaps,
  findRcpEmailGaps,
  isRcpEmailQuestionReply,
  readRcpSenderDetails,
  readRcpSenderFromEmail,
  writeRcpSenderDetails,
  readApprovalEmailReply,
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
  configItemName: 'Recon Service',
  ciOwnerName: 'Lee, Jordan',
  directorName: 'Lee, Jordan',
  riskLabel: 'Moderate',
  justification: 'Fixes premiums before the Nov 1 regulatory deadline.',
  backoutPlan: 'Redeploy v1.4 within 15 minutes.',
};

describe('buildRcpApprovalEmailTemplate', () => {
  it('signs off with the sender learned from their last email, else asks AI Assist to find out', () => {
    expect(buildRcpApprovalEmailTemplate({ ...EMAIL_CONTEXT, senderName: 'Smith, Mike', senderContact: 'ext 1234' }, 'Ben Labout'))
      .toContain('Thank you,\nSmith, Mike\next 1234');
    expect(buildRcpApprovalEmailTemplate(EMAIL_CONTEXT, 'Ben Labout')).toContain('Thank you,\n[CONFIRM: your name]');
  });

  it('fills the template\'s change summary from the change\'s own facts', () => {
    const template = buildRcpApprovalEmailTemplate(EMAIL_CONTEXT, 'Ben Labout');

    expect(template).toContain('Hello Lee, Jordan and Ben Labout,');
    expect(template).toContain('Please review the attached PDF of change CHG0012345 and reply with your approval');
    expect(template).toContain('Change number and title: CHG0012345 — Recon | deploy v1.5 | PRD');
    expect(template).toContain('Affected service and CI(s): Recon Service');
    expect(template).toContain('CI owner: Lee, Jordan');
    expect(template).toContain('Proposed implementation window: Fri 2026-10-09 7:30 PM → Sat 2026-10-10 3:00 AM CT');
    expect(template).toContain('Risk and expected impact: Moderate');
    expect(template).toContain('Why this must occur during RCP');
    expect(template).toContain('Impact of deferring until after RCP');
    expect(template).toContain('“I approve the RCP request for change CHG0012345, as described in the attached PDF, for the proposed window of Fri 2026-10-09 7:30 PM → Sat 2026-10-10 3:00 AM CT.”');
    expect(template).toContain('Attachment: CHG0012345 change plan.pdf');
  });

  it('marks every fact it does not have for the sender to confirm, rather than inventing one', () => {
    const template = buildRcpApprovalEmailTemplate({
      ...EMAIL_CONTEXT, ciOwnerName: '', riskLabel: '', windowText: '', plannedStartUtc: null, directorName: '',
    }, 'Ben Labout');

    expect(template).toContain('Hello [CONFIRM: Director name] and Ben Labout,');
    expect(template).toContain('CI owner: [CONFIRM: CI owner]');
    expect(template).toContain('Proposed implementation window: [CONFIRM: date, start time and end time — Central Time]');
    expect(template).toContain('Risk and expected impact: [CONFIRM: risk level]');
  });

  it('asks why the work must run on a weekday only when the window starts Monday to Thursday', () => {
    expect(buildRcpApprovalEmailTemplate(EMAIL_CONTEXT, 'Ben Labout')).not.toContain('Why must this occur during Monday - Friday?');

    const weekdayTemplate = buildRcpApprovalEmailTemplate({ ...EMAIL_CONTEXT, plannedStartUtc: TUESDAY_NIGHT_START_UTC }, 'Ben Labout');
    expect(weekdayTemplate).toContain('Why must this occur during Monday - Friday?');
    expect(weekdayTemplate).toContain('What is the impact of deploying on a weekend?');
  });

  it('keeps the weekday questions when the window is not known yet, so they are not lost', () => {
    expect(buildRcpApprovalEmailTemplate({ ...EMAIL_CONTEXT, plannedStartUtc: null }, 'Ben Labout'))
      .toContain('Why must this occur during Monday - Friday?');
  });
});

describe('buildRcpApprovalEmailPrompt', () => {
  it('hands AI Assist the filled template and the facts, and lets it write only the marked sections', () => {
    const prompt = buildRcpApprovalEmailPrompt(EMAIL_CONTEXT, 'Ben Labout');

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
    }, 'Ben Labout');

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

  it('names Ben Labout until changed, and remembers the change', () => {
    expect(readRcpProcessOwnerName()).toBe(DEFAULT_RCP_PROCESS_OWNER_NAME);
    expect(DEFAULT_RCP_PROCESS_OWNER_NAME).toBe('Ben Labout');
    writeRcpProcessOwnerName('Smith, Pat');
    expect(readRcpProcessOwnerName()).toBe('Smith, Pat');
  });

  it('falls back to the default when cleared to blank', () => {
    writeRcpProcessOwnerName('   ');
    expect(readRcpProcessOwnerName()).toBe(DEFAULT_RCP_PROCESS_OWNER_NAME);
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
    const attachmentText = '## Implementation plan\nDeploy v1.5.';
    const prompt = buildRcpEmailGapPrompt(emailText, attachmentText, findRcpDraftGaps(emailText, attachmentText));

    expect(prompt).toContain('- [CONFIRM: Director name]');
    expect(prompt).toContain(emailText);
    expect(prompt).toContain(attachmentText);
    expect(prompt).toContain('=== ATTACHMENT ===');
    expect(prompt).toMatch(/best guess/);
    expect(prompt).toMatch(/send both again/);
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

describe('the attachment AI Assist writes with the email', () => {
  it('is asked for in the prompt: the change plan the email says is attached, from the change\'s own text', () => {
    const prompt = buildRcpApprovalEmailPrompt({ ...EMAIL_CONTEXT, implementationPlan: 'Deploy v1.5 through the pipeline.' }, 'Ben Labout');

    expect(prompt).toContain('=== EMAIL ===');
    expect(prompt).toContain('=== ATTACHMENT ===');
    for (const heading of ['## Change summary', '## Implementation plan', '## Risk and impact analysis', '## Backout plan', '## Pre-production and post-implementation testing', '## Change tasks']) {
      expect(prompt).toContain(heading);
    }
    expect(prompt).toMatch(/word for word from the change/i);
    expect(prompt).toContain('CHG0012345 change plan.pdf');
  });

  it('is read out of the reply apart from the email', () => {
    const replyText = '```text\n=== EMAIL ===\nSubject: RCP\n\nHello.\n=== ATTACHMENT ===\n## Implementation plan\nDeploy v1.5.\n```';

    expect(readRcpEmailReply(replyText)).toEqual({ emailText: 'Subject: RCP\n\nHello.', attachmentText: '## Implementation plan\nDeploy v1.5.' });
  });

  it('is empty when the reply holds only an email, so the gap check can ask for it', () => {
    expect(readRcpEmailReply('Subject: RCP\n\nHello.')).toEqual({ emailText: 'Subject: RCP\n\nHello.', attachmentText: '' });
  });

  it('counts as a gap when missing, and its own placeholders count too', () => {
    expect(findRcpDraftGaps('Subject: RCP', '')).toEqual([
      { placeholderText: '(no attachment)', questionText: 'The change plan attachment the email says is attached' },
    ]);
    expect(findRcpDraftGaps('Subject: RCP', '## Backout plan\n[CONFIRM: backout steps]')).toEqual([
      { placeholderText: '[CONFIRM: backout steps]', questionText: 'backout steps' },
    ]);
  });

  it('is named after the change, the same name the email gives it', () => {
    expect(buildRcpAttachmentTitle('CHG0012345')).toBe('CHG0012345 change plan');
    expect(buildRcpAttachmentTitle('')).toBe('Change plan');
  });
});
