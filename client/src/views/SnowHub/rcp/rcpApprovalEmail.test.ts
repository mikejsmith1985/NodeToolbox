// rcpApprovalEmail.test.ts — The AI Assist prompt for the Director approval email, and the RCP on/off switch.

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildRcpApprovalEmailPrompt,
  readApprovalEmailReply,
  readRcpRulesEnabled,
  writeRcpRulesEnabled,
} from './rcpApprovalEmail.ts';

const EMAIL_CONTEXT = {
  changeNumber: 'CHG0012345',
  shortDescription: 'Recon | deploy v1.5 | PRD',
  environmentLabel: 'PRD',
  windowText: 'Fri 2026-10-09 7:30 PM → Sat 2026-10-10 3:00 AM CT',
  configItemName: 'Recon Service',
  directorName: 'Lee, Jordan',
  riskLabel: 'Moderate',
  justification: 'Fixes premiums before the Nov 1 regulatory deadline.',
  backoutPlan: 'Redeploy v1.4 within 15 minutes.',
};

describe('buildRcpApprovalEmailPrompt', () => {
  it('asks for a short, punchy approval email built only from the change\'s facts', () => {
    const prompt = buildRcpApprovalEmailPrompt(EMAIL_CONTEXT);

    expect(prompt).toContain('Lee, Jordan');
    expect(prompt).toContain('CHG0012345');
    expect(prompt).toContain('Fri 2026-10-09 7:30 PM → Sat 2026-10-10 3:00 AM CT');
    expect(prompt).toContain('Jan 19, 2027');
    expect(prompt).toMatch(/200 words/);
    expect(prompt).toMatch(/\[CONFIRM:/);
  });
});

describe('readApprovalEmailReply', () => {
  it('takes the email out of a code block and counts its words', () => {
    expect(readApprovalEmailReply('```text\nSubject: Approval needed\n\nJordan, please approve.\n```'))
      .toEqual({ emailText: 'Subject: Approval needed\n\nJordan, please approve.', wordCount: 6 });
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
