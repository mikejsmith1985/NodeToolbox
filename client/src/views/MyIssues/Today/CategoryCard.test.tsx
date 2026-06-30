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
  render(
    <CategoryCard
      entry={ENTRY}
      result={buildResult()}
      isComplete={false}
      onToggleComplete={onToggleComplete}
      onNavigate={onNavigate}
      onRetry={onRetry}
      {...props}
    />,
  );
  return { onToggleComplete, onNavigate, onRetry };
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
