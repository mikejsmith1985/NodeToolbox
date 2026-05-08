// ClientDiagnosticsPanel.test.tsx — Tests for the client-side Diagnostics panel.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockSettingsState = {
  changeRequestGeneratorJiraUrl: string;
  changeRequestGeneratorSnowUrl: string;
  theme: string;
};

const mockSettingsState: MockSettingsState = {
  changeRequestGeneratorJiraUrl: '',
  changeRequestGeneratorSnowUrl: '',
  theme: 'dark',
};

vi.mock('../../store/settingsStore', () => ({
  useSettingsStore: (selector: (storeState: MockSettingsState) => unknown) =>
    selector(mockSettingsState),
}));

import ClientDiagnosticsPanel from './ClientDiagnosticsPanel';

describe('ClientDiagnosticsPanel', () => {
  beforeEach(() => {
    mockSettingsState.changeRequestGeneratorJiraUrl = '';
    mockSettingsState.changeRequestGeneratorSnowUrl = '';
    mockSettingsState.theme = 'dark';
    vi.clearAllMocks();
  });

  it('renders the Diagnostics heading', () => {
    render(<ClientDiagnosticsPanel />);
    expect(screen.getByRole('heading', { name: /diagnostics/i })).toBeInTheDocument();
  });

  it('shows a "Browser" label', () => {
    render(<ClientDiagnosticsPanel />);
    expect(screen.getByText('Browser')).toBeInTheDocument();
  });

  it('shows the navigator.userAgent value', () => {
    render(<ClientDiagnosticsPanel />);
    // jsdom sets a user agent; we just check something is there.
    expect(screen.getByTestId('diagnostics-user-agent').textContent).not.toBe('');
  });

  it('shows localStorage usage estimate', () => {
    render(<ClientDiagnosticsPanel />);
    expect(screen.getByText(/localstorage usage/i)).toBeInTheDocument();
  });

  it('shows the Jira URL label and value', () => {
    mockSettingsState.changeRequestGeneratorJiraUrl = 'https://jira.example.com';
    render(<ClientDiagnosticsPanel />);
    expect(screen.getByText('https://jira.example.com')).toBeInTheDocument();
  });

  it('shows "—" for Jira URL when not configured', () => {
    render(<ClientDiagnosticsPanel />);
    // There should be a "—" placeholder for unconfigured URLs.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the current theme from settingsStore', () => {
    render(<ClientDiagnosticsPanel />);
    expect(screen.getByTestId('diagnostics-theme').textContent).toBe('dark');
  });

  it('renders an Open Dev Panel link pointing to /dev-panel', () => {
    render(<ClientDiagnosticsPanel />);
    const devPanelLink = screen.getByRole('link', { name: /open dev panel/i });
    expect(devPanelLink).toHaveAttribute('href', '/dev-panel');
  });
});
