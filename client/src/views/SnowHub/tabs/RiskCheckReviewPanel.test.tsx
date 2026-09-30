// RiskCheckReviewPanel.test.tsx — The pasted risk-check review, shown so a person can actually read it (GH #395).

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RiskCheckReviewPanel } from './RiskCheckReviewPanel.tsx';

const EMPTY_FIELDS = {
  shortDescription: '',
  description: '',
  justification: '',
  riskImpact: '',
  implementationPlan: '',
  testPlan: '',
  backoutPlan: '',
};

const SAMPLE_REVIEW = [
  'PASS | Short Description — Clear.',
  'PASS | Category — Software.',
  'GAP | Configuration Item — CI not named. — Fix: Add the CI to DESCRIPTION.',
  'N/A | Irreversibility Point — Nothing is deleted.',
  'NO | Can the team detect failure quickly? — No thresholds.',
  'VERDICT: NOT READY — 1 gap(s).',
].join('\n');

describe('RiskCheckReviewPanel', () => {
  it('leads with the verdict and a count of gaps, passes and not-applicable items', () => {
    render(<RiskCheckReviewPanel fieldValues={EMPTY_FIELDS} reviewText={SAMPLE_REVIEW} />);

    expect(screen.getByText('NOT READY — 1 gap(s).')).toBeInTheDocument();
    expect(screen.getByText('1 gap · 2 passed · 1 not applicable')).toBeInTheDocument();
  });

  it('lists each gap with its field, the problem and the fix', () => {
    render(<RiskCheckReviewPanel fieldValues={EMPTY_FIELDS} reviewText={SAMPLE_REVIEW} />);

    const gapList = screen.getByRole('list', { name: 'Gaps to fix' });
    expect(within(gapList).getByText('Configuration Item')).toBeInTheDocument();
    expect(within(gapList).getByText('CI not named.')).toBeInTheDocument();
    expect(within(gapList).getByText('Add the CI to DESCRIPTION.')).toBeInTheDocument();
  });

  it('shows failed quality-gate questions beside the gaps', () => {
    render(<RiskCheckReviewPanel fieldValues={EMPTY_FIELDS} reviewText={SAMPLE_REVIEW} />);

    expect(screen.getByText('Can the team detect failure quickly?')).toBeInTheDocument();
  });

  it('tucks passed items away until asked for', () => {
    render(<RiskCheckReviewPanel fieldValues={EMPTY_FIELDS} reviewText={SAMPLE_REVIEW} />);

    expect(screen.getByText('Passed (2)').closest('details')).not.toHaveAttribute('open');
  });

  it('says which fields still hold [CONFIRM: …] placeholders', () => {
    render(
      <RiskCheckReviewPanel
        fieldValues={{ ...EMPTY_FIELDS, testPlan: '[CONFIRM: duration] and [CONFIRM: owner]' }}
        reviewText={SAMPLE_REVIEW}
      />,
    );

    expect(screen.getByText(/Still to confirm/)).toHaveTextContent('Test Plan (2)');
  });

  it('falls back to the raw text, wrapped, when the reply is not in the checklist format', () => {
    render(<RiskCheckReviewPanel fieldValues={EMPTY_FIELDS} reviewText={'The change looks mostly fine.'} />);

    expect(screen.getByText('The change looks mostly fine.')).toBeInTheDocument();
  });
});
