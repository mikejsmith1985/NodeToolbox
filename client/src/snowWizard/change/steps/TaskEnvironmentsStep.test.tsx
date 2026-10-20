// TaskEnvironmentsStep.test.tsx — Proves the grid shows Business Checkout on PRD and not REL, flips ticks, flags errors, saves defaults.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CrgDraftState, CrgHook } from '../changeDraft.ts';
import { createChangeWizardSession } from '../changeWizardSession.ts';
import { CTASK_ENV_DEFAULTS_STORAGE_KEY, seedCtaskEnvironmentPlan } from '../ctaskEnvironmentPlan.ts';
import TaskEnvironmentsStep from './TaskEnvironmentsStep.tsx';

/** A draft with REL and PRD switched on — all the grid reads. */
const CRG = {
  state: {
    relEnvironment: { isEnabled: true }, prdEnvironment: { isEnabled: true }, pfixEnvironment: { isEnabled: false },
  } as unknown as CrgDraftState,
} as CrgHook;

describe('TaskEnvironmentsStep', () => {
  it('starts Business Checkout on PRD, not REL, and lets either tick change', () => {
    const plan = seedCtaskEnvironmentPlan(['Business Checkout'], ['REL', 'PRD'], {});
    const updateSession = vi.fn();
    render(<TaskEnvironmentsStep crg={CRG} session={createChangeWizardSession('create')} updateSession={updateSession} goToStep={vi.fn()} ctaskEnvironmentPlan={plan} />);
    expect((screen.getByLabelText('Business Checkout on PRD') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Business Checkout on REL') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('Implementation (added by ServiceNow)')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Business Checkout on REL'));
    expect(updateSession).toHaveBeenCalledWith({ ctaskEnvironmentPlan: { 'Business Checkout': { REL: true, PRD: true, PFIX: false } } });
  });

  it('flags a task on no environment, and remembers the ticks as defaults', () => {
    localStorage.clear();
    const plan = { Testing: { REL: false, PRD: false, PFIX: false } };
    render(<TaskEnvironmentsStep crg={CRG} session={createChangeWizardSession('create')} updateSession={vi.fn()} goToStep={vi.fn()} ctaskEnvironmentPlan={plan} />);
    expect(screen.getByText('Testing is not ticked for any environment.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remember these ticks as my defaults' }));
    expect(localStorage.getItem(CTASK_ENV_DEFAULTS_STORAGE_KEY)).toContain('testing');
  });
});
