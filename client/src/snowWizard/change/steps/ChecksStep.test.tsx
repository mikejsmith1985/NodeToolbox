// ChecksStep.test.tsx — Proves a failing check gives one sentence and one fix to the right step, and "could not check" needs acknowledging.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReadinessItem } from '../../../views/SnowHub/guided/changeReadiness.ts';
import { useCrgState } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { createChangeWizardSession, type ChangeWizardSession } from '../changeWizardSession.ts';
import ChecksStep from './ChecksStep.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const BACKOUT_GAP: ReadinessItem = {
  id: 'formulaBackout', label: 'Formula Card 7: Backout', state: 'needsAction', reason: 'Backout Plan is empty.',
  action: { kind: 'openStep', stepId: 'changeText', label: 'Write the Backout Plan', focusField: 'backoutPlan' },
};
const UNCHECKED_PRBS: ReadinessItem = { id: 'prbs', label: 'Problem records', state: 'couldNotCheck', reason: 'Not checked: Could not read.', action: null };
const DONE_OWNER: ReadinessItem = { id: 'owner', label: 'Change owner', state: 'done', reason: 'Owned by Pat.', action: null };

function Harness({ items, session, goToStep, updateSession }: { items: ReadinessItem[] | null; session: ChangeWizardSession; goToStep: () => void; updateSession: () => void }) {
  const crg = useCrgState({ storageKey: 'snowWizard:change:checks-test' });
  return <ChecksStep crg={crg} session={session} updateSession={updateSession} goToStep={goToStep} items={items} />;
}

describe('ChecksStep', () => {
  it('shows a failing check\'s reason and one fix that returns to the planning step', () => {
    const goToStep = vi.fn();
    render(<Harness items={[DONE_OWNER, BACKOUT_GAP]} session={createChangeWizardSession('create')} goToStep={goToStep} updateSession={vi.fn()} />);
    expect(screen.getByText('Backout Plan is empty.')).toBeTruthy();
    expect(screen.getByText('Needs action')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Write the Backout Plan' }));
    expect(goToStep).toHaveBeenCalledWith('planning');
    expect(screen.getByText('Ask AI to fix all the writing at once')).toBeTruthy();
  });

  it('asks for acknowledgement when a check could not be made', () => {
    const updateSession = vi.fn();
    render(<Harness items={[UNCHECKED_PRBS]} session={createChangeWizardSession('create')} goToStep={vi.fn()} updateSession={updateSession} />);
    expect(screen.getByText(/Create stays locked/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(updateSession).toHaveBeenCalledWith({ areChecksAcknowledged: true });
  });

  it('says it is checking while the reads run, and offers nothing to acknowledge when all is done', () => {
    const { rerender } = render(<Harness items={null} session={createChangeWizardSession('create')} goToStep={vi.fn()} updateSession={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('Checking your change…');
    rerender(<Harness items={[DONE_OWNER]} session={createChangeWizardSession('create')} goToStep={vi.fn()} updateSession={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(/should pass review/)).toBeTruthy();
  });
});
