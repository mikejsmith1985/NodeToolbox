// EnvironmentsStep.test.tsx — Proves environments are ticked with their windows, and the ServiceNow value is picked automatically.

import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { readEnvironmentProblems } from '../changeDraft.ts';
import { createChangeWizardSession } from '../changeWizardSession.ts';
import EnvironmentsStep from './EnvironmentsStep.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const CHOICES = { u_environment: [{ value: 'prod', label: 'Production' }] };

/** What the harness last rendered, written after each render (never during it). */
const observed = { latestProblems: [] as string[] };

function Harness() {
  const crg = useCrgState({ storageKey: 'snowWizard:change:environments-test' });
  useEffect(() => { observed.latestProblems = readEnvironmentProblems(crg.state); });
  return <EnvironmentsStep crg={crg} session={createChangeWizardSession('create')} updateSession={vi.fn()} goToStep={vi.fn()} choiceOptions={CHOICES} />;
}

describe('EnvironmentsStep', () => {
  it('shows the window fields once an environment is ticked, and clears the problems when both dates are set', () => {
    render(<Harness />);
    expect(observed.latestProblems).toEqual(['Tick at least one environment.']);
    fireEvent.click(screen.getByLabelText('PRD — Production'));
    fireEvent.change(screen.getByLabelText('PRD starts'), { target: { value: '2026-11-02T19:00' } });
    fireEvent.change(screen.getByLabelText('PRD ends'), { target: { value: '2026-11-02T21:00' } });
    expect(observed.latestProblems).toEqual([]);
    expect(screen.getByText(/automatic: Production/)).toBeTruthy();
  });
});
