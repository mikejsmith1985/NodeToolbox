// RcpChecklist.test.tsx — The RCP checklist panel and its Director approval email draft (GH #415).

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useAiAssistStore } from '../../../store/aiAssistStore.ts';
import type { RcpApprovalEmailContext } from './rcpApprovalEmail.ts';
import { RcpChecklist } from './RcpChecklist.tsx';
import type { RcpCheckResult } from './rcpRules.ts';

const RESULTS: RcpCheckResult[] = [
  { ruleId: 'window', title: 'Approved implementation window', status: 'pass', detail: 'Fri 7:30 PM → Sat 3:00 AM CT.' },
  { ruleId: 'director', title: 'Director listed as Requested By', status: 'check', detail: 'Confirm Lee, Jordan.' },
  { ruleId: 'approval', title: 'Director approval attached', status: 'fail', detail: 'No email is attached.' },
  { ruleId: 'justification', title: 'Justification for changing during RCP', status: 'pass', detail: 'Covers it.' },
  { ruleId: 'leadTime', title: 'Submitted early enough', status: 'pass', detail: 'Moderate risk, 3 business days.' },
];
const EMAIL_CONTEXT: RcpApprovalEmailContext = {
  changeNumber: 'CHG0012345', shortDescription: 'Recon deploy', environmentLabel: 'PRD', windowText: 'Fri → Sat CT',
  configItemName: 'Recon Service', directorName: 'Lee, Jordan', riskLabel: 'Moderate', justification: 'Deadline.', backoutPlan: 'Redeploy.',
};

describe('RcpChecklist', () => {
  afterEach(() => useAiAssistStore.setState({ isAiAssistUnlocked: false }));

  it('leads with how many rules are met, then each rule with its verdict and reason', () => {
    render(<RcpChecklist emailContext={EMAIL_CONTEXT} results={RESULTS} />);

    expect(screen.getByText(/3 of 5 RCP rules met/)).toBeInTheDocument();
    expect(screen.getByText('No email is attached.')).toBeInTheDocument();
    expect(screen.getByText(/❌ Director approval attached/)).toBeInTheDocument();
    expect(screen.getByText(/⚠️ Director listed as Requested By/)).toBeInTheDocument();
  });

  it('offers no email draft while AI Assist is locked', () => {
    render(<RcpChecklist emailContext={EMAIL_CONTEXT} results={RESULTS} />);

    expect(screen.queryByRole('button', { name: /Director approval email/ })).not.toBeInTheDocument();
  });

  it('drafts the Director approval email through AI Assist and flags a draft over 200 words', () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    render(<RcpChecklist emailContext={EMAIL_CONTEXT} results={RESULTS} />);

    fireEvent.click(screen.getByRole('button', { name: /Draft the Director approval email/ }));
    expect(screen.getByDisplayValue(/CHG0012345/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: `Subject: Approval\n\n${'word '.repeat(210)}` } });
    fireEvent.click(screen.getByRole('button', { name: /Use this email/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.getByRole('button', { name: /Copy email/ })).toBeInTheDocument();
    expect(screen.getByText(/212 words — trim it to 200/)).toBeInTheDocument();
  });
});
