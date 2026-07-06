// StoryInspectorPanel.test.tsx — Verifies the story inspector shows header facts instantly and
// fetches description/acceptance criteria on demand.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StoryInspectorPanel, type StoryInspectorSummary } from './StoryInspectorPanel.tsx';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));
vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

const STORY: StoryInspectorSummary = {
  storyKey: 'DENP-2', summary: 'Build the API', status: 'In Progress', points: 3,
  issueType: 'Story', assignee: 'Ada Lovelace', subtaskCount: 2,
};

describe('StoryInspectorPanel', () => {
  it('renders the header facts immediately and loads description + acceptance criteria', async () => {
    // The comment fetch and the detail fetch both go through jiraGet; return the story fields.
    mockJiraGet.mockResolvedValue({ fields: { description: 'Call the endpoint', customfield_10200: 'Given a token, returns 200' } });

    render(<StoryInspectorPanel story={STORY} onClose={vi.fn()} />);

    // Header renders from props without waiting on the fetch.
    expect(screen.getByText('DENP-2')).toBeInTheDocument();
    expect(screen.getByText('Build the API')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();

    // Description + AC arrive from the on-demand fetch.
    expect(await screen.findByText('Call the endpoint')).toBeInTheDocument();
    expect(await screen.findByText('Given a token, returns 200')).toBeInTheDocument();
  });

  it('shows an error when the detail fetch fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('boom'));
    render(<StoryInspectorPanel story={STORY} onClose={vi.fn()} />);
    expect(await screen.findByText(/Failed to load story detail/)).toBeInTheDocument();
  });
});
