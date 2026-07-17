// TeamDashboardHygieneTab.test.tsx — Tests for Team Dashboard hygiene adapter behavior.

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TeamDashboardHygieneTab from './TeamDashboardHygieneTab.tsx';
import { HYGIENE_PROJECT_KEY_STORAGE_KEY } from '../Hygiene/hooks/useHygieneState.ts';

// The embedded Hygiene view auto-runs a Jira search on mount; stub the API so the
// adapter tests stay focused on how the team project key reaches the Hygiene view.
vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn().mockResolvedValue({ issues: [] }),
}));

// The adapter reads the ?hygieneFilter deep-link param, so it needs a router context.
function renderAtUrl(ui: ReactElement, url = '/sprint-dashboard') {
  return render(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>);
}

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
    renderAtUrl(<TeamDashboardHygieneTab projectKey="tbx" {...defaultScopeProps} />);

    expect(screen.getByRole('textbox', { name: 'Project key' })).toHaveValue('TBX');
    expect(screen.getByRole('heading', { name: 'Hygiene' })).toBeInTheDocument();
  });

  it('re-scopes Hygiene when the team is switched without leaving the previous team behind', () => {
    const { rerender } = renderAtUrl(<TeamDashboardHygieneTab projectKey="alpha" {...defaultScopeProps} />);

    expect(screen.getByRole('textbox', { name: 'Project key' })).toHaveValue('ALPHA');

    rerender(
      <MemoryRouter initialEntries={['/sprint-dashboard']}>
        <TeamDashboardHygieneTab projectKey="beta" {...defaultScopeProps} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('textbox', { name: 'Project key' })).toHaveValue('BETA');
  });

  it('does not pollute the standalone Hygiene saved project key', () => {
    window.localStorage.setItem(HYGIENE_PROJECT_KEY_STORAGE_KEY, 'EXISTING');

    renderAtUrl(<TeamDashboardHygieneTab projectKey="tbx" {...defaultScopeProps} />);

    expect(window.localStorage.getItem(HYGIENE_PROJECT_KEY_STORAGE_KEY)).toBe('EXISTING');
  });

  // ── GH #167: the PI scope clause must follow the configured PI field, never a hardcode ──

  it('builds the PI scope clause from the default field when nothing is configured', () => {
    renderAtUrl(
      <TeamDashboardHygieneTab
        projectKey="tbx"
        scopeMode="pi"
        selectedPiValue="PI 26.3 (05/21/26 - 07/29/26)"
        selectedFixVersionName=""
        selectedSprintId={null}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Extra JQL' }))
      .toHaveValue('AND cf[10301] = "PI 26.3 (05/21/26 - 07/29/26)"');
  });

  it('builds the PI scope clause from the ART-configured PI field when one is set', () => {
    // A team whose PI lives in a different custom field used to get a hardcoded cf[10301] scope
    // that matched nothing — which Hygiene then rendered as a perfect score.
    window.localStorage.setItem('tbxARTSettings', JSON.stringify({ piFieldId: 'customfield_12345' }));

    renderAtUrl(
      <TeamDashboardHygieneTab
        projectKey="tbx"
        scopeMode="pi"
        selectedPiValue="PI 26.3 (05/21/26 - 07/29/26)"
        selectedFixVersionName=""
        selectedSprintId={null}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Extra JQL' }))
      .toHaveValue('AND cf[12345] = "PI 26.3 (05/21/26 - 07/29/26)"');
  });

  // ── GH #177: Today-card deep links must arrive pre-filtered to the check they counted ──

  it('applies the ?hygieneFilter deep-link param as the initial check filter', () => {
    renderAtUrl(
      <TeamDashboardHygieneTab projectKey="tbx" {...defaultScopeProps} />,
      '/sprint-dashboard?hygieneFilter=stale',
    );

    expect(screen.getByRole('button', { name: /stale/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('supports a comma-separated multi-check filter (the commitment-gaps card counts two checks)', () => {
    renderAtUrl(
      <TeamDashboardHygieneTab projectKey="tbx" {...defaultScopeProps} />,
      '/sprint-dashboard?hygieneFilter=missing-sp,no-ac',
    );

    expect(screen.getByRole('button', { name: /unpointed story/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /acceptance criteria/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
