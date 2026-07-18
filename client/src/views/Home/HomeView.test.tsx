// HomeView.test.tsx — Unit tests for the sortable Home view with honest gating (spec 020).

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  MouseSensor: class {},
  TouchSensor: class {},
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  rectSortingStrategy: vi.fn(),
  arrayMove: (items: unknown[]) => items,
}));

import { useAdminStore } from '@/store/adminStore.ts';
import { useSettingsStore } from '@/store/settingsStore.ts';
import { setToolVisibility, useToolVisibilityStore } from '@/store/toolVisibilityStore.ts';
import HomeView from './HomeView.tsx';
import { APP_CARDS } from './homeCardData.ts';
import styles from './HomeView.module.css';

function renderHomeView() {
  render(
    <MemoryRouter>
      <HomeView />
    </MemoryRouter>,
  );
}

describe('HomeView', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSettingsStore.setState({ cardOrder: [], recentViews: [] });
    useToolVisibilityStore.setState({ visibilityByCardId: {} });
    useAdminStore.setState({ isAdminUnlocked: false });
  });

  it('renders the main heading', () => {
    renderHomeView();

    expect(screen.getByRole('heading', { name: 'Your personal utility belt' })).toBeInTheDocument();
  });

  it('shows every ungated app card by default', () => {
    renderHomeView();

    APP_CARDS.filter((appCard) => appCard.gateKind === undefined).forEach((appCard) => {
      expect(screen.getByRole('heading', { name: appCard.title })).toBeInTheDocument();
    });
  });

  // ── Spec 020 US1: honest gating ──

  it('hides the SNow Hub card and its recents chip while Admin Hub is locked', () => {
    useSettingsStore.setState({ recentViews: ['snow-hub'] });

    renderHomeView();

    expect(screen.queryByRole('heading', { name: 'SNow Hub' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '❄️ SNow Hub' })).not.toBeInTheDocument();
  });

  it('shows the SNow Hub card while Admin Hub is unlocked in this session', () => {
    useAdminStore.setState({ isAdminUnlocked: true });

    renderHomeView();

    expect(screen.getByRole('heading', { name: 'SNow Hub' })).toBeInTheDocument();
  });

  it('hides a tool switched off in the visibility map, card and recents chip alike', () => {
    useSettingsStore.setState({ recentViews: ['text-tools'] });
    setToolVisibility('text-tools', false);

    renderHomeView();

    expect(screen.queryByRole('heading', { name: 'Text Tools' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '🛠 Text Tools' })).not.toBeInTheDocument();
  });

  it('always shows the Admin Hub card even when the stored map claims it is hidden', () => {
    useToolVisibilityStore.setState({ visibilityByCardId: { 'admin-hub': false } });

    renderHomeView();

    expect(screen.getByRole('heading', { name: 'Admin Hub' })).toBeInTheDocument();
  });

  // ── Spec 020 US2: job-shaped catalog ──

  it('renders the three job sections with their default cards', () => {
    renderHomeView();

    expect(screen.getByText('🙋 My Work')).toBeInTheDocument();
    expect(screen.getByText('🏃 Agile Delivery')).toBeInTheDocument();
    expect(screen.getByText('📈 Insights & Admin')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agile Hub' })).toBeInTheDocument();
    // The retired cards are gone from the catalog.
    expect(screen.queryByRole('heading', { name: 'Team Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'PO Tool' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ART View' })).not.toBeInTheDocument();
  });

  it('renders no divider for a section whose cards are all hidden', () => {
    setToolVisibility('my-issues', false);
    setToolVisibility('personal-toolbox', false);

    renderHomeView();

    expect(screen.queryByText('🙋 My Work')).not.toBeInTheDocument();
  });

  it('tolerates a saved card order that still references retired tool ids', () => {
    useSettingsStore.setState({ cardOrder: ['sprint-dashboard', 'po-tool', 'my-issues', 'agile-hub'] });

    renderHomeView();

    expect(screen.getByRole('heading', { name: 'My Issues' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agile Hub' })).toBeInTheDocument();
  });

  it('resolves retired-tool recents (incl. legacy dsu-board) to the Agile Hub', () => {
    useSettingsStore.setState({ recentViews: ['dsu-board'] });

    renderHomeView();

    expect(screen.getByRole('link', { name: '🏃 Agile Hub' })).toHaveAttribute('href', '/agile-hub');
  });

  // ── Pre-existing behaviors that must survive the reorganization ──

  it('hides the recent views section when there are no recent views', () => {
    renderHomeView();

    expect(screen.queryByText('Recently Used')).not.toBeInTheDocument();
  });

  it('shows recent-view chips when recent views are available', () => {
    useSettingsStore.setState({ recentViews: ['dev-workspace', 'reports-hub'] });

    renderHomeView();

    expect(screen.getByText('Recently Used')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '📊 My Issues' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '📈 Reports Hub' })).toBeInTheDocument();
  });

  it('wraps each home card in a full-height grid slot so card sizes stay uniform', () => {
    renderHomeView();

    const myIssuesCardLink = screen.getByRole('link', { name: /my issues/i });
    expect(myIssuesCardLink.parentElement).toHaveClass(styles.cardSlot);
  });
});
