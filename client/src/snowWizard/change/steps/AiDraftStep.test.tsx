// AiDraftStep.test.tsx — Proves the "Let AI write it" screen offers the prompt, reads a pasted reply, and fills in only
// the ticked fields through the draft's own setters.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CrgHook } from '../changeDraft.ts';
import type { ChangeWizardSession } from '../changeWizardSession.ts';
import AiDraftStep from './AiDraftStep.tsx';

const CHOICE_OPTIONS = { category: [{ value: 'software', label: 'Software' }] };

function buildCrg() {
  const emptyEnvironment = { isEnabled: false, plannedStartDate: '', plannedEndDate: '' };
  const state = {
    fetchedIssues: [], selectedIssueKeys: new Set<string>(),
    generatedShortDescription: '', generatedDescription: '', generatedJustification: '', generatedRiskImpact: '',
    chgPlanningContent: { implementationPlan: '', backoutPlan: '', testPlan: '' },
    chgPlanningAssessment: { impact: '', systemAvailabilityImplication: '', hasBeenTested: '', impactedPersonsAware: '', hasBeenPerformedPreviously: '', successProbability: '', canBeBackedOut: '' },
    chgBasicInfo: { category: '', changeType: '', isExpedited: false, configItem: { displayName: '' }, assignmentGroup: { displayName: '' }, assignedTo: { displayName: '' } },
    relEnvironment: emptyEnvironment, prdEnvironment: emptyEnvironment, pfixEnvironment: emptyEnvironment, changeTasks: [],
  };
  const actions = { updateGeneratedField: vi.fn(), setChgPlanningContent: vi.fn(), setChgBasicInfo: vi.fn(), setChgPlanningAssessment: vi.fn() };
  return { state, actions } as unknown as CrgHook & { actions: typeof actions };
}

function renderStep(crg: CrgHook) {
  render(<AiDraftStep crg={crg} session={{} as ChangeWizardSession} updateSession={vi.fn()} goToStep={vi.fn()} choiceOptions={CHOICE_OPTIONS} />);
}

function pasteReply(replyText: string) {
  fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: replyText } });
  fireEvent.click(screen.getByRole('button', { name: 'Read the reply' }));
}

describe('AiDraftStep', () => {
  it('shows a prompt that asks for the picks and the texts', () => {
    renderStep(buildCrg());
    const promptField = screen.getByLabelText(/Copy this and paste it/) as HTMLTextAreaElement;
    expect(promptField.value).toContain('PICK category: one of Software');
    expect(promptField.value).toContain('IMPLEMENTATION_PLAN:');
  });

  it('fills in only the ticked fields', () => {
    const crg = buildCrg();
    renderStep(crg);
    pasteReply('PICK category: Software\nSHORT_DESCRIPTION: Portal login fix\nDESCRIPTION: Fixes login.');
    fireEvent.click(screen.getByRole('checkbox', { name: /^Description/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Fill in 2 fields' }));

    expect(crg.actions.setChgBasicInfo).toHaveBeenCalledWith({ category: 'software' });
    expect(crg.actions.updateGeneratedField).toHaveBeenCalledWith('shortDescription', 'Portal login fix');
    expect(crg.actions.updateGeneratedField).not.toHaveBeenCalledWith('description', 'Fixes login.');
    expect(screen.getByText(/Filled in 2 fields/)).toBeTruthy();
  });

  it('says plainly when the paste is not the reply, and fills nothing', () => {
    const crg = buildCrg();
    renderStep(crg);
    pasteReply('hello');
    expect(screen.getByText(/does not look like the AI draft/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Fill in/ })).toBeNull();
  });
});
