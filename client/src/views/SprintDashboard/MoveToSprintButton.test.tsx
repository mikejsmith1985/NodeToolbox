// MoveToSprintButton.test.tsx — Unit tests for the MoveToSprintButton component.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraSprint } from '../../types/jira.ts';
import MoveToSprintButton from './MoveToSprintButton.tsx';

function buildMockSprint(sprintId: number, sprintName: string, state: 'active' | 'future' = 'active'): JiraSprint {
  return {
    id: sprintId,
    name: sprintName,
    state,
    startDate: '2025-01-01T00:00:00.000Z',
    endDate: '2025-01-14T00:00:00.000Z',
  };
}

const AVAILABLE_SPRINTS: JiraSprint[] = [
  buildMockSprint(10, 'Sprint 10'),
  buildMockSprint(11, 'Sprint 11', 'future'),
];

describe('MoveToSprintButton', () => {
  const onFetchSprints = vi.fn();
  const onMoveToSprint = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the "Move to Sprint" trigger button', () => {
    render(
      <MoveToSprintButton
        availableSprints={[]}
        currentSprintId={9}
        isLoadingAvailableSprints={false}
        issueKey="TBX-5"
        onFetchSprints={onFetchSprints}
        onMoveToSprint={onMoveToSprint}
      />,
    );

    expect(screen.getByRole('button', { name: /move to sprint/i })).toBeInTheDocument();
  });

  it('calls onFetchSprints when the dropdown is opened for the first time', () => {
    render(
      <MoveToSprintButton
        availableSprints={[]}
        currentSprintId={9}
        isLoadingAvailableSprints={false}
        issueKey="TBX-5"
        onFetchSprints={onFetchSprints}
        onMoveToSprint={onMoveToSprint}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /move to sprint/i }));

    expect(onFetchSprints).toHaveBeenCalledTimes(1);
  });

  it('shows available sprints in the dropdown after opening', () => {
    render(
      <MoveToSprintButton
        availableSprints={AVAILABLE_SPRINTS}
        currentSprintId={9}
        isLoadingAvailableSprints={false}
        issueKey="TBX-5"
        onFetchSprints={onFetchSprints}
        onMoveToSprint={onMoveToSprint}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /move to sprint/i }));

    expect(screen.getByText('Sprint 10')).toBeInTheDocument();
    expect(screen.getByText('Sprint 11')).toBeInTheDocument();
  });

  it('excludes the current sprint from the dropdown', () => {
    const sprintsIncludingCurrent = [
      buildMockSprint(9, 'Current Sprint'),
      ...AVAILABLE_SPRINTS,
    ];

    render(
      <MoveToSprintButton
        availableSprints={sprintsIncludingCurrent}
        currentSprintId={9}
        isLoadingAvailableSprints={false}
        issueKey="TBX-5"
        onFetchSprints={onFetchSprints}
        onMoveToSprint={onMoveToSprint}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /move to sprint/i }));

    expect(screen.queryByText('Current Sprint')).not.toBeInTheDocument();
  });

  it('calls onMoveToSprint with issueKey and sprintId when a sprint is selected', async () => {
    render(
      <MoveToSprintButton
        availableSprints={AVAILABLE_SPRINTS}
        currentSprintId={9}
        isLoadingAvailableSprints={false}
        issueKey="TBX-5"
        onFetchSprints={onFetchSprints}
        onMoveToSprint={onMoveToSprint}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /move to sprint/i }));
    fireEvent.click(screen.getByText('Sprint 10'));

    await waitFor(() => {
      expect(onMoveToSprint).toHaveBeenCalledWith('TBX-5', 10);
    });
  });

  it('shows a loading indicator while sprints are being fetched', () => {
    render(
      <MoveToSprintButton
        availableSprints={[]}
        currentSprintId={9}
        isLoadingAvailableSprints={true}
        issueKey="TBX-5"
        onFetchSprints={onFetchSprints}
        onMoveToSprint={onMoveToSprint}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /move to sprint/i }));

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows an error message when the move fails', async () => {
    const failingMove = vi.fn().mockRejectedValue(new Error('Server error'));

    render(
      <MoveToSprintButton
        availableSprints={AVAILABLE_SPRINTS}
        currentSprintId={9}
        isLoadingAvailableSprints={false}
        issueKey="TBX-5"
        onFetchSprints={onFetchSprints}
        onMoveToSprint={failingMove}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /move to sprint/i }));
    fireEvent.click(screen.getByText('Sprint 10'));

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument();
    });
  });

  it('shows a no-other-sprints message when available list only contains the current sprint', () => {
    render(
      <MoveToSprintButton
        availableSprints={[buildMockSprint(9, 'Current Sprint')]}
        currentSprintId={9}
        isLoadingAvailableSprints={false}
        issueKey="TBX-5"
        onFetchSprints={onFetchSprints}
        onMoveToSprint={onMoveToSprint}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /move to sprint/i }));

    expect(screen.getByText(/no other sprints/i)).toBeInTheDocument();
  });
});
