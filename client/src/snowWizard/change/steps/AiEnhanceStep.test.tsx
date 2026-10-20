// AiEnhanceStep.test.tsx — Proves the AI step's review loop: review, fix, go fix elsewhere, review again, until ready.

import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { createChangeWizardSession, type ChangeWizardSession } from '../changeWizardSession.ts';
import type { ChangeWizardStepId } from '../changeWizardSteps.ts';
import AiEnhanceStep from './AiEnhanceStep.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

/** What the harness last rendered, written after each render (never during it). */
const observed: { latestJustification: string; latestSession: ChangeWizardSession | null } = { latestJustification: '', latestSession: null };

const NOT_READY_REVIEW = [
  'GAP | Justification — too vague — Fix: name the driver',
  'RECORD | Configuration Item — not set',
  'VERDICT: NOT READY — 1 gap(s)',
  '=== REVISED FIELDS ===',
  'JUSTIFICATION: A clear reason',
].join('\n');
const READY_REVIEW = 'PASS | Justification — clear\nVERDICT: READY FOR APPROVAL';

interface HarnessProps {
  initialSession: ChangeWizardSession;
  goToStep?: (stepId: ChangeWizardStepId) => void;
  updateSpy?: (update: Partial<ChangeWizardSession>) => void;
}

/** The step over a live draft and a live session, as the wizard runs it. */
function Harness({ initialSession, goToStep = vi.fn(), updateSpy = vi.fn() }: HarnessProps) {
  const crg = useCrgState({ storageKey: 'snowWizard:change:ai-step-test' });
  const [session, setSession] = useState(initialSession);
  useEffect(() => { observed.latestJustification = crg.state.generatedJustification; observed.latestSession = session; });
  const updateSession = (update: Partial<ChangeWizardSession>) => { updateSpy(update); setSession((previous) => ({ ...previous, ...update })); };
  return <AiEnhanceStep crg={crg} session={session} updateSession={updateSession} goToStep={goToStep} />;
}

/** Pastes a reply into the open round and reads it. */
function pasteReply(replyText: string, readButtonName: string) {
  fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: replyText } });
  fireEvent.click(screen.getByRole('button', { name: readButtonName }));
}

describe('AiEnhanceStep', () => {
  it('offers the prompt to everyone, records the verdict, and writes an accepted suggestion', () => {
    const updateSpy = vi.fn();
    render(<Harness initialSession={createChangeWizardSession('create')} updateSpy={updateSpy} />);
    expect(screen.getByRole('button', { name: 'Copy the review prompt' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Round 1' })).toBeTruthy();

    pasteReply(NOT_READY_REVIEW, 'Read the reply');

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ riskReview: { isReady: false } }));
    expect(screen.getByText(/The review found 2 things to fix/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(observed.latestJustification).toBe('A clear reason');
  });

  it('applies nothing from a reply that is not a review', () => {
    const updateSpy = vi.fn();
    render(<Harness initialSession={createChangeWizardSession('create')} updateSpy={updateSpy} />);
    pasteReply('Hello there', 'Read the reply');
    expect(updateSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/does not look like the review/);
  });

  it('sends a gap no rewrite can close to the step that fixes it', () => {
    const goToStep = vi.fn();
    render(<Harness initialSession={createChangeWizardSession('create')} goToStep={goToStep} />);
    pasteReply(NOT_READY_REVIEW, 'Read the reply');
    fireEvent.click(screen.getByRole('button', { name: 'Go to “Tell us about the change”' }));
    expect(goToStep).toHaveBeenCalledWith('details');
  });

  it('loops: fix the gaps, review again, and stops with a clear success when ready', () => {
    render(<Harness initialSession={createChangeWizardSession('create')} />);
    pasteReply(NOT_READY_REVIEW, 'Read the reply');

    fireEvent.click(screen.getByRole('button', { name: 'Write fixes for these gaps' }));
    expect((screen.getByLabelText(/Copy this and paste it/) as HTMLTextAreaElement).value).toContain('Gaps to close');
    pasteReply('JUSTIFICATION: The fixed reason', 'Read the fixes');
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(observed.latestJustification).toBe('The fixed reason');

    fireEvent.click(screen.getByRole('button', { name: 'Review again' }));
    expect(screen.getByRole('heading', { name: 'Round 2' })).toBeTruthy();
    expect((screen.getByLabelText(/Copy this and paste it/) as HTMLTextAreaElement).value).toContain('The fixed reason');
    pasteReply(READY_REVIEW, 'Read the reply');

    expect(screen.getByText(/ready for approval/i, { selector: 'p' })).toBeTruthy();
    expect(observed.latestSession?.riskReview).toEqual({ isReady: true });
    const roundsSoFar = screen.getByRole('list', { name: 'Rounds so far' }).textContent ?? '';
    expect(roundsSoFar).toContain('Round 1: needs work — 2 things to fix');
    expect(roundsSoFar).toContain('Round 2: ready for approval');
  });

  it('comes back to the same round after leaving the step', () => {
    const { unmount } = render(<Harness initialSession={createChangeWizardSession('create')} />);
    pasteReply(NOT_READY_REVIEW, 'Read the reply');
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    const leftSession = observed.latestSession as ChangeWizardSession;
    unmount();

    render(<Harness initialSession={leftSession} />);
    expect(screen.getByText(/The review found 2 things to fix/)).toBeTruthy();
    expect(screen.getByText('✓ Accepted')).toBeTruthy();
  });

  it('shows no internal field names', () => {
    render(<Harness initialSession={createChangeWizardSession('create')} />);
    pasteReply(NOT_READY_REVIEW, 'Read the reply');
    const visibleText = Array.from(document.body.querySelectorAll('p, li, h3, h4, button')).map((element) => element.textContent).join(' ');
    expect(visibleText).not.toMatch(/u_|cmdb_ci|customfield_|sys_id/);
  });
});
