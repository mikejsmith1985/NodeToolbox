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

  it('asks for every missing answer before the prompt can be copied, then drafts from them', () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    render(<RcpChecklist emailContext={EMAIL_CONTEXT} results={RESULTS} />);

    fireEvent.click(screen.getByRole('button', { name: /Draft the Director approval email/ }));
    const continueButton = screen.getByRole('button', { name: /Continue to AI Assist/ });
    expect(continueButton).toBeDisabled();
    expect(screen.getByText(/4 answers still needed/)).toBeInTheDocument();

    answerAllQuestions();
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    expect(screen.getByDisplayValue(/Change number and title: CHG0012345/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/notes from the sender: "Recon is read-only for 20 minutes/)).toBeInTheDocument();
    expect(localStorage.getItem('tbxRcpSenderName')).toBe('Smith, Mike');
  });

  it('will not copy an email that still has a gap, and asks for each one', () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    render(<RcpChecklist emailContext={EMAIL_CONTEXT} results={RESULTS} />);

    pasteDraftedEmail('Subject: Approval\n\nHello [CONFIRM: Director name],\nPlease approve.');

    expect(screen.getByRole('button', { name: /Copy email/ })).toBeDisabled();
    expect(screen.getByText(/1 gap left/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Director name'), { target: { value: 'Park, Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fill in' }));

    expect(screen.getByLabelText('RCP approval request email')).toHaveValue('Subject: Approval\n\nHello Park, Alex,\nPlease approve.');
    expect(screen.getByRole('button', { name: /Copy email/ })).toBeEnabled();
  });

  it('re-checks for gaps as the email is edited by hand', () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    render(<RcpChecklist emailContext={EMAIL_CONTEXT} results={RESULTS} />);

    pasteDraftedEmail('Subject: Approval\n\nHello Lee, Jordan,\nPlease approve.');
    expect(screen.getByRole('button', { name: /Copy email/ })).toBeEnabled();

    fireEvent.change(screen.getByLabelText('RCP approval request email'), { target: { value: 'Hello TBD' } });
    expect(screen.getByRole('button', { name: /Copy email/ })).toBeDisabled();
  });
});

/** Answers every question the draft asks for this change that is not yet answered. */
function answerAllQuestions() {
  const answers: Record<string, string> = {
    'Affected users or services, and any expected outage or degradation': 'Recon is read-only for 20 minutes; no customer outage.',
    'Impact of deferring until after RCP': 'Premiums stay wrong for 11 weeks.',
    'Your name': 'Smith, Mike',
    'Your team and contact details': 'Recon Devs — ext 1234',
  };
  for (const [label, answer] of Object.entries(answers)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: answer } });
  }
}

/** Answers the questions, opens AI Assist, and pastes this email as its reply. */
function pasteDraftedEmail(emailText: string) {
  fireEvent.click(screen.getByRole('button', { name: /Draft the Director approval email/ }));
  answerAllQuestions();
  fireEvent.click(screen.getByRole('button', { name: /Continue to AI Assist/ }));
  fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: emailText } });
  fireEvent.click(screen.getByRole('button', { name: /Use this email/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
}

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
