// RcpEmailDraft.test.tsx — The approval email asks for every missing answer, and holds a draft with gaps.

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { writeRcpSenderDetails, type RcpApprovalEmailContext } from './rcpApprovalEmail.ts';
import { RcpEmailDraft } from './RcpEmailDraft.tsx';

// Tuesday 13 Oct 2026, 7:30 PM CT — a weekday night, so the template's two weekday questions apply.
const TUESDAY_NIGHT_START_UTC = '2026-10-14T00:30:00Z';

const EMAIL_CONTEXT: RcpApprovalEmailContext = {
  changeNumber: '', shortDescription: 'Recon deploy', environmentLabel: 'PRD', windowText: 'Tue → Wed CT',
  plannedStartUtc: TUESDAY_NIGHT_START_UTC, ciOwnerName: 'Lee, Jordan', configItemName: 'Recon Service',
  directorName: '', riskLabel: 'Moderate', justification: '', backoutPlan: 'Redeploy.',
};

describe('RcpEmailDraft', () => {
  afterEach(() => localStorage.clear());

  it('asks for the change number, the Director and the weekday answers when ServiceNow lacks them', () => {
    render(<RcpEmailDraft emailContext={EMAIL_CONTEXT} />);

    fireEvent.click(screen.getByRole('button', { name: /Draft the Director approval email/ }));

    for (const label of ['Director name', 'Change number', 'Why must this occur Monday - Friday?', 'What is the impact of deploying on a weekend?']) {
      expect(screen.getByLabelText(label)).toHaveValue('');
    }
    expect(screen.getByText(/The CI owner is Lee, Jordan/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue to AI Assist/ })).toBeDisabled();
  });

  it('fills in the sender\'s name and contact from last time, still shown to check', () => {
    writeRcpSenderDetails({ senderName: 'Smith, Mike', senderContact: 'ext 1234' });
    render(<RcpEmailDraft emailContext={EMAIL_CONTEXT} />);

    fireEvent.click(screen.getByRole('button', { name: /Draft the Director approval email/ }));

    expect(screen.getByLabelText('Your name')).toHaveValue('Smith, Mike');
    expect(screen.getByLabelText('Your team and contact details')).toHaveValue('ext 1234');
  });
});
