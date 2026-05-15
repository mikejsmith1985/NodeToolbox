// PrbWizard.test.tsx — Behavioural tests for the four-step PRB wizard UI.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PrbWizard from './PrbWizard.tsx';

interface PrbStateOverrides {
  prbNumber?: string;
  prbData?: unknown;
  jiraProjectKey?: string;
  isPrimaryIssueDefect?: boolean;
  primaryIssueSummaryTemplate?: string;
  slStorySummaryTemplate?: string;
  createdIssueKeys?: string[];
  fetchError?: string | null;
  fetchWarning?: string | null;
  createError?: string | null;
  isFetchingPrb?: boolean;
  isCreatingIssues?: boolean;
}

function buildFakePrbHook(overrides: PrbStateOverrides = {}) {
  const state = {
    prbNumber: overrides.prbNumber ?? '',
    prbData: overrides.prbData ?? null,
    isFetchingPrb: overrides.isFetchingPrb ?? false,
    fetchError: overrides.fetchError ?? null,
    fetchWarning: overrides.fetchWarning ?? null,
    jiraProjectKey: overrides.jiraProjectKey ?? '',
    isPrimaryIssueDefect: overrides.isPrimaryIssueDefect ?? true,
    primaryIssueSummaryTemplate: overrides.primaryIssueSummaryTemplate ?? '',
    slStorySummaryTemplate: overrides.slStorySummaryTemplate ?? '',
    isCreatingIssues: overrides.isCreatingIssues ?? false,
    createError: overrides.createError ?? null,
    createdIssueKeys: overrides.createdIssueKeys ?? [],
  };
  const actions = {
    setPrbNumber: vi.fn(),
    fetchPrb: vi.fn().mockResolvedValue(undefined),
    setJiraProjectKey: vi.fn(),
    setIsPrimaryIssueDefect: vi.fn(),
    setPrimaryIssueSummary: vi.fn(),
    setSlStorySummary: vi.fn(),
    createJiraIssues: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  };
  return { state, actions };
}

describe('PrbWizard', () => {
  it('starts on step one (Pick PRB) and disables Back', () => {
    const { state, actions } = buildFakePrbHook();

    render(<PrbWizard actions={actions as never} state={state as never} />);

    expect(screen.getByText(/Step 1 of 4: Pick PRB/)).toBeInTheDocument();
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Next on step one until a PRB has been loaded', () => {
    const { state, actions } = buildFakePrbHook();

    render(<PrbWizard actions={actions as never} state={state as never} />);

    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('advances to step two when a PRB is loaded and Next is clicked', () => {
    const { state, actions } = buildFakePrbHook({
      prbData: { number: 'PRB0001234', incidentNumber: 'INC0012345', shortDescription: 'foo', description: 'bar', state: 'Open', severity: '2', assignedTo: null, sysId: 'x' },
    });

    render(<PrbWizard actions={actions as never} state={state as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText(/Step 2 of 4: Issue/)).toBeInTheDocument();
  });

  it('disables Next on step two until project key and issue summary are filled', () => {
    const initial = buildFakePrbHook({
      prbData: { number: 'PRB1', incidentNumber: 'INC0012345', shortDescription: 's', description: 'd', state: 'Open', severity: '2', assignedTo: null, sysId: 'x' },
    });

    const { rerender } = render(<PrbWizard actions={initial.actions as never} state={initial.state as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);

    const filled = buildFakePrbHook({
      prbData: initial.state.prbData,
      jiraProjectKey: 'PROJ',
      primaryIssueSummaryTemplate: 'INC0012345: PRB1: "foo"',
    });
    rerender(<PrbWizard actions={filled.actions as never} state={filled.state as never} />);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Back returns the user to a prior step', () => {
    const { state, actions } = buildFakePrbHook({
      prbData: { number: 'PRB1', incidentNumber: 'INC0012345', shortDescription: 's', description: 'd', state: 'Open', severity: '2', assignedTo: null, sysId: 'x' },
    });

    render(<PrbWizard actions={actions as never} state={state as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Step 2 of 4/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/Step 1 of 4/)).toBeInTheDocument();
  });

  it('Start Over resets the wizard and underlying state', () => {
    const { state, actions } = buildFakePrbHook();

    render(<PrbWizard actions={actions as never} state={state as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Over' }));

    expect(actions.reset).toHaveBeenCalled();
  });

  it('renders the Review step with per-issue type, summary and description cards plus a Create button', () => {
    const { state, actions } = buildFakePrbHook({
      prbData: { number: 'PRB1', incidentNumber: 'INC0012345', shortDescription: 's', description: 'Full description here', state: 'Open', severity: '2', assignedTo: null, sysId: 'x' },
      jiraProjectKey: 'PROJ',
      isPrimaryIssueDefect: true,
      primaryIssueSummaryTemplate: 'INC0012345: PRB1: "foo"',
      slStorySummaryTemplate: '[SL] INC0012345: PRB1: "foo"',
    });

    render(<PrbWizard actions={actions as never} state={state as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText(/Step 4 of 4: Review/)).toBeInTheDocument();
    // Primary issue preview card
    expect(screen.getByText('Issue 1 — Primary')).toBeInTheDocument();
    expect(screen.getAllByText('Defect').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('INC0012345: PRB1: "foo"')).toBeInTheDocument();
    // SL Story preview card
    expect(screen.getByText('Issue 2 — SL Story')).toBeInTheDocument();
    expect(screen.getByText('[SL] INC0012345: PRB1: "foo"')).toBeInTheDocument();
    // Description preview should include the PRB number
    expect(screen.getAllByText(/PRB1[\s\S]*Full description here/).length).toBeGreaterThanOrEqual(1);
    // Action button
    fireEvent.click(screen.getByRole('button', { name: 'Create Jira Issues' }));
    expect(actions.createJiraIssues).toHaveBeenCalled();
  });

  it('shows a partial success with created key and error message when one issue creation fails', () => {
    const { state, actions } = buildFakePrbHook({
      prbData: { number: 'PRB1', incidentNumber: 'INC1', shortDescription: 's', description: 'd', state: 'Open', severity: '2', assignedTo: null, sysId: 'x' },
      jiraProjectKey: 'PROJ',
      primaryIssueSummaryTemplate: 'INC1: PRB1: "s"',
      slStorySummaryTemplate: '[SL] INC1: PRB1: "s"',
      // Simulate partial success: one key created, one error
      createdIssueKeys: ['PROJ-42'],
      createError: 'SL Story: Jira POST failed: 400 — Issue Type is required.',
    });

    render(<PrbWizard actions={actions as never} state={state as never} />);
    // Navigate to review step
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('PROJ-42')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('SL Story');
  });
});
