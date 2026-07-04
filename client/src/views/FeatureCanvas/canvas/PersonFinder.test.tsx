// PersonFinder.test.tsx — Verifies the person type-ahead searches and inserts an assignee clause.

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JiraUser } from '../../../types/jira.ts';
import { PersonFinder } from './PersonFinder.tsx';

const mockSearchUsers = vi.fn();
vi.mock('../../../services/jiraApi.ts', () => ({
  searchUsers: (query: string) => mockSearchUsers(query),
}));

function buildUser(overrides: Partial<JiraUser> = {}): JiraUser {
  return { accountId: '557058:abc', displayName: 'Ada Lovelace', emailAddress: 'ada@example.com', avatarUrls: {}, ...overrides };
}

afterEach(() => {
  mockSearchUsers.mockReset();
});

describe('PersonFinder', () => {
  it('searches after typing and inserts the resolved assignee clause on pick', async () => {
    mockSearchUsers.mockResolvedValue([buildUser()]);
    const onInsertClause = vi.fn();
    render(<PersonFinder onInsertClause={onInsertClause} />);

    fireEvent.click(screen.getByRole('button', { name: /Find person/ }));
    fireEvent.change(screen.getByLabelText(/Search people/), { target: { value: 'ada' } });

    const result = await screen.findByRole('button', { name: /Ada Lovelace/ });
    expect(mockSearchUsers).toHaveBeenCalledWith('ada');

    fireEvent.click(result);
    expect(onInsertClause).toHaveBeenCalledWith('assignee = "557058:abc"');
  });

  it('does not search for queries shorter than two characters', async () => {
    render(<PersonFinder onInsertClause={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Find person/ }));
    fireEvent.change(screen.getByLabelText(/Search people/), { target: { value: 'a' } });

    // Give the debounce window time to elapse; the search must never fire for a 1-char query.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(mockSearchUsers).not.toHaveBeenCalled();
  });

  it('surfaces a search error without inserting anything', async () => {
    mockSearchUsers.mockRejectedValue(new Error('Jira unreachable'));
    const onInsertClause = vi.fn();
    render(<PersonFinder onInsertClause={onInsertClause} />);

    fireEvent.click(screen.getByRole('button', { name: /Find person/ }));
    fireEvent.change(screen.getByLabelText(/Search people/), { target: { value: 'ada' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Jira unreachable');
    expect(onInsertClause).not.toHaveBeenCalled();
  });
});
