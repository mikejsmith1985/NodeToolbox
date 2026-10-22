// TasksStep.test.tsx — Proves the tasks step is a blank canvas: the user adds, fills, orders and removes every task; saved tasks pre-fill a card.

import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChangeTaskTypeOptions } from '../../../views/SnowHub/hooks/useChangeTaskTypeOptions.ts';
import { useCrgState, type CtaskTemplate } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { createChangeWizardSession, type ChangeWizardSession } from '../changeWizardSession.ts';
import { useTemplateLibrary } from '../useTemplateLibrary.ts';
import TasksStep from './TasksStep.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn(async () => ({ result: [] })) }));
vi.mock('../../../views/SnowHub/hooks/useChangeTaskTypeOptions.ts', () => ({ useChangeTaskTypeOptions: vi.fn() }));

const BLANK = { sysId: '', displayName: '' };
const SAVED_TASK: CtaskTemplate = {
  id: 'saved-1', name: 'Business Checkout', createdAt: '', shortDescription: 'Business Checkout', description: 'Check it', assignmentGroup: BLANK,
  assignedTo: { sysId: 'usr-1', displayName: 'Pat' }, plannedStartDate: '', plannedEndDate: '', closeNotes: '', changeTaskType: 'review', environmentKeys: ['PRD'],
};

/** What the harness last rendered, written after each render (never during it). */
const observed = { tasks: [] as CtaskTemplate[] };

function Harness({ session }: { session: ChangeWizardSession }) {
  const crg = useCrgState({ storageKey: 'snowWizard:change:tasks-test' });
  const library = useTemplateLibrary();
  const { updateEnvironment } = crg.actions;
  useEffect(() => { updateEnvironment('rel', { isEnabled: true }); updateEnvironment('prd', { isEnabled: true }); }, [updateEnvironment]);
  useEffect(() => { observed.tasks = crg.state.changeTasks; });
  return <TasksStep crg={crg} session={session} updateSession={vi.fn()} goToStep={vi.fn()} library={library} />;
}

describe('TasksStep', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ntbx-ctask-templates', JSON.stringify([SAVED_TASK]));
    vi.mocked(useChangeTaskTypeOptions).mockReturnValue({
      typeOptions: [{ value: 'implementation', label: 'Implementation' }, { value: 'review', label: 'Business Checkout' }], isLoading: false, loadErrorMessage: null,
    });
  });

  it('starts empty, with no task-type tick boxes and nothing added behind the user’s back', () => {
    render(<Harness session={createChangeWizardSession('create')} />);
    expect(screen.getByText(/No tasks yet/)).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/ServiceNow adds|added by ServiceNow|always there/i);
  });

  it('adds a blank card the user fills in, ticking which changes get it', () => {
    render(<Harness session={createChangeWizardSession('create')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    fireEvent.change(screen.getByLabelText('Short description (needed)'), { target: { value: 'Deploy' } });
    fireEvent.change(screen.getByLabelText('Task type'), { target: { value: 'implementation' } });
    fireEvent.click(screen.getByLabelText('Deploy on REL'));
    expect(observed.tasks).toHaveLength(1);
    expect(observed.tasks[0]).toMatchObject({ shortDescription: 'Deploy', changeTaskType: 'implementation', environmentKeys: ['PRD'] });
  });

  it('says what a card still needs', () => {
    render(<Harness session={createChangeWizardSession('create')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    expect(screen.getByText('Task 1 needs a short description.')).toBeTruthy();
  });

  it('adds a card from a saved task, keeping its type, assignee and environments', () => {
    render(<Harness session={createChangeWizardSession('create')} />);
    fireEvent.change(screen.getByLabelText('Add from a saved task'), { target: { value: 'saved-1' } });
    expect(observed.tasks[0]).toMatchObject({ shortDescription: 'Business Checkout', changeTaskType: 'review', assignedTo: { sysId: 'usr-1', displayName: 'Pat' } });
    expect((screen.getByLabelText('Business Checkout on PRD') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Business Checkout on REL') as HTMLInputElement).checked).toBe(false);
  });

  it('reorders and removes cards, and saves a card as a task template', () => {
    render(<Harness session={createChangeWizardSession('create')} />);
    fireEvent.change(screen.getByLabelText('Add from a saved task'), { target: { value: 'saved-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Task 2 up' }));
    expect(observed.tasks.map((task) => task.shortDescription)).toEqual(['', 'Business Checkout']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Task 1' }));
    expect(observed.tasks.map((task) => task.shortDescription)).toEqual(['Business Checkout']);
    fireEvent.click(screen.getByRole('button', { name: 'Save as task template' }));
    fireEvent.change(screen.getByLabelText('Name this task template'), { target: { value: 'Checkout again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task template' }));
    expect(JSON.parse(localStorage.getItem('ntbx-ctask-templates') ?? '[]').map((task: CtaskTemplate) => task.name)).toContain('Checkout again');
  });

  it('on a modify, shows the change’s own tasks as cards to edit, with no environment ticks', () => {
    localStorage.setItem('snowWizard:change:tasks-test', JSON.stringify({ changeTasks: [{ ...SAVED_TASK, id: 'card-1', name: 'CTASK1' }] }));
    const session = {
      ...createChangeWizardSession('modify'),
      modify: { changeNumber: 'CHG1', stateLabel: 'New', loadedSnapshot: {}, loadedStepValues: {}, existingTaskNames: [], existingTasks: [{ taskId: 'card-1', sysId: 's1', number: 'CTASK1', loadedFingerprint: '' }] },
    };
    render(<Harness session={session} />);
    expect(screen.getByText('Already on this change. Your edits update it.')).toBeTruthy();
    expect(screen.queryByLabelText('Business Checkout on PRD')).toBeNull();
  });

  it('explains when ServiceNow’s task types cannot be read', () => {
    vi.mocked(useChangeTaskTypeOptions).mockReturnValue({ typeOptions: [], isLoading: false, loadErrorMessage: 'HTTP 403' });
    render(<Harness session={createChangeWizardSession('create')} />);
    expect(screen.getByText(/task types could not be read: HTTP 403/)).toBeTruthy();
  });

  it('offers to save the picks as a template on a new change, before anything is created', () => {
    render(<Harness session={createChangeWizardSession('create')} />);
    expect(screen.getByRole('heading', { name: 'Save the picks as a template (optional)' })).toBeTruthy();
  });

  it('does not offer it while modifying a change', () => {
    render(<Harness session={createChangeWizardSession('modify')} />);
    expect(screen.queryByRole('heading', { name: 'Save the picks as a template (optional)' })).toBeNull();
  });
});
