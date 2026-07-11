// AgingTriageActionTable.test.tsx — Verifies the grouped verdict/feature/issue table and its inline detail.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// IssueDetailPanel fetches transitions/comments of its own; stub it so this test focuses on the table.
vi.mock('../../components/IssueDetailPanel/index.tsx', () => ({
  default: ({ issue, acceptanceCriteria }: { issue: { key: string }; acceptanceCriteria?: string | null }) => (
    <div data-testid="issue-detail">{issue.key} · AC: {acceptanceCriteria ?? 'none'}</div>
  ),
}));

import type { JiraIssue } from '../../types/jira.ts';
import { AgingTriageActionTable } from './AgingTriageActionTable.tsx';
import { buildTriageActionModel } from './agingTriageActionModel.ts';
import type { AgingTriageIssue, AgingTriageSuggestion } from './agingTriage.ts';

function makeTriageIssue(overrides: Partial<AgingTriageIssue>): AgingTriageIssue {
  return {
    issueKey: 'ENCUC-1', issueType: 'Story', summary: 'A', status: 'To Do', ageDays: 100,
    daysSinceUpdate: 90, priority: 'Low', featureKey: 'FEAT-1', featureSummary: 'Reporting', featureStatus: 'Done',
    ...overrides,
  };
}

function fullIssue(key: string): JiraIssue {
  return { id: key, key, fields: { summary: 'A', status: { name: 'To Do', statusCategory: { key: 'new' } } } } as unknown as JiraIssue;
}

describe('AgingTriageActionTable', () => {
  const triageIssues = [
    makeTriageIssue({ issueKey: 'ENCUC-1' }),
    makeTriageIssue({ issueKey: 'ENCUC-9', featureKey: 'FEAT-9', featureSummary: 'Keep', featureStatus: 'In Progress' }),
  ];
  const suggestions: AgingTriageSuggestion[] = [
    { issueKey: 'ENCUC-1', verdict: 'cancel-safe', rationale: 'stale, parent Done' },
    { issueKey: 'ENCUC-9', verdict: 'must-remain', rationale: 'active' },
  ];
  const model = buildTriageActionModel(suggestions, triageIssues);
  const issuesByKey = new Map<string, JiraIssue>([['ENCUC-1', fullIssue('ENCUC-1')], ['ENCUC-9', fullIssue('ENCUC-9')]]);

  it('renders a section per recommendation with its feature group and issue count', () => {
    render(<AgingTriageActionTable model={model} issuesByKey={issuesByKey} acceptanceCriteriaFieldIds={['customfield_10200']} />);
    expect(screen.getByText('Cancel-safe')).toBeInTheDocument();
    expect(screen.getByText('Must remain')).toBeInTheDocument();
    expect(screen.getByText(/FEAT-1 · Reporting/)).toBeInTheDocument();
  });

  it('offers the bulk close action on the cancel-safe group but not on must-remain', () => {
    render(<AgingTriageActionTable model={model} issuesByKey={issuesByKey} acceptanceCriteriaFieldIds={['customfield_10200']} />);
    // cancel-safe → a close button; must-remain (FEAT-9 / Keep) → none.
    expect(screen.getByRole('button', { name: /close feature \+ 1 item/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /close feature \+ 1 item.*keep/i })).not.toBeInTheDocument();
  });

  it('expands an issue row to show the inline detail panel with acceptance criteria', () => {
    render(<AgingTriageActionTable model={model} issuesByKey={issuesByKey} acceptanceCriteriaFieldIds={['customfield_10200']} />);
    expect(screen.queryByTestId('issue-detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ENCUC-1/ }));
    expect(screen.getByTestId('issue-detail')).toHaveTextContent('ENCUC-1');
  });
});
