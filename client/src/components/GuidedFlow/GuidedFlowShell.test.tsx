// GuidedFlowShell.test.tsx — Proves the shared guided-flow frame follows the step rules every wizard relies on.

import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import GuidedFlowShell, { type GuidedFlowStep } from './GuidedFlowShell.tsx';

const THREE_STEPS: GuidedFlowStep[] = [
  { id: 'pick', title: 'Pick the change', state: 'done' },
  { id: 'describe', title: 'Describe the work', state: 'current' },
  { id: 'review', title: 'Review and send', state: 'todo' },
];

function renderShell(overrides: Partial<Parameters<typeof GuidedFlowShell>[0]> = {}) {
  const handlers = { onNext: vi.fn(), onBack: vi.fn(), onSkip: vi.fn() };
  render(
    <GuidedFlowShell
      steps={THREE_STEPS}
      currentStepId="describe"
      canGoNext
      onNext={handlers.onNext}
      onBack={handlers.onBack}
      {...overrides}
    >
      <p>Step body</p>
    </GuidedFlowShell>,
  );
  return handlers;
}

describe('GuidedFlowShell header', () => {
  it('reads "Step N of M — <title>" for the current step', () => {
    renderShell();
    expect(screen.getByRole('heading', { name: 'Step 2 of 3 — Describe the work' })).toBeInTheDocument();
  });

  it('renders the caller-provided step content', () => {
    renderShell();
    expect(screen.getByText('Step body')).toBeInTheDocument();
  });
});

describe('GuidedFlowShell Next button', () => {
  it('shows exactly one primary Next button and calls onNext when enabled', () => {
    const handlers = renderShell();
    const nextButtons = screen.getAllByRole('button', { name: 'Next' });
    expect(nextButtons).toHaveLength(1);
    fireEvent.click(nextButtons[0]);
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
  });

  it('uses the caller label when one is given', () => {
    renderShell({ nextLabel: 'Create the change' });
    expect(screen.getByRole('button', { name: 'Create the change' })).toBeInTheDocument();
  });

  it('is disabled with its reason visible beneath it when the step is not complete', () => {
    const handlers = renderShell({ canGoNext: false, nextBlockedReason: 'Pick a configuration item first.' });
    const nextButton = screen.getByRole('button', { name: 'Next' });
    expect(nextButton).toBeDisabled();
    const reason = screen.getByText('Pick a configuration item first.');
    expect(reason).toBeVisible();
    expect(nextButton).toHaveAttribute('aria-describedby', reason.id);
    fireEvent.click(nextButton);
    expect(handlers.onNext).not.toHaveBeenCalled();
  });

  it('shows no reason line while Next is enabled', () => {
    renderShell({ nextBlockedReason: 'Should not show' });
    expect(screen.queryByText('Should not show')).not.toBeInTheDocument();
  });
});

describe('GuidedFlowShell Back button', () => {
  it('calls onBack when Back is pressed', () => {
    const handlers = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });

  it('has no Back button on the first step', () => {
    renderShell({ currentStepId: 'pick' });
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('keeps entries made on a step after going Back and returning', () => {
    function StatefulFlow() {
      const [stepIndex, setStepIndex] = useState(1);
      const [summaryText, setSummaryText] = useState('');
      const steps = THREE_STEPS.map((step, index) => ({
        ...step,
        state: index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'todo',
      })) as GuidedFlowStep[];
      return (
        <GuidedFlowShell
          steps={steps}
          currentStepId={steps[stepIndex].id}
          canGoNext
          onNext={() => setStepIndex((index) => index + 1)}
          onBack={() => setStepIndex((index) => index - 1)}
        >
          {stepIndex === 1 ? (
            <label>
              Summary
              <input value={summaryText} onChange={(event) => setSummaryText(event.target.value)} />
            </label>
          ) : (
            <p>Other step</p>
          )}
        </GuidedFlowShell>
      );
    }
    render(<StatefulFlow />);
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Patch the server' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Other step')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('Summary')).toHaveValue('Patch the server');
  });
});

describe('GuidedFlowShell skip', () => {
  it('offers "Skip — nothing to change" only when the step is skippable', () => {
    const handlers = renderShell({ isSkippable: true, onSkip: vi.fn() });
    expect(handlers.onSkip).not.toHaveBeenCalled();
    const skipButton = screen.getByRole('button', { name: 'Skip — nothing to change' });
    expect(skipButton).toBeInTheDocument();
  });

  it('calls onSkip when the skip button is pressed', () => {
    const onSkip = vi.fn();
    renderShell({ isSkippable: true, onSkip });
    fireEvent.click(screen.getByRole('button', { name: 'Skip — nothing to change' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('has no skip button when the step is not skippable', () => {
    renderShell();
    expect(screen.queryByRole('button', { name: /Skip/ })).not.toBeInTheDocument();
  });
});

describe('GuidedFlowShell steps strip', () => {
  it('labels each step state with text, not colour alone', () => {
    renderShell();
    const strip = screen.getByRole('list', { name: 'Steps' });
    const items = within(strip).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Pick the change');
    expect(items[0]).toHaveTextContent('Done');
    expect(items[1]).toHaveTextContent('Current');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[2]).toHaveTextContent('To do');
    expect(items[2]).not.toHaveAttribute('aria-current');
  });
});

describe('GuidedFlowShell focus', () => {
  it('moves focus to the step heading when the step changes, not on first render', () => {
    const { rerender } = render(
      <GuidedFlowShell steps={THREE_STEPS} currentStepId="describe" canGoNext onNext={vi.fn()} onBack={vi.fn()}>
        <p>Body</p>
      </GuidedFlowShell>,
    );
    expect(screen.getByRole('heading', { level: 2 })).not.toHaveFocus();
    rerender(
      <GuidedFlowShell steps={THREE_STEPS} currentStepId="review" canGoNext onNext={vi.fn()} onBack={vi.fn()}>
        <p>Body</p>
      </GuidedFlowShell>,
    );
    expect(screen.getByRole('heading', { name: 'Step 3 of 3 — Review and send' })).toHaveFocus();
  });
});

describe('GuidedFlowShell advanced action', () => {
  it('renders the advanced slot when given', () => {
    renderShell({ advancedAction: <button type="button">Advanced</button> });
    expect(screen.getByRole('button', { name: 'Advanced' })).toBeInTheDocument();
  });

  it('renders no advanced control by default', () => {
    renderShell();
    expect(screen.queryByRole('button', { name: 'Advanced' })).not.toBeInTheDocument();
  });

  it('groups the strip into named stages, makes finished steps clickable, and offers "Show me" when blocked', () => {
    const onStepSelect = vi.fn();
    render(
      <GuidedFlowShell
        steps={[{ id: 'pick', title: 'Pick', state: 'done' }, { id: 'write', title: 'Write', state: 'current' }]}
        phases={[{ label: '① Choose', stepIds: ['pick'] }, { label: '② Write', stepIds: ['write'] }]}
        currentStepId="write" canGoNext={false} nextBlockedReason="Still needed: a title." onNext={vi.fn()} onBack={vi.fn()}
        onStepSelect={onStepSelect} shouldOfferShowMe
      >
        <label htmlFor="title-field">Title (needed)</label><input id="title-field" defaultValue="" />
      </GuidedFlowShell>,
    );
    expect(screen.getByRole('list', { name: '① Choose' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Pick/ }));
    expect(onStepSelect).toHaveBeenCalledWith('pick');
    expect(screen.queryByRole('button', { name: /^2Write/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(document.activeElement?.id).toBe('title-field');
  });
});
