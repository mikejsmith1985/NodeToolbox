// RiskCheckSection.test.tsx — Proves Toolbox's Risk Check opens on the real ticket: the Production change first, with that
// change's own configuration item, and the change the user picks; and that fixes it returns land in the draft.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CrgDraftState, CrgHook } from '../changeDraft.ts';
import { createChangeWizardSession, type ChangeWizardSession } from '../changeWizardSession.ts';
import { fetchChangeForModify } from '../modifyLoad.ts';
import RiskCheckSection from './RiskCheckSection.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../modifyLoad.ts', () => ({ fetchChangeForModify: vi.fn(async (changeNumber: string) => ({ changeSysId: `sys-${changeNumber}` })) }));
const { roundClosed } = vi.hoisted(() => ({ roundClosed: vi.fn() }));
/** A round as Toolbox's Risk Check hands it over: a reply saying USE is used, any other is refused. */
const FAKE_SESSION = {
  instructions: 'Fix the gaps.', promptText: 'PROMPT', applyButtonLabel: 'Apply the fixes',
  applyReply: (replyText: string) => (replyText === 'USE' ? { statusMessage: 'Applied 2 fixes.', wasApplied: true } : { statusMessage: 'Nothing usable.', wasApplied: false }),
};
// Toolbox's own component is proven by Toolbox's tests; here only what the Wizard hands it is checked.
vi.mock('../../../views/SnowHub/tabs/ExistingChgRiskCheck.tsx', () => ({
  ExistingChgRiskCheck: (props: {
    changeSysId: string; changeConfigItem: { sysId: string }; isProduction: boolean; onApplyChangeFields: (fields: Record<string, string>) => number;
    renderPromptSession?: (session: typeof FAKE_SESSION, onClose: () => void) => unknown;
  }) => (
    <div>
      <p>{`Risk check on ${props.changeSysId} with ${props.changeConfigItem.sysId}${props.isProduction ? ' (production)' : ''}`}</p>
      <button type="button" onClick={() => props.onApplyChangeFields({ backoutPlan: '1. Redeploy v1' })}>Apply fix</button>
      {props.renderPromptSession ? (props.renderPromptSession(FAKE_SESSION, roundClosed) as never) : null}
    </div>
  ),
}));

function buildCrg(): CrgHook & { actions: { setChgPlanningContent: ReturnType<typeof vi.fn> } } {
  const environment = (sysId: string) => ({ isEnabled: true, plannedStartDate: '', plannedEndDate: '', configItem: { sysId, displayName: sysId } });
  return {
    state: {
      fetchedIssues: [], selectedIssueKeys: new Set<string>(), generatedShortDescription: 'Payments', generatedDescription: '', generatedJustification: '', generatedRiskImpact: '',
      chgPlanningContent: { implementationPlan: '', backoutPlan: '', testPlan: '' }, chgPlanningAssessment: {},
      chgBasicInfo: { category: '', changeType: '', isExpedited: false, configItem: { sysId: 'ci-main', displayName: '' }, assignmentGroup: { displayName: '' }, assignedTo: { displayName: '' } },
      relEnvironment: environment('ci-rel'), prdEnvironment: environment('ci-prd'), pfixEnvironment: { isEnabled: false, configItem: { sysId: '' } }, changeTasks: [],
    } as unknown as CrgDraftState,
    actions: { updateGeneratedField: vi.fn(), setChgPlanningContent: vi.fn() },
  } as unknown as CrgHook & { actions: { setChgPlanningContent: ReturnType<typeof vi.fn> } };
}

describe('RiskCheckSection', () => {
  it('waits for the real ticket before a new change is created', () => {
    render(<RiskCheckSection crg={buildCrg()} session={createChangeWizardSession('create')} />);
    expect(screen.getByText(/runs on the real ticket, once your change is in ServiceNow/)).toBeTruthy();
  });

  it('opens on the Production change first with its own item, switches change on request, and applies fixes to the draft', async () => {
    const crg = buildCrg();
    const session: ChangeWizardSession = { ...createChangeWizardSession('create'), createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }] };
    render(<RiskCheckSection crg={crg} session={session} />);
    expect(await screen.findByText('Risk check on sys-CHG2 with ci-prd (production)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply fix' }));
    expect(crg.actions.setChgPlanningContent).toHaveBeenCalledWith({ backoutPlan: '1. Redeploy v1' });
    fireEvent.change(screen.getByLabelText('Check which change?'), { target: { value: 'CHG1' } });
    await waitFor(() => expect(screen.getByText('Risk check on sys-CHG1 with ci-rel')).toBeTruthy());
    expect(fetchChangeForModify).toHaveBeenCalledWith('CHG1');
  });

  it('runs on the change a modify loaded, using the id it already holds', () => {
    const session: ChangeWizardSession = { ...createChangeWizardSession('modify'), modify: { changeNumber: 'CHG9', stateLabel: 'New', loadedSnapshot: {}, loadedStepValues: {}, existingTaskNames: [], changeSysId: 'sys-9' } };
    render(<RiskCheckSection crg={buildCrg()} session={session} />);
    expect(screen.getByText('Risk check on sys-9 with ci-rel')).toBeTruthy();
  });

  describe('an AI round, drawn on the page', () => {
    function openOnModify() {
      const session: ChangeWizardSession = { ...createChangeWizardSession('modify'), modify: { changeNumber: 'CHG9', changeSysId: 'sys-9' } as ChangeWizardSession['modify'] };
      render(<RiskCheckSection crg={buildCrg()} session={session} />);
    }

    it('closes itself once a reply is used, keeping what it did on the page', () => {
      roundClosed.mockClear();
      openOnModify();
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: 'USE' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply the fixes' }));
      expect(roundClosed).toHaveBeenCalledTimes(1);
      expect(screen.getAllByText('Applied 2 fixes.').length).toBeGreaterThan(0);
    });

    it('stays open with the reason when the reply cannot be used, and closes on request', () => {
      roundClosed.mockClear();
      openOnModify();
      fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: 'nonsense' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply the fixes' }));
      expect(roundClosed).not.toHaveBeenCalled();
      expect(screen.getByText('Nothing usable.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Close this round' }));
      expect(roundClosed).toHaveBeenCalledTimes(1);
    });
  });
});
