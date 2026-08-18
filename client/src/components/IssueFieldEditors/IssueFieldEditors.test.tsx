// IssueFieldEditors.test.tsx — Tests for the inline text/select/assignee editors.
//
// Each editor is verified in isolation with a stub writer: the VALUE ITSELF is the control that
// activates the input, the save is delegated to the writer, and a failure shows an inline error
// without committing. An empty field says "Click to edit" so the affordance is never invisible.

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
    fireEvent.click(screen.getByRole('button', { name: 'Edit Summary' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Edit Summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Write rejected'));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('restores the original value on Cancel', () => {
    render(<TextFieldEditor label="Summary" initialValue="Original" onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Summary' }));
    fireEvent.change(screen.getByLabelText('Summary value'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Original')).toBeInTheDocument();
  });

  it('says "Click to edit" when the field is empty, rather than showing a bare dash', () => {
    // An em dash tells somebody the field is empty but not that they can do anything about it. The
    // empty fields are exactly the ones this panel exists for, so they say so in words.
    render(<TextFieldEditor label="Summary" initialValue="" onSave={vi.fn()} />);
    expect(screen.getByText('Click to edit')).toBeInTheDocument();
  });

  it('offers no separate Edit button — the value is the control', () => {
    render(<TextFieldEditor label="Summary" initialValue="Old" onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Edit Priority' }));
    fireEvent.change(screen.getByLabelText('Priority value'), { target: { value: 'Low' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Low'));
  });

  it('opens with the current option already selected, showing its readable label', async () => {
    // The defect this covers: options are keyed by Jira id while the issue carries the name, so the
    // select used to open on the blank row and report a set priority as unset.
    render(
      <SelectFieldEditor
        label="Priority"
        initialValue="3"
        options={[{ label: 'High', value: '3' }, { label: 'Low', value: '5' }]}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Priority' }));
    expect(screen.getByLabelText('Priority value')).toHaveValue('3');
    expect(screen.getByRole('option', { name: 'High' })).toBeInTheDocument();
  });

  it('shows the readable label rather than the stored id when not editing', () => {
    render(
      <SelectFieldEditor
        label="Priority"
        initialValue="3"
        options={[{ label: 'High', value: '3' }]}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Edit Priority' })).toHaveTextContent('High');
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit Assignee' }));
    fireEvent.change(screen.getByLabelText('Assignee search'), { target: { value: 'casey' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getByLabelText('Assignee candidate')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('acc-1'));
  });
});
