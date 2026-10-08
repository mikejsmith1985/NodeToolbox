// ExistingChgRiskCheck.test.tsx — Risk-checking an existing CHG and its CTASKs in one pass, and fixing both (GH #395).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchChangeJiraStories } from '../chgFormula/changeJiraStories.ts';
import { fetchChangeAttachmentFileNames, fetchReviewedCtasks, saveCtaskFix } from '../chgFormula/ctaskReviewApi.ts';
import type { ReviewedCtask } from '../chgFormula/ctaskReviewRecord.ts';
import { useAiAssist } from '../hooks/useAiAssist.ts';
import { ExistingChgRiskCheck } from './ExistingChgRiskCheck.tsx';

vi.mock('../chgFormula/ctaskReviewApi.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chgFormula/ctaskReviewApi.ts')>()),
  fetchReviewedCtasks: vi.fn(),
  fetchChangeAttachmentFileNames: vi.fn(),
  saveCtaskFix: vi.fn(),
}));
vi.mock('../chgFormula/changeJiraStories.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chgFormula/changeJiraStories.ts')>()),
  fetchChangeJiraStories: vi.fn(),
}));
vi.mock('../hooks/useAiAssist.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useAiAssist.ts')>()),
  useAiAssist: vi.fn(),
}));

const CHANGE_CI = { sysId: 'ci-recon', displayName: 'Recon Service' };
const FIELD_VALUES = {
  shortDescription: 'Recon | deploy v1.5 | REL',
  description: 'Deploys v1.5.',
  justification: 'Fixes LIS mismatch.',
  riskImpact: 'Low.',
  implementationPlan: 'Run pipeline.',
  testPlan: 'Smoke test.',
  backoutPlan: 'Redeploy v1.4.',
};

const MISALIGNED_TASK: ReviewedCtask = {
  sysId: 'task-1',
  number: 'CTASK0012345',
  shortDescription: 'Deploy recon service',
  description: 'Run the pipeline.',
  typeLabel: 'Implementation',
  isImplementation: true,
  configItem: { sysId: 'ci-other', displayName: 'Billing' },
  assignedTo: { sysId: 'usr-1', displayName: 'Jane Smith' },
  assignmentGroup: { sysId: 'grp-1', displayName: 'Platform Team' },
  backoutPlan: 'Revert.',
  backoutFieldName: 'u_backout_plan',
};

function renderPanel(onApplyChangeFields = vi.fn(() => 1), fieldValues = FIELD_VALUES) {
  render(
    <ExistingChgRiskCheck
      changeConfigItem={CHANGE_CI}
      changeSysId="chg-1"
      fieldValues={fieldValues}
      onApplyChangeFields={onApplyChangeFields}
      promptContext={{
        categoryLabel: 'Software', changeTypeLabel: 'Normal', isExpedited: false, configItemLabel: 'Recon Service',
        assignmentGroupLabel: 'Cleanup Crew', changeOwnerLabel: 'Smith, Mike', environmentLines: [], assessmentLines: [],
        changeTaskLines: [],
      }}
    />,
  );
  return onApplyChangeFields;
}

/** Opens the AI round behind a button, pastes a reply into the modal and uses it. */
function pasteReply(buttonName: RegExp, replyText: string, useButtonName: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
  fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: replyText } });
  fireEvent.click(screen.getByRole('button', { name: useButtonName }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
}

describe('ExistingChgRiskCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchReviewedCtasks).mockResolvedValue([MISALIGNED_TASK]);
    vi.mocked(saveCtaskFix).mockResolvedValue(undefined);
    vi.mocked(fetchChangeJiraStories).mockResolvedValue([]);
    vi.mocked(fetchChangeAttachmentFileNames).mockResolvedValue([]);
    vi.mocked(useAiAssist).mockReturnValue({ isUnlocked: true } as ReturnType<typeof useAiAssist>);
  });

  it('reads the change\'s tasks and flags a task on another CI, with no AI needed', async () => {
    vi.mocked(useAiAssist).mockReturnValue({ isUnlocked: false } as ReturnType<typeof useAiAssist>);
    renderPanel();

    expect(await screen.findByText(/CTASK0012345 · Configuration item/)).toBeInTheDocument();
    expect(fetchReviewedCtasks).toHaveBeenCalledWith('chg-1');
    expect(screen.queryByRole('button', { name: /Risk check CHG \+ CTASKs/ })).not.toBeInTheDocument();
  });

  it('reads the Jira stories the change names and gives them to the risk check (GH #415)', async () => {
    vi.mocked(fetchChangeJiraStories).mockResolvedValue([
      { key: 'ENCUC-77', fields: { summary: 'Fix recon totals', description: 'Affects 300 enrolled members.' } },
    ] as Awaited<ReturnType<typeof fetchChangeJiraStories>>);
    renderPanel(undefined, { ...FIELD_VALUES, description: 'Deploys v1.5 for ENCUC-77.' });

    expect(await screen.findByText(/Read 1 Jira story named in the change: ENCUC-77/)).toBeInTheDocument();
    expect(fetchChangeJiraStories).toHaveBeenCalledWith(['ENCUC-77']);

    fireEvent.click(screen.getByRole('button', { name: /Risk check CHG \+ CTASKs/ }));
    expect(screen.getByDisplayValue(/Jira work this change delivers[\s\S]*Description: Affects 300 enrolled members\./))
      .toBeInTheDocument();
  });

  it('gives the risk check the files on the change and each task\'s estimated minutes (GH #415)', async () => {
    vi.mocked(fetchChangeAttachmentFileNames).mockResolvedValue(['CHG0012345-test-evidence.zip']);
    vi.mocked(fetchReviewedCtasks).mockResolvedValue([{
      ...MISALIGNED_TASK,
      description: 'Run the pipeline.\nImplementation: 30 minutes\nPost-deployment validation/monitoring: 20 minutes',
    }]);
    renderPanel();
    await screen.findByText(/CTASK0012345 · Configuration item/);
    await waitFor(() => expect(fetchChangeAttachmentFileNames).toHaveBeenCalledWith('chg-1'));

    fireEvent.click(screen.getByRole('button', { name: /Risk check CHG \+ CTASKs/ }));

    expect(screen.getByDisplayValue(/Files attached to the change:\s+CHG0012345-test-evidence\.zip/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/CTASK0012345 — [^\n]*implementation 30 min, validation 20 min, backout \? min/))
      .toBeInTheDocument();
  });

  it('settles the team\'s standing answers and the CTASK durations itself, whatever the review asks (GH #415)', async () => {
    vi.mocked(fetchReviewedCtasks).mockResolvedValue([{
      ...MISALIGNED_TASK,
      configItem: CHANGE_CI,
      description: 'Run the pipeline.\nImplementation: 30 minutes',
    }]);
    renderPanel();
    await screen.findByText(/CTASK checks pass/);

    fireEvent.click(screen.getByRole('button', { name: /Risk check CHG \+ CTASKs/ }));
    expect(screen.getByDisplayValue(/Team standards[\s\S]*Estimated durations \(the CTASK estimates added up\): implementation 30 min/))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    pasteReply(/Risk check CHG \+ CTASKs/, [
      'INFO | Bridge or Command Center — What bridge will be used?',
      'INFO | Implementation Duration — How long will it take?',
      'INFO | Business Validation — Who validates?',
      'VERDICT: NOT READY — no text gaps.',
    ].join('\n'), /Use this review/);

    expect(await screen.findByLabelText(/Answer for Business Validation/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Answer for Bridge or Command Center/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Answer for Implementation Duration/)).not.toBeInTheDocument();
  });

  it('sets a misaligned task\'s CI to the change\'s in ServiceNow, then reads the tasks again', async () => {
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Set CI to Recon Service on 1 task/ }));

    await waitFor(() => expect(saveCtaskFix).toHaveBeenCalledWith(MISALIGNED_TASK, { configItemSysId: 'ci-recon' }));
    await waitFor(() => expect(fetchReviewedCtasks).toHaveBeenCalledTimes(2));
  });

  it('checks the change and its tasks in one prompt and shows one review with the CI rule folded in', async () => {
    renderPanel();
    await screen.findByText(/CTASK0012345 · Configuration item/);

    fireEvent.click(screen.getByRole('button', { name: /Risk check CHG \+ CTASKs/ }));
    expect(screen.getByDisplayValue(/CTASK0012345 — Deploy recon service/)).toBeInTheDocument();
    // The task's assignee is who deploys it — given as a record fact, never asked for (GH #415).
    expect(screen.getByDisplayValue(/CTASK0012345 — Deploy recon service \(Implementation\) — assigned to Jane Smith \(group: Platform Team\)/))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    pasteReply(/Risk check CHG \+ CTASKs/, 'PASS | Backout Plan — clear.\nGAP | CTASK0012345 · Backout plan — only says Revert. — Fix: name the steps.\nVERDICT: NOT READY — 1 gap(s).', /Use this review/);

    expect(await screen.findByText(/NOT READY — 2 gap/)).toBeInTheDocument();
  });

  it('applies a fix round to the change fields and stages the task\'s new backout plan to write', async () => {
    const onApplyChangeFields = renderPanel();
    await screen.findByText(/CTASK0012345 · Configuration item/);
    pasteReply(/Risk check CHG \+ CTASKs/, 'GAP | Backout Plan — no timing. — Fix: add timing.\nGAP | CTASK0012345 · Backout plan — only says Revert.\nVERDICT: NOT READY — 2 gap(s).', /Use this review/);

    pasteReply(/Fix these gaps/, 'BACKOUT_PLAN:\nRedeploy v1.4 within 15 minutes.\nCTASK0012345_BACKOUT_PLAN:\n1. Stop the job.\n2. Redeploy v1.4.', /Apply/);

    expect(onApplyChangeFields).toHaveBeenCalledWith({ backoutPlan: 'Redeploy v1.4 within 15 minutes.' });
    fireEvent.click(await screen.findByRole('button', { name: /Write 1 CTASK fix to ServiceNow/ }));
    await waitFor(() => expect(saveCtaskFix).toHaveBeenCalledWith(MISALIGNED_TASK, { backoutPlan: '1. Stop the job.\n2. Redeploy v1.4.' }));
  });
});

describe('ExistingChgRiskCheck — questions for the owner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchReviewedCtasks).mockResolvedValue([]);
    vi.mocked(useAiAssist).mockReturnValue({ isUnlocked: true } as ReturnType<typeof useAiAssist>);
  });

  it('re-checks a question on Check again instead of offering an AI rewrite', async () => {
    renderPanel();
    await waitFor(() => expect(fetchReviewedCtasks).toHaveBeenCalled());
    pasteReply(/Risk check CHG \+ CTASKs/, 'PASS | Short Description — Clear.\nINFO | Support Coverage — Who is on call?\nVERDICT: NOT READY — 0 gap(s).', /Use this review/);

    expect(screen.queryByRole('button', { name: /Fix these gaps/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Check again/ }));

    expect(await screen.findByDisplayValue(/re-checking specific gaps[\s\S]*Support Coverage/)).toBeInTheDocument();
  });

  it('sends the owner\'s answers to the fix round', async () => {
    renderPanel();
    await waitFor(() => expect(fetchReviewedCtasks).toHaveBeenCalled());
    pasteReply(/Risk check CHG \+ CTASKs/, 'INFO | Support Coverage — Who is on call?\nVERDICT: NOT READY — no text gaps; 1 fact needed from you.', /Use this review/);

    fireEvent.change(screen.getByLabelText('Answer for Support Coverage'), { target: { value: 'Jordan Lee, PagerDuty' } });
    fireEvent.click(screen.getByRole('button', { name: /Fix these gaps with AI Assist \(using 1 answer\)/ }));

    expect(screen.getByDisplayValue(/Write in the owner's answer: Jordan Lee, PagerDuty/)).toBeInTheDocument();
  });
});
