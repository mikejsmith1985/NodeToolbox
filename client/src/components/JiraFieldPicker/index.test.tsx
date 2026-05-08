// index.test.tsx — Unit tests for the Jira field picker component.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import JiraFieldPicker from './index.tsx';

describe('JiraFieldPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while fetching fields', () => {
    mockJiraGet.mockReturnValue(new Promise(() => {}));

    render(
      <JiraFieldPicker
        id="story-points-field"
        label="Story Points Field"
        onChange={vi.fn()}
        value=""
      />,
    );

    expect(screen.getByRole('combobox', { name: /story points field/i })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Loading fields…' })).toBeInTheDocument();
  });

  it('renders options after a successful fetch', async () => {
    mockJiraGet.mockResolvedValue([
      { id: 'customfield_10016', name: 'Story Points' },
      { id: 'customfield_10014', name: 'Epic Link' },
    ]);

    render(
      <JiraFieldPicker
        id="story-points-field"
        label="Story Points Field"
        onChange={vi.fn()}
        value=""
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Story Points (customfield_10016)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Epic Link (customfield_10014)' })).toBeInTheDocument();
    });
  });

  it('shows a text input fallback when the fetch fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('Unable to load fields'));

    render(
      <JiraFieldPicker
        id="story-points-field"
        label="Story Points Field"
        onChange={vi.fn()}
        value="customfield_10016"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /story points field/i })).toBeInTheDocument();
    });
  });

  it('calls onChange with the selected field ID', async () => {
    const handleChange = vi.fn();
    mockJiraGet.mockResolvedValue([
      { id: 'customfield_10016', name: 'Story Points' },
      { id: 'customfield_10014', name: 'Epic Link' },
    ]);

    render(
      <JiraFieldPicker
        id="story-points-field"
        label="Story Points Field"
        onChange={handleChange}
        value=""
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Story Points (customfield_10016)' })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('combobox', { name: /story points field/i }), {
      target: { value: 'customfield_10016' },
    });

    expect(handleChange).toHaveBeenCalledWith('customfield_10016');
  });
});
