// QuickJobsCard.test.tsx — Proves the short cuts on a loaded change: the evidence one is the sweep card, and the schedule
// one is the tasks step with one save that stays held until every task is timed.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChangeTaskTypeOptions } from '../../../views/SnowHub/hooks/useChangeTaskTypeOptions.ts';
import { useCrgState, type CtaskTemplate } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { createChangeWizardSession, type ChangeWizardSession } from '../changeWizardSession.ts';
import { saveQuickSchedule } from '../quickSchedule.ts';
import { useTemplateLibrary } from '../useTemplateLibrary.ts';
import QuickJobsCard from './QuickJobsCard.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn(async () => ({ result: [] })) }));
vi.mock('../../../views/SnowHub/hooks/useChangeTaskTypeOptions.ts', () => ({ useChangeTaskTypeOptions: vi.fn() }));
vi.mock('../quickSchedule.ts', () => ({ saveQuickSchedule: vi.fn(async () => '1 task updated on CHG1. The implementation plan now states the estimated durations.') }));

const BLANK = { sysId: '', displayName: '' };

function buildTask(durationEstimates?: CtaskTemplate['durationEstimates']): CtaskTemplate {
  return {
    id: '', name: 'CTASK1', createdAt: '', shortDescription: 'Deploy', description: 'Modules: a, b', assignmentGroup: BLANK, assignedTo: BLANK,
    plannedStartDate: '', plannedEndDate: '', closeNotes: '', changeTaskType: 'implementation', durationEstimates,
  };
}

function Harness({ task }: { task: CtaskTemplate }) {
  const crg = useCrgState({ storageKey: 'snowWizard:change:quick-test' });
  const library = useTemplateLibrary();
  const [session, setSession] = useState<ChangeWizardSession>({
    ...createChangeWizardSession('modify'),
    modify: { changeNumber: 'CHG1', stateLabel: 'New', loadedSnapshot: {}, loadedStepValues: {}, existingTaskNames: [], changeSysId: 'chg-sys', existingTasks: [] },
  });
  const { updateEnvironment, addChangeTask } = crg.actions;
  useEffect(() => {
    updateEnvironment('prd', { isEnabled: true, plannedStartDate: '2026-10-24T22:00', plannedEndDate: '2026-10-25T01:00' });
    addChangeTask(task);
  }, [updateEnvironment, addChangeTask, task]);
  return <QuickJobsCard crg={crg} session={session} updateSession={(update) => setSession((previous) => ({ ...previous, ...update }))} goToStep={vi.fn()} library={library} />;
}

describe('QuickJobsCard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(saveQuickSchedule).mockClear();
    vi.mocked(useChangeTaskTypeOptions).mockReturnValue({ typeOptions: [{ value: 'implementation', label: 'Implementation' }], isLoading: false, loadErrorMessage: null });
  });

  it('opens the sweep card for just the test evidence', () => {
    render(<Harness task={buildTask()} />);
    fireEvent.click(screen.getByRole('button', { name: '📎 Just the test evidence' }));
    expect(screen.getByRole('heading', { name: '📎 Test evidence for CHG1' })).toBeTruthy();
  });

  it('holds the schedule save until every task is timed, and says why', () => {
    render(<Harness task={buildTask()} />);
    fireEvent.click(screen.getByRole('button', { name: '⏱️ Just the task schedule' }));
    expect(screen.getByRole('button', { name: 'Save the task schedule to CHG1' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/Before saving: Deploy has no timing yet/)).toBeTruthy();
  });

  it('saves just the schedule once the tasks are timed, and confirms it', async () => {
    render(<Harness task={buildTask({ implementationMinutes: '30', validationMinutes: '15', backoutMinutes: '20' })} />);
    fireEvent.click(screen.getByRole('button', { name: '⏱️ Just the task schedule' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save the task schedule to CHG1' })); });
    expect(saveQuickSchedule).toHaveBeenCalledWith(expect.objectContaining({ changeNumber: 'CHG1', changeSysId: 'chg-sys' }));
    expect(screen.getByText(/✅ 1 task updated on CHG1/)).toBeTruthy();
  });
});
