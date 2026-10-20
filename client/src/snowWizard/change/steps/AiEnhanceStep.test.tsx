// AiEnhanceStep.test.tsx — Proves step 6 shows the same open checks as step 9, asks the AI to fix exactly that writing,
// and applies each change in place without leaving the step.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReadinessItem } from '../../../views/SnowHub/guided/changeReadiness.ts';
import type { CrgHook } from '../changeDraft.ts';
import { createChangeWizardSession } from '../changeWizardSession.ts';
import AiEnhanceStep from './AiEnhanceStep.tsx';

const BACKOUT_GAP: ReadinessItem = {
  id: 'formulaBackout', label: 'Formula Card 7: Backout', state: 'needsAction', reason: 'Backout Plan has no trigger.',
  action: { kind: 'openStep', stepId: 'changeText', label: 'Write the Backout Plan', focusField: 'backoutPlan' },
};
const DATES_GAP: ReadinessItem = {
  id: 'ctaskDates', label: 'Task dates', state: 'needsAction', reason: 'Deploy has no dates.',
  action: { kind: 'openStep', stepId: 'ctaskTimeline', label: 'Set the task dates' },
};
const DONE_OWNER: ReadinessItem = { id: 'owner', label: 'Change owner', state: 'done', reason: 'Owned by Pat.', action: null };

function buildCrg() {
  const emptyEnvironment = { isEnabled: false, plannedStartDate: '', plannedEndDate: '' };
  const state = {
    fetchedIssues: [], selectedIssueKeys: new Set<string>(),
    generatedShortDescription: 'Portal fix', generatedDescription: 'Fix it.', generatedJustification: '', generatedRiskImpact: '',
    chgPlanningContent: { implementationPlan: '1. Deploy', backoutPlan: 'Undo', testPlan: '' },
    chgPlanningAssessment: { impact: '', systemAvailabilityImplication: '', hasBeenTested: '', impactedPersonsAware: '', hasBeenPerformedPreviously: '', successProbability: '', canBeBackedOut: '' },
    chgBasicInfo: { category: '', changeType: '', isExpedited: false, configItem: { displayName: '' }, assignmentGroup: { displayName: '' }, assignedTo: { displayName: '' } },
    relEnvironment: emptyEnvironment, prdEnvironment: emptyEnvironment, pfixEnvironment: emptyEnvironment, changeTasks: [],
  };
  const actions = { updateGeneratedField: vi.fn(), setChgPlanningContent: vi.fn() };
  return { state, actions } as unknown as CrgHook & { actions: typeof actions };
}

function renderStep(items: ReadinessItem[] | null, crg = buildCrg(), goToStep = vi.fn()) {
  render(<AiEnhanceStep crg={crg} session={createChangeWizardSession('create')} updateSession={vi.fn()} goToStep={goToStep} items={items} />);
  return { crg, goToStep };
}

describe('AiEnhanceStep', () => {
  it('lists the same open checks as step 9 and asks the AI to fix exactly the flagged writing', () => {
    renderStep([DONE_OWNER, BACKOUT_GAP]);
    expect(screen.getByText(/Formula Card 7: Backout: Backout Plan has no trigger\./)).toBeTruthy();
    const promptField = screen.getByLabelText(/Copy this and paste it/) as HTMLTextAreaElement;
    expect(promptField.value).toContain('Backout Plan has no trigger.');
    expect(screen.queryByText(/ready for approval/i)).toBeNull();
  });

  it('applies every change in place with one button, never leaving the step', () => {
    const { crg, goToStep } = renderStep([BACKOUT_GAP]);
    fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: 'BACKOUT_PLAN: 1. If login fails, redeploy v1\n2. Confirm login' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read the reply' }));
    expect(screen.getByText('Undo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 field' }));
    expect(crg.actions.setChgPlanningContent).toHaveBeenCalledWith({ backoutPlan: '1. If login fails, redeploy v1\n2. Confirm login' });
    expect(goToStep).not.toHaveBeenCalled();
  });

  it('offers a direct button for a check that needs a value rather than writing', () => {
    const { goToStep } = renderStep([DATES_GAP]);
    fireEvent.click(screen.getByRole('button', { name: /Task dates →/ }));
    expect(goToStep).toHaveBeenCalledWith('tasks');
  });

  it('says so plainly when every check passes', () => {
    renderStep([DONE_OWNER]);
    expect(screen.getByText('Every check passes. Press Next to go on.')).toBeTruthy();
  });
});
