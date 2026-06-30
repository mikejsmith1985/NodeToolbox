// JiraTemplateMaker.test.tsx — Integration test: the wizard renders and narrows project → issue type.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCreateMeta, getMyself, jiraGet } from '../../services/jiraApi.ts';
import { loadJiraTemplates } from '../../services/confluenceApi.ts';
import JiraTemplateMaker from './JiraTemplateMaker.tsx';

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
  getCreateMeta: vi.fn(),
  getMyself: vi.fn(),
}));
vi.mock('../../services/confluenceApi.ts', () => ({
  loadJiraTemplates: vi.fn(),
  saveJiraTemplates: vi.fn(),
  mergeJiraTemplateStores: vi.fn(),
}));

const jiraGetMock = vi.mocked(jiraGet);
const getCreateMetaMock = vi.mocked(getCreateMeta);
const loadMock = vi.mocked(loadJiraTemplates);
const myselfMock = vi.mocked(getMyself);

const META = {
  projects: [{
    id: '10000', key: 'ABC', name: 'Alpha',
    issuetypes: [{ id: '1', name: 'Task', subtask: false, fields: {
      summary: { required: true, name: 'Summary', schema: { type: 'string', system: 'summary' } },
    } }],
  }],
};

describe('JiraTemplateMaker view', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('renders the wizard and narrows issue types to the chosen project', async () => {
    jiraGetMock.mockResolvedValue([{ id: '10000', key: 'ABC', name: 'Alpha' }] as never);
    getCreateMetaMock.mockResolvedValue(META as never);
    loadMock.mockResolvedValue({ schemaVersion: 1, updatedAt: '', templates: [] } as never);
    myselfMock.mockResolvedValue({ displayName: 'Jane' } as never);

    render(<JiraTemplateMaker />);
    expect(screen.getByRole('heading', { name: /jira template maker/i })).toBeInTheDocument();

    // Project select populates after the project list loads.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Alpha (ABC)' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'ABC' } });

    // After createmeta resolves, advancing reaches the issue-type step scoped to this project.
    const nextButton = await screen.findByRole('button', { name: /next: issue type/i });
    await waitFor(() => expect(nextButton).toBeEnabled());
    fireEvent.click(nextButton);

    expect(await screen.findByRole('option', { name: 'Task' })).toBeInTheDocument();
  });
});
