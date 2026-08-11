// AddWorkDialog.test.tsx — Proves the create form cannot produce an issue that vanishes.
//
// The dialog's whole reason to exist is that the new issue lands in the lane it was created from, so
// what matters here is that it states the fields responsible for that and refuses an incomplete create.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AddWorkDialog } from './AddWorkDialog.tsx';
import type { CreateMetaIssueType } from '../../../../types/jira.ts';

const ISSUE_TYPES: CreateMetaIssueType[] = [
  { id: '10001', name: 'Story', subtask: false },
  { id: '10004', name: 'Defect', subtask: false },
];

/** Renders the dialog with sensible defaults, overridable per test. */
function renderDialog(overrides: Partial<React.ComponentProps<typeof AddWorkDialog>> = {}) {
  const onCreate = vi.fn();
  const onCancel = vi.fn();
  render(
    <AddWorkDialog
      errorMessage={null}
      featureKey="DENP-1387"
      featureSummary="Enhance IPM Duplicate Matching"
      isSaving={false}
      issueTypes={ISSUE_TYPES}
      onCancel={onCancel}
      onCreate={onCreate}
      piValue="PI 26.4"
      {...overrides}
    />,
  );
  return { onCreate, onCancel };
}

describe('AddWorkDialog — what it promises', () => {
  it('names the Feature the work will roll up to', () => {
    renderDialog();
    expect(screen.getByText('Add work to DENP-1387')).toBeInTheDocument();
    expect(screen.getByText('Enhance IPM Duplicate Matching')).toBeInTheDocument();
  });

  it('states the two fields that make the issue visible here, so neither is a surprise', () => {
    renderDialog();
    expect(screen.getByText(/Feature Link DENP-1387/)).toBeInTheDocument();
    expect(screen.getByText(/PI 26.4/)).toBeInTheDocument();
  });

  it('promises only the Feature Link when the board is not scoped by a PI', () => {
    renderDialog({ piValue: '' });
    expect(screen.getByText(/Feature Link DENP-1387/)).toBeInTheDocument();
    expect(screen.queryByText(/and PI/)).not.toBeInTheDocument();
  });

  it('offers every issue type the caller allowed', () => {
    renderDialog();
    expect(screen.getByRole('option', { name: 'Story' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Defect' })).toBeInTheDocument();
  });
});

describe('AddWorkDialog — refusing an incomplete create', () => {
  it('will not create without a summary', () => {
    const { onCreate } = renderDialog();
    const createButton = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;

    expect(createButton.disabled).toBe(true);
    fireEvent.click(createButton);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('will not create from a summary that is only whitespace', () => {
    const { onCreate } = renderDialog();
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: '    ' } });

    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('passes the chosen type and summary once both are present', () => {
    const { onCreate } = renderDialog();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: '10004' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Fix the retry handler' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(onCreate).toHaveBeenCalledWith('10004', 'Fix the retry handler');
  });
});

describe('AddWorkDialog — while and after saving', () => {
  it('locks the form and says what it is doing during a create', () => {
    renderDialog({ isSaving: true });

    expect(screen.getByRole('button', { name: 'Creating…' })).toBeInTheDocument();
    expect((screen.getByLabelText('Summary') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows a failure beside the button that caused it', () => {
    renderDialog({ errorMessage: 'Field "Feature Link" is not on the create screen' });
    expect(screen.getByText(/not on the create screen/)).toBeInTheDocument();
  });

  it('can be cancelled without creating anything', () => {
    const { onCancel, onCreate } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });
});
