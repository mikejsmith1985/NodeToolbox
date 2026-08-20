// ForecastSection.test.tsx — Every scanned issue appears exactly once, under an honest heading.
//
// The three "cannot be forecast" groups carry the weight. Folding unsized, unassigned or undated
// work into "on track" would make the panel read as though the whole board were fine — which is the
// specific failure this panel exists to prevent, and the one nobody would notice.

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ForecastSection } from './ForecastSection.tsx';
import { computeForecast } from '../../SprintDashboard/forecast/forecastCompose.ts';
import { buildForecastConfig } from '../../SprintDashboard/forecast/forecastSettings.ts';
import type { ForecastIssue, ForecastResult } from '../../SprintDashboard/forecast/forecastTypes.ts';

const TODAY_ISO = '2026-08-20';

const CONFIG = buildForecastConfig(
  { pointsPerWorkingDay: 1, holidayIsoDates: [], featureSizingTolerancePercent: 0 },
  TODAY_ISO,
).config;

const TEAM_NAMES = { 'team-a': 'Alpha', 'team-b': 'Bravo' };

function issue(overrides: Partial<ForecastIssue> = {}): ForecastIssue {
  return {
    key: 'ENC-1',
    summary: 'Build the thing',
    typeBucket: 'story',
    featureKey: 'DENP-1',
    columnId: '',
    statusName: 'Working',
    subStatusValue: null,
    assigneeAccountId: 'acct-1',
    assigneeDisplayName: 'Smith, Jane (CTR)',
    fixVersionNames: ['Release 08/24/2026'],
    storyPoints: 3,
    isComplete: false,
    actualStartIso: null,
    storedTargetStartIso: null,
    ...overrides,
  };
}

/** Builds a real forecast so the panel is tested against the engine, not against a hand-made shape. */
function forecastFor(items: ForecastIssue[], piEndDate = '2026-11-06'): ForecastResult {
  return computeForecast(
    {
      items,
      orderedColumnIds: [],
      fixVersions: [
        { name: 'Release 08/24/2026', releaseDate: '2026-09-14' },
        { name: 'Release 09/01/2026', releaseDate: '2026-08-15' },
        { name: 'Undated version' },
      ],
      people: [],
      piEndDate,
      hasSubStatusField: true,
      teamProfileId: 'team-a',
    },
    CONFIG,
  );
}

function renderSection(forecast: ForecastResult | null) {
  return render(<ForecastSection forecast={forecast} teamNamesByProfileId={TEAM_NAMES} />);
}

describe('ForecastSection', () => {
  it('says the forecast has not run yet rather than showing an empty panel', () => {
    renderSection(null);
    expect(screen.getByRole('status')).toHaveTextContent(/once the team scans have loaded/i);
  });

  it('always names how many issues it scanned and what it could not measure', () => {
    // The line is unconditional. A panel that only mentioned caveats when there were some would
    // leave a reader unable to tell "nothing missing" from "nobody checked".
    renderSection(forecastFor([issue({ key: 'ENC-1' }), issue({ key: 'ENC-2', storyPoints: null })]));
    expect(screen.getByText(/2 issues scanned/)).toBeInTheDocument();
    expect(screen.getByText(/1 unsized/)).toBeInTheDocument();
  });

  it('lists an unsized issue under its own heading, never as on track', () => {
    renderSection(forecastFor([issue({ storyPoints: null })]));
    expect(screen.getByText(/Unsized — cannot be forecast/)).toBeInTheDocument();
    expect(screen.queryByText(/^On track$/)).not.toBeInTheDocument();
  });

  it('lists an unassigned issue under its own heading', () => {
    renderSection(forecastFor([issue({ assigneeAccountId: null, assigneeDisplayName: null })]));
    expect(screen.getByText(/No owner — cannot be forecast/)).toBeInTheDocument();
  });

  it('lists an issue with no deadline at all under its own heading', () => {
    renderSection(forecastFor([issue({ fixVersionNames: [] })], ''));
    expect(screen.getByText(/No deadline — cannot be forecast/)).toBeInTheDocument();
  });

  it('puts work that must start today under the urgent heading', () => {
    // 3 days of work against a Monday code freeze: Thursday is the last day to begin.
    renderSection(forecastFor([issue({ storyPoints: 3, fixVersionNames: ['Release 08/24/2026'] })]));
    expect(screen.getByText(/Must start today/)).toBeInTheDocument();
  });

  it('reports nothing urgent when nothing is, rather than leaving the panel blank', () => {
    renderSection(forecastFor([issue({ storyPoints: 1, fixVersionNames: [] })]));
    expect(screen.getByText(/Nothing has to start today/)).toBeInTheDocument();
  });

  it('shows every issue exactly once, so nothing is double-counted or dropped', () => {
    const forecast = forecastFor([
      issue({ key: 'ENC-1' }),
      issue({ key: 'ENC-2', storyPoints: null }),
      issue({ key: 'ENC-3', assigneeAccountId: null, assigneeDisplayName: null }),
    ]);
    renderSection(forecast);
    ['ENC-1', 'ENC-2', 'ENC-3'].forEach((issueKey) => {
      expect(screen.getAllByText(issueKey)).toHaveLength(1);
    });
  });

  it('names the team on every row, so a two-team view can be acted on', () => {
    renderSection(forecastFor([issue()]));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('states the workings behind each verdict', () => {
    renderSection(forecastFor([issue({ storyPoints: 3 })]));
    expect(screen.getByText(/working days of work left/)).toBeInTheDocument();
  });

  it('reports a disagreement with the date Jira holds without changing it', () => {
    renderSection(forecastFor([issue({ storyPoints: 3, storedTargetStartIso: '2026-07-01' })]));
    expect(screen.getByText(/Jira holds 2026-07-01/)).toBeInTheDocument();
  });

  it('shows a refused setting rather than swallowing it', () => {
    const forecast = forecastFor([issue()]);
    renderSection({
      ...forecast,
      rejectedSettings: [{ name: 'pointsPerWorkingDay', storedValue: '0', reason: 'must be greater than zero' }],
    });
    expect(screen.getByText(/pointsPerWorkingDay/)).toBeInTheDocument();
    expect(screen.getByText(/must be greater than zero/)).toBeInTheDocument();
  });

  it('counts the rows in each group', () => {
    renderSection(forecastFor([
      issue({ key: 'ENC-1', storyPoints: null }),
      issue({ key: 'ENC-2', storyPoints: null }),
    ]));
    const heading = screen.getByText(/Unsized — cannot be forecast/).closest('h4');
    expect(heading).not.toBeNull();
    expect(within(heading as HTMLElement).getByText('2')).toBeInTheDocument();
  });
});
