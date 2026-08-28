// ReworkTab.test.tsx — The report that prices work done twice and charged once.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import ReworkTab from './ReworkTab.tsx';
import { resolveStoryPointsFieldIds } from '../Hygiene/checks/storyPointsField.ts';

// Read from the central resolver: the field-mapping boundary fails any NEW file naming a custom
// field id, and a test is no exception.
const [STORY_POINTS_FIELD] = resolveStoryPointsFieldIds('');

/** One changelog entry moving an issue between two named statuses. */
function statusChange(fromName: string, toName: string, dayOfMonth: number) {
  return {
    created: `2026-08-${String(dayOfMonth).padStart(2, '0')}T12:00:00.000Z`,
    items: [{ field: 'status', fromString: fromName, toString: toName }],
  };
}

/** One issue with the history the test is about. */
function issue(key: string, histories: ReturnType<typeof statusChange>[], points: number | null = 5) {
  return {
    key,
    fields: {
      summary: `Summary for ${key}`,
      status: { name: 'Done' },
      assignee: { displayName: 'Reynolds, Kevin' },
      [STORY_POINTS_FIELD]: points,
    },
    changelog: { histories },
  };
}

/** An issue that reached delivery, fell back, and returned. */
function wentBackAndForth(key: string) {
  return issue(key, [
    statusChange('To Do', 'In Progress', 3),
    statusChange('In Progress', 'Ready for QA', 5),
    statusChange('Ready for QA', 'In Progress', 7),
    statusChange('In Progress', 'Ready for QA', 14),
  ]);
}

/** Runs the report. */
async function runReport(): Promise<void> {
  const user = userEvent.setup();
  render(<ReworkTab />);
  await user.click(screen.getByRole('button', { name: 'Run' }));
}

describe('ReworkTab', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
  });

  it('explains what it counts before it counts anything', async () => {
    render(<ReworkTab />);

    expect(screen.getByText(/reached the team.s delivery line/)).toBeInTheDocument();
    expect(screen.getByText(/costs nothing on paper/)).toBeInTheDocument();
  });

  it('states the rate against the issues that COULD have come back', async () => {
    // "12 of 145" is misleading when a hundred never reached delivery.
    mockJiraGet.mockResolvedValue({
      issues: [
        wentBackAndForth('ENCUC-1'),
        issue('ENCUC-2', [statusChange('To Do', 'In Progress', 3), statusChange('In Progress', 'Ready for QA', 6)]),
        issue('ENCUC-3', [statusChange('To Do', 'In Progress', 3)]),
      ],
    });

    await runReport();

    expect(await screen.findByText(/50% of the work that reached delivery came back/)).toBeInTheDocument();
  });

  it('leads with what a return costs to recover', async () => {
    // The first version led with a points total, which was zero, because nobody points defects.
    mockJiraGet.mockResolvedValue({ issues: [wentBackAndForth('ENCUC-1')] });

    await runReport();

    // Now a stat card: the label carries the unit, the value carries the number.
    expect(await screen.findByText('Days to recover a return')).toBeInTheDocument();
    expect(screen.getByText(/median over \d+ resolved return/)).toBeInTheDocument();
  });

  it('says outright that nothing which came back carried points', async () => {
    mockJiraGet.mockResolvedValue({ issues: [issue('ENCUC-1', [
      statusChange('To Do', 'Ready for QA', 3),
      statusChange('Ready for QA', 'In Progress', 5),
      statusChange('In Progress', 'Ready for QA', 12),
    ], null)] });

    await runReport();

    expect(await screen.findByText(/recorded nowhere at all/)).toBeInTheDocument();
  });

  it('states what it chose NOT to count, rather than applying it silently', async () => {
    // An exclusion nobody can see is a number nobody can check.
    mockJiraGet.mockResolvedValue({ issues: [
      wentBackAndForth('ENCUC-1'),
      issue('ENCUC-2', [
        statusChange('To Do', 'Ready for QA', 3),
        statusChange('Ready for QA', 'Cancelled', 5),
      ]),
    ] });

    await runReport();

    expect(await screen.findByText(/abandoned, not redone/)).toBeInTheDocument();
  });

  it('names which stage sent work back', async () => {
    mockJiraGet.mockResolvedValue({ issues: [wentBackAndForth('ENCUC-1')] });

    await runReport();

    expect(await screen.findByText('Which stage sent work back')).toBeInTheDocument();
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
  });

  it('lists the worst round trips with a link back to Jira', async () => {
    mockJiraGet.mockResolvedValue({ issues: [wentBackAndForth('ENCUC-1')] });

    await runReport();

    expect(await screen.findByText('Worst round trips')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ENCUC-1' })).toBeInTheDocument();
  });

  it('says nothing came back rather than showing an empty table', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [issue('ENCUC-1', [statusChange('To Do', 'In Progress', 3), statusChange('In Progress', 'Ready for QA', 6)])],
    });

    await runReport();

    expect(await screen.findByText(/None of the 1 issues that reached delivery came back/)).toBeInTheDocument();
    expect(screen.queryByText('Worst round trips')).not.toBeInTheDocument();
  });

  it('warns when it stopped short, so a sample is not quoted as the whole scope', async () => {
    const fullPage = Array.from({ length: 100 }, (_unused, index) => wentBackAndForth(`A-${index}`));
    mockJiraGet.mockResolvedValue({ issues: fullPage });

    await runReport();

    expect(await screen.findByText(/this is a sample, not the whole scope/)).toBeInTheDocument();
  });

  it('says plainly when the history could not be read', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira is unreachable'));

    await runReport();

    expect(await screen.findByText('Jira is unreachable')).toBeInTheDocument();
  });

  it('marks an issue that has not come back yet as still out', async () => {
    // Waiting for it to return before admitting it went away would under-report the worst cases.
    mockJiraGet.mockResolvedValue({
      issues: [issue('ENCUC-9', [
        statusChange('To Do', 'Ready for QA', 3),
        statusChange('Ready for QA', 'In Progress', 5),
      ])],
    });

    await runReport();

    // Said twice on purpose: once as an open total in the summary, once against the row it belongs to.
    await waitFor(() => expect(screen.getAllByText(/still out/).length).toBeGreaterThan(1));
  });
});
