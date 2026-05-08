// CredentialManagementSection.test.tsx — Tests for the Credential Management section.

import { render, screen, fireEvent } from '@testing-library/react';
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

  it('renders the GitHub PAT password input when no PAT is saved', () => {
    render(<CredentialManagementSection />);
    expect(screen.getByLabelText(/github pat input/i)).toBeInTheDocument();
  });

  it('renders the Save PAT button', () => {
    render(<CredentialManagementSection />);
    expect(screen.getByRole('button', { name: /save pat/i })).toBeInTheDocument();
  });

  it('saves the GitHub PAT to localStorage when Save PAT is clicked', () => {
    render(<CredentialManagementSection />);
    const patInput = screen.getByLabelText(/github pat input/i);
    fireEvent.change(patInput, { target: { value: 'ghp_test_token_12345' } });
    fireEvent.click(screen.getByRole('button', { name: /save pat/i }));
    expect(localStorage.getItem('tbxGithubPat')).toBe('ghp_test_token_12345');
  });

  it('shows a masked PAT display and clear button when a PAT is saved in localStorage', () => {
    localStorage.setItem('tbxGithubPat', 'ghp_existing_token');
    render(<CredentialManagementSection />);
    expect(screen.getByText(/●/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear github pat/i })).toBeInTheDocument();
  });

  it('clears the GitHub PAT from localStorage when Clear is clicked', () => {
    localStorage.setItem('tbxGithubPat', 'ghp_existing_token');
    render(<CredentialManagementSection />);
    fireEvent.click(screen.getByRole('button', { name: /clear github pat/i }));
    expect(localStorage.getItem('tbxGithubPat')).toBeNull();
  });

  it('reveals the PAT when the Show button is clicked', () => {
    localStorage.setItem('tbxGithubPat', 'ghp_visible_token');
    render(<CredentialManagementSection />);
    fireEvent.click(screen.getByRole('button', { name: /show pat/i }));
    expect(screen.getByText('ghp_visible_token')).toBeInTheDocument();
  });
});
