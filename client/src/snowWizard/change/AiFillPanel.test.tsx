// AiFillPanel.test.tsx — Proves the AI round is offered on a typing screen, open while fields are still empty.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AiFillPanel from './AiFillPanel.tsx';
import type { CrgHook } from './changeDraft.ts';
import type { ChangeWizardSession } from './changeWizardSession.ts';

function buildCrg(): CrgHook {
  const emptyEnvironment = { isEnabled: false, plannedStartDate: '', plannedEndDate: '' };
  return {
    state: {
      fetchedIssues: [], selectedIssueKeys: new Set<string>(),
      generatedShortDescription: '', generatedDescription: '', generatedJustification: '', generatedRiskImpact: '',
      chgPlanningContent: { implementationPlan: '', backoutPlan: '', testPlan: '' },
      chgPlanningAssessment: { impact: '', systemAvailabilityImplication: '', hasBeenTested: '', impactedPersonsAware: '', hasBeenPerformedPreviously: '', successProbability: '', canBeBackedOut: '' },
      chgBasicInfo: { category: '', changeType: '', isExpedited: false, configItem: { displayName: '' }, assignmentGroup: { displayName: '' }, assignedTo: { displayName: '' } },
      relEnvironment: emptyEnvironment, prdEnvironment: emptyEnvironment, pfixEnvironment: emptyEnvironment, changeTasks: [],
    },
    actions: {},
  } as unknown as CrgHook;
}

function renderPanel(isOpenAtStart: boolean) {
  const { container } = render(
    <AiFillPanel isOpenAtStart={isOpenAtStart} crg={buildCrg()} session={{} as ChangeWizardSession} updateSession={vi.fn()} goToStep={vi.fn()} choiceOptions={{}} />,
  );
  return container.querySelector('details') as HTMLDetailsElement;
}

describe('AiFillPanel', () => {
  it('offers the AI round with its prompt, open while fields are empty', () => {
    const panel = renderPanel(true);
    expect(screen.getByText(/Let AI write it/)).toBeTruthy();
    expect(panel.open).toBe(true);
    expect((screen.getByLabelText(/Copy this and paste it/) as HTMLTextAreaElement).value).toContain('IMPLEMENTATION_PLAN:');
  });

  it('stays folded once the screen is filled in', () => {
    expect(renderPanel(false).open).toBe(false);
  });
});
