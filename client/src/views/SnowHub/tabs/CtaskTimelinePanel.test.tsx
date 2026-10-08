// CtaskTimelinePanel.test.tsx — Planning the CTASK timeline with AI Assist and writing the dates (Modify).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchReviewedCtasks, saveCtaskPlannedDates } from '../chgFormula/ctaskReviewApi.ts';
import type { ReviewedCtask } from '../chgFormula/ctaskReviewRecord.ts';
import { useAiAssist } from '../hooks/useAiAssist.ts';
import { CtaskTimelinePanel } from './CtaskTimelinePanel.tsx';

vi.mock('../chgFormula/ctaskReviewApi.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chgFormula/ctaskReviewApi.ts')>()),
  fetchReviewedCtasks: vi.fn(),
  saveCtaskPlannedDates: vi.fn(),
}));
vi.mock('../hooks/useAiAssist.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useAiAssist.ts')>()),
  useAiAssist: vi.fn(),
}));

const BASE_TASK: ReviewedCtask = {
  sysId: 'task-1', number: 'CTASK0000001', shortDescription: 'Deploy recon', description: 'Run the pipeline.',
  typeLabel: 'Implementation', isImplementation: true, configItem: { sysId: 'ci-1', displayName: 'Recon' },
  assignedTo: { sysId: 'usr-1', displayName: 'Jane Smith' }, assignmentGroup: { sysId: 'grp-1', displayName: 'Platform' },
  backoutPlan: 'Redeploy.', backoutFieldName: 'u_backout_plan',
};
const CHECKOUT_TASK: ReviewedCtask = {
  ...BASE_TASK, sysId: 'task-2', number: 'CTASK0000002', shortDescription: 'Review Technical Checkout', typeLabel: 'Review', isImplementation: false,
};
const WINDOW = { startUtc: '2026-10-10T05:00', endUtc: '2026-10-10T07:00' };

/** A UTC form date-time as this machine's wall clock, "YYYY-MM-DD HH:mm" — what the panel shows. */
function localTimeFor(formDateTimeUtc: string): string {
  const instant = new Date(`${formDateTimeUtc}:00Z`);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())} ${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
}

/** Opens the planning round (which reads the tasks), pastes a timeline and uses it. */
async function pasteTimeline(replyText: string) {
  fireEvent.click(screen.getByRole('button', { name: /Plan the CTASK timeline with AI Assist/ }));
  fireEvent.change(await screen.findByLabelText(/Paste the assistant/), { target: { value: replyText } });
  fireEvent.click(screen.getByRole('button', { name: 'Use this timeline' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
}

describe('CtaskTimelinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchReviewedCtasks).mockResolvedValue([CHECKOUT_TASK, BASE_TASK]);
    vi.mocked(saveCtaskPlannedDates).mockResolvedValue(undefined);
    vi.mocked(useAiAssist).mockReturnValue({ isUnlocked: true } as ReturnType<typeof useAiAssist>);
  });

  it('dates the tasks back to back in stage order and writes them to ServiceNow', async () => {
    render(<CtaskTimelinePanel changeSysId="chg-1" changeWindow={WINDOW} />);
    // Nothing is read until planning starts.
    expect(fetchReviewedCtasks).not.toHaveBeenCalled();

    await pasteTimeline('TIMELINE:\nCTASK0000002 | 20\nCTASK0000001 | 45');

    expect(await screen.findByText(new RegExp(`CTASK0000001 · ${localTimeFor('2026-10-10T05:00')} → ${localTimeFor('2026-10-10T05:45')} \\(45 min\\)`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`CTASK0000002 · ${localTimeFor('2026-10-10T05:45')} → ${localTimeFor('2026-10-10T06:05')} \\(20 min\\)`))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Write CTASK dates to ServiceNow' }));

    await waitFor(() => expect(saveCtaskPlannedDates).toHaveBeenCalledWith(BASE_TASK, '2026-10-10T05:00', '2026-10-10T05:45'));
    expect(saveCtaskPlannedDates).toHaveBeenCalledWith(CHECKOUT_TASK, '2026-10-10T05:45', '2026-10-10T06:05');
    expect(await screen.findByText(/Wrote planned dates to 2 CTASKs/)).toBeInTheDocument();
  });

  it('warns when the timeline runs past the change\'s planned end, and when a task was left out', async () => {
    render(<CtaskTimelinePanel changeSysId="chg-1" changeWindow={WINDOW} />);

    await pasteTimeline('TIMELINE:\nCTASK0000001 | 150');

    expect(await screen.findByText(/runs past the change's planned end/)).toBeInTheDocument();
    expect(screen.getByText(/The reply left out CTASK0000002/)).toBeInTheDocument();
  });

  it('shows ServiceNow\'s own reason when it refuses a task\'s dates', async () => {
    vi.mocked(saveCtaskPlannedDates).mockImplementation(async (ctask) => {
      if (ctask.number === 'CTASK0000001') throw new Error('Data Policy Exception: Planned start date must be within the change window');
    });
    render(<CtaskTimelinePanel changeSysId="chg-1" changeWindow={WINDOW} />);
    await pasteTimeline('TIMELINE:\nCTASK0000001 | 45\nCTASK0000002 | 20');

    fireEvent.click(await screen.findByRole('button', { name: 'Write CTASK dates to ServiceNow' }));

    expect(await screen.findByText(/CTASK0000001: Data Policy Exception: Planned start date must be within the change window/)).toBeInTheDocument();
    expect(screen.getByText(/Wrote planned dates to 1 CTASK\./)).toBeInTheDocument();
  });

  it('asks for the change\'s planned start first when it has none', async () => {
    render(<CtaskTimelinePanel changeSysId="chg-1" changeWindow={{ startUtc: '', endUtc: '' }} />);

    expect(await screen.findByText(/Set the change's planned start and end/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Plan the CTASK timeline/ })).not.toBeInTheDocument();
  });
});
