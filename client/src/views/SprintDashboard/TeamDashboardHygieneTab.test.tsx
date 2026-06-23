// TeamDashboardHygieneTab.test.tsx — Tests for Team Dashboard hygiene adapter behavior.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TeamDashboardHygieneTab from './TeamDashboardHygieneTab.tsx';
import { HYGIENE_PROJECT_KEY_STORAGE_KEY } from '../Hygiene/hooks/useHygieneState.ts';

// The embedded Hygiene view auto-runs a Jira search on mount; stub the API so the
// adapter tests stay focused on how the team project key reaches the Hygiene view.
vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn().mockResolvedValue({ issues: [] }),
}));

describe('TeamDashboardHygieneTab', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const defaultScopeProps = {
    scopeMode: 'sprint' as const,
    selectedPiValue: '',
    selectedFixVersionName: '',
    selectedSprintId: null,
  };

  it('scopes the embedded Hygiene view to the active Team Dashboard project key', () => {
    render(<TeamDashboardHygieneTab projectKey="tbx" {...defaultScopeProps} />);

    expect(screen.getByRole('textbox', { name: 'Project key' })).toHaveValue('TBX');
    expect(screen.getByRole('heading', { name: 'Hygiene' })).toBeInTheDocument();
  });

  it('re-scopes Hygiene when the team is switched without leaving the previous team behind', () => {
    const { rerender } = render(<TeamDashboardHygieneTab projectKey="alpha" {...defaultScopeProps} />);

    expect(screen.getByRole('textbox', { name: 'Project key' })).toHaveValue('ALPHA');

    rerender(<TeamDashboardHygieneTab projectKey="beta" {...defaultScopeProps} />);

    expect(screen.getByRole('textbox', { name: 'Project key' })).toHaveValue('BETA');
  });

  it('does not pollute the standalone Hygiene saved project key', () => {
    window.localStorage.setItem(HYGIENE_PROJECT_KEY_STORAGE_KEY, 'EXISTING');

    render(<TeamDashboardHygieneTab projectKey="tbx" {...defaultScopeProps} />);

    expect(window.localStorage.getItem(HYGIENE_PROJECT_KEY_STORAGE_KEY)).toBe('EXISTING');
  });
});
