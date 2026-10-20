// TasksStep.test.tsx — Proves tasks are picked from ServiceNow's own type list, and ServiceNow's own two are never staged twice.

import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useChangeTaskTypeOptions } from '../../../views/SnowHub/hooks/useChangeTaskTypeOptions.ts';
import { useCrgState } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { createChangeWizardSession, type ChangeWizardSession } from '../changeWizardSession.ts';
import TasksStep from './TasksStep.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../../../views/SnowHub/hooks/useChangeTaskTypeOptions.ts', () => ({ useChangeTaskTypeOptions: vi.fn() }));

/** What the harness last rendered, written after each render (never during it). */
const observed = { latestTaskNames: [] as string[] };

function Harness({ session }: { session: ChangeWizardSession }) {
  const crg = useCrgState({ storageKey: 'snowWizard:change:tasks-test' });
  useEffect(() => { observed.latestTaskNames = crg.state.changeTasks.map((task) => task.shortDescription); });
  return <TasksStep crg={crg} session={session} updateSession={vi.fn()} goToStep={vi.fn()} />;
}

describe('TasksStep', () => {
  it('stages a ticked task, unstages it again, and shows ServiceNow\'s own tasks as always there', () => {
    localStorage.clear();
    vi.mocked(useChangeTaskTypeOptions).mockReturnValue({
      typeOptions: [{ value: 'implementation', label: 'Implementation' }, { value: 'review', label: 'Business Checkout' }],
      isLoading: false, loadErrorMessage: null,
    });
    render(<Harness session={createChangeWizardSession('create')} />);
    const implementationBox = screen.getByLabelText('Implementation') as HTMLInputElement;
    expect(implementationBox.checked && implementationBox.disabled).toBe(true);
    expect(screen.getByText('ServiceNow adds this to every change itself.')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Business Checkout'));
    expect(observed.latestTaskNames).toEqual(['Business Checkout']);
    fireEvent.click(screen.getByLabelText('Business Checkout'));
    expect(observed.latestTaskNames).toEqual([]);
  });

  it('lists the existing tasks of a change being modified', () => {
    vi.mocked(useChangeTaskTypeOptions).mockReturnValue({ typeOptions: [], isLoading: false, loadErrorMessage: 'HTTP 403' });
    const session = { ...createChangeWizardSession('modify'), modify: { changeNumber: 'CHG1', stateLabel: 'New', loadedSnapshot: {}, loadedStepValues: {}, existingTaskNames: ['CTASK1 — Smoke test'] } };
    render(<Harness session={session} />);
    expect(screen.getByText('CTASK1 — Smoke test')).toBeTruthy();
    expect(screen.getByText(/task types could not be read: HTTP 403/)).toBeTruthy();
  });
});
