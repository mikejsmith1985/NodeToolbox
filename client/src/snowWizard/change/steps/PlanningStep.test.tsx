// PlanningStep.test.tsx — Proves Planning writes the three plans and the answers from ServiceNow's lists, in plain words.

import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { readPlanningGaps } from '../changeDraft.ts';
import { createChangeWizardSession } from '../changeWizardSession.ts';
import PlanningStep from './PlanningStep.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const CHOICES = { impact: [{ value: '3', label: '3 - Low' }] };

/** What the harness last rendered, written after each render (never during it). */
const observed = { latestImpact: '', latestGaps: [] as string[] };

function Harness() {
  const crg = useCrgState({ storageKey: 'snowWizard:change:planning-test' });
  useEffect(() => { observed.latestImpact = crg.state.chgPlanningAssessment.impact; observed.latestGaps = readPlanningGaps(crg.state); });
  return <PlanningStep crg={crg} session={createChangeWizardSession('create')} updateSession={vi.fn()} goToStep={vi.fn()} choiceOptions={CHOICES} />;
}

describe('PlanningStep', () => {
  it('writes each plan and an answer picked from ServiceNow\'s list', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Implementation plan'), { target: { value: '1. Deploy' } });
    fireEvent.change(screen.getByLabelText('Backout plan'), { target: { value: '1. Roll back' } });
    fireEvent.change(screen.getByLabelText('How many people does it affect?'), { target: { value: '3' } });
    expect(observed.latestGaps).toEqual(['the test plan']);
    expect(observed.latestImpact).toBe('3');
  });

  it('asks the questions first and holds no AI round of its own — AI writes once, later (GH #468)', () => {
    render(<Harness />);
    expect(screen.queryByLabelText(/Paste the assistant/)).toBeNull();
    expect(screen.getByText(/AI writes them on “Let AI write it”/)).toBeTruthy();
    expect(screen.getByText('Write the plans yourself (optional)')).toBeTruthy();
  });

  it('never shows an internal field name', () => {
    render(<Harness />);
    expect(document.body.textContent).not.toMatch(/u_[a-z]|cmdb_ci|customfield_|sys_id/);
  });
});
