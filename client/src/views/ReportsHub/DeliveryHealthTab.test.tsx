// DeliveryHealthTab.test.tsx — Where the work is, and what it costs, on one screen.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import DeliveryHealthTab from './DeliveryHealthTab.tsx';
import { resolveStoryPointsFieldIds } from '../Hygiene/checks/storyPointsField.ts';

const [STORY_POINTS_FIELD] = resolveStoryPointsFieldIds('');

/** A moment the given number of days before now. */
function daysAgo(dayCount: number): string {
  return new Date(Date.now() - dayCount * 86_400_000).toISOString();
}

/** One changelog entry moving an issue between two named statuses. */
function statusChange(fromName: string, toName: string, dayCount: number) {
  return { created: daysAgo(dayCount), items: [{ field: 'status', fromString: fromName, toString: toName }] };
}

/** One issue as Jira returns it. */
function issue(
  key: string,
  statusName: string,
  categoryKey: string,
  histories: ReturnType<typeof statusChange>[] = [],
  assigneeName: string | null = 'Reynolds, Kevin',
) {
  return {
    key,
    fields: {
      summary: `Summary for ${key}`,
      created: daysAgo(60),
      status: { name: statusName, statusCategory: { key: categoryKey } },
      assignee: assigneeName === null ? null : { displayName: assigneeName },
      [STORY_POINTS_FIELD]: 5,
    },
    changelog: { histories },
  };
}

/** An issue that has been sitting in shift-left testing for a month. */
function stuckInTesting(key: string, assigneeName = 'Phatate, Smita') {
  return issue(key, 'Ready for Testing', 'indeterminate', [
    statusChange('To Do', 'In Progress', 45),
    statusChange('In Progress', 'Ready for Testing', 30),
  ], assigneeName);
}

/** Runs the dashboard. */
async function runDashboard(): Promise<void> {
  const user = userEvent.setup();
  render(<DeliveryHealthTab />);
  await user.click(screen.getByRole('button', { name: 'Run' }));
}

describe('DeliveryHealthTab', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
  });

  it('explains what it draws before drawing anything', () => {
    render(<DeliveryHealthTab />);

    expect(screen.getByText(/One read of Jira, drawn four ways/)).toBeInTheDocument();
  });

  it('reads the scope ONCE for every panel', async () => {
    // Four panels asking four times is four chances to describe different moments.
    mockJiraGet.mockResolvedValue({ issues: [stuckInTesting('ENCUC-1')] });

    await runDashboard();

    await waitFor(() => expect(screen.getByText('Where work is piling up')).toBeInTheDocument());
    // Counted as SEARCHES: the project picker loads its own list, which is not a panel asking again.
    const searchCalls = mockJiraGet.mock.calls.filter((call) => String(call[0]).includes('/search?'));

    expect(searchCalls).toHaveLength(1);
  });

  it('NAMES the constraint rather than asking which statuses to measure', async () => {
    // A report that has to be told where the bottleneck is cannot tell you where the bottleneck is.
    mockJiraGet.mockResolvedValue({
      issues: [stuckInTesting('ENCUC-1'), stuckInTesting('ENCUC-2'), issue('ENCUC-3', 'In Progress', 'indeterminate')],
    });

    await runDashboard();

    expect(await screen.findByText('The constraint')).toBeInTheDocument();
    expect(screen.getAllByText(/Ready for Testing/).length).toBeGreaterThan(0);
  });

  it('says which scope it actually read, so nobody infers it from the controls', async () => {
    mockJiraGet.mockResolvedValue({ issues: [stuckInTesting('ENCUC-1')] });

    await runDashboard();

    expect(await screen.findByText(/Showing 1 issue\(s\) from every project you can see/)).toBeInTheDocument();
  });

  it('names who is holding the waiting', async () => {
    // A queue with one server has a name on it.
    mockJiraGet.mockResolvedValue({ issues: [stuckInTesting('ENCUC-1'), stuckInTesting('ENCUC-2')] });

    await runDashboard();

    expect(await screen.findByText('Who is holding the waiting')).toBeInTheDocument();
    expect(screen.getAllByText(/Phatate, Smita/).length).toBeGreaterThan(0);
  });

  it('lists the issues waiting longest, so they can be asked about by name', async () => {
    mockJiraGet.mockResolvedValue({ issues: [stuckInTesting('ENCUC-1')] });

    await runDashboard();

    expect(await screen.findByText('Waiting longest right now')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ENCUC-1' })).toBeInTheDocument();
  });

  it('does not treat finished work as waiting', async () => {
    // A closed issue's time in status is time since it shipped, which is not a queue.
    mockJiraGet.mockResolvedValue({ issues: [issue('DONE-1', 'Done', 'done')] });

    await runDashboard();

    expect(await screen.findByText(/No open work was found/)).toBeInTheDocument();
  });

  it('draws the rework panel from the same read', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [issue('ENCUC-9', 'Ready for QA', 'indeterminate', [
        statusChange('In Progress', 'Ready for QA', 40),
        statusChange('Ready for QA', 'In Progress', 30),
        statusChange('In Progress', 'Ready for QA', 20),
      ])],
    });

    await runDashboard();

    expect(await screen.findByText('What came back after reaching delivery')).toBeInTheDocument();
  });

  it('warns when it stopped short of the whole scope', async () => {
    const fullPage = Array.from({ length: 100 }, (_unused, index) => stuckInTesting(`A-${index}`));
    mockJiraGet.mockResolvedValue({ issues: fullPage });

    await runDashboard();

    expect(await screen.findByText(/this is a sample, not the whole scope/)).toBeInTheDocument();
  });

  it('says plainly when the history could not be read', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira is unreachable'));

    await runDashboard();

    expect(await screen.findByText('Jira is unreachable')).toBeInTheDocument();
  });

  it('points at the right control when the JQL box is wrong', async () => {
    mockJiraGet.mockRejectedValue(new Error("Error in the JQL Query: Expecting operator but got ')'."));

    await runDashboard();

    // The label says it too, so match the message that NAMES it as the cause.
    expect(await screen.findByText(/Check the "Narrow it further" box/)).toBeInTheDocument();
  });
});
