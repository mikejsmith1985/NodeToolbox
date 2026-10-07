// EpicDatePlanPanel.test.tsx — Planning a PI's Epic dates from points and capacity, and writing them to Jira.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiAssistStore } from '../../../store/aiAssistStore.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import type { CapacitySummary } from '../../SprintDashboard/capacityModel.ts';
import { createEmptyPiReviewRow, type PiReviewRow } from '../piReviewTable.ts';
import { EpicDatePlanPanel } from './EpicDatePlanPanel.tsx';

function buildRow(feature: string, pointEstimate: string): PiReviewRow {
  return { ...createEmptyPiReviewRow(), feature, pointEstimate };
}

function buildIssue(key: string): JiraIssue {
  return { key, fields: { summary: `${key} summary`, status: { name: 'Backlog', statusCategory: { key: 'new' } } } } as unknown as JiraIssue;
}

// 600 points of 80% capacity over 60 work days: 10 points a working day.
const CAPACITY: CapacitySummary = {
  summaryLabel: 'Cleanup Crew',
  startDate: '2026-10-12',
  endDate: '2026-12-30',
  workDayCount: 60,
  totalCapacityPoints: 750,
  recommendedCapacityPoints: 600,
  roleCapacities: {} as CapacitySummary['roleCapacities'],
};
const ROWS = [buildRow('DENP-1 - Recon', '10'), buildRow('DENP-2 - LIS', '10'), buildRow('DENP-3 - Audit', '10')];
const ISSUES = { 'DENP-1': buildIssue('DENP-1'), 'DENP-2': buildIssue('DENP-2'), 'DENP-3': buildIssue('DENP-3') };

function renderPanel(overrides: Partial<Parameters<typeof EpicDatePlanPanel>[0]> = {}) {
  const onWriteDates = vi.fn().mockResolvedValue(undefined);
  render(
    <EpicDatePlanPanel
      capacitySummary={CAPACITY}
      jiraIssueMap={ISSUES}
      onWriteDates={onWriteDates}
      piName="PI 26.5"
      piWindow={{ startIso: '2026-10-12', endIso: '2026-12-30' }}
      rows={ROWS}
      todayIso="2026-10-07"
      {...overrides}
    />,
  );
  return onWriteDates;
}

/** The proposed Start and End cells of one Epic's row. */
function readProposedDates(epicKey: string): [string, string] {
  const row = screen.getByRole('row', { name: new RegExp(epicKey) });
  return [within(row).getByTestId('proposed-start').textContent ?? '', within(row).getByTestId('proposed-end').textContent ?? ''];
}

describe('EpicDatePlanPanel', () => {
  beforeEach(() => useAiAssistStore.setState({ isAiAssistUnlocked: false }));
  afterEach(() => useAiAssistStore.setState({ isAiAssistUnlocked: false }));

  it('plans every Epic from the team\'s speed, running three at once by default', () => {
    renderPanel();

    expect(screen.getByText(/10\.0 points per working day/)).toBeInTheDocument();
    expect(readProposedDates('DENP-1')).toEqual(['2026-10-12', '2026-10-15']);
    expect(readProposedDates('DENP-3')).toEqual(['2026-10-12', '2026-10-15']);
  });

  it('replans when fewer Epics may run at once', () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Epics worked at once'), { target: { value: '1' } });

    expect(readProposedDates('DENP-1')).toEqual(['2026-10-12', '2026-10-13']);
    expect(readProposedDates('DENP-3')).toEqual(['2026-10-14', '2026-10-15']);
  });

  it('writes only the accepted Epics\' Target Start and Target End to Jira', async () => {
    const onWriteDates = renderPanel();

    fireEvent.click(screen.getByLabelText('Accept dates for DENP-2'));
    fireEvent.click(screen.getByRole('button', { name: /Write 1 Epic's dates to Jira/ }));

    await waitFor(() => expect(onWriteDates).toHaveBeenCalledWith([
      { featureKey: 'DENP-2', targetStart: '2026-10-12', targetEnd: '2026-10-15', dueDate: null },
    ]));
    expect(await screen.findByText(/Wrote dates for 1 Epic/)).toBeInTheDocument();
  });

  it('says what is missing when there is no team capacity to plan with', () => {
    renderPanel({ capacitySummary: null });

    expect(screen.getByText(/needs the Team Capacity/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('reorders the Epics from a pasted AI Assist order and shows why', () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    renderPanel();
    fireEvent.change(screen.getByLabelText('Epics worked at once'), { target: { value: '1' } });

    fireEvent.change(screen.getByLabelText(/Propose the Epic order reply/), {
      target: { value: '{"kind":"epicDatePlan","order":[{"key":"DENP-3","rationale":"Unblocks the others."}]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Use this order/ }));

    expect(readProposedDates('DENP-3')).toEqual(['2026-10-12', '2026-10-13']);
    expect(screen.getByText('Unblocks the others.')).toBeInTheDocument();
  });
});
