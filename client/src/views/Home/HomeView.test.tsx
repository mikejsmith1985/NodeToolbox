// HomeView.test.tsx — Unit tests for the persona-aware Home view.

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

import { useSettingsStore } from '@/store/settingsStore.ts';
import HomeView from './HomeView.tsx';
import { APP_CARDS } from './homeCardData.ts';

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
    useSettingsStore.setState({ homePersona: 'all', cardOrder: [], recentViews: [] });
  });

  it('renders the main heading', () => {
    renderHomeView();

    expect(screen.getByRole('heading', { name: 'Your personal utility belt' })).toBeInTheDocument();
  });

  it('shows all twenty app cards', () => {
    renderHomeView();

    APP_CARDS.forEach((appCard) => {
      expect(screen.getByRole('heading', { name: appCard.title })).toBeInTheDocument();
    });
  });

  it('reorders cards when the Dev persona is selected', async () => {
    const user = userEvent.setup();
    renderHomeView();

    await user.click(screen.getByRole('button', { name: /dev/i }));

    const cardTitles = screen.getAllByRole('heading', { level: 3 }).map((headingElement) => {
      return headingElement.textContent;
    });

    expect(cardTitles[0]).toBe('Dev Workspace');
  });

  it('hides the recent views section when there are no recent views', () => {
    renderHomeView();

    expect(screen.queryByText('Recently Used')).not.toBeInTheDocument();
  });

  it('shows recent-view chips when recent views are available', () => {
    useSettingsStore.setState({ recentViews: ['dev-workspace', 'reports-hub'] });

    renderHomeView();

    expect(screen.getByText('Recently Used')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '🏗 Dev Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '📈 Reports Hub' })).toBeInTheDocument();
  });

  it('maps legacy dsu-board recents to the Team Dashboard route', () => {
    useSettingsStore.setState({ recentViews: ['dsu-board'] });

    renderHomeView();

    expect(screen.getByRole('link', { name: '🏃 Team Dashboard' })).toHaveAttribute(
      'href',
      '/sprint-dashboard',
    );
  });
});
