// ToolVisibilitySection.test.tsx — Tests for the Tool Visibility (feature flags) section.

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import ToolVisibilitySection from './ToolVisibilitySection';

describe('ToolVisibilitySection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders the section heading', () => {
    render(<ToolVisibilitySection />);
    expect(screen.getByRole('heading', { name: /tool visibility/i })).toBeInTheDocument();
  });

  it('renders a Show All button', () => {
    render(<ToolVisibilitySection />);
    expect(screen.getByRole('button', { name: /show all/i })).toBeInTheDocument();
  });

  it('renders a Hide All button', () => {
    render(<ToolVisibilitySection />);
    expect(screen.getByRole('button', { name: /hide all/i })).toBeInTheDocument();
  });

  it('renders a toggle for each APP_CARD (at least one card exists)', () => {
    render(<ToolVisibilitySection />);
    // Team Dashboard is always in APP_CARDS.
    expect(
      screen.getByLabelText(/toggle visibility of team dashboard/i),
    ).toBeInTheDocument();
  });

  it('defaults all tools to visible (checked) when no localStorage data exists', () => {
    render(<ToolVisibilitySection />);
    const teamDashboard = screen.getByLabelText(
      /toggle visibility of team dashboard/i,
    ) as HTMLInputElement;
    expect(teamDashboard.checked).toBe(true);
  });

  it('hides all tools when Hide All is clicked', () => {
    render(<ToolVisibilitySection />);
    fireEvent.click(screen.getByRole('button', { name: /hide all/i }));
    const teamDashboard = screen.getByLabelText(
      /toggle visibility of team dashboard/i,
    ) as HTMLInputElement;
    expect(teamDashboard.checked).toBe(false);
  });

  it('shows all tools when Show All is clicked after Hide All', () => {
    render(<ToolVisibilitySection />);
    fireEvent.click(screen.getByRole('button', { name: /hide all/i }));
    fireEvent.click(screen.getByRole('button', { name: /show all/i }));
    const teamDashboard = screen.getByLabelText(
      /toggle visibility of team dashboard/i,
    ) as HTMLInputElement;
    expect(teamDashboard.checked).toBe(true);
  });

  it('persists visibility state to localStorage when a toggle changes', () => {
    render(<ToolVisibilitySection />);
    const teamDashboard = screen.getByLabelText(/toggle visibility of team dashboard/i);
    fireEvent.click(teamDashboard);
    const stored = localStorage.getItem('tbxToolVisibility');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed['sprint-dashboard']).toBe(false);
  });

  it('reads persisted visibility from localStorage on mount', () => {
    localStorage.setItem(
      'tbxToolVisibility',
      JSON.stringify({ 'sprint-dashboard': false }),
    );
    render(<ToolVisibilitySection />);
    const teamDashboard = screen.getByLabelText(
      /toggle visibility of team dashboard/i,
    ) as HTMLInputElement;
    expect(teamDashboard.checked).toBe(false);
  });
});
