// AgileHubView.test.tsx — Unit tests for the Agile Hub thin shell (spec 020 US3).

import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The shell mounts the three REAL views unchanged; tests replace them with markers.
vi.mock('../SprintDashboard/SprintDashboardView.tsx', () => ({
  default: () => <h1>Sprint Dashboard Mock</h1>,
}));
vi.mock('../PoTool/PoToolView.tsx', () => ({
  default: () => <h1>PO Tool Mock</h1>,
}));
vi.mock('../ArtView/ArtView.tsx', () => ({
  default: () => <h1>ART View Mock</h1>,
}));

import { useSettingsStore } from '../../store/settingsStore.ts';
import AgileHubView from './AgileHubView.tsx';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderAgileHub(initialPath = '/agile-hub') {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AgileHubView />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('AgileHubView', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSettingsStore.setState({ agileHubLastSpace: 'team' });
  });

  it('honors the ?space= param as the authoritative space', () => {
    renderAgileHub('/agile-hub?space=product');

    expect(screen.getByRole('heading', { name: 'PO Tool Mock' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sprint Dashboard Mock' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ART View Mock' })).not.toBeInTheDocument();
  });

  it('falls back to the persisted last space when the param is absent', () => {
    useSettingsStore.setState({ agileHubLastSpace: 'train' });

    renderAgileHub('/agile-hub');

    expect(screen.getByRole('heading', { name: 'ART View Mock' })).toBeInTheDocument();
  });

  it('falls back to Team for an invalid param and an invalid persisted value', () => {
    useSettingsStore.setState({ agileHubLastSpace: 'bogus' });

    renderAgileHub('/agile-hub?space=nonsense');

    expect(screen.getByRole('heading', { name: 'Sprint Dashboard Mock' })).toBeInTheDocument();
  });

  it('always shows all three space controls — audiences are lenses, not permissions (FR-013)', () => {
    renderAgileHub('/agile-hub');

    expect(screen.getByRole('button', { name: /Team/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Product/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Train/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switching spaces updates the URL param, persists the last space, and swaps the mounted view', () => {
    renderAgileHub('/agile-hub?space=team');

    fireEvent.click(screen.getByRole('button', { name: /Product/ }));

    expect(screen.getByRole('heading', { name: 'PO Tool Mock' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sprint Dashboard Mock' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('space=product');
    expect(useSettingsStore.getState().agileHubLastSpace).toBe('product');
  });

  it('persists a deep-linked space as the last space (arriving IS using it)', () => {
    renderAgileHub('/agile-hub?space=train');

    expect(useSettingsStore.getState().agileHubLastSpace).toBe('train');
  });

  it('leaves foreign query params untouched for the mounted view to consume', () => {
    renderAgileHub('/agile-hub?space=team&hygieneFilter=stale');

    fireEvent.click(screen.getByRole('button', { name: /Train/ }));

    expect(screen.getByTestId('location-probe')).toHaveTextContent('hygieneFilter=stale');
    expect(screen.getByTestId('location-probe')).toHaveTextContent('space=train');
  });
});
