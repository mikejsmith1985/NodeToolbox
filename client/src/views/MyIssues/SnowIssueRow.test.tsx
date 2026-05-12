// SnowIssueRow.test.tsx — Tests for the SnowIssueRow component.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SnowIssueRow } from './SnowIssueRow.tsx';
import type { SnowMyIssue } from '../../types/snow.ts';

// ── Test data ──

const MOCK_INCIDENT: SnowMyIssue = {
  sys_id: 'inc-001',
  number: 'INC0001234',
  short_description: 'Email system is down',
  state: 'New',
  priority: '2 - High',
  sys_class_name: 'incident',
  opened_at: '2026-05-01T10:00:00Z',
};

const MOCK_PROBLEM: SnowMyIssue = {
  sys_id: 'prb-001',
  number: 'PRB0000099',
  short_description: 'Recurring network failures',
  state: 'In Progress',
  priority: '1 - Critical',
  sys_class_name: 'problem',
  opened_at: '2026-04-15T08:30:00Z',
  problem_statement: 'Network drops every 2 hours. TBX-42',
};

// ── Tests ──

describe('SnowIssueRow', () => {
  it('renders the record number', () => {
    render(<SnowIssueRow issue={MOCK_INCIDENT} />);
    expect(screen.getByText('INC0001234')).toBeInTheDocument();
  });

  it('renders the short description', () => {
    render(<SnowIssueRow issue={MOCK_INCIDENT} />);
    expect(screen.getByText('Email system is down')).toBeInTheDocument();
  });

  it('renders the current state as a badge', () => {
    render(<SnowIssueRow issue={MOCK_INCIDENT} />);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('renders the priority label without the leading digit and dash', () => {
    render(<SnowIssueRow issue={MOCK_INCIDENT} />);
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('shows "INC" type icon for incidents', () => {
    render(<SnowIssueRow issue={MOCK_INCIDENT} />);
    expect(screen.getByText('INC')).toBeInTheDocument();
  });

  it('shows "PRB" type icon for problems', () => {
    render(<SnowIssueRow issue={MOCK_PROBLEM} />);
    expect(screen.getByText('PRB')).toBeInTheDocument();
  });

  it('renders with an accessible row label containing the record number', () => {
    render(<SnowIssueRow issue={MOCK_INCIDENT} />);
    expect(screen.getByRole('row', { name: /INC0001234/i })).toBeInTheDocument();
  });

  it('renders Critical priority label for priority 1', () => {
    render(<SnowIssueRow issue={MOCK_PROBLEM} />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });
});
