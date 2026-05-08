// index.test.tsx — Unit tests for the Jira board picker component.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import JiraBoardPicker from './index.tsx';

describe('JiraBoardPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while fetching boards', () => {
    mockJiraGet.mockReturnValue(new Promise(() => {}));

    render(
      <JiraBoardPicker
        id="jira-board"
        label="Board"
        onChange={vi.fn()}
        value=""
      />,
    );

    expect(screen.getByRole('combobox', { name: /board/i })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Loading boards…' })).toBeInTheDocument();
  });

  it('renders options after a successful fetch', async () => {
    mockJiraGet.mockResolvedValue({
      values: [
        { id: 42, name: 'Alpha Board', type: 'scrum', projectKey: 'ALPHA' },
        { id: 77, name: 'Beta Board', type: 'kanban', projectKey: 'BETA' },
      ],
    });

    render(
      <JiraBoardPicker
        id="jira-board"
        label="Board"
        onChange={vi.fn()}
        value=""
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Alpha Board (#42)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Beta Board (#77)' })).toBeInTheDocument();
    });
  });

  it('shows a text input fallback when the fetch fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('Unable to load boards'));

    render(
      <JiraBoardPicker
        id="jira-board"
        label="Board"
        onChange={vi.fn()}
        value="42"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /board/i })).toBeInTheDocument();
    });
  });

  it('calls onChange with the selected board ID', async () => {
    const handleChange = vi.fn();
    mockJiraGet.mockResolvedValue({
      values: [
        { id: 42, name: 'Alpha Board', type: 'scrum', projectKey: 'ALPHA' },
        { id: 77, name: 'Beta Board', type: 'kanban', projectKey: 'BETA' },
      ],
    });

    render(
      <JiraBoardPicker
        id="jira-board"
        label="Board"
        onChange={handleChange}
        value=""
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Alpha Board (#42)' })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('combobox', { name: /board/i }), {
      target: { value: '42' },
    });

    expect(handleChange).toHaveBeenCalledWith('42');
  });
});
