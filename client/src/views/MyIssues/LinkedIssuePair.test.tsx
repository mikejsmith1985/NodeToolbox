// LinkedIssuePair.test.tsx — Tests for the LinkedIssuePair component.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { LinkedIssuePair } from './LinkedIssuePair.tsx';
import type { LinkedIssuePair as LinkedIssuePairType } from '../../types/issueLinking.ts';
import type { JiraIssue } from '../../types/jira.ts';
import type { SnowMyIssue } from '../../types/snow.ts';

// ── Test fixtures ──

const MOCK_JIRA_ISSUE: JiraIssue = {
  id: 'jira-100',
  key: 'TBX-100',
  fields: {
    summary: 'Login page crashes on mobile',
    status: { name: 'To Do', statusCategory: { key: 'new' } },
    priority: { name: 'High', iconUrl: '' },
    assignee: null,
    reporter: null,
    issuetype: { name: 'Defect', iconUrl: '/icons/bug.png' },
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-02T00:00:00Z',
    description: null,
    customfield_11203: 'PRB0000100',
  },
};

const MOCK_SNOW_PROBLEM: SnowMyIssue = {
  sys_id: 'prb-sys-100',
  number: 'PRB0000100',
  short_description: 'Mobile authentication failure',
  state: 'New',
  priority: '2 - High',
  sys_class_name: 'problem',
  opened_at: '2026-01-01T00:00:00Z',
  problem_statement: 'Users cannot log in on mobile. TBX-100',
};

function buildPair(healthStatus: LinkedIssuePairType['healthStatus'] = 'green'): LinkedIssuePairType {
  return {
    pairId: 'TBX-100::prb-sys-100',
    jiraIssue: MOCK_JIRA_ISSUE,
    snowProblem: MOCK_SNOW_PROBLEM,
    healthStatus,
    matchingFieldCount: healthStatus === 'green' ? 1 : healthStatus === 'yellow' ? 0 : 0,
    totalMappedFieldCount: 1,
  };
}

// ── Tests ──

describe('LinkedIssuePair', () => {
  it('renders the Jira issue key', () => {
    render(<LinkedIssuePair pair={buildPair()} />);
    expect(screen.getByText('TBX-100')).toBeInTheDocument();
  });

  it('renders the Jira issue summary', () => {
    render(<LinkedIssuePair pair={buildPair()} />);
    expect(screen.getByText('Login page crashes on mobile')).toBeInTheDocument();
  });

  it('shows the green health badge label when health is green', () => {
    render(<LinkedIssuePair pair={buildPair('green')} />);
    expect(screen.getByText('✓ In Sync')).toBeInTheDocument();
  });

  it('shows the yellow health badge label when health is yellow', () => {
    render(<LinkedIssuePair pair={buildPair('yellow')} />);
    expect(screen.getByText('⚠ Partial')).toBeInTheDocument();
  });

  it('shows the red health badge label when health is red', () => {
    render(<LinkedIssuePair pair={buildPair('red')} />);
    expect(screen.getByText('✗ Out of Sync')).toBeInTheDocument();
  });

  it('does not show the SNow panel initially', () => {
    render(<LinkedIssuePair pair={buildPair()} />);
    expect(screen.queryByText('PRB0000100')).not.toBeInTheDocument();
  });

  it('expands the SNow panel when the Jira row is clicked', async () => {
    const user = userEvent.setup();
    render(<LinkedIssuePair pair={buildPair()} />);

    await user.click(screen.getByRole('button', { name: /TBX-100/i }));

    expect(screen.getByText('PRB0000100')).toBeInTheDocument();
    expect(screen.getByText('Mobile authentication failure')).toBeInTheDocument();
  });

  it('collapses the SNow panel on a second click', async () => {
    const user = userEvent.setup();
    render(<LinkedIssuePair pair={buildPair()} />);

    const rowButton = screen.getByRole('button', { name: /TBX-100/i });
    await user.click(rowButton);
    await user.click(rowButton);

    expect(screen.queryByText('PRB0000100')).not.toBeInTheDocument();
  });

  it('shows the match summary when expanded', async () => {
    const user = userEvent.setup();
    render(<LinkedIssuePair pair={buildPair('green')} />);

    await user.click(screen.getByRole('button', { name: /TBX-100/i }));

    expect(screen.getByText(/1 of 1 mapped field/i)).toBeInTheDocument();
  });

  it('sets aria-expanded to false when collapsed', () => {
    render(<LinkedIssuePair pair={buildPair()} />);
    const button = screen.getByRole('button', { name: /TBX-100/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('sets aria-expanded to true when expanded', async () => {
    const user = userEvent.setup();
    render(<LinkedIssuePair pair={buildPair()} />);

    const button = screen.getByRole('button', { name: /TBX-100/i });
    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('sets data-health attribute on the wrapper matching the health status', () => {
    render(<LinkedIssuePair pair={buildPair('red')} />);
    const wrapper = screen.getByTestId('linked-issue-pair');
    expect(wrapper).toHaveAttribute('data-health', 'red');
  });
});
