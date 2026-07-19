// ReadinessPanel.test.tsx — Proves the Readiness panel's lens tiles, filtering, count/list identity,
// honest states, and deep links, with the data hook and child controls mocked.

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./useReadinessData.ts', () => ({ useReadinessData: vi.fn() }));
vi.mock('./ReadinessFixControl.tsx', () => ({
  ReadinessFixControl: ({ alertId }: { alertId: string }) => <span data-testid={`fix-${alertId}`}>fix</span>,
}));
vi.mock('./ai/ReadinessAiPanel.tsx', () => ({
  ReadinessAiPanel: () => <div data-testid="ai-panel" />,
}));
vi.mock('../../../components/IssueDetailPanel/index.tsx', () => ({
  default: () => <div data-testid="issue-detail" />,
}));

import ReadinessPanel from './ReadinessPanel.tsx';
import { useReadinessData } from './useReadinessData.ts';
import type { ReadinessFeature, ReadinessScanResult } from './readinessScan.ts';

const mockUseReadinessData = vi.mocked(useReadinessData);

function buildFeature(key: string, overrides: Partial<ReadinessFeature> = {}, labels: string[] = []): ReadinessFeature {
  return {
    issue: { key, fields: { summary: `Feature ${key}`, status: { name: 'Analyzing', statusCategory: { key: 'new' } }, issuetype: { name: 'Feature' }, labels } },
    key,
    summary: `Feature ${key}`,
    statusName: 'Analyzing',
    statusBucket: 'todo',
    assigneeDisplayName: null,
    productOwnerDisplayName: null,
    estimateValue: null,
    pcodeValue: null,
    targetEndIso: null,
    dueDateIso: null,
    ageDays: 5,
    impedimentReasons: [],
    alerts: [],
    ...overrides,
  } as unknown as ReadinessFeature;
}

function buildScan(overrides: Partial<ReadinessScanResult> = {}): ReadinessScanResult {
  const currentFeatures = overrides.lenses?.current.features ?? [buildFeature('CUR-1'), buildFeature('CUR-2', { statusBucket: 'inProgress' })];
  return {
    lenses: {
      current: { id: 'current', piNames: ['PI 26.3'], features: currentFeatures, countsByBucket: { todo: 1, inProgress: 1, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: true, isCoverageCapped: false },
      upcoming: { id: 'upcoming', piNames: ['PI 26.4'], features: [buildFeature('UPC-1')], countsByBucket: { todo: 1, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 1, isPiConfigured: true, isCoverageCapped: false },
      carryover: { id: 'carryover', piNames: [], features: [], countsByBucket: { todo: 0, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: true, isCoverageCapped: false },
    },
    scannedFeatureCount: currentFeatures.length + 1,
    alertFamilyStates: { 'missing-ownership': 'active', 'missing-estimate': 'active', 'missing-pcode': 'active', 'target-end-missing-or-past': 'active', 'due-date-missing-or-past': 'active' },
    writeFieldIds: { productOwnerFieldId: 'customfield_20002', estimateFieldId: 'customfield_20007', pcodeFieldId: 'customfield_20008', targetEndFieldId: 'customfield_10102' },
    loadError: null,
    scopeDescription: 'project in (PORT)',
    ...overrides,
  } as ReadinessScanResult;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderPanel(initialPath = '/agile-hub?space=train&artTab=readiness') {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ReadinessPanel selectedPiName="PI 26.3" availablePiNames={['PI 26.4', 'PI 26.3', 'PI 26.2']} rosterTeams={[]} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseReadinessData.mockReset();
  window.localStorage.clear();
  mockUseReadinessData.mockReturnValue({ scanResult: buildScan(), isLoading: false, reload: vi.fn() });
});

describe('ReadinessPanel', () => {
  it('renders the three lens tiles with the scan counts', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: /Current PI/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Upcoming PI/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Carryover/ })).toBeInTheDocument();
  });

  it('shows the current lens features and a count that equals the row count (SC-003)', () => {
    renderPanel();

    expect(screen.getByText('CUR-1')).toBeInTheDocument();
    expect(screen.getByText('CUR-2')).toBeInTheDocument();
    // Summary counts: To Do 1 + In Progress 1 = 2 features, matching the two rows.
    const todoTile = screen.getByRole('button', { name: /To Do/ });
    expect(todoTile).toHaveTextContent('1');
  });

  it('filters the listing when a status tile is clicked', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /In Progress/ }));

    expect(screen.getByText('CUR-2')).toBeInTheDocument();
    expect(screen.queryByText('CUR-1')).not.toBeInTheDocument();
  });

  it('switches lenses and writes the lens to the URL (deep-linkable)', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Upcoming PI/ }));

    expect(screen.getByText('UPC-1')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('readinessLens=upcoming');
  });

  it('honors a deep-linked lens on arrival', () => {
    renderPanel('/agile-hub?space=train&artTab=readiness&readinessLens=upcoming');

    expect(screen.getByRole('button', { name: /Upcoming PI/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('UPC-1')).toBeInTheDocument();
  });

  it('shows the amber empty-scope message and no healthy zero when nothing matched', () => {
    mockUseReadinessData.mockReturnValue({
      scanResult: buildScan({
        lenses: {
          current: { id: 'current', piNames: ['PI 26.3'], features: [], countsByBucket: { todo: 0, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: true, isCoverageCapped: false },
          upcoming: { id: 'upcoming', piNames: [], features: [], countsByBucket: { todo: 0, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: false, isCoverageCapped: false },
          carryover: { id: 'carryover', piNames: [], features: [], countsByBucket: { todo: 0, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: true, isCoverageCapped: false },
        },
        scannedFeatureCount: 0,
      }),
      isLoading: false,
      reload: vi.fn(),
    });

    renderPanel();

    expect(screen.getByRole('status')).toHaveTextContent(/matched no Features/i);
  });

  it('renders the load error and no counts when the scan failed', () => {
    mockUseReadinessData.mockReturnValue({
      scanResult: buildScan({ scannedFeatureCount: null, loadError: 'Jira 500' }),
      isLoading: false,
      reload: vi.fn(),
    });

    renderPanel();

    expect(screen.getByRole('alert')).toHaveTextContent('Jira 500');
  });

  it('notes any alert family that is not configured on this instance', () => {
    mockUseReadinessData.mockReturnValue({
      scanResult: buildScan({
        alertFamilyStates: { 'missing-ownership': 'active', 'missing-estimate': 'notConfigured', 'missing-pcode': 'notConfigured', 'target-end-missing-or-past': 'active', 'due-date-missing-or-past': 'active' },
      }),
      isLoading: false,
      reload: vi.fn(),
    });

    renderPanel();

    expect(screen.getByText(/not checked — no matching field/i)).toBeInTheDocument();
  });

  it('renders an inline fix control for each alert on a feature', () => {
    mockUseReadinessData.mockReturnValue({
      scanResult: buildScan({
        lenses: {
          current: { id: 'current', piNames: ['PI 26.3'], features: [buildFeature('CUR-1', { alerts: ['missing-ownership', 'missing-pcode'] })], countsByBucket: { todo: 1, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: true, isCoverageCapped: false },
          upcoming: { id: 'upcoming', piNames: [], features: [], countsByBucket: { todo: 0, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: false, isCoverageCapped: false },
          carryover: { id: 'carryover', piNames: [], features: [], countsByBucket: { todo: 0, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: true, isCoverageCapped: false },
        },
        scannedFeatureCount: 1,
      }),
      isLoading: false,
      reload: vi.fn(),
    });

    renderPanel();

    expect(screen.getByTestId('fix-missing-ownership')).toBeInTheDocument();
    expect(screen.getByTestId('fix-missing-pcode')).toBeInTheDocument();
  });

  it('gives every alert family its own colour class so families are distinguishable (GH #197)', () => {
    const allFamilies = ['missing-ownership', 'missing-estimate', 'missing-pcode', 'target-end-missing-or-past', 'due-date-missing-or-past'];
    mockUseReadinessData.mockReturnValue({
      scanResult: buildScan({
        lenses: {
          current: { id: 'current', piNames: ['PI 26.3'], features: [buildFeature('CUR-1', { alerts: allFamilies as ReadinessFeature['alerts'] })], countsByBucket: { todo: 1, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: true, isCoverageCapped: false },
          upcoming: { id: 'upcoming', piNames: [], features: [], countsByBucket: { todo: 0, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: false, isCoverageCapped: false },
          carryover: { id: 'carryover', piNames: [], features: [], countsByBucket: { todo: 0, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: true, isCoverageCapped: false },
        },
        scannedFeatureCount: 1,
      }),
      isLoading: false,
      reload: vi.fn(),
    });

    renderPanel();

    // Each family carries its own data hook and its own colour modifier class; no two families share a class,
    // which is exactly what "same colour for all alerts" (GH #197) violated.
    const flagClasses = allFamilies.map((family) => {
      const flag = document.querySelector(`[data-alert-family="${family}"]`) as HTMLElement;
      expect(flag).not.toBeNull();
      return flag.className;
    });
    expect(new Set(flagClasses).size).toBe(allFamilies.length);
  });

  // ── Clicking the card toggles its details ──

  it('expands and collapses a feature card when the card body is clicked', () => {
    renderPanel();

    const card = screen.getByText('CUR-1').closest('[role="button"]') as HTMLElement;
    expect(card).toHaveAttribute('aria-expanded', 'false');

    // Click the summary text — a non-control part of the card body — not the arrow.
    fireEvent.click(screen.getByText('Feature CUR-1'));
    expect(card).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByText('Feature CUR-1'));
    expect(card).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands the card when the alert region (a non-control area) is clicked', () => {
    mockUseReadinessData.mockReturnValue({
      scanResult: buildScan({
        lenses: {
          current: { id: 'current', piNames: ['PI 26.3'], features: [buildFeature('CUR-1', { alerts: ['missing-ownership'] })], countsByBucket: { todo: 1, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: true, isCoverageCapped: false },
          upcoming: { id: 'upcoming', piNames: [], features: [], countsByBucket: { todo: 0, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: false, isCoverageCapped: false },
          carryover: { id: 'carryover', piNames: [], features: [], countsByBucket: { todo: 0, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: true, isCoverageCapped: false },
        },
        scannedFeatureCount: 1,
      }),
      isLoading: false,
      reload: vi.fn(),
    });

    renderPanel();
    const card = screen.getByText('CUR-1').closest('[role="button"]') as HTMLElement;

    // The alert flag label is a plain span in the card body — clicking it toggles the card.
    fireEvent.click(screen.getByText('Missing Owner'));
    expect(card).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not toggle the card when its Jira key link is clicked', () => {
    renderPanel();

    const card = screen.getByText('CUR-1').closest('[role="button"]') as HTMLElement;
    fireEvent.click(screen.getByRole('link', { name: 'CUR-1' }));
    expect(card).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not toggle the card when an ignore button is clicked', () => {
    renderPanel();

    const card = screen.getByText('CUR-1').closest('[role="button"]') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'Ignore CUR-1' }));
    expect(card).toHaveAttribute('aria-expanded', 'false');
  });

  // ── Ignore projects and features ──

  it('ignores a feature (persisting it) and triggers a rescan', () => {
    window.localStorage.clear();
    const reload = vi.fn();
    mockUseReadinessData.mockReturnValue({ scanResult: buildScan(), isLoading: false, reload });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Ignore CUR-1' }));

    const stored = JSON.parse(window.localStorage.getItem('tbxReadinessIgnored') ?? '{}');
    expect(stored.ignoredFeatureKeys).toContain('CUR-1');
    expect(reload).toHaveBeenCalled();
  });

  it('ignores a whole project from a row', () => {
    window.localStorage.clear();
    mockUseReadinessData.mockReturnValue({ scanResult: buildScan(), isLoading: false, reload: vi.fn() });

    renderPanel();
    // Both CUR features expose the project-ignore button; ignoring from either records the project once.
    fireEvent.click(screen.getAllByRole('button', { name: 'Ignore project CUR' })[0]);

    const stored = JSON.parse(window.localStorage.getItem('tbxReadinessIgnored') ?? '{}');
    expect(stored.ignoredProjectKeys).toContain('CUR');
  });

  it('shows the ignored manager with a restore control once something is ignored', () => {
    window.localStorage.setItem('tbxReadinessIgnored', JSON.stringify({ ignoredProjectKeys: ['OTHER'], ignoredFeatureKeys: [] }));
    mockUseReadinessData.mockReturnValue({ scanResult: buildScan(), isLoading: false, reload: vi.fn() });

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Ignored \(1\)/ }));

    expect(screen.getByRole('button', { name: 'Restore project OTHER' })).toBeInTheDocument();
  });

  // ── View features by team ──

  function renderPanelWithTeams(initialPath = '/agile-hub?space=train&artTab=readiness') {
    mockUseReadinessData.mockReturnValue({
      scanResult: buildScan({
        lenses: {
          current: {
            id: 'current', piNames: ['PI 26.3'], features: [
              buildFeature('ALPHA-1', {}, ['team-alpha']),
              buildFeature('BETA-1', {}, ['team-beta']),
              buildFeature('LOOSE-1', {}, ['misc']),
            ],
            countsByBucket: { todo: 3, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: true, isCoverageCapped: false,
          },
          upcoming: { id: 'upcoming', piNames: [], features: [], countsByBucket: { todo: 0, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: false, isCoverageCapped: false },
          carryover: { id: 'carryover', piNames: [], features: [], countsByBucket: { todo: 0, inProgress: 0, done: 0 }, refinedCount: 0, unrefinedCount: 0, isPiConfigured: true, isCoverageCapped: false },
        },
        scannedFeatureCount: 3,
      }),
      isLoading: false,
      reload: vi.fn(),
    });
    render(
      <MemoryRouter initialEntries={[initialPath]}>
        <ReadinessPanel
          selectedPiName="PI 26.3"
          availablePiNames={['PI 26.4', 'PI 26.3']}
          rosterTeams={[{ name: 'Alpha', jiraLabel: 'team-alpha' }, { name: 'Beta', jiraLabel: 'team-beta' }]}
        />
        <LocationProbe />
      </MemoryRouter>,
    );
  }

  it('offers a team filter built from the roster and narrows the listing to the chosen team', () => {
    renderPanelWithTeams();

    // All three features show under "All teams".
    expect(screen.getByText('ALPHA-1')).toBeInTheDocument();
    expect(screen.getByText('BETA-1')).toBeInTheDocument();
    expect(screen.getByText('LOOSE-1')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter by team'), { target: { value: 'team-alpha' } });

    expect(screen.getByText('ALPHA-1')).toBeInTheDocument();
    expect(screen.queryByText('BETA-1')).not.toBeInTheDocument();
    expect(screen.queryByText('LOOSE-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('readinessTeam=team-alpha');
  });

  it('shows only features carrying no team label under Unlabeled', () => {
    renderPanelWithTeams();

    fireEvent.change(screen.getByLabelText('Filter by team'), { target: { value: '__unlabeled__' } });

    expect(screen.getByText('LOOSE-1')).toBeInTheDocument();
    expect(screen.queryByText('ALPHA-1')).not.toBeInTheDocument();
    expect(screen.queryByText('BETA-1')).not.toBeInTheDocument();
  });

  it('honors a deep-linked team on arrival', () => {
    renderPanelWithTeams('/agile-hub?space=train&artTab=readiness&readinessTeam=team-beta');

    expect(screen.getByText('BETA-1')).toBeInTheDocument();
    expect(screen.queryByText('ALPHA-1')).not.toBeInTheDocument();
  });

  it('shows no team filter when the roster defines no labels', () => {
    mockUseReadinessData.mockReturnValue({ scanResult: buildScan(), isLoading: false, reload: vi.fn() });
    renderPanel(); // rosterTeams=[] in the default renderPanel

    expect(screen.queryByLabelText('Filter by team')).not.toBeInTheDocument();
  });
});
