// MentionPicker.test.tsx — Unit tests for the @-mention type-ahead popover.
//
// The assertion that matters most here is that a person the app cannot build a real mention for is
// never offered: inserting their plain name would post a comment that notifies nobody, which is the
// exact silent failure this feature exists to remove.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeatureReviewUserCandidate } from '../../views/SprintDashboard/featureReviewFixes.ts';
import MentionPicker from './MentionPicker.tsx';

const JANE: FeatureReviewUserCandidate = { userIdentifier: 'accountId:557058:ab-12', displayName: 'Jane Doe' };
const JANE_TWIN: FeatureReviewUserCandidate = {
  userIdentifier: 'accountId:557058:cd-34',
  displayName: 'Jane Doe',
  emailAddress: 'jane.doe2@example.com',
};
const BOB: FeatureReviewUserCandidate = { userIdentifier: 'name:bwilson', displayName: 'Bob Wilson' };

const mockSearchUsers = vi.fn();

function renderPicker(overrides: Partial<React.ComponentProps<typeof MentionPicker>> = {}) {
  const onSelect = vi.fn();
  const onDismiss = vi.fn();
  render(
    <MentionPicker
      onDismiss={onDismiss}
      onSelect={onSelect}
      query="ja"
      searchUsers={mockSearchUsers}
      {...overrides}
    />,
  );
  return { onSelect, onDismiss };
}

beforeEach(() => {
  mockSearchUsers.mockReset();
  mockSearchUsers.mockResolvedValue([JANE, BOB]);
});

describe('MentionPicker', () => {
  it('lists the people matching the typed query', async () => {
    renderPicker();

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Bob Wilson')).toBeInTheDocument();
  });

  it('does not search until the query is long enough to be meaningful', () => {
    renderPicker({ query: 'j' });

    expect(mockSearchUsers).not.toHaveBeenCalled();
  });

  it('shows an email address so two colleagues with the same name can be told apart', async () => {
    mockSearchUsers.mockResolvedValue([JANE, JANE_TWIN]);
    renderPicker();

    expect(await screen.findByText(/jane\.doe2@example\.com/)).toBeInTheDocument();
  });

  it('never offers a person no real mention can be built for', async () => {
    // A candidate whose identifier has no recognised flavour cannot produce a notifying mention.
    mockSearchUsers.mockResolvedValue([JANE, { userIdentifier: 'email:x@y.com', displayName: 'Unbuildable Person' }]);
    renderPicker();

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('Unbuildable Person')).not.toBeInTheDocument();
  });

  it('reports the picked person and the mention token to insert', async () => {
    const { onSelect } = renderPicker();

    await userEvent.click(await screen.findByText('Jane Doe'));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ raw: '[~accountid:557058:ab-12]' }),
    );
  });

  it('moves through the results with the arrow keys and inserts with Enter', async () => {
    const { onSelect } = renderPicker();
    await screen.findByText('Jane Doe');

    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ raw: '[~bwilson]' }));
  });

  it('dismisses on Escape so a typed @ can stay ordinary text', async () => {
    const { onDismiss, onSelect } = renderPicker();
    await screen.findByText('Jane Doe');

    await userEvent.keyboard('{Escape}');

    expect(onDismiss).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('says so when nobody matches, rather than looking broken', async () => {
    mockSearchUsers.mockResolvedValue([]);
    renderPicker();

    expect(await screen.findByText(/no people found/i)).toBeInTheDocument();
  });

  it('reports an unavailable search without blocking the composer', async () => {
    mockSearchUsers.mockRejectedValue(new Error('Jira unreachable'));
    renderPicker();

    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable/i);
  });

  it('exposes the results as an accessible listbox with an active option', async () => {
    renderPicker();
    await screen.findByText('Jane Doe');

    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('runs one search for a burst of typing rather than one per keystroke', async () => {
    const { rerender } = render(
      <MentionPicker onDismiss={vi.fn()} onSelect={vi.fn()} query="ja" searchUsers={mockSearchUsers} />,
    );
    rerender(<MentionPicker onDismiss={vi.fn()} onSelect={vi.fn()} query="jan" searchUsers={mockSearchUsers} />);
    rerender(<MentionPicker onDismiss={vi.fn()} onSelect={vi.fn()} query="jane" searchUsers={mockSearchUsers} />);

    await waitFor(() => expect(mockSearchUsers).toHaveBeenCalled());
    expect(mockSearchUsers).toHaveBeenCalledTimes(1);
    expect(mockSearchUsers).toHaveBeenCalledWith('jane');
  });
});
