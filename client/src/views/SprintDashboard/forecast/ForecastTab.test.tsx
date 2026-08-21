// ForecastTab.test.tsx — The surface where both clocks are on screen at once.
//
// The assertion that matters most is that they stay APART. A team is measured on the PI clock and
// operates on the release clock, and a single merged figure is the exact confusion this feature was
// built to end — so it is checked here, on the one screen where merging them would be tempting.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchVersions, mockLoadFieldConfig, mockReadRoster } = vi.hoisted(() => ({
  mockFetchVersions: vi.fn(),
  mockLoadFieldConfig: vi.fn(),
  mockReadRoster: vi.fn(),
}));

vi.mock('../../ArtView/piPlan/piPlanReleaseSchedule.ts', () => ({
  fetchPiWindowFixVersions: mockFetchVersions,
}));
vi.mock('../../Hygiene/checks/hygieneFieldConfig.ts', () => ({
  loadHygieneFieldConfig: mockLoadFieldConfig,
}));
vi.mock('../hooks/useStandupRosterStore.ts', () => ({
  readStoredStandupRosterMembers: mockReadRoster,
}));

import ForecastTab from './ForecastTab.tsx';
import { ART_SETTINGS_STORAGE_KEY } from '../../../services/artSettingsStore.ts';
import { resolveStoryPointsFieldIds } from '../../Hygiene/checks/storyPointsField.ts';
import type { JiraIssueLike } from './forecastAdapters.ts';

/**
 * The field the tab will actually read, resolved the same way the tab resolves it.
 *
 * Naming an id here would have put a fourteenth copy of it in the codebase — and the boundary test
 * caught exactly that, which is what it is for.
 */
const POINTS_FIELD = resolveStoryPointsFieldIds('')[0];

function issue(key: string, fields: Record<string, unknown> = {}): JiraIssueLike {
  return {
    key,
    fields: {
      summary: '[DEV] Build it',
      status: { name: 'Working' },
      issuetype: { name: 'Story' },
      assignee: { accountId: 'acct-1', displayName: 'Smith, Jane (CTR)' },
      fixVersions: [{ name: 'Release 10/02/2026' }],
      customfield_featurelink: 'DENP-1',
      [POINTS_FIELD]: 3,
      ...fields,
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  mockFetchVersions.mockResolvedValue([{ name: 'Release 10/02/2026', archived: false }]);
  mockLoadFieldConfig.mockResolvedValue({
    subStatusFieldIds: ['customfield_substatus'],
    targetStartFieldIds: ['customfield_targetstart'],
    featureLinkFieldIds: ['customfield_featurelink'],
  });
  mockReadRoster.mockReturnValue([
    {
      displayName: 'Smith, Jane (CTR)',
      jiraAccountId: 'acct-1',
      roleCapabilities: { canDevelop: true, canInternalTest: false },
    },
  ]);
});

afterEach(() => localStorage.clear());

function renderTab(scopedIssues: JiraIssueLike[] = [issue('ENC-1')]) {
  return render(<ForecastTab projectKey="ENCUC" teamProfileId="team-a" scopedIssues={scopedIssues} />);
}

describe('ForecastTab', () => {
  it('offers the version list Jira itself holds, never a typed name', async () => {
    // A value that must match Jira exactly is picked, not typed: a typo saves cleanly and silently
    // matches nothing.
    renderTab();
    await waitFor(() => expect(screen.getByRole('combobox', { name: /fix version/i })).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Release 10/02/2026' })).toBeInTheDocument();
  });

  it('asks for a version rather than guessing one', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText(/Pick a fix version/i)).toBeInTheDocument());
  });

  it('says so when the project has no versions at all', async () => {
    mockFetchVersions.mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(screen.getByText(/no fix versions to forecast/i)).toBeInTheDocument());
  });

  it('survives Jira refusing the version list', async () => {
    mockFetchVersions.mockRejectedValue(new Error('Jira is down'));
    renderTab();
    await waitFor(() => expect(screen.getByText(/no fix versions to forecast/i)).toBeInTheDocument());
  });

  it('says plainly that the deploy-buffer week carries no test capacity', async () => {
    // Present so a reader can LABEL that week, never so anything can be scheduled into it.
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ piEndDate: '2026-11-06' }));
    renderTab();
    await waitFor(() => expect(screen.getByRole('combobox', { name: /fix version/i })).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox', { name: /fix version/i }), {
      target: { value: 'Release 10/02/2026' },
    });

    await waitFor(() => expect(screen.getAllByText(/carries no test capacity/i).length).toBeGreaterThan(0));
  });

  it('names both remedies when the test window genuinely cannot absorb the work', async () => {
    // A flag on its own does not say what to do about it, and the two remedies cost very different
    // things — so both are named rather than left to be inferred.
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ piEndDate: '2026-11-06' }));
    renderTab([issue('S-1', { summary: '[SL] Test everything', assignee: { accountId: 'acct-2', displayName: 'Tester' }, [POINTS_FIELD]: 90 })]);
    mockReadRoster.mockReturnValue([
      { displayName: 'Tester', jiraAccountId: 'acct-2', roleCapabilities: { canDevelop: false, canInternalTest: true } },
    ]);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /fix version/i })).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox', { name: /fix version/i }), {
      target: { value: 'Release 10/02/2026' },
    });

    await waitFor(() => expect(screen.getAllByText(/Reduce scope, or add test resource/i).length).toBeGreaterThan(0));
  });

  it('keeps the release clock and the PI clock in separate blocks on one screen', async () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ piEndDate: '2026-11-06' }));
    renderTab();
    await waitFor(() => expect(screen.getByRole('combobox', { name: /fix version/i })).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox', { name: /fix version/i }), {
      target: { value: 'Release 10/02/2026' },
    });

    await waitFor(() => expect(screen.getAllByText(/Release clock/i).length).toBeGreaterThan(0));
    // Two headings, two blocks. Never one merged figure.
    expect(screen.getAllByText(/PI commitment/i).length).toBeGreaterThan(0);
  });

  it('reports a version nothing can date rather than forecasting it as fine', async () => {
    mockFetchVersions.mockResolvedValue([{ name: 'Sprint 5', archived: false }]);
    renderTab([issue('ENC-1', { fixVersions: [{ name: 'Sprint 5' }] })]);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /fix version/i })).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox', { name: /fix version/i }), {
      target: { value: 'Sprint 5' },
    });

    await waitFor(() => expect(screen.getAllByText(/its work cannot be forecast/i).length).toBeGreaterThan(0));
  });

  it('shows a refused setting rather than swallowing it', async () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ pointsPerWorkingDay: 0 }));
    renderTab();
    await waitFor(() => expect(screen.getByText(/pointsPerWorkingDay/)).toBeInTheDocument());
    expect(screen.getByText(/must be greater than zero/i)).toBeInTheDocument();
  });

  it('lists Features that cannot reach Integrated Test in time', async () => {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify({ piEndDate: '2026-08-25' }));
    renderTab([issue('ENC-1', { [POINTS_FIELD]: 60 })]);
    await waitFor(() => expect(screen.getByText(/PI commitment/i)).toBeInTheDocument());
  });

  it('re-queries nothing — it forecasts the issues the dashboard already scoped', async () => {
    renderTab();
    await waitFor(() => expect(mockFetchVersions).toHaveBeenCalled());
    // The ONLY fetch is the version list a picker cannot do without. No issue search of its own —
    // the tab forecasts the set the dashboard already scoped.
    expect(mockFetchVersions).toHaveBeenCalledWith('ENCUC');
  });

  it('lists a Feature whose children have outgrown its estimate', async () => {
    // No Feature estimate reaches this surface, so it reports NOT SIZED rather than comparing
    // against nothing and calling the result healthy.
    renderTab([issue('ENC-1', { [POINTS_FIELD]: 40 })]);
    await waitFor(() => expect(screen.getByText(/outgrown their estimate/i)).toBeInTheDocument());
    expect(screen.getByText(/Not sized/i)).toBeInTheDocument();
  });

  it('shows no sizing table when every Feature is sized correctly', async () => {
    renderTab([issue('ENC-1', { customfield_featurelink: null })]);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /fix version/i })).toBeInTheDocument());
    expect(screen.queryByText(/outgrown their estimate/i)).not.toBeInTheDocument();
  });
});
