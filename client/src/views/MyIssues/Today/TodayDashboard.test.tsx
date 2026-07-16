// TodayDashboard.test.tsx — Component tests for the Today dashboard composition layer.
//
// The orchestration and checklist hooks are mocked so these tests focus on rendering: the
// ready grid, an errored card not blanking its siblings, the connection-required gate, and the
// done-for-today confirmation.

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseTodayDashboard, mockUseChecklistCompletion } = vi.hoisted(() => ({
  mockUseTodayDashboard: vi.fn(),
  mockUseChecklistCompletion: vi.fn(),
}));

vi.mock('./hooks/useTodayDashboard.ts', () => ({ useTodayDashboard: mockUseTodayDashboard }));
vi.mock('./hooks/useChecklistCompletion.ts', () => ({ useChecklistCompletion: mockUseChecklistCompletion }));
vi.mock('../../../store/settingsStore.ts', () => ({
  useSettingsStore: { getState: () => ({ setSprintDashboardActiveTab: vi.fn() }) },
}));

import TodayDashboard from './TodayDashboard.tsx';
import { CATEGORY_CATALOG, type CategoryId } from './todayCategories.ts';
import type { CategoryResult } from './hooks/useTodayDashboard.ts';

function buildCategories(
  overrides: Partial<Record<CategoryId, CategoryResult>> = {},
): Record<CategoryId, CategoryResult> {
  const categories = {} as Record<CategoryId, CategoryResult>;
  for (const catalogEntry of CATEGORY_CATALOG) {
    categories[catalogEntry.id] = {
      id: catalogEntry.id,
      status: 'ready',
      count: 0,
      destination: { kind: 'myIssuesTab', tab: 'report' },
    };
  }
  return { ...categories, ...overrides };
}

function buildCompletion(isDoneForToday = false) {
  const completionByCategory = {} as Record<CategoryId, boolean>;
  for (const catalogEntry of CATEGORY_CATALOG) {
    completionByCategory[catalogEntry.id] = true;
  }
  return { completionByCategory, toggle: vi.fn(), isDoneForToday };
}

function buildDashboard(overrides: Record<string, unknown> = {}) {
  return {
    categories: buildCategories(),
    isConnectionReady: true,
    refresh: vi.fn(),
    sprintIssues: [],
    sprintInfo: null,
    ...overrides,
  };
}

function renderDashboard() {
  render(
    <MemoryRouter initialEntries={['/my-issues']}>
      <TodayDashboard />
    </MemoryRouter>,
  );
}

/** Records the router location so navigation tests can assert the exact query the dashboard built. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
}

function renderDashboardWithLocationProbe() {
  render(
    <MemoryRouter initialEntries={['/my-issues']}>
      <Routes>
        <Route
          path="*"
          element={(
            <>
              <TodayDashboard />
              <LocationProbe />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseTodayDashboard.mockReturnValue(buildDashboard());
  mockUseChecklistCompletion.mockReturnValue(buildCompletion());
});

describe('TodayDashboard', () => {
  it('carries the destination scope params on drill-through, so the target answers what the card counted (GH #167)', () => {
    // The "My stale issues" card counts cross-project; its Open must land Hygiene in the same scope
    // with the stale filter applied — not on whatever single project key was last persisted there.
    mockUseTodayDashboard.mockReturnValue(buildDashboard({
      categories: buildCategories({
        'my-stale': {
          id: 'my-stale',
          status: 'ready',
          count: 2,
          destination: { kind: 'myIssuesTab', tab: 'hygiene', search: { hygieneScope: 'mine', hygieneFilter: 'stale' } },
        },
      }),
    }));

    renderDashboardWithLocationProbe();
    const myStaleCard = document.querySelector('[data-category="my-stale"]');
    fireEvent.click(myStaleCard!.querySelector('button')!);

    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/my-issues?tab=hygiene&hygieneScope=mine&hygieneFilter=stale',
    );
  });

  it('renders a card per catalog category once data is ready', () => {
    renderDashboard();

    expect(screen.getByText('Respond to mentions')).toBeInTheDocument();
    expect(screen.getByText('Unblock issues')).toBeInTheDocument();
    expect(screen.getByText('Sprint flow')).toBeInTheDocument();
  });

  it('keeps sibling cards visible when one card is in an error state', () => {
    mockUseTodayDashboard.mockReturnValue(
      buildDashboard({
        categories: buildCategories({
          blockers: {
            id: 'blockers',
            status: 'error',
            count: 0,
            errorMessage: 'Blocked fetch failed',
            destination: { kind: 'sprintTab', tab: 'blockers' },
          },
        }),
      }),
    );

    renderDashboard();

    expect(screen.getByText('Blocked fetch failed')).toBeInTheDocument();
    expect(screen.getByText('Respond to mentions')).toBeInTheDocument();
  });

  it('shows the connection-required state instead of cards when Jira is not connected', () => {
    mockUseTodayDashboard.mockReturnValue(buildDashboard({ isConnectionReady: false }));

    renderDashboard();

    expect(screen.getByText(/connect to jira/i)).toBeInTheDocument();
    expect(screen.queryByText('Unblock issues')).not.toBeInTheDocument();
  });

  it('shows the done-for-today confirmation when every duty is complete', () => {
    mockUseChecklistCompletion.mockReturnValue(buildCompletion(true));

    renderDashboard();

    expect(screen.getByText(/done for today/i)).toBeInTheDocument();
  });
});
