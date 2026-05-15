// PrbTab.test.tsx — Unit tests for the PRB-to-Jira generator tab.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockState, mockActions } = vi.hoisted(() => ({
    mockState: {
      prbNumber: '',
      prbData: null as {
        sysId: string;
        number: string;
        incidentNumber: string;
        shortDescription: string;
        description: string;
        state: string;
        severity: string;
        assignedTo: { sysId: string; name: string; email: string } | null;
      } | null,
      isFetchingPrb: false,
      fetchError: null as string | null,
      fetchWarning: null as string | null,
      jiraProjectKey: '',
      isPrimaryIssueDefect: true,
      primaryIssueSummaryTemplate: '',
      slStorySummaryTemplate: '',
      isCreatingIssues: false,
      createError: null as string | null,
      createdIssueKeys: [] as string[],
    },
    mockActions: {
      setPrbNumber: vi.fn(),
      fetchPrb: vi.fn().mockResolvedValue(undefined),
      setJiraProjectKey: vi.fn(),
      setIsPrimaryIssueDefect: vi.fn(),
      setPrimaryIssueSummary: vi.fn(),
      setSlStorySummary: vi.fn(),
      createJiraIssues: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
    },
  }));

vi.mock('../hooks/usePrbState.ts', () => ({
  usePrbState: () => ({ state: mockState, actions: mockActions }),
}));

import PrbTab from './PrbTab.tsx';

function resetMockState(): void {
  Object.assign(mockState, {
    prbNumber: '',
    prbData: null,
    isFetchingPrb: false,
    fetchError: null,
    fetchWarning: null,
    jiraProjectKey: '',
    isPrimaryIssueDefect: true,
    primaryIssueSummaryTemplate: '',
    slStorySummaryTemplate: '',
    isCreatingIssues: false,
    createError: null,
    createdIssueKeys: [],
  });
}

describe('PrbTab', () => {
  beforeEach(() => {
    resetMockState();
    Object.values(mockActions).forEach((mockAction) => mockAction.mockReset());
    mockActions.fetchPrb.mockResolvedValue(undefined);
    mockActions.createJiraIssues.mockResolvedValue(undefined);
  });

  it('renders the PRB number input and load button', () => {
    render(<PrbTab />);

    expect(screen.getByLabelText('PRB Number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load PRB' })).toBeInTheDocument();
  });

  it('shows the PRB detail card when prbData is present', () => {
    mockState.prbData = {
      sysId: 'problem-1',
      number: 'PRB0001234',
      incidentNumber: 'INC0012345',
      shortDescription: 'Orders fail during deployment',
      description: 'Deployment issues impact order creation',
      state: 'Open',
      severity: '2 - High',
      assignedTo: { sysId: 'user-1', name: 'Jordan Analyst', email: 'jordan@example.com' },
    };

    render(<PrbTab />);

    expect(screen.getByText('PRB0001234')).toBeInTheDocument();
    expect(screen.getByText('INC0012345')).toBeInTheDocument();
    expect(screen.getByText('Orders fail during deployment')).toBeInTheDocument();
    expect(screen.getByText('Jordan Analyst')).toBeInTheDocument();
  });

  it('shows the Jira issue creation form when prbData is present', () => {
    mockState.prbData = {
      sysId: 'problem-1',
      number: 'PRB0001234',
      incidentNumber: 'INC0012345',
      shortDescription: 'Orders fail during deployment',
      description: 'Deployment issues impact order creation',
      state: 'Open',
      severity: '2 - High',
      assignedTo: null,
    };
    mockState.primaryIssueSummaryTemplate = 'Issue summary';
    mockState.slStorySummaryTemplate = 'SL story summary';

    render(<PrbTab />);

    expect(screen.getByLabelText('Jira Project Key')).toBeInTheDocument();
    expect(screen.getByLabelText('Issue Summary')).toBeInTheDocument();
    expect(screen.getByLabelText('Create primary issue as Defect')).toBeInTheDocument();
    expect(screen.getByLabelText('SL Story Summary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Jira Issues' })).toBeInTheDocument();
  });

  it('shows the created issue keys after success', () => {
    mockState.prbData = {
      sysId: 'problem-1',
      number: 'PRB0001234',
      incidentNumber: 'INC0012345',
      shortDescription: 'Orders fail during deployment',
      description: 'Deployment issues impact order creation',
      state: 'Open',
      severity: '2 - High',
      assignedTo: null,
    };
    mockState.createdIssueKeys = ['ABC-101', 'ABC-102'];

    render(<PrbTab />);

    expect(screen.getByText('ABC-101')).toBeInTheDocument();
    expect(screen.getByText('ABC-102')).toBeInTheDocument();
  });

  it('shows issue preview cards with type, summary, and description when prbData is present', () => {
    mockState.prbData = {
      sysId: 'problem-1',
      number: 'PRB0001234',
      incidentNumber: 'INC0012345',
      shortDescription: 'Orders fail during deployment',
      description: 'Deployment issues impact order creation',
      state: 'Open',
      severity: '2 - High',
      assignedTo: null,
    };
    mockState.isPrimaryIssueDefect = true;
    mockState.primaryIssueSummaryTemplate = 'INC0012345: PRB0001234: "Orders fail during deployment"';
    mockState.slStorySummaryTemplate = '[SL] INC0012345: PRB0001234: "Orders fail during deployment"';

    render(<PrbTab />);

    // Issue type preview for both issues
    expect(screen.getByText('Defect')).toBeInTheDocument();
    // Both issues should show the description starting with the PRB number
    const descriptionPreviews = screen.getAllByText(/PRB0001234[\s\S]*Deployment issues impact order creation/);
    expect(descriptionPreviews.length).toBeGreaterThanOrEqual(1);
    // SL Story label present in preview heading
    expect(screen.getByText('Issue 2 — SL Story')).toBeInTheDocument();
  });
});
