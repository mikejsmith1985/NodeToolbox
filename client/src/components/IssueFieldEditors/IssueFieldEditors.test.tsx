// IssueFieldEditors.test.tsx — Tests for the inline text/select/assignee editors.
//
// Each editor is verified in isolation with a stub writer: it shows the current value, activates an
// input, delegates the save to the writer, and on failure shows an inline error without committing.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssigneeFieldEditor, SelectFieldEditor, TextFieldEditor } from './IssueFieldEditors.tsx';

describe('TextFieldEditor', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows the current value and edits it through the writer', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onSaved = vi.fn();
    render(<TextFieldEditor label="Summary" initialValue="Old summary" onSave={onSave} onSaved={onSaved} />);

    expect(screen.getByText('Old summary')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Summary value'), { target: { value: 'New summary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('New summary'));
    expect(onSaved).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
  });

  it('shows an inline error and does not signal saved on failure', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Write rejected'));
    const onSaved = vi.fn();
    render(<TextFieldEditor label="Summary" initialValue="Old" onSave={onSave} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Write rejected'));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('restores the original value on Cancel', () => {
    render(<TextFieldEditor label="Summary" initialValue="Original" onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Summary value'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Original')).toBeInTheDocument();
  });
});

describe('SelectFieldEditor', () => {
  afterEach(() => vi.clearAllMocks());

  it('saves the chosen option through the writer', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SelectFieldEditor
        label="Priority"
        initialValue="High"
        options={[{ label: 'High', value: 'High' }, { label: 'Low', value: 'Low' }]}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Priority value'), { target: { value: 'Low' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Low'));
  });
});

describe('AssigneeFieldEditor', () => {
  afterEach(() => vi.clearAllMocks());

  it('searches users, picks one, and saves the account id', async () => {
    const onSearchUsers = vi.fn().mockResolvedValue([
      { userIdentifier: 'acc-1', displayName: 'Casey Owner' },
    ]);
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AssigneeFieldEditor initialDisplayName="Taylor Dev" onSearchUsers={onSearchUsers} onSave={onSave} />);

    expect(screen.getByText('Taylor Dev')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Assignee search'), { target: { value: 'casey' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByLabelText('Assignee candidate')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('acc-1'));
  });
});
