// rcpApprovalEmail.test.ts — The RCP approval request email (GH #441 template), its AI Assist prompt, and the RCP switch.

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildRcpApprovalEmailPrompt,
  buildRcpApprovalEmailTemplate,
  DEFAULT_RCP_PROCESS_OWNER_NAME,
  readApprovalEmailReply,
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
    expect(template).toContain('Attachment: CHG0012345 — Change Record.pdf');
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
