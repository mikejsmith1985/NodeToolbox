// JiraTemplateMaker.test.tsx — Integration test: the wizard renders and narrows project → issue type.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getIssueTypeFields, getMyself, getProject, getProjectIssueTypes } from '../../services/jiraApi.ts';
import { loadJiraTemplates } from '../../services/confluenceApi.ts';
import { fetchJiraBaseUrl } from '../../services/proxyApi.ts';
import JiraTemplateMaker from './JiraTemplateMaker.tsx';

vi.mock('../../services/jiraApi.ts', () => ({
  getProjectIssueTypes: vi.fn(),
  getIssueTypeFields: vi.fn(),
  getMyself: vi.fn(),
  getProject: vi.fn(),
}));
vi.mock('../../services/confluenceApi.ts', () => ({
  loadJiraTemplates: vi.fn(),
  saveJiraTemplates: vi.fn(),
  mergeJiraTemplateStores: vi.fn(),
}));
vi.mock('../../services/proxyApi.ts', () => ({ fetchJiraBaseUrl: vi.fn() }));

const issueTypesMock = vi.mocked(getProjectIssueTypes);
const fieldsMock = vi.mocked(getIssueTypeFields);
const loadMock = vi.mocked(loadJiraTemplates);
const myselfMock = vi.mocked(getMyself);
const projectMock = vi.mocked(getProject);
const baseUrlMock = vi.mocked(fetchJiraBaseUrl);

describe('JiraTemplateMaker view', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('renders the wizard and narrows issue types to the chosen project', async () => {
    issueTypesMock.mockResolvedValue({ values: [{ id: '1', name: 'Task', subtask: false }] } as never);
    fieldsMock.mockResolvedValue({ values: [
      { fieldId: 'summary', required: true, name: 'Summary', schema: { type: 'string', system: 'summary' } },
    ] } as never);
    loadMock.mockResolvedValue({ schemaVersion: 1, updatedAt: '', templates: [] } as never);
    myselfMock.mockResolvedValue({ displayName: 'Jane' } as never);
    projectMock.mockResolvedValue({ id: '11900', key: 'ABC', name: 'Alpha' } as never);
    baseUrlMock.mockResolvedValue('https://jira.example.com');

    render(<JiraTemplateMaker />);
    expect(screen.getByRole('heading', { name: /jira template maker/i })).toBeInTheDocument();

    // Project is a searchable key input (seeded with ART projects); type a key directly.
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'ABC' } });

    // After createmeta resolves, advancing reaches the issue-type step scoped to this project.
    const nextButton = await screen.findByRole('button', { name: /next: issue type/i });
    await waitFor(() => expect(nextButton).toBeEnabled());
    fireEvent.click(nextButton);

    expect(await screen.findByRole('option', { name: 'Task' })).toBeInTheDocument();
  });
});
