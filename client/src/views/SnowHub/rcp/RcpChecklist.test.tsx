// RcpChecklist.test.tsx — The RCP checklist panel and its Director approval email draft (GH #415).

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  changeNumber: 'CHG0012345', shortDescription: 'Recon deploy', environmentLabel: 'PRD', windowText: 'Fri → Sat CT', plannedStartUtc: '2026-10-10T00:30:00Z', ciOwnerName: 'Lee, Jordan',
  configItemName: 'Recon Service', directorName: 'Lee, Jordan', riskLabel: 'Moderate', justification: 'Deadline.', backoutPlan: 'Redeploy.',
};

describe('RcpChecklist', () => {
  afterEach(() => {
    useAiAssistStore.setState({ isAiAssistUnlocked: false });
    localStorage.clear();
  });

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

  it('drafts the RCP approval request email through AI Assist from the template in one click', async () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    render(<RcpChecklist emailContext={EMAIL_CONTEXT} results={RESULTS} />);

    fireEvent.click(screen.getByRole('button', { name: /Draft the Director approval email/ }));

    expect(await screen.findByDisplayValue(/Change number and title: CHG0012345/)).toBeInTheDocument();
  });
});

describe('RcpChecklist fix buttons', () => {
  it('offers a rule\'s fix beside it while the rule is not met, and runs it', () => {
    const onFix = vi.fn();
    render(<RcpChecklist
      emailContext={null}
      fixActions={{ approval: { label: 'Do the impossible', onFix }, window: { label: 'Never shown', onFix } }}
      results={RESULTS}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Do the impossible' }));

    expect(onFix).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Never shown' })).not.toBeInTheDocument();
  });
});
