// SprintFlowSnapshot.test.tsx — Component tests for the informational sprint-flow panel.
//
// We verify the WIP-by-zone counts, the sprint days-remaining text (including the no-sprint
// case), and that the panel never renders a check-off control.

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { JiraSprint } from '../../../types/jira.ts';
import type { JiraIssue as HygieneJiraIssue } from '../../Hygiene/checks/hygieneChecks.ts';
import SprintFlowSnapshot from './SprintFlowSnapshot.tsx';

function buildIssue(key: string, statusCategoryKey: string): HygieneJiraIssue {
  return {
    key,
    fields: {
      summary: `Summary ${key}`,
      status: { name: statusCategoryKey, statusCategory: { key: statusCategoryKey } },
    },
  };
}

function renderSnapshot(sprintIssues: HygieneJiraIssue[], sprintInfo: JiraSprint | null) {
  render(
    <MemoryRouter>
      <SprintFlowSnapshot sprintIssues={sprintIssues} sprintInfo={sprintInfo} />
    </MemoryRouter>,
  );
}

function buildSprint(endDate: string): JiraSprint {
  return { id: 1, name: 'Sprint 1', state: 'active', startDate: '2026-06-01', endDate };
}

describe('SprintFlowSnapshot', () => {
  it('renders WIP counts grouped by status zone', () => {
    renderSnapshot(
      [
        buildIssue('A-1', 'new'),
        buildIssue('A-2', 'indeterminate'),
        buildIssue('A-3', 'indeterminate'),
        buildIssue('A-4', 'done'),
      ],
      buildSprint('2026-07-10'),
    );

    expect(screen.getByText('To Do').nextSibling).toHaveTextContent('1');
    expect(screen.getByText('In Progress').nextSibling).toHaveTextContent('2');
    expect(screen.getByText('Done').nextSibling).toHaveTextContent('1');
  });

  it('shows days remaining when a sprint is active', () => {
    const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    renderSnapshot([], buildSprint(futureDate));

    expect(screen.getByText(/remaining/i)).toBeInTheDocument();
  });

  it('shows the no-active-sprint message when sprintInfo is null', () => {
    renderSnapshot([buildIssue('A-1', 'new')], null);

    expect(screen.getByText('No active sprint')).toBeInTheDocument();
  });

  it('never renders a check-off control', () => {
    renderSnapshot([buildIssue('A-1', 'new')], buildSprint('2026-07-10'));

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
