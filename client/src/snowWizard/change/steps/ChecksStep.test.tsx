// ChecksStep.test.tsx — Proves the Risk Check leads the step and owns the writing gaps, a value gap gets one fix button that
// comes back here, and "could not check" needs acknowledging.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReadinessItem } from '../../../views/SnowHub/guided/changeReadiness.ts';
import { useCrgState } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { createChangeWizardSession, type ChangeWizardSession } from '../changeWizardSession.ts';
import { runReadinessFix } from '../readinessFixes.ts';
import ChecksStep from './ChecksStep.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../readinessFixes.ts', () => ({ runReadinessFix: vi.fn(async () => 'CHG9: set the configuration item on CTASK7.') }));

const BACKOUT_GAP: ReadinessItem = {
  id: 'formulaBackout', label: 'Formula Card 7: Backout', state: 'needsAction', reason: 'Backout Plan is empty.',
  action: { kind: 'openStep', stepId: 'changeText', label: 'Write the Backout Plan', focusField: 'backoutPlan' },
};
const DATES_GAP: ReadinessItem = {
  id: 'ctaskDates', label: 'Task dates', state: 'needsAction', reason: 'Deploy has no dates.',
  action: { kind: 'openStep', stepId: 'ctaskTimeline', label: 'Set the task dates' },
};
const UNCHECKED_PRBS: ReadinessItem = { id: 'prbs', label: 'Problem records', state: 'couldNotCheck', reason: 'Not checked: Could not read.', action: null };
const DONE_OWNER: ReadinessItem = { id: 'owner', label: 'Change owner', state: 'done', reason: 'Owned by Pat.', action: null };

function Harness({ items, session, goToStep, updateSession }: { items: ReadinessItem[] | null; session: ChangeWizardSession; goToStep: () => void; updateSession: () => void }) {
  const crg = useCrgState({ storageKey: 'snowWizard:change:checks-test' });
  return <ChecksStep crg={crg} session={session} updateSession={updateSession} goToStep={goToStep} items={items} />;
}

describe('ChecksStep', () => {
  it('puts Toolbox\'s Risk Check first, and hands writing gaps to it instead of a second AI round', () => {
    const goToStep = vi.fn();
    render(<Harness items={[DONE_OWNER, BACKOUT_GAP]} session={createChangeWizardSession('create')} goToStep={goToStep} updateSession={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '🛡️ AI Risk Check — on the real ticket' })).toBeTruthy();
    expect(screen.getByText('Backout Plan is empty.')).toBeTruthy();
    expect(screen.getByText('The Risk Check above rewrites this.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Write the Backout Plan' })).toBeNull();
    expect(screen.queryByText(/Fix all with AI/)).toBeNull();
    expect(goToStep).not.toHaveBeenCalled();
  });

  it('gives a check that needs a value one button, which comes back here afterwards', () => {
    const goToStep = vi.fn();
    render(<Harness items={[DATES_GAP]} session={createChangeWizardSession('create')} goToStep={goToStep} updateSession={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: '✨ Fix all with AI' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set the task dates' }));
    expect(goToStep).toHaveBeenCalledWith('tasks', { shouldReturnHere: true });
  });

  it('asks for acknowledgement when a check could not be made', () => {
    const updateSession = vi.fn();
    render(<Harness items={[UNCHECKED_PRBS]} session={createChangeWizardSession('create')} goToStep={vi.fn()} updateSession={updateSession} />);
    expect(screen.getByText(/The last step stays locked/)).toBeTruthy();
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

  it('runs a one-click fix right here on the change, says what it did, and has the checks read the change again (GH #475)', async () => {
    const goToStep = vi.fn();
    const updateSession = vi.fn();
    const ciGap: ReadinessItem = {
      id: 'ctaskCi', label: 'Task configuration items', state: 'needsAction', reason: 'CTASK7 does not match.',
      action: { kind: 'fixNow', fixId: 'setCtaskConfigItems', label: 'Set it on 1 task', targetCount: 1 },
    };
    const session = { ...createChangeWizardSession('modify'), modify: { changeNumber: 'CHG9', stateLabel: 'New', loadedSnapshot: {}, loadedStepValues: {}, existingTaskNames: [], changeSysId: 'sys-9' } };
    render(<Harness items={[ciGap]} session={session} goToStep={goToStep} updateSession={updateSession} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set it on 1 task' }));
    expect(await screen.findByText('✓ CHG9: set the configuration item on CTASK7.')).toBeTruthy();
    expect(runReadinessFix).toHaveBeenCalledWith('setCtaskConfigItems', [{ changeNumber: 'CHG9', changeSysId: 'sys-9' }]);
    expect(updateSession).toHaveBeenCalledWith({ readinessRefreshCount: 1 });
    expect(goToStep).not.toHaveBeenCalled();
  });
});
