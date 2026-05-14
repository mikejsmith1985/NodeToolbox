// SnowLookupField.test.tsx — Tests for the SNow reference typeahead search component.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import { SnowLookupField } from './SnowLookupField.tsx';

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

function buildEmptyReference() {
  return { sysId: '', displayName: '' };
}

function buildResolvedReference() {
  return { sysId: 'usr-001', displayName: 'Jane Smith' };
}

function makeSuggestionResponse(records: Array<{ sys_id: string; name: string }>) {
  return {
    result: records.map((record) => ({
      sys_id: record.sys_id,
      name:   record.name,
    })),
  };
}

function makeSingleRecordResponse(record: { sys_id: string; name: string }) {
  return {
    result: {
      sys_id: record.sys_id,
      name:   record.name,
    },
  };
}

describe('SnowLookupField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('renders the label and an empty input when no value is provided', () => {
    render(
      <SnowLookupField
        label="Assignment Group"
        tableName="sys_user_group"
        value={buildEmptyReference()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Assignment Group')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search Assignment Group…')).toBeInTheDocument();
  });

  it('shows the display name in the input when a resolved reference is passed', () => {
    render(
      <SnowLookupField
        label="Assigned To"
        tableName="sys_user"
        value={buildResolvedReference()}
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Assigned To') as HTMLInputElement;
    expect(input.value).toBe('Jane Smith');
  });

  it('resolves a cloned sys_id-only reference to a display name', async () => {
    const handleChange = vi.fn();
    vi.mocked(snowFetch).mockResolvedValueOnce(
      makeSingleRecordResponse({ sys_id: 'usr-001', name: 'Jane Smith' }) as never,
    );

    render(
      <SnowLookupField
        label="Change Manager"
        tableName="sys_user"
        value={{ sysId: 'usr-001', displayName: '' }}
        onChange={handleChange}
      />,
    );

    await act(async () => { await Promise.resolve(); });

    expect(screen.getByLabelText('Change Manager')).toHaveValue('Jane Smith');
    expect(handleChange).toHaveBeenCalledWith({ sysId: 'usr-001', displayName: 'Jane Smith' });
  });

  it('shows the checkmark badge when the reference is resolved (sysId is populated)', () => {
    render(
      <SnowLookupField
        label="Assigned To"
        tableName="sys_user"
        value={buildResolvedReference()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('resolved')).toBeInTheDocument();
  });

  it('does not show the checkmark when no sysId is set', () => {
    render(
      <SnowLookupField
        label="Assigned To"
        tableName="sys_user"
        value={buildEmptyReference()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('resolved')).not.toBeInTheDocument();
  });

  it('does not fire the SNow search when fewer than 2 characters are typed', async () => {
    // fireEvent.change is used here (instead of userEvent.type) to avoid internal
    // setTimeout delays in userEvent that conflict with vi.useFakeTimers().
    render(
      <SnowLookupField
        label="Assignment Group"
        tableName="sys_user_group"
        value={buildEmptyReference()}
        onChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Assignment Group'), { target: { value: 'P' } });
    await act(async () => { vi.runAllTimers(); });

    expect(vi.mocked(snowFetch)).not.toHaveBeenCalled();
  });

  it('fires a debounced SNow search after the user types at least 2 characters', async () => {
    vi.mocked(snowFetch).mockResolvedValueOnce(
      makeSuggestionResponse([{ sys_id: 'grp-001', name: 'Platform Team' }]) as never,
    );

    render(
      <SnowLookupField
        label="Assignment Group"
        tableName="sys_user_group"
        value={buildEmptyReference()}
        onChange={vi.fn()}
      />,
    );

    // Typing 'Pl' via fireEvent to avoid userEvent internal timer conflicts.
    fireEvent.change(screen.getByLabelText('Assignment Group'), { target: { value: 'Pl' } });
    // act(async) flushes the debounce timer AND awaits the resulting snowFetch promise.
    await act(async () => { vi.runAllTimers(); });

    expect(vi.mocked(snowFetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/now/table/sys_user_group'),
    );
  });

  it('shows the returned suggestions in a dropdown list', async () => {
    vi.mocked(snowFetch).mockResolvedValueOnce(
      makeSuggestionResponse([
        { sys_id: 'grp-001', name: 'Platform Team' },
        { sys_id: 'grp-002', name: 'Platform Ops' },
      ]) as never,
    );

    render(
      <SnowLookupField
        label="Assignment Group"
        tableName="sys_user_group"
        value={buildEmptyReference()}
        onChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Assignment Group'), { target: { value: 'Pl' } });
    await act(async () => { vi.runAllTimers(); });

    expect(screen.getByText('Platform Team')).toBeInTheDocument();
    expect(screen.getByText('Platform Ops')).toBeInTheDocument();
  });

  it('calls onChange with the selected reference when a suggestion is clicked', async () => {
    const handleChange = vi.fn();
    vi.mocked(snowFetch).mockResolvedValueOnce(
      makeSuggestionResponse([{ sys_id: 'grp-001', name: 'Platform Team' }]) as never,
    );

    render(
      <SnowLookupField
        label="Assignment Group"
        tableName="sys_user_group"
        value={buildEmptyReference()}
        onChange={handleChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Assignment Group'), { target: { value: 'Pl' } });
    await act(async () => { vi.runAllTimers(); });

    expect(screen.getByText('Platform Team')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('Platform Team'));

    expect(handleChange).toHaveBeenCalledWith({ sysId: 'grp-001', displayName: 'Platform Team' });
  });

  it('fills the input with the selected display name after picking a suggestion', async () => {
    vi.mocked(snowFetch).mockResolvedValueOnce(
      makeSuggestionResponse([{ sys_id: 'grp-001', name: 'Platform Team' }]) as never,
    );

    const { rerender } = render(
      <SnowLookupField
        label="Assignment Group"
        tableName="sys_user_group"
        value={buildEmptyReference()}
        onChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Assignment Group'), { target: { value: 'Pl' } });
    await act(async () => { vi.runAllTimers(); });

    expect(screen.getByText('Platform Team')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('Platform Team'));

    // Simulate the parent updating value after onChange fires.
    rerender(
      <SnowLookupField
        label="Assignment Group"
        tableName="sys_user_group"
        value={{ sysId: 'grp-001', displayName: 'Platform Team' }}
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Assignment Group') as HTMLInputElement;
    expect(input.value).toBe('Platform Team');
  });

  it('clears the sysId (calls onChange with empty sysId) when the user edits the resolved input', async () => {
    const handleChange = vi.fn();

    render(
      <SnowLookupField
        label="Assigned To"
        tableName="sys_user"
        value={buildResolvedReference()}
        onChange={handleChange}
      />,
    );

    // Editing the text should immediately call onChange with sysId cleared.
    fireEvent.change(screen.getByLabelText('Assigned To'), { target: { value: 'Jane Smithx' } });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({ sysId: '' }),
    );
  });

  it('does not crash and shows no suggestions when snowFetch rejects', async () => {
    vi.mocked(snowFetch).mockRejectedValueOnce(new Error('Relay not connected') as never);

    render(
      <SnowLookupField
        label="Config Item"
        tableName="cmdb_ci"
        value={buildEmptyReference()}
        onChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Config Item'), { target: { value: 'Se' } });
    await act(async () => { vi.runAllTimers(); });

    // Should not throw — just silently collapse the dropdown.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('disables the input when isDisabled is true', () => {
    render(
      <SnowLookupField
        label="Assignment Group"
        tableName="sys_user_group"
        value={buildEmptyReference()}
        onChange={vi.fn()}
        isDisabled
      />,
    );

    expect(screen.getByLabelText('Assignment Group')).toBeDisabled();
  });
});
