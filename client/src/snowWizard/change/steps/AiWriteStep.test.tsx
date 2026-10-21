// AiWriteStep.test.tsx — Proves the one AI step shows part 1 (write) open until the plans exist, then part 2 (pass review).

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReadinessItem } from '../../../views/SnowHub/guided/changeReadiness.ts';
import type { CrgHook } from '../changeDraft.ts';
import { createChangeWizardSession } from '../changeWizardSession.ts';
import AiWriteStep from './AiWriteStep.tsx';

const DONE_OWNER: ReadinessItem = { id: 'owner', label: 'Change owner', state: 'done', reason: 'Owned by Pat.', action: null };

function buildCrg(plans: { implementationPlan: string; backoutPlan: string; testPlan: string }) {
  const emptyEnvironment = { isEnabled: false, plannedStartDate: '', plannedEndDate: '' };
  const state = {
    fetchedIssues: [], selectedIssueKeys: new Set<string>(), generatedShortDescription: 'Portal fix', generatedDescription: '', generatedJustification: '', generatedRiskImpact: '',
    chgPlanningContent: plans,
    chgPlanningAssessment: { impact: '', systemAvailabilityImplication: '', hasBeenTested: '', impactedPersonsAware: '', hasBeenPerformedPreviously: '', successProbability: '', canBeBackedOut: '' },
    chgBasicInfo: { category: '', changeType: '', isExpedited: false, configItem: { displayName: '' }, assignmentGroup: { displayName: '' }, assignedTo: { displayName: '' } },
    relEnvironment: emptyEnvironment, prdEnvironment: emptyEnvironment, pfixEnvironment: emptyEnvironment, changeTasks: [],
  };
  return { state, actions: { updateGeneratedField: vi.fn(), setChgPlanningContent: vi.fn() } } as unknown as CrgHook;
}

function renderStep(crg: CrgHook) {
  render(<AiWriteStep crg={crg} session={createChangeWizardSession('create')} updateSession={vi.fn()} goToStep={vi.fn()} choiceOptions={{}} items={[DONE_OWNER]} createdChangeLines={['REL change CHG1 — tasks: none']} />);
}

describe('AiWriteStep', () => {
  it('opens part 1 while the plans are empty, and asks for it before the checks', () => {
    renderStep(buildCrg({ implementationPlan: '', backoutPlan: '', testPlan: '' }));
    expect(screen.getByText('1 · AI writes it')).toBeTruthy();
    expect((screen.getByLabelText(/Copy this and paste it/) as HTMLTextAreaElement).value).toContain('REL change CHG1');
    expect(screen.getByText(/Do part 1 first/)).toBeTruthy();
  });

  it('folds part 1 once the plans exist and shows the same checks Release Management makes', () => {
    renderStep(buildCrg({ implementationPlan: '1. Deploy', backoutPlan: '1. Undo', testPlan: '1. Smoke' }));
    expect(screen.getByText('1 · AI writes it ✓ (open to write it again)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '2 · Make it pass review' })).toBeTruthy();
    expect(screen.getByText('Every check passes. Press Next to go on.')).toBeTruthy();
  });
});
