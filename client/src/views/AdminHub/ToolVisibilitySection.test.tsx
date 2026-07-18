// ToolVisibilitySection.test.tsx — Tests for the Tool Visibility section (live store binding, spec 020).

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useToolVisibilityStore } from '../../store/toolVisibilityStore.ts';
import ToolVisibilitySection from './ToolVisibilitySection';

describe('ToolVisibilitySection', () => {
  beforeEach(() => {
    localStorage.clear();
    useToolVisibilityStore.setState({ visibilityByCardId: {} });
  });

  it('renders the section heading and bulk buttons', () => {
    render(<ToolVisibilitySection />);
    expect(screen.getByRole('heading', { name: /tool visibility/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show all/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide all/i })).toBeInTheDocument();
  });

  it('renders a toggle for hideable cards, defaulting to visible', () => {
    render(<ToolVisibilitySection />);
    const textToolsToggle = screen.getByLabelText(/toggle visibility of text tools/i) as HTMLInputElement;
    expect(textToolsToggle.checked).toBe(true);
  });

  it('offers NO toggle for the Admin Hub — the control that could lock you out does not exist', () => {
    render(<ToolVisibilitySection />);
    expect(screen.queryByLabelText(/toggle visibility of admin hub/i)).not.toBeInTheDocument();
  });

  it('offers no toggles for the retired tools (their card ids left the catalog)', () => {
    render(<ToolVisibilitySection />);
    expect(screen.queryByLabelText(/toggle visibility of team dashboard/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/toggle visibility of po tool/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/toggle visibility of art view/i)).not.toBeInTheDocument();
  });

  it('writes toggles through the SHARED store so the home page reacts live (spec 020 FR-003)', () => {
    render(<ToolVisibilitySection />);

    fireEvent.click(screen.getByLabelText(/toggle visibility of text tools/i));

    expect(useToolVisibilityStore.getState().visibilityByCardId['text-tools']).toBe(false);
    const persistedMap = JSON.parse(localStorage.getItem('tbxToolVisibility') ?? '{}');
    expect(persistedMap['text-tools']).toBe(false);
  });

  it('reflects an external store change without remounting (one store, one truth)', () => {
    render(<ToolVisibilitySection />);
    const textToolsToggle = screen.getByLabelText(/toggle visibility of text tools/i) as HTMLInputElement;
    expect(textToolsToggle.checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /hide all/i }));
    expect(textToolsToggle.checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /show all/i }));
    expect(textToolsToggle.checked).toBe(true);
  });

  it('reads a map persisted by the previous implementation on mount (same key, same shape)', () => {
    localStorage.setItem('tbxToolVisibility', JSON.stringify({ 'text-tools': false }));
    useToolVisibilityStore.setState({ visibilityByCardId: { 'text-tools': false } });

    render(<ToolVisibilitySection />);

    const textToolsToggle = screen.getByLabelText(/toggle visibility of text tools/i) as HTMLInputElement;
    expect(textToolsToggle.checked).toBe(false);
  });
});
