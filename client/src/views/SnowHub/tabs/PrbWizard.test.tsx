// PrbWizard.test.tsx — Behavioural tests for the four-step PRB wizard UI.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PrbWizard from './PrbWizard.tsx';

interface PrbStateOverrides {
  prbNumber?: string;
  prbData?: unknown;
  jiraProjectKey?: string;
  defectSummaryTemplate?: string;
  storySummaryTemplate?: string;
  createdIssueKeys?: string[];
  fetchError?: string | null;
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
    jiraProjectKey: overrides.jiraProjectKey ?? '',
    defectSummaryTemplate: overrides.defectSummaryTemplate ?? '',
    storySummaryTemplate: overrides.storySummaryTemplate ?? '',
    isCreatingIssues: overrides.isCreatingIssues ?? false,
    createError: overrides.createError ?? null,
    createdIssueKeys: overrides.createdIssueKeys ?? [],
  };
  const actions = {
    setPrbNumber: vi.fn(),
    fetchPrb: vi.fn().mockResolvedValue(undefined),
    setJiraProjectKey: vi.fn(),
    setDefectSummary: vi.fn(),
    setStorySummary: vi.fn(),
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
      prbData: { number: 'PRB0001234', shortDescription: 'foo', description: 'bar', state: 'Open', severity: '2', assignedTo: null, sysId: 'x' },
    });

    render(<PrbWizard actions={actions as never} state={state as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText(/Step 2 of 4: Defect/)).toBeInTheDocument();
  });

  it('disables Next on step two until project key and defect summary are filled', () => {
    const initial = buildFakePrbHook({
      prbData: { number: 'PRB1', shortDescription: 's', description: 'd', state: 'Open', severity: '2', assignedTo: null, sysId: 'x' },
    });

    const { rerender } = render(<PrbWizard actions={initial.actions as never} state={initial.state as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);

    const filled = buildFakePrbHook({
      prbData: initial.state.prbData,
      jiraProjectKey: 'PROJ',
      defectSummaryTemplate: 'Defect: foo',
    });
    rerender(<PrbWizard actions={filled.actions as never} state={filled.state as never} />);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Back returns the user to a prior step', () => {
    const { state, actions } = buildFakePrbHook({
      prbData: { number: 'PRB1', shortDescription: 's', description: 'd', state: 'Open', severity: '2', assignedTo: null, sysId: 'x' },
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

  it('renders the Review step with summary values and a Create Jira Issues button', () => {
    const { state, actions } = buildFakePrbHook({
      prbData: { number: 'PRB1', shortDescription: 's', description: 'd', state: 'Open', severity: '2', assignedTo: null, sysId: 'x' },
      jiraProjectKey: 'PROJ',
      defectSummaryTemplate: 'Defect: foo',
      storySummaryTemplate: 'Story: foo',
    });

    render(<PrbWizard actions={actions as never} state={state as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText(/Step 4 of 4: Review/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Jira Issues' }));
    expect(actions.createJiraIssues).toHaveBeenCalled();
  });
});
