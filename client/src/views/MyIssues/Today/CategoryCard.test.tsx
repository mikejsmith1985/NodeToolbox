// CategoryCard.test.tsx — Component tests for a single Today category card.
//
// These cover each visual state (loading, ready, error, not-configured) and confirm that the
// link calls onNavigate, the checkbox calls onToggleComplete, and Retry calls onRetry.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import CategoryCard from './CategoryCard.tsx';
import type { CategoryCatalogEntry } from './todayCategories.ts';
import type { CategoryResult } from './hooks/useTodayDashboard.ts';

const ENTRY: CategoryCatalogEntry = { id: 'blockers', label: 'Unblock issues', icon: '🚧', scope: 'mixed' };

function buildResult(overrides: Partial<CategoryResult> = {}): CategoryResult {
  return {
    id: 'blockers',
    status: 'ready',
    count: 3,
    destination: { kind: 'sprintTab', tab: 'blockers' },
    ...overrides,
  };
}

function renderCard(props: Partial<React.ComponentProps<typeof CategoryCard>> = {}) {
  const onToggleComplete = vi.fn();
  const onNavigate = vi.fn();
  const onRetry = vi.fn();
  const onOpenTeam = vi.fn();
  render(
    <CategoryCard
      entry={ENTRY}
      result={buildResult()}
      isComplete={false}
      onToggleComplete={onToggleComplete}
      onNavigate={onNavigate}
      onRetry={onRetry}
      onOpenTeam={onOpenTeam}
      {...props}
    />,
  );
  return { onToggleComplete, onNavigate, onRetry, onOpenTeam };
}

describe('CategoryCard', () => {
  it('shows a loading indicator in the loading state', () => {
    renderCard({ result: buildResult({ status: 'loading' }) });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the count and label in the ready state', () => {
    renderCard();
    expect(screen.getByText('Unblock issues')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('calls onNavigate with the destination when the link is clicked', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderCard();

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(onNavigate).toHaveBeenCalledWith({ kind: 'sprintTab', tab: 'blockers' });
  });

  // ── Per-team breakdown (GH #282 follow-up: an SM sees ALL their saved teams) ──

  it('renders a per-team breakdown chip for each team when more than one team was scanned', () => {
    renderCard({
      result: buildResult({
        teamBreakdown: [
          { teamProfileId: 'alpha-id', teamName: 'Alpha', count: 2, hasError: false, isProjectWideScope: false },
          { teamProfileId: 'beta-id', teamName: 'Beta', count: 6, hasError: false, isProjectWideScope: false },
        ],
      }),
    });

    expect(screen.getByRole('button', { name: /Alpha.*2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Beta.*6/ })).toBeInTheDocument();
  });

  it('opens a specific team when its breakdown chip is clicked', async () => {
    const user = userEvent.setup();
    const { onOpenTeam } = renderCard({
      result: buildResult({
        teamBreakdown: [
          { teamProfileId: 'alpha-id', teamName: 'Alpha', count: 2, hasError: false, isProjectWideScope: false },
          { teamProfileId: 'beta-id', teamName: 'Beta', count: 6, hasError: false, isProjectWideScope: false },
        ],
      }),
    });

    await user.click(screen.getByRole('button', { name: /Beta.*6/ }));

    expect(onOpenTeam).toHaveBeenCalledWith('beta-id', { kind: 'sprintTab', tab: 'blockers' });
  });

  // ── Per-scope breakdown (a my+team union cannot be opened by one link) ──

  it('renders a chip per scope, each labelled with its own share of the count', () => {
    renderCard({
      result: buildResult({
        scopeBreakdown: [
          { id: 'mine', label: 'Mine', count: 8, destination: { kind: 'myIssuesTab', tab: 'hygiene' } },
          { id: 'team', label: 'Team', count: 18, destination: { kind: 'sprintTab', tab: 'hygiene' } },
        ],
      }),
    });

    expect(screen.getByRole('button', { name: /Mine.*8/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Team.*18/ })).toBeInTheDocument();
  });

  it('opens the scope a chip names, not the card default', async () => {
    // The whole point: the card's own Open button can only show one scope, so the OTHER scope had
    // no route out of this screen at all.
    const user = userEvent.setup();
    const teamDestination = { kind: 'sprintTab', tab: 'hygiene', search: { hygieneFilter: 'due-date-overdue' } } as const;
    const { onNavigate } = renderCard({
      result: buildResult({
        scopeBreakdown: [
          { id: 'mine', label: 'Mine', count: 8, destination: { kind: 'myIssuesTab', tab: 'hygiene' } },
          { id: 'team', label: 'Team', count: 18, destination: teamDestination },
        ],
      }),
    });

    await user.click(screen.getByRole('button', { name: /Team.*18/ }));

    expect(onNavigate).toHaveBeenCalledWith(teamDestination);
  });

  it('says nothing about scopes when only one of them has anything in it', () => {
    // A chip row reading "Mine 8 · Team 0" is noise; the Open button already goes to the only
    // scope that has work in it.
    renderCard({
      result: buildResult({
        scopeBreakdown: [
          { id: 'mine', label: 'Mine', count: 8, destination: { kind: 'myIssuesTab', tab: 'hygiene' } },
          { id: 'team', label: 'Team', count: 0, destination: { kind: 'sprintTab', tab: 'hygiene' } },
        ],
      }),
    });

    expect(screen.queryByRole('button', { name: /Mine/ })).not.toBeInTheDocument();
  });

  // ── Partial counts (a floor must not read as a total) ──

  it('renders a share with no destination as a label, not a button that goes somewhere wrong', () => {
    renderCard({
      result: buildResult({
        scopeBreakdown: [
          { id: 'mine', label: 'Mine', count: 1, destination: { kind: 'myIssuesTab', tab: 'hygiene' } },
          { id: 'team', label: 'Team', count: 26 },
        ],
      }),
    });

    expect(screen.getByRole('button', { name: /Mine.*1/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Team.*26/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Team 26/)).toBeInTheDocument();
  });

  it('activates the team a share names before opening it', async () => {
    const user = userEvent.setup();
    const teamDestination = { kind: 'sprintTab', tab: 'hygiene' } as const;
    const { onOpenTeam } = renderCard({
      result: buildResult({
        scopeBreakdown: [
          { id: 'mine', label: 'Mine', count: 1, destination: { kind: 'myIssuesTab', tab: 'hygiene' } },
          { id: 'team', label: 'Team', count: 26, destination: teamDestination, teamProfileId: 'alpha-id' },
        ],
      }),
    });

    await user.click(screen.getByRole('button', { name: /Team.*26/ }));

    expect(onOpenTeam).toHaveBeenCalledWith('alpha-id', teamDestination);
  });

  it('marks a partial count so a floor is not read as a total', () => {
    renderCard({ result: buildResult({ count: 26, isPartial: true }) });

    expect(screen.getByLabelText(/at least 26/i)).toBeInTheDocument();
    expect(screen.getByText('26+')).toBeInTheDocument();
  });

  it('leaves a complete count unmarked', () => {
    renderCard({ result: buildResult({ count: 26 }) });

    expect(screen.getByText('26')).toBeInTheDocument();
    expect(screen.queryByText('26+')).not.toBeInTheDocument();
  });

  it('marks a team that audited the whole project, so its share is explainable', () => {
    // The number that could not be reconciled: a saved profile with no PI, sprint or fix version
    // scans everything, so its findings are a superset of the PI-scoped Hygiene tab and the extra
    // ones look like they came from nowhere. The chip now says which team did that.
    renderCard({
      result: buildResult({
        teamBreakdown: [
          { teamProfileId: 'alpha-id', teamName: 'Alpha', count: 2, hasError: false, isProjectWideScope: false },
          { teamProfileId: 'beta-id', teamName: 'Beta', count: 24, hasError: false, isProjectWideScope: true },
        ],
      }),
    });

    expect(screen.getByRole('button', { name: /Beta.*24/ }))
      .toHaveAttribute('title', expect.stringContaining('whole project'));
    expect(screen.getByRole('button', { name: /Alpha.*2/ }))
      .not.toHaveAttribute('title', expect.stringContaining('whole project'));
  });

  it('marks a team whose scan failed instead of showing a false zero', () => {
    renderCard({
      result: buildResult({
        teamBreakdown: [
          { teamProfileId: 'alpha-id', teamName: 'Alpha', count: 0, hasError: true, isProjectWideScope: false },
          { teamProfileId: 'beta-id', teamName: 'Beta', count: 6, hasError: false, isProjectWideScope: false },
        ],
      }),
    });

    expect(screen.getByRole('button', { name: /Alpha.*⚠/ })).toBeInTheDocument();
  });

  it('shows no breakdown when only one team was scanned', () => {
    renderCard({
      result: buildResult({
        teamBreakdown: [{ teamProfileId: 'alpha-id', teamName: 'Alpha', count: 2, hasError: false, isProjectWideScope: false }],
      }),
    });

    expect(screen.queryByRole('button', { name: /Alpha/ })).not.toBeInTheDocument();
  });

  it('calls onToggleComplete when the checkbox is toggled', async () => {
    const user = userEvent.setup();
    const { onToggleComplete } = renderCard();

    await user.click(screen.getByRole('checkbox'));

    expect(onToggleComplete).toHaveBeenCalled();
  });

  it('renders cleared styling when complete with a zero count', () => {
    renderCard({ result: buildResult({ count: 0 }), isComplete: true });
    expect(screen.getByRole('button', { name: 'Cleared' })).toBeInTheDocument();
  });

  it('shows the error message and a working Retry button in the error state', async () => {
    const user = userEvent.setup();
    const { onRetry } = renderCard({
      result: buildResult({ status: 'error', errorMessage: 'Boom' }),
    });

    expect(screen.getByText('Boom')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalled();
  });

  it('shows the not-configured state with a link to the Sprint Dashboard', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderCard({ result: buildResult({ status: 'not-configured', count: 0 }) });

    expect(screen.getByText(/team not set up/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /configure team/i }));

    expect(onNavigate).toHaveBeenCalledWith({ kind: 'sprintTab', tab: 'settings' });
  });
});
