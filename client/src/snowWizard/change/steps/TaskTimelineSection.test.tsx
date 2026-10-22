// TaskTimelineSection.test.tsx — Proves the timing round puts the AI's three estimates on each card and lays every
// change's tasks out back to back in its window, warning when they run past it.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCrgState, type CtaskTemplate } from '../../../views/SnowHub/hooks/useCrgState.ts';
import TaskTimelineSection from './TaskTimelineSection.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn(async () => ({ result: [] })) }));

const BLANK = { sysId: '', displayName: '' };

function buildCard(shortDescription: string, changeTaskType: string): CtaskTemplate {
  return {
    id: '', name: '', createdAt: '', shortDescription, description: '', assignmentGroup: BLANK, assignedTo: BLANK,
    plannedStartDate: '', plannedEndDate: '', closeNotes: '', changeTaskType, environmentKeys: ['PRD'],
  };
}

/** What the harness last rendered, written after each render (never during it). */
const observed = { tasks: [] as CtaskTemplate[] };

function Harness({ windowEnd }: { windowEnd: string }) {
  const crg = useCrgState({ storageKey: 'snowWizard:change:timeline-test' });
  const { updateEnvironment, addChangeTask } = crg.actions;
  useEffect(() => {
    updateEnvironment('prd', { isEnabled: true, plannedStartDate: '2026-10-24T22:00', plannedEndDate: windowEnd });
    addChangeTask(buildCard('Business Checkout', 'review'));
    addChangeTask(buildCard('Deploy payments', 'implementation'));
  }, [updateEnvironment, addChangeTask, windowEnd]);
  useEffect(() => { observed.tasks = crg.state.changeTasks; });
  return <TaskTimelineSection crg={crg} />;
}

/** Pastes a reply into the empty reply box, which reads it at once. */
function pasteReply(replyText: string) {
  fireEvent.paste(screen.getByLabelText(/Paste the assistant/), { clipboardData: { getData: () => replyText } });
}

/** Each timeline row's task, start, end and timing — the "Runs" controls left out. */
function readTimelineRows(): string[] {
  const rows = within(screen.getByRole('table', { name: 'PRD task timeline' })).getAllByRole('row').slice(1);
  return rows.map((row) => within(row).getAllByRole('cell').filter((_cell, cellIndex) => cellIndex !== 1).map((cell) => cell.textContent).join('|'));
}

describe('TaskTimelineSection', () => {
  beforeEach(() => localStorage.clear());

  it('offers a timing prompt naming every task', () => {
    render(<Harness windowEnd="2026-10-25T01:00" />);
    const promptText = (screen.getByLabelText(/Copy this and paste it/) as HTMLTextAreaElement).value;
    expect(promptText).toContain('T1 — Business Checkout');
    expect(promptText).toContain('T2 — Deploy payments');
  });

  it('times each card from the reply and runs the deploy before the checkout, back to back', () => {
    render(<Harness windowEnd="2026-10-25T01:00" />);
    pasteReply('TIMELINE:\nT1 | 20 | 10 | 5 | checkout\nT2 | 30 | 15 | 20 | deploy');
    expect(screen.getByText(/Every task is timed \(2\)/)).toBeTruthy();
    expect(observed.tasks.map((task) => task.durationEstimates?.implementationMinutes)).toEqual(['20', '30']);
    expect(readTimelineRows()).toEqual([
      'Deploy payments|22:00|22:45|implementation 30 minutes, validation 15 minutes, backout 20 minutes',
      'Business Checkout|22:45|23:15|implementation 20 minutes, validation 10 minutes, backout 5 minutes',
    ]);
  });

  it('lets the user run a task at the same time as another, or hold it until a time (GH #475)', () => {
    render(<Harness windowEnd="2026-10-25T01:00" />);
    pasteReply('TIMELINE:\nT1 | 20 | 10 | 5 | in order | checkout\nT2 | 30 | 15 | 20 | in order | deploy');
    fireEvent.change(screen.getByLabelText('How “Business Checkout” runs'), { target: { value: 'alongside:Deploy payments' } });
    expect(readTimelineRows()[1]).toMatch(/^Business Checkout\|22:00\|22:30/);
    fireEvent.change(screen.getByLabelText('“Deploy payments” starts no earlier than'), { target: { value: '23:00' } });
    expect(readTimelineRows()).toEqual([
      'Deploy payments|23:00|23:45|implementation 30 minutes, validation 15 minutes, backout 20 minutes',
      'Business Checkout|23:00|23:30|implementation 20 minutes, validation 10 minutes, backout 5 minutes',
    ]);
    expect(observed.tasks.find((task) => task.shortDescription === 'Deploy payments')?.timelinePlacement).toEqual({ runMode: 'inOrder', notBeforeTime: '23:00' });
  });

  it('says when the tasks run past the change window', () => {
    render(<Harness windowEnd="2026-10-24T23:00" />);
    pasteReply('TIMELINE:\nT1 | 20 | 10 | 5 | checkout\nT2 | 30 | 15 | 20 | deploy');
    expect(screen.getByText(/On the PRD change the tasks run 15 minutes past the window's end/)).toBeTruthy();
  });
});
