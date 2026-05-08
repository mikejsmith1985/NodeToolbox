// index.test.tsx — Unit tests for the Jira project picker component.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import JiraProjectPicker from './index.tsx';

describe('JiraProjectPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while fetching projects', () => {
    mockJiraGet.mockReturnValue(new Promise(() => {}));

    render(
      <JiraProjectPicker
        id="jira-project"
        label="Project"
        onChange={vi.fn()}
        value=""
      />,
    );

    expect(screen.getByRole('combobox', { name: /project/i })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Loading projects…' })).toBeInTheDocument();
  });

  it('renders options after a successful fetch', async () => {
    mockJiraGet.mockResolvedValue([
      { id: '10001', key: 'TBX', name: 'Toolbox' },
      { id: '10002', key: 'OPS', name: 'Operations' },
    ]);

    render(
      <JiraProjectPicker
        id="jira-project"
        label="Project"
        onChange={vi.fn()}
        value=""
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Toolbox (TBX)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Operations (OPS)' })).toBeInTheDocument();
    });
  });

  it('shows a text input fallback when the fetch fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('Unable to load projects'));

    render(
      <JiraProjectPicker
        id="jira-project"
        label="Project"
        onChange={vi.fn()}
        value="TBX"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /project/i })).toBeInTheDocument();
    });
  });

  it('calls onChange with the selected project key', async () => {
    const handleChange = vi.fn();
    mockJiraGet.mockResolvedValue([
      { id: '10001', key: 'TBX', name: 'Toolbox' },
      { id: '10002', key: 'OPS', name: 'Operations' },
    ]);

    render(
      <JiraProjectPicker
        id="jira-project"
        label="Project"
        onChange={handleChange}
        value=""
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Toolbox (TBX)' })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('combobox', { name: /project/i }), {
      target: { value: 'TBX' },
    });

    expect(handleChange).toHaveBeenCalledWith('TBX');
  });
});
