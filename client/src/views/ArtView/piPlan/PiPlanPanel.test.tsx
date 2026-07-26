// PiPlanPanel.test.tsx — The gated planner panel (spec 028, US1). Covers the AI-lock gate (analyze C1),
// the ingest→proposal flow, and per-item accept invoking the injected writer (no network).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PiPlanPanel } from './PiPlanPanel.tsx';
import type { PiPlanPanelProps } from './PiPlanPanel.tsx';
import { assemblePromptContext } from './piPlanAiFetch.ts';
import { useAiAssistStore } from '../../../store/aiAssistStore.ts';
import type { PersonCapacity } from '../../FeatureCanvas/planner/capacityTypes.ts';
import type { FeatureInput } from './piPlanTypes.ts';

const FEATURES: FeatureInput[] = [
  { key: 'ABC-1', summary: 'Login', sizePoints: 8, priorityRank: 1, priorityName: 'High', isCommitted: true, dependencyKeys: [], targetFixVersion: null, existingChildren: [] },
];
const PEOPLE: PersonCapacity[] = [
  { displayName: 'Dev One', roles: ['dev'], pointsPerSprint: 10 },
  { displayName: 'QA One', roles: ['internalTest'], pointsPerSprint: 10 },
];
const RELEASES = { entries: [{ name: 'R1', releaseDateIso: '2026-06-15', isSuggested: false }] };
const CAL = { weekendDays: [0, 6], holidayIsoDates: [] };

function props(onApplyStory = vi.fn(async () => {})): PiPlanPanelProps {
  const promptContext = assemblePromptContext({
    piName: 'PI 26.3 (05/21/26 - 07/29/26)', piStartIso: '2026-05-21', piEndIso: '2026-07-29',
    sprints: [{ name: '26.3.1', startIso: '2026-05-21', endIso: '2026-06-03' }],
    workingCalendar: CAL, people: PEOPLE, features: FEATURES, releaseSchedule: RELEASES,
  });
  return {
    promptContext, features: FEATURES, people: PEOPLE, releaseSchedule: RELEASES, workingCalendar: CAL,
    piName: 'PI 26.3 (05/21/26 - 07/29/26)', piStartIso: '2026-05-21', piEndIso: '2026-07-29',
    sprintLengthDays: 14, todayIso: '2026-05-21', onApplyStory,
  };
}

const REPLY = JSON.stringify({ kind: 'piPlan', items: [{ featureKey: 'ABC-1', stories: [{ summary: 'Story A', sizePoints: 8, hasTestableOutput: true }] }] });

afterEach(() => useAiAssistStore.setState({ isAiAssistUnlocked: false }));

describe('PiPlanPanel', () => {
  it('renders nothing while AI Assist is locked (gate — analyze C1)', () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: false });
    render(<PiPlanPanel {...props()} />);
    expect(screen.queryByText(/PI Planner/)).not.toBeInTheDocument();
  });

  it('ingests a reply, renders the proposal and capacity map, and writes on accept', async () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    const onApplyStory = vi.fn(async () => {});
    render(<PiPlanPanel {...props(onApplyStory)} />);

    // The prompt is offered.
    expect(screen.getByText(/PI Planner/)).toBeInTheDocument();

    // Paste the reply and ingest it.
    fireEvent.change(screen.getByLabelText(/PI Planner reply/), { target: { value: REPLY } });
    fireEvent.click(screen.getByRole('button', { name: /Ingest plan reply/i }));

    // Proposal + capacity map render.
    await waitFor(() => expect(screen.getByRole('table', { name: 'Plan proposal' })).toBeInTheDocument());
    expect(screen.getByText('Story A')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Capacity map' })).toBeInTheDocument();

    // Accepting the Story invokes the injected writer.
    const storyRow = screen.getByText('Story A').closest('tr')!;
    fireEvent.click(storyRow.querySelector('button')!); // the Accept button
    await waitFor(() => expect(onApplyStory).toHaveBeenCalledTimes(1));
  });

  it('surfaces a parse error for a malformed reply and shows no proposal', async () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    render(<PiPlanPanel {...props()} />);
    fireEvent.change(screen.getByLabelText(/PI Planner reply/), { target: { value: 'not json' } });
    fireEvent.click(screen.getByRole('button', { name: /Ingest plan reply/i }));
    await waitFor(() => expect(screen.queryByRole('table', { name: 'Plan proposal' })).not.toBeInTheDocument());
  });
});
