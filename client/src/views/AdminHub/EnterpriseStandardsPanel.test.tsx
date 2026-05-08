// EnterpriseStandardsPanel.test.tsx — Tests for the Enterprise Standards Rules panel.

import { act, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EnterpriseStandardsPanel from './EnterpriseStandardsPanel';

describe('EnterpriseStandardsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders the section heading', () => {
    render(<EnterpriseStandardsPanel />);
    expect(
      screen.getByRole('heading', { name: /enterprise standards rules/i }),
    ).toBeInTheDocument();
  });

  it('renders built-in default rules', () => {
    render(<EnterpriseStandardsPanel />);
    expect(screen.getByText(/missing assignee/i)).toBeInTheDocument();
    expect(screen.getByText(/stale ticket/i)).toBeInTheDocument();
    expect(screen.getByText(/unpointed story/i)).toBeInTheDocument();
  });

  it('renders the Save Changes button', () => {
    render(<EnterpriseStandardsPanel />);
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('renders the Add Custom Rule button', () => {
    render(<EnterpriseStandardsPanel />);
    expect(screen.getByRole('button', { name: /add custom rule/i })).toBeInTheDocument();
  });

  it('renders the Reset to Defaults button', () => {
    render(<EnterpriseStandardsPanel />);
    expect(screen.getByRole('button', { name: /reset to defaults/i })).toBeInTheDocument();
  });

  it('opens the add-rule form when Add Custom Rule is clicked', () => {
    render(<EnterpriseStandardsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /add custom rule/i }));
    expect(screen.getByLabelText(/rule name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  });

  it('adds a custom rule when the form is submitted', () => {
    render(<EnterpriseStandardsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /add custom rule/i }));
    fireEvent.change(screen.getByLabelText(/rule name/i), {
      target: { value: 'My Custom Rule' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add rule$/i }));
    expect(screen.getByText('My Custom Rule')).toBeInTheDocument();
  });

  it('toggles a rule enabled state when the checkbox is changed', () => {
    render(<EnterpriseStandardsPanel />);
    const toggles = screen.getAllByRole('checkbox');
    const firstToggle = toggles[0] as HTMLInputElement;
    expect(firstToggle.checked).toBe(true);
    fireEvent.click(firstToggle);
    expect(firstToggle.checked).toBe(false);
  });

  it('persists rules to localStorage when Save Changes is clicked', () => {
    render(<EnterpriseStandardsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    const stored = localStorage.getItem('tbxEnterpriseStandards');
    expect(stored).not.toBeNull();
  });

  it('shows a saved confirmation after Save Changes', () => {
    render(<EnterpriseStandardsPanel />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    });
    expect(screen.getByText(/✓ saved/i)).toBeInTheDocument();
  });

  it('resets to defaults when Reset to Defaults is confirmed', () => {
    render(<EnterpriseStandardsPanel />);
    // First add a custom rule.
    fireEvent.click(screen.getByRole('button', { name: /add custom rule/i }));
    fireEvent.change(screen.getByLabelText(/rule name/i), {
      target: { value: 'Custom Temp Rule' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add rule$/i }));
    expect(screen.getByText('Custom Temp Rule')).toBeInTheDocument();

    // Now reset.
    fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
    fireEvent.click(screen.getByRole('button', { name: /^reset to defaults$/i }));
    expect(screen.queryByText('Custom Temp Rule')).not.toBeInTheDocument();
  });

  it('shows a delete button only for custom (non-built-in) rules', () => {
    render(<EnterpriseStandardsPanel />);
    // No delete buttons visible for built-in rules.
    expect(screen.queryAllByRole('button', { name: /delete/i })).toHaveLength(0);

    // Add a custom rule.
    fireEvent.click(screen.getByRole('button', { name: /add custom rule/i }));
    fireEvent.change(screen.getByLabelText(/rule name/i), {
      target: { value: 'Deletable Rule' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add rule$/i }));
    expect(screen.getAllByRole('button', { name: /delete deletable rule/i })).toHaveLength(1);
  });

  it('loads persisted rules from localStorage on mount', () => {
    const savedRules = [
      {
        id: 'persisted-rule',
        name: 'Persisted Rule',
        description: 'From storage',
        isBuiltIn: false,
        isEnabled: true,
      },
    ];
    localStorage.setItem('tbxEnterpriseStandards', JSON.stringify(savedRules));
    render(<EnterpriseStandardsPanel />);
    expect(screen.getByText('Persisted Rule')).toBeInTheDocument();
  });

  it('cancels the add-rule form without adding a rule', () => {
    render(<EnterpriseStandardsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /add custom rule/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByLabelText(/rule name/i)).not.toBeInTheDocument();
  });
});
