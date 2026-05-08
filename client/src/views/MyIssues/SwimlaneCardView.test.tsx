// SwimlaneCardView.test.tsx — Tests for the Swimlane Card View component.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ExtendedJiraIssue } from './myIssuesExtendedTypes.ts';
import SwimlaneCardView from './SwimlaneCardView.tsx';

vi.mock('../../components/IssueDetailPanel/index.tsx', () => ({
  default: ({ issue }: { issue: ExtendedJiraIssue }) => <div>Detail panel for {issue.key}</div>,
}));

function createIssue(
  key: string,
  statusName: string,
  statusCategoryKey: string,
  priorityName = 'Medium',
): ExtendedJiraIssue {
  return {
    id: key,
    key,
    fields: {
      summary: `Summary for ${key}`,
      status: { name: statusName, statusCategory: { key: statusCategoryKey } },
      priority: { name: priorityName, iconUrl: '' },
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: '' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-10T00:00:00.000Z',
      description: null,
    },
  };
}

const MOCK_ISSUES: ExtendedJiraIssue[] = [
  createIssue('TBX-1', 'Blocked', 'indeterminate'),
  createIssue('TBX-2', 'In Progress', 'indeterminate'),
  createIssue('TBX-3', 'In Review', 'indeterminate'),
  createIssue('TBX-4', 'To Do', 'new'),
  createIssue('TBX-5', 'Done', 'done'),
];

describe('SwimlaneCardView', () => {
  it('renders swimlane headers for each populated zone', () => {
    render(
      <SwimlaneCardView
        activeQuickFilterIds={{}}
        bulkSelectedKeys={{}}
        collapsedSwimlanes={{}}
        expandedIssueKey={null}
        isBulkModeActive={false}
        issues={MOCK_ISSUES}
        onIssueClick={vi.fn()}
        onIssueUpdated={vi.fn()}
        onToggleBulkKey={vi.fn()}
        onToggleSwimlane={vi.fn()}
      />,
    );

    expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/in review/i)).toBeInTheDocument();
    expect(screen.getByText(/to do/i)).toBeInTheDocument();
    expect(screen.getByText(/done/i)).toBeInTheDocument();
  });

  it('renders issue cards inside the correct swimlane', () => {
    render(
      <SwimlaneCardView
        activeQuickFilterIds={{}}
        bulkSelectedKeys={{}}
        collapsedSwimlanes={{}}
        expandedIssueKey={null}
        isBulkModeActive={false}
        issues={MOCK_ISSUES}
        onIssueClick={vi.fn()}
        onIssueUpdated={vi.fn()}
        onToggleBulkKey={vi.fn()}
        onToggleSwimlane={vi.fn()}
      />,
    );

    // TBX-1 is blocked → Needs Attention lane
    expect(screen.getByText('TBX-1')).toBeInTheDocument();
  });

  it('shows attention reason badges for blocked issues', () => {
    render(
      <SwimlaneCardView
        activeQuickFilterIds={{}}
        bulkSelectedKeys={{}}
        collapsedSwimlanes={{}}
        expandedIssueKey={null}
        isBulkModeActive={false}
        issues={[createIssue('TBX-1', 'Blocked', 'indeterminate')]}
        onIssueClick={vi.fn()}
        onIssueUpdated={vi.fn()}
        onToggleBulkKey={vi.fn()}
        onToggleSwimlane={vi.fn()}
      />,
    );

    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
  });

  it('calls onIssueClick when a card is clicked', async () => {
    const user = userEvent.setup();
    const handleIssueClick = vi.fn();

    render(
      <SwimlaneCardView
        activeQuickFilterIds={{}}
        bulkSelectedKeys={{}}
        collapsedSwimlanes={{}}
        expandedIssueKey={null}
        isBulkModeActive={false}
        issues={[createIssue('TBX-2', 'In Progress', 'indeterminate')]}
        onIssueClick={handleIssueClick}
        onIssueUpdated={vi.fn()}
        onToggleBulkKey={vi.fn()}
        onToggleSwimlane={vi.fn()}
      />,
    );

    await user.click(screen.getByText('Summary for TBX-2'));

    expect(handleIssueClick).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'TBX-2' }),
    );
  });

  it('calls onToggleSwimlane when a swimlane header is clicked', async () => {
    const user = userEvent.setup();
    const handleToggle = vi.fn();

    render(
      <SwimlaneCardView
        activeQuickFilterIds={{}}
        bulkSelectedKeys={{}}
        collapsedSwimlanes={{}}
        expandedIssueKey={null}
        isBulkModeActive={false}
        issues={MOCK_ISSUES}
        onIssueClick={vi.fn()}
        onIssueUpdated={vi.fn()}
        onToggleBulkKey={vi.fn()}
        onToggleSwimlane={handleToggle}
      />,
    );

    await user.click(screen.getByText(/needs attention/i));

    expect(handleToggle).toHaveBeenCalledWith('attn');
  });

  it('hides lane body when collapsed', () => {
    render(
      <SwimlaneCardView
        activeQuickFilterIds={{}}
        bulkSelectedKeys={{}}
        collapsedSwimlanes={{ attn: true }}
        expandedIssueKey={null}
        isBulkModeActive={false}
        issues={[createIssue('TBX-1', 'Blocked', 'indeterminate')]}
        onIssueClick={vi.fn()}
        onIssueUpdated={vi.fn()}
        onToggleBulkKey={vi.fn()}
        onToggleSwimlane={vi.fn()}
      />,
    );

    // Card summary should not be visible when lane is collapsed
    expect(screen.queryByText('Summary for TBX-1')).not.toBeInTheDocument();
  });

  it('shows checkbox when bulk mode is active', () => {
    render(
      <SwimlaneCardView
        activeQuickFilterIds={{}}
        bulkSelectedKeys={{}}
        collapsedSwimlanes={{}}
        expandedIssueKey={null}
        isBulkModeActive={true}
        issues={[createIssue('TBX-2', 'In Progress', 'indeterminate')]}
        onIssueClick={vi.fn()}
        onIssueUpdated={vi.fn()}
        onToggleBulkKey={vi.fn()}
        onToggleSwimlane={vi.fn()}
      />,
    );

    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('calls onToggleBulkKey when checkbox is changed', async () => {
    const user = userEvent.setup();
    const handleToggleBulk = vi.fn();

    render(
      <SwimlaneCardView
        activeQuickFilterIds={{}}
        bulkSelectedKeys={{}}
        collapsedSwimlanes={{}}
        expandedIssueKey={null}
        isBulkModeActive={true}
        issues={[createIssue('TBX-2', 'In Progress', 'indeterminate')]}
        onIssueClick={vi.fn()}
        onIssueUpdated={vi.fn()}
        onToggleBulkKey={handleToggleBulk}
        onToggleSwimlane={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('checkbox'));

    expect(handleToggleBulk).toHaveBeenCalledWith('TBX-2');
  });

  it('shows aging label when issue is older than 5 days', () => {
    const staleIssue = createIssue('TBX-6', 'To Do', 'new');
    // Updated 15 days ago
    staleIssue.fields.updated = new Date(Date.now() - 15 * 86_400_000).toISOString();

    render(
      <SwimlaneCardView
        activeQuickFilterIds={{}}
        bulkSelectedKeys={{}}
        collapsedSwimlanes={{}}
        expandedIssueKey={null}
        isBulkModeActive={false}
        issues={[staleIssue]}
        onIssueClick={vi.fn()}
        onIssueUpdated={vi.fn()}
        onToggleBulkKey={vi.fn()}
        onToggleSwimlane={vi.fn()}
      />,
    );

    expect(screen.getByText(/\d+d ago/)).toBeInTheDocument();
  });

  it('renders empty state message when issues list is empty', () => {
    render(
      <SwimlaneCardView
        activeQuickFilterIds={{}}
        bulkSelectedKeys={{}}
        collapsedSwimlanes={{}}
        expandedIssueKey={null}
        isBulkModeActive={false}
        issues={[]}
        onIssueClick={vi.fn()}
        onIssueUpdated={vi.fn()}
        onToggleBulkKey={vi.fn()}
        onToggleSwimlane={vi.fn()}
      />,
    );

    expect(screen.getByText(/no issues/i)).toBeInTheDocument();
  });

  it('renders inline detail content for the expanded card', () => {
    render(
      <SwimlaneCardView
        activeQuickFilterIds={{}}
        bulkSelectedKeys={{}}
        collapsedSwimlanes={{}}
        expandedIssueKey="TBX-2"
        isBulkModeActive={false}
        issues={[createIssue('TBX-2', 'In Progress', 'indeterminate')]}
        onIssueClick={vi.fn()}
        onIssueUpdated={vi.fn()}
        onToggleBulkKey={vi.fn()}
        onToggleSwimlane={vi.fn()}
      />,
    );

    expect(screen.getByText('Detail panel for TBX-2')).toBeInTheDocument();
  });
});
