// CredentialManagementSection.test.tsx
//
// Tests for the Credential Management section.
//
// The GitHub PAT tests are gone with the field they covered: it wrote to a localStorage key nothing
// ever read, so it could only ever look like the credential that would have worked.

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import CredentialManagementSection from './CredentialManagementSection';

describe('CredentialManagementSection', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSettingsState.changeRequestGeneratorJiraUrl = '';
    mockSettingsState.changeRequestGeneratorSnowUrl = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders the section heading', () => {
    render(<CredentialManagementSection />);
    expect(
      screen.getByRole('heading', { name: /credential management/i }),
    ).toBeInTheDocument();
  });

  it('shows "Not configured" when Jira URL is empty', () => {
    render(<CredentialManagementSection />);
    expect(screen.getAllByText(/not configured/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the Jira URL when one is configured', () => {
    mockSettingsState.changeRequestGeneratorJiraUrl = 'https://jira.example.com';
    render(<CredentialManagementSection />);
    expect(screen.getByText('https://jira.example.com')).toBeInTheDocument();
  });

  it('shows the SNow URL when one is configured', () => {
    mockSettingsState.changeRequestGeneratorSnowUrl = 'https://snow.example.com';
    render(<CredentialManagementSection />);
    expect(screen.getByText('https://snow.example.com')).toBeInTheDocument();
  });

  it('renders Settings links for Jira and SNow config', () => {
    render(<CredentialManagementSection />);
    const settingsLinks = screen.getAllByRole('link');
    expect(settingsLinks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('CredentialManagementSection — no third GitHub credential', () => {
  it('does not offer a GitHub token field here, and says where the real ones are', () => {
    // Three places to enter a GitHub token, one of which was read by nothing, cost real time to
    // diagnose. This pins the removal so it cannot drift back.
    render(<CredentialManagementSection />);

    expect(screen.queryByLabelText(/GitHub Personal Access Token/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Connectivity → GitHub/)).toBeInTheDocument();
    expect(screen.getByText(/My Issues → Git Sync/)).toBeInTheDocument();
  });
});
