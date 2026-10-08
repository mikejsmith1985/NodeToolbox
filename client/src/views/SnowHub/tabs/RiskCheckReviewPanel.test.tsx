// RiskCheckReviewPanel.test.tsx — The pasted risk-check review, shown so a person can actually read it (GH #395).

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

  it('offers the next round of the loop: fix these gaps, then check again', () => {
    const onFixGaps = vi.fn();
    const onCheckAgain = vi.fn();
    render(
      <RiskCheckReviewPanel
        fieldValues={EMPTY_FIELDS}
        onCheckAgain={onCheckAgain}
        onFixGaps={onFixGaps}
        reviewText={SAMPLE_REVIEW}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Fix these gaps with AI Assist/ }));
    fireEvent.click(screen.getByRole('button', { name: /Check again/ }));

    expect(onFixGaps).toHaveBeenCalledTimes(1);
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it('has nothing to fix once the change is ready', () => {
    render(
      <RiskCheckReviewPanel
        fieldValues={EMPTY_FIELDS}
        onCheckAgain={vi.fn()}
        onFixGaps={vi.fn()}
        reviewText={'PASS | Risk — Rated.\nVERDICT: READY FOR APPROVAL'}
      />,
    );

    expect(screen.queryByRole('button', { name: /Fix these gaps/ })).not.toBeInTheDocument();
  });

  it('says the review is out of date once its gaps have been fixed', () => {
    render(
      <RiskCheckReviewPanel
        fieldValues={EMPTY_FIELDS}
        isOutOfDate
        onCheckAgain={vi.fn()}
        onFixGaps={vi.fn()}
        reviewText={SAMPLE_REVIEW}
      />,
    );

    expect(screen.getByText(/out of date/i)).toBeInTheDocument();
  });

  it('falls back to the raw text, wrapped, when the reply is not in the checklist format', () => {
    render(<RiskCheckReviewPanel fieldValues={EMPTY_FIELDS} reviewText={'The change looks mostly fine.'} />);

    expect(screen.getByText('The change looks mostly fine.')).toBeInTheDocument();
  });
});

describe('RiskCheckReviewPanel — questions and record fields', () => {
  const REVIEW_WITH_QUESTIONS = [
    'PASS | Short Description — Clear.',
    'INFO | Support Coverage — Who is on call during the window?',
    'RECORD | Configuration Item — Set the CI to Enrollment Web.',
    'VERDICT: NOT READY — no text gaps; 1 fact needed from you; 1 record field to set.',
  ].join('\n');

  it('lists the facts needed from the owner and the form fields to set, apart from the gaps', () => {
    render(<RiskCheckReviewPanel fieldValues={EMPTY_FIELDS} reviewText={REVIEW_WITH_QUESTIONS} />);

    expect(within(screen.getByRole('list', { name: 'Questions for you' })).getByText('Support Coverage')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Fix in the change form' })).getByText('Configuration Item')).toBeInTheDocument();
  });

  it('offers the AI fix round for questions too — the assistant asks them in its own chat', () => {
    render(<RiskCheckReviewPanel fieldValues={EMPTY_FIELDS} onCheckAgain={vi.fn()} onFixGaps={vi.fn()} reviewText={REVIEW_WITH_QUESTIONS} />);

    expect(screen.getByRole('button', { name: /Fix with AI Assist — it will ask you 1 question/ })).toBeInTheDocument();
    expect(screen.getByText(/AI Assist asks you these in its chat/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check again/ })).toBeInTheDocument();
  });
});

describe('RiskCheckReviewPanel — questions go to the assistant\'s chat', () => {
  it('has no answer boxes; the fix round is opened for the questions', () => {
    const onFixGaps = vi.fn();
    const reviewText = 'INFO | Support Coverage — Who is on call?\nVERDICT: NOT READY — no text gaps; 1 fact needed from you.';
    render(<RiskCheckReviewPanel fieldValues={EMPTY_FIELDS} onFixGaps={onFixGaps} reviewText={reviewText} />);

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Fix with AI Assist — it will ask you 1 question/ }));

    expect(onFixGaps).toHaveBeenCalledTimes(1);
  });
});
