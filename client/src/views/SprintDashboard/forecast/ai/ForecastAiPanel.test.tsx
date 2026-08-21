// ForecastAiPanel.test.tsx — Gated, propose-only, and structurally unable to change a number.
//
// The locked case is the first test and the most important: when AI Assist is locked the panel
// renders NOTHING — no heading, no copy button, no hint that an assistant exists. That is inherited
// from ReportAiPanel rather than reimplemented, and this test is what proves the inheritance holds.

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ForecastAiPanel } from './ForecastAiPanel.tsx';
import { useAiAssistStore } from '../../../../store/aiAssistStore.ts';
import { buildForecastConfig } from '../forecastSettings.ts';
import { computeForecast } from '../forecastCompose.ts';
import type { ForecastIssue, ForecastResult } from '../forecastTypes.ts';

const CONFIG = buildForecastConfig(
  { pointsPerWorkingDay: 1, holidayIsoDates: [], featureSizingTolerancePercent: 0 },
  '2026-08-20',
).config;

function issue(overrides: Partial<ForecastIssue> = {}): ForecastIssue {
  return {
    key: 'ENC-1',
    summary: '[DEV] Build the thing',
    typeBucket: 'story',
    featureKey: 'DENP-1',
    columnId: '',
    statusName: 'Working',
    subStatusValue: null,
    assigneeAccountId: 'acct-1',
    assigneeDisplayName: 'Smith, Jane (CTR)',
    fixVersionNames: ['Release 10/02/2026'],
    storyPoints: 3,
    isComplete: false,
    actualStartIso: null,
    storedTargetStartIso: null,
    ...overrides,
  };
}

const FORECAST: ForecastResult = computeForecast(
  {
    items: [issue()],
    orderedColumnIds: [],
    fixVersions: [{ name: 'Release 10/02/2026', releaseDate: '2026-10-02' }],
    people: [],
    piEndDate: '2026-11-06',
    hasSubStatusField: true,
    teamProfileId: 'team-a',
  },
  CONFIG,
);

function setUnlocked(isUnlocked: boolean): void {
  useAiAssistStore.setState({ isAiAssistUnlocked: isUnlocked });
}

/** Pastes a reply into the first narrative's reply box and ingests it. */
function ingestIntoFirstPanel(replyText: string): void {
  const replyBoxes = screen.getAllByLabelText(/reply$/i);
  fireEvent.change(replyBoxes[0], { target: { value: replyText } });
  fireEvent.click(screen.getAllByRole('button', { name: /Ingest narrative/i })[0]);
}

beforeEach(() => setUnlocked(true));
afterEach(() => setUnlocked(false));

describe('ForecastAiPanel', () => {
  it('renders nothing at all when AI Assist is locked', () => {
    // Not a disabled control, not a hint — nothing. An affordance somebody cannot use is still an
    // affordance they have to reason about.
    setUnlocked(false);
    const { container } = render(<ForecastAiPanel forecast={FORECAST} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers all three narratives once unlocked', () => {
    render(<ForecastAiPanel forecast={FORECAST} />);
    expect(screen.getByText(/Daily forecast narrative/)).toBeInTheDocument();
    expect(screen.getByText(/Scope-cut recommendation/)).toBeInTheDocument();
    expect(screen.getByText(/Test-capacity mitigation/)).toBeInTheDocument();
  });

  it('puts every computed figure in the prompt for the operator to copy', () => {
    render(<ForecastAiPanel forecast={FORECAST} />);
    const prompt = screen.getAllByLabelText(/prompt$/i)[0] as HTMLTextAreaElement;
    expect(prompt.value).toContain('ENC-1');
    expect(prompt.value).toMatch(/NOT NEGOTIABLE/);
  });

  it('asks for a version rather than building a scope-cut prompt out of nothing', () => {
    render(<ForecastAiPanel forecast={FORECAST} />);
    const prompts = screen.getAllByLabelText(/prompt$/i) as HTMLTextAreaElement[];
    expect(prompts.some((prompt) => prompt.value.includes('Pick a fix version first'))).toBe(true);
  });

  it('renders an accepted narrative and lets it be accepted once', () => {
    render(<ForecastAiPanel forecast={FORECAST} />);
    ingestIntoFirstPanel(JSON.stringify({
      kind: 'forecastDaily',
      items: [{ id: 'a', headline: 'One issue is late', narrative: 'ENC-1 should have started.', issueKeys: ['ENC-1'], personKeys: [] }],
    }));

    expect(screen.getByText('One issue is late')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(screen.getByRole('button', { name: /Accepted/ })).toBeDisabled();
  });

  it('names a rejected item rather than dropping it', () => {
    render(<ForecastAiPanel forecast={FORECAST} />);
    ingestIntoFirstPanel(JSON.stringify({
      kind: 'forecastDaily',
      items: [{ id: 'bad', headline: 'H', narrative: 'N', issueKeys: ['FAKE-9'], personKeys: [] }],
    }));

    // One sentence naming both the item and what was wrong with it — a rejection nobody can act on
    // is barely better than a silent drop.
    expect(screen.getByText(/Rejected bad — it names FAKE-9, which was not in the prompt\./))
      .toBeInTheDocument();
  });

  it('rejects an item carrying a figure, which is what stops the AI changing a number', () => {
    render(<ForecastAiPanel forecast={FORECAST} />);
    ingestIntoFirstPanel(JSON.stringify({
      kind: 'forecastDaily',
      items: [{ id: 'numeric', headline: 'H', narrative: 'N', issueKeys: [], personKeys: [], days: 14 }],
    }));

    expect(screen.getByText(/unexpected property "days"/)).toBeInTheDocument();
  });

  it('shows a readable error when the reply is not JSON at all', () => {
    render(<ForecastAiPanel forecast={FORECAST} />);
    ingestIntoFirstPanel('sorry, I cannot help with that');
    expect(screen.getByRole('alert')).toHaveTextContent(/No JSON object/);
  });
});
