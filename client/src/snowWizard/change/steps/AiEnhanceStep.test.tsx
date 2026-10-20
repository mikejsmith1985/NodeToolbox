// AiEnhanceStep.test.tsx — Proves the AI step needs no unlock, records the verdict, and writes only accepted suggestions.

import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { createChangeWizardSession } from '../changeWizardSession.ts';
import AiEnhanceStep from './AiEnhanceStep.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

/** What the harness last rendered, written after each render (never during it). */
const observed = { latestJustification: '' };

function Harness({ updateSession }: { updateSession: (update: object) => void }) {
  const crg = useCrgState({ storageKey: 'snowWizard:change:ai-step-test' });
  useEffect(() => { observed.latestJustification = crg.state.generatedJustification; });
  return <AiEnhanceStep crg={crg} session={createChangeWizardSession('create')} updateSession={updateSession} goToStep={vi.fn()} />;
}

describe('AiEnhanceStep', () => {
  it('offers the prompt to everyone, records the verdict, and writes an accepted suggestion', () => {
    const updateSession = vi.fn();
    render(<Harness updateSession={updateSession} />);
    expect(screen.getByRole('button', { name: 'Copy the review prompt' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Paste the assistant/), {
      target: { value: 'GAP | Justification — vague\nVERDICT: NOT READY\n=== REVISED FIELDS ===\nJUSTIFICATION: A clear reason' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read the reply' }));

    expect(updateSession).toHaveBeenCalledWith({ riskReview: { isReady: false } });
    expect(screen.getByText('The review found things to improve before approval.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(observed.latestJustification).toBe('A clear reason');
  });

  it('applies nothing from a reply that is not a review', () => {
    const updateSession = vi.fn();
    render(<Harness updateSession={updateSession} />);
    fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read the reply' }));
    expect(updateSession).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/does not look like the review/);
  });
});
