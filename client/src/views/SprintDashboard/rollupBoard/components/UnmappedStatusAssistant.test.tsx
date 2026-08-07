// UnmappedStatusAssistant.test.tsx — Proves a status that fell into Unmapped can be found and put
// where the team wants it, without hunting through Jira to work out which ones exist.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UnmappedStatusAssistant } from './UnmappedStatusAssistant.tsx';
import type { ObservedBoardState } from '../columnOptionSources.ts';
import type { BoardColumn } from '../rollupBoardTypes.ts';

const UNMAPPED_STATES: ObservedBoardState[] = [
  { jiraStatusName: 'In Progress', subStatusValue: 'Code Review', issueCount: 7, suggestedColumnName: 'In Progress — Code Review' },
  { jiraStatusName: 'Blocked', subStatusValue: null, issueCount: 2, suggestedColumnName: 'Blocked' },
];

const COLUMNS: BoardColumn[] = [
  { id: 'col-dev', name: 'Being coded', order: 0, mappings: [{ jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' }] },
  { id: 'col-sl', name: 'Waiting on SL test', order: 1, mappings: [] },
];

describe('UnmappedStatusAssistant — finding what fell out', () => {
  it('names every status sitting in Unmapped, with how much work is in it', () => {
    render(
      <UnmappedStatusAssistant
        columns={COLUMNS}
        onAssignToColumn={vi.fn()}
        onCreateColumnFor={vi.fn()}
        unmappedStates={UNMAPPED_STATES}
      />,
    );

    expect(screen.getByText('In Progress / Code Review')).toBeTruthy();
    expect(screen.getByText(/7 issues/)).toBeTruthy();
    expect(screen.getByText(/2 issues/)).toBeTruthy();
  });

  it('says so plainly when nothing is unmapped, rather than showing an empty panel', () => {
    render(
      <UnmappedStatusAssistant
        columns={COLUMNS}
        onAssignToColumn={vi.fn()}
        onCreateColumnFor={vi.fn()}
        unmappedStates={[]}
      />,
    );

    expect(screen.getByText(/nothing is sitting in Unmapped/)).toBeTruthy();
  });
});

describe('UnmappedStatusAssistant — putting it somewhere', () => {
  it('offers every existing column as a destination', () => {
    render(
      <UnmappedStatusAssistant
        columns={COLUMNS}
        onAssignToColumn={vi.fn()}
        onCreateColumnFor={vi.fn()}
        unmappedStates={UNMAPPED_STATES}
      />,
    );

    const columnPicker = screen.getByLabelText('Column for In Progress / Code Review');
    expect(columnPicker).toBeTruthy();
    expect(screen.getAllByRole('option', { name: 'Being coded' }).length).toBeGreaterThan(0);
  });

  it('adds the status to the chosen column, so one column can hold several states', () => {
    const onAssignToColumn = vi.fn();
    render(
      <UnmappedStatusAssistant
        columns={COLUMNS}
        onAssignToColumn={onAssignToColumn}
        onCreateColumnFor={vi.fn()}
        unmappedStates={UNMAPPED_STATES}
      />,
    );

    fireEvent.change(screen.getByLabelText('Column for In Progress / Code Review'), { target: { value: 'col-dev' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to column' })[0]);

    expect(onAssignToColumn).toHaveBeenCalledWith('col-dev', UNMAPPED_STATES[0]);
  });

  it('will not add anything until a column has actually been chosen', () => {
    const onAssignToColumn = vi.fn();
    render(
      <UnmappedStatusAssistant
        columns={COLUMNS}
        onAssignToColumn={onAssignToColumn}
        onCreateColumnFor={vi.fn()}
        unmappedStates={UNMAPPED_STATES}
      />,
    );

    const addButton = screen.getAllByRole('button', { name: 'Add to column' })[0] as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);

    fireEvent.click(addButton);
    expect(onAssignToColumn).not.toHaveBeenCalled();
  });

  it('offers a new column for a status that does not belong in an existing one', () => {
    const onCreateColumnFor = vi.fn();
    render(
      <UnmappedStatusAssistant
        columns={COLUMNS}
        onAssignToColumn={vi.fn()}
        onCreateColumnFor={onCreateColumnFor}
        unmappedStates={UNMAPPED_STATES}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'New column for this' })[1]);

    expect(onCreateColumnFor).toHaveBeenCalledWith(UNMAPPED_STATES[1]);
  });

  it('keeps each row\'s chosen column to itself', () => {
    const onAssignToColumn = vi.fn();
    render(
      <UnmappedStatusAssistant
        columns={COLUMNS}
        onAssignToColumn={onAssignToColumn}
        onCreateColumnFor={vi.fn()}
        unmappedStates={UNMAPPED_STATES}
      />,
    );

    fireEvent.change(screen.getByLabelText('Column for In Progress / Code Review'), { target: { value: 'col-dev' } });

    // Choosing for one status must not arm the button for another.
    expect((screen.getAllByRole('button', { name: 'Add to column' })[1] as HTMLButtonElement).disabled).toBe(true);
  });
});
