// UserAssignmentGroupsTab.test.tsx — Unit tests for user-to-assignment-group reverse lookup UI in SNow Hub.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLookupAssignmentGroupsForUser = vi.fn();
const mockClearAssignmentGroupResults = vi.fn();

const mockLookupState = {
  assignmentGroupMemberships: [] as Array<{
    membershipSysId: string;
    groupSysId: string;
    groupDisplayName: string;
  }>,
  isLoadingAssignmentGroups: false,
  lookupErrorMessage: null as string | null,
};

vi.mock('../hooks/useUserAssignmentGroups.ts', () => ({
  useUserAssignmentGroups: () => ({
    ...mockLookupState,
    lookupAssignmentGroupsForUser: mockLookupAssignmentGroupsForUser,
    clearAssignmentGroupResults: mockClearAssignmentGroupResults,
  }),
}));

vi.mock('../components/SnowLookupField.tsx', () => ({
  SnowLookupField: ({ label, onChange }: { label: string; onChange: (reference: { sysId: string; displayName: string }) => void }) => (
    <button type="button" onClick={() => onChange({ sysId: 'user-001', displayName: 'Jordan User' })}>
      Select {label}
    </button>
  ),
}));

import UserAssignmentGroupsTab from './UserAssignmentGroupsTab.tsx';

function resetMockLookupState(): void {
  mockLookupState.assignmentGroupMemberships = [];
  mockLookupState.isLoadingAssignmentGroups = false;
  mockLookupState.lookupErrorMessage = null;
}

describe('UserAssignmentGroupsTab', () => {
  beforeEach(() => {
    resetMockLookupState();
    mockLookupAssignmentGroupsForUser.mockReset();
    mockLookupAssignmentGroupsForUser.mockResolvedValue(undefined);
    mockClearAssignmentGroupResults.mockReset();
  });

  it('renders heading content and keeps lookup disabled until a user is selected', async () => {
    const user = userEvent.setup();
    render(<UserAssignmentGroupsTab />);

    const lookupButton = screen.getByRole('button', { name: 'Find Assignment Groups' });
    expect(screen.getByRole('heading', { name: 'User Assignment Groups' })).toBeInTheDocument();
    expect(lookupButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Select User' }));
    expect(lookupButton).toBeEnabled();
  });

  it('runs reverse lookup with the selected user', async () => {
    const user = userEvent.setup();
    render(<UserAssignmentGroupsTab />);

    await user.click(screen.getByRole('button', { name: 'Select User' }));
    await user.click(screen.getByRole('button', { name: 'Find Assignment Groups' }));

    expect(mockLookupAssignmentGroupsForUser).toHaveBeenCalledWith({
      sysId: 'user-001',
      displayName: 'Jordan User',
    });
  });

  it('shows a table when memberships are returned', () => {
    mockLookupState.assignmentGroupMemberships = [
      { membershipSysId: 'membership-1', groupSysId: 'group-1', groupDisplayName: 'Platform Team' },
    ];

    render(<UserAssignmentGroupsTab />);

    expect(screen.getByRole('columnheader', { name: 'Assignment Group' })).toBeInTheDocument();
    expect(screen.getByText('Platform Team')).toBeInTheDocument();
    expect(screen.getByText('membership-1')).toBeInTheDocument();
  });

  it('shows empty-state messaging after a lookup attempt returns no memberships', async () => {
    const user = userEvent.setup();
    render(<UserAssignmentGroupsTab />);

    await user.click(screen.getByRole('button', { name: 'Select User' }));
    await user.click(screen.getByRole('button', { name: 'Find Assignment Groups' }));

    expect(screen.getByText('No assignment groups were found for this user.')).toBeInTheDocument();
  });
});

