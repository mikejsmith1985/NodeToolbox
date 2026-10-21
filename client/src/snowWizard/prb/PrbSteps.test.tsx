// PrbSteps.test.tsx — Proves the problem job's screens draw the states they are handed: gaps, failures, picks.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { buildPrbJiraDrafts } from './prbJiraPlan.ts';
import { PrbChooseStep, PrbDraftsStep, PrbPlaceStep, PrbResultStep } from './PrbSteps.tsx';

const NO_DESCRIPTION_DRAFTS = buildPrbJiraDrafts({ number: 'PRB1', shortDescription: 'Broken', description: '', link: 'https://snow/x' }, 'EP-1', 'ENCUC');

function renderPlaceStep(overrides: Partial<Parameters<typeof PrbPlaceStep>[0]> = {}) {
  const props = {
    projectList: { status: 'ready' as const, items: [{ id: '1', key: 'ENCUC', name: 'Enrollment' }] },
    projectKey: '',
    epicSearchText: '',
    epicSearch: { status: 'idle' as const, items: [] },
    chosenEpic: null,
    onChooseProject: vi.fn(),
    onRetryProjects: vi.fn(),
    onEpicSearchTextChange: vi.fn(),
    onEpicSearch: vi.fn(),
    onChooseEpic: vi.fn(),
    ...overrides,
  };
  render(<PrbPlaceStep {...props} />);
  return props;
}

describe('PrbDraftsStep', () => {
  it('points at the gap when the problem had no description', () => {
    render(<PrbDraftsStep drafts={NO_DESCRIPTION_DRAFTS} onEdit={vi.fn()} />);
    expect(screen.getAllByText(/replace the highlighted line/)).toHaveLength(3);
  });

  it('reports each summary edit for its own item', () => {
    const onEdit = vi.fn();
    render(<PrbDraftsStep drafts={NO_DESCRIPTION_DRAFTS} onEdit={onEdit} />);
    fireEvent.change(screen.getByLabelText('Summary', { selector: '#prb-qe-summary' }), { target: { value: 'QE: new' } });
    expect(onEdit).toHaveBeenCalledWith('qe', { summary: 'QE: new' });
  });
});

describe('PrbPlaceStep', () => {
  it('offers a Try again — never a text box — when the project list cannot be read', () => {
    const props = renderPlaceStep({ projectList: { status: 'failed', items: [] } });
    expect(screen.queryByLabelText('Jira project')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetryProjects).toHaveBeenCalled();
  });

  it('chooses an Epic from the results', () => {
    const epic = { key: 'EP-1', summary: 'Epic one', statusName: 'Open' };
    const props = renderPlaceStep({ epicSearch: { status: 'ready', items: [epic] } });
    fireEvent.click(screen.getByRole('button', { name: /EP-1 — Epic one/ }));
    expect(props.onChooseEpic).toHaveBeenCalledWith(epic);
  });
});

describe('PrbChooseStep', () => {
  const IDLE_SEARCH = { searchText: '', results: { status: 'idle' as const, items: [] } };

  it('offers three choices per item, and warns when the Defect is left out', () => {
    const onChooseMode = vi.fn();
    render(
      <PrbChooseStep roleChoices={{ defect: { mode: 'skip' }, sl: { mode: 'new' }, qe: { mode: 'new' } }}
        roleSearches={{ defect: IDLE_SEARCH, sl: IDLE_SEARCH, qe: IDLE_SEARCH }} jiraUrl="https://jira.example.com"
        onChooseMode={onChooseMode} onSearchTextChange={vi.fn()} onSearch={vi.fn()} onPickIssue={vi.fn()} />,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(9);
    expect(screen.getByText(/With no Defect, the stories are not linked to one/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('radio', { name: 'Use one already in Jira' })[2]);
    expect(onChooseMode).toHaveBeenCalledWith('qe', 'existing');
  });

  it('picks an issue from the search results for that item', () => {
    const onPickIssue = vi.fn();
    const foundIssue = { key: 'X-2', summary: 'SL work', issueTypeName: 'Story', statusName: 'Open', labels: [], linkedKeys: [] };
    render(
      <PrbChooseStep roleChoices={{ defect: { mode: 'new' }, sl: { mode: 'existing', issue: null }, qe: { mode: 'new' } }}
        roleSearches={{ defect: IDLE_SEARCH, sl: { searchText: 'SL', results: { status: 'ready', items: [foundIssue] } }, qe: IDLE_SEARCH }}
        jiraUrl="https://jira.example.com" onChooseMode={vi.fn()} onSearchTextChange={vi.fn()} onSearch={vi.fn()} onPickIssue={onPickIssue} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'X-2 — SL work (Story, Open)' }));
    expect(onPickIssue).toHaveBeenCalledWith('sl', foundIssue);
  });
});

describe('PrbResultStep', () => {
  it('names a story that was made but not linked, and offers Retry the rest', () => {
    const onRetry = vi.fn();
    const createResult = {
      progress: { createdKeys: { defect: 'A-1', sl: 'A-2', qe: 'A-3' }, linkedRoles: ['sl' as const], labelledRoles: [] },
      failures: [{ role: 'qe' as const, stage: 'link' as const, message: 'Link refused' }],
      isComplete: false,
    };
    render(<PrbResultStep isCreating={false} createResult={createResult} jiraUrl="https://jira.example.com" keptRoles={['defect', 'sl', 'qe']} onRetry={onRetry} />);
    expect(screen.getByText('QE story is in Jira but not linked to the Defect — Link refused')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry the rest' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
