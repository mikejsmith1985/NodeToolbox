// TaskCard.test.tsx — Proves one task card edits its words, type and environments, orders itself, and saves as a template.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CtaskTemplate } from '../../../views/SnowHub/hooks/useCrgState.ts';
import TaskCard, { type TaskCardProps } from './TaskCard.tsx';

vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn(async () => ({ result: [] })) }));

const BLANK = { sysId: '', displayName: '' };
const TASK: CtaskTemplate = {
  id: 'card-1', name: '', createdAt: '', shortDescription: 'Smoke test', description: '', assignmentGroup: BLANK, assignedTo: BLANK,
  plannedStartDate: '', plannedEndDate: '', closeNotes: '', changeTaskType: '',
};

function renderCard(overrides: Partial<TaskCardProps> = {}) {
  const props: TaskCardProps = {
    task: TASK, taskIndex: 0, taskCount: 2, typeOptions: [{ value: 'testing', label: 'Testing' }], typeUnavailableText: 'Waiting',
    enabledEnvironments: ['REL', 'PRD'], isEnvironmentChoiceShown: true, isExistingTask: false,
    onChange: vi.fn(), onMove: vi.fn(), onRemove: vi.fn(), onSaveAsTemplate: vi.fn(), ...overrides,
  };
  render(<TaskCard {...props} />);
  return props;
}

describe('TaskCard', () => {
  it('edits the short description and picks the type from ServiceNow’s own list', () => {
    const props = renderCard();
    fireEvent.change(screen.getByLabelText('Short description (needed)'), { target: { value: 'Smoke test v2' } });
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ shortDescription: 'Smoke test v2' }));
    fireEvent.change(screen.getByLabelText('Task type'), { target: { value: 'testing' } });
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ changeTaskType: 'testing' }));
  });

  it('starts on every change in use and lets the user untick one', () => {
    const props = renderCard();
    expect((screen.getByLabelText('Smoke test on REL') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Smoke test on REL'));
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ environmentKeys: ['PRD'] }));
  });

  it('moves, and removes a card the user built — but never removes a task the change already has', () => {
    const props = renderCard();
    expect((screen.getByRole('button', { name: 'Move Smoke test up' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Move Smoke test down' }));
    expect(props.onMove).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Smoke test' }));
    expect(props.onRemove).toHaveBeenCalled();
  });

  it('shows a task the change already has without environment ticks or Remove', () => {
    renderCard({ isExistingTask: true, isEnvironmentChoiceShown: false });
    expect(screen.getByText('Already on this change. Your edits update it.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Smoke test' })).toBeNull();
    expect(screen.queryByLabelText('Smoke test on REL')).toBeNull();
  });

  it('saves the card as a task template under the name given, and says so', () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Save as task template' }));
    expect((screen.getByLabelText('Name this task template') as HTMLInputElement).value).toBe('Smoke test');
    fireEvent.click(screen.getByRole('button', { name: 'Save task template' }));
    expect(props.onSaveAsTemplate).toHaveBeenCalledWith('Smoke test');
    expect(screen.getByRole('status').textContent).toContain('Saved ✓');
  });

  it('never shows an internal field name', () => {
    renderCard();
    expect(document.body.textContent).not.toMatch(/u_[a-z]|cmdb_ci|customfield_|sys_id|change_task_type/);
  });
});
