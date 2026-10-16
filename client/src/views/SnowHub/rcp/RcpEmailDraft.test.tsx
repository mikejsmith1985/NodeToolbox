// RcpEmailDraft.test.tsx — AI Assist works the approval email out, asks only in its chat, and gaps block copying.

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeRcpSenderDetails, type RcpApprovalEmailContext } from './rcpApprovalEmail.ts';
import { RcpEmailDraft } from './RcpEmailDraft.tsx';

const EMAIL_CONTEXT: RcpApprovalEmailContext = {
  changeNumber: 'CHG0012345', shortDescription: 'Recon deploy', environmentLabel: 'PRD', windowText: 'Fri → Sat CT',
  plannedStartUtc: '2026-10-10T00:30:00Z', ciOwnerName: 'Lee, Jordan', configItemName: 'Recon Service',
  directorName: 'Lee, Jordan', riskLabel: 'Moderate', justification: 'Deadline.', backoutPlan: 'Redeploy.',
};
const FINISHED_EMAIL = 'Subject: RCP approval request — CHG0012345\n\nHello Lee, Jordan,\nPlease approve.\n\nThank you,\nSmith, Mike\next 1234';

/** Opens the draft and waits for the prompt. */
async function openDraft() {
  fireEvent.click(screen.getByRole('button', { name: /Draft the Director approval email/ }));
  return screen.findByText(/asks you in its chat only what it cannot/);
}

/** Pastes a reply into the open prompt, uses it, and closes the prompt. */
function pasteReply(replyText: string, shouldClose = true) {
  fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: replyText } });
  fireEvent.click(screen.getByRole('button', { name: /Use this email/ }));
  if (shouldClose) fireEvent.click(screen.getByRole('button', { name: 'Close' }));
}

describe('RcpEmailDraft', () => {
  afterEach(() => localStorage.clear());

  it('opens the prompt straight away — no form — with the rest of the change read in for AI Assist', async () => {
    const loadFullEmailContext = vi.fn().mockResolvedValue({ ...EMAIL_CONTEXT, implementationPlan: 'Deploy v1.5 through the pipeline.' });
    render(<RcpEmailDraft emailContext={EMAIL_CONTEXT} loadFullEmailContext={loadFullEmailContext} />);

    await openDraft();

    expect(screen.getByDisplayValue(/Implementation plan: Deploy v1\.5 through the pipeline\./)).toBeInTheDocument();
  });

  it('still drafts from what it has when the rest of the change cannot be read', async () => {
    render(<RcpEmailDraft emailContext={EMAIL_CONTEXT} loadFullEmailContext={vi.fn().mockRejectedValue(new Error('403'))} />);

    await openDraft();

    expect(screen.getByDisplayValue(/Change number and title: CHG0012345/)).toBeInTheDocument();
  });

  it('includes the sender remembered from the last email, so AI Assist need not ask', async () => {
    writeRcpSenderDetails({ senderName: 'Smith, Mike', senderContact: 'ext 1234' });
    render(<RcpEmailDraft emailContext={EMAIL_CONTEXT} />);

    await openDraft();

    // Display values are matched with their line breaks collapsed to spaces.
    expect(screen.getByDisplayValue(/Thank you, Smith, Mike ext 1234/)).toBeInTheDocument();
  });

  it('sends AI Assist\'s question back to its chat rather than taking it as the email', async () => {
    render(<RcpEmailDraft emailContext={EMAIL_CONTEXT} />);
    await openDraft();

    pasteReply('1. Is Park, Alex the Director? (my guess: yes)', false);

    expect(screen.getByText(/answer it in the AI chat/)).toBeInTheDocument();
  });

  it('holds an email with a gap and builds the follow-up that has AI Assist finish it', async () => {
    render(<RcpEmailDraft emailContext={EMAIL_CONTEXT} />);
    await openDraft();
    pasteReply('Subject: RCP\n\nHello [CONFIRM: Director name],\nPlease approve.');

    expect(screen.getByRole('button', { name: /Copy email/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Ask AI Assist to finish it/ }));

    expect(screen.getByDisplayValue(/still has gaps the Director must not see: - \[CONFIRM: Director name\]/)).toBeInTheDocument();
  });

  it('lets a finished email be copied, re-checks hand edits, and learns the sender\'s sign-off', async () => {
    render(<RcpEmailDraft emailContext={EMAIL_CONTEXT} />);
    await openDraft();
    pasteReply(FINISHED_EMAIL);

    expect(screen.getByRole('button', { name: /Copy email/ })).toBeEnabled();
    expect(localStorage.getItem('tbxRcpSenderName')).toBe('Smith, Mike');

    fireEvent.change(screen.getByLabelText('RCP approval request email'), { target: { value: 'Hello TBD' } });
    expect(screen.getByRole('button', { name: /Copy email/ })).toBeDisabled();
  });
});
