// CredentialManagementSection.test.tsx
//
// Tests for the Credential Management section.
//
// The Jira and ServiceNow URLs used to be read-only text here, so after a Jira re-instance migration there was
// nothing to paste the new URL into. These tests pin the fix: both URLs are real inputs that accept a paste,
// and Save writes the value to the server (the copy the proxies use) and to the browser's settings store.
//
// The GitHub PAT tests are gone with the field they covered: it wrote to a localStorage key nothing
// ever read, so it could only ever look like the credential that would have worked.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockSettingsState = {
  changeRequestGeneratorJiraUrl: string;
  changeRequestGeneratorSnowUrl: string;
  setChangeRequestGeneratorJiraUrl: (url: string) => void;
  setChangeRequestGeneratorSnowUrl: (url: string) => void;
};

const { fetchServiceBaseUrlsMock, saveServiceBaseUrlMock, saveJiraTokenMock, setJiraUrlMock, setSnowUrlMock } = vi.hoisted(() => ({
  saveJiraTokenMock: vi.fn(),
  fetchServiceBaseUrlsMock: vi.fn(),
  saveServiceBaseUrlMock: vi.fn(),
  setJiraUrlMock: vi.fn(),
  setSnowUrlMock: vi.fn(),
}));

const mockSettingsState: MockSettingsState = {
  changeRequestGeneratorJiraUrl: '',
  changeRequestGeneratorSnowUrl: '',
  setChangeRequestGeneratorJiraUrl: setJiraUrlMock,
  setChangeRequestGeneratorSnowUrl: setSnowUrlMock,
};

vi.mock('../../store/settingsStore', () => ({
  useSettingsStore: (selector: (storeState: MockSettingsState) => unknown) => selector(mockSettingsState),
}));

vi.mock('../../services/proxyApi.ts', () => ({
  fetchServiceBaseUrls: fetchServiceBaseUrlsMock,
  saveServiceBaseUrl: saveServiceBaseUrlMock,
  saveJiraPersonalAccessToken: saveJiraTokenMock,
}));

import CredentialManagementSection from './CredentialManagementSection';

beforeEach(() => {
  vi.clearAllMocks();
  mockSettingsState.changeRequestGeneratorJiraUrl = '';
  mockSettingsState.changeRequestGeneratorSnowUrl = '';
  fetchServiceBaseUrlsMock.mockResolvedValue({ jira: 'https://old-jira.example.com', snow: '', confluence: '' });
  saveServiceBaseUrlMock.mockResolvedValue(undefined);
  saveJiraTokenMock.mockResolvedValue(undefined);
});

describe('CredentialManagementSection', () => {
  it('renders the section heading', () => {
    render(<CredentialManagementSection isAdminUnlocked />);
    expect(screen.getByRole('heading', { name: /credential management/i })).toBeInTheDocument();
  });

  it('fills each input with the URL the server is actually using', async () => {
    render(<CredentialManagementSection isAdminUnlocked />);
    await waitFor(() => expect(screen.getByLabelText(/Jira Base URL/i)).toHaveValue('https://old-jira.example.com'));
    expect(screen.getByLabelText(/ServiceNow Instance URL/i)).toHaveValue('');
  });

  it('accepts a pasted ServiceNow URL and saves it to the server and the settings store', async () => {
    render(<CredentialManagementSection isAdminUnlocked />);
    const snowInput = screen.getByLabelText(/ServiceNow Instance URL/i);

    await userEvent.click(snowInput);
    await userEvent.paste('https://new-snow.example.com');
    await userEvent.click(screen.getByRole('button', { name: /save servicenow/i }));

    await waitFor(() => expect(saveServiceBaseUrlMock).toHaveBeenCalledWith('snow', 'https://new-snow.example.com'));
    expect(setSnowUrlMock).toHaveBeenCalledWith('https://new-snow.example.com');
    expect(screen.getByText(/ServiceNow URL saved/i)).toBeInTheDocument();
  });

  it('replaces the Jira URL on paste over the old one and saves it', async () => {
    render(<CredentialManagementSection isAdminUnlocked />);
    const jiraInput = screen.getByLabelText(/Jira Base URL/i);
    await waitFor(() => expect(jiraInput).toHaveValue('https://old-jira.example.com'));

    await userEvent.tripleClick(jiraInput);
    await userEvent.paste('https://new-jira.example.com');
    await userEvent.click(screen.getByRole('button', { name: /^save jira$/i }));

    await waitFor(() => expect(saveServiceBaseUrlMock).toHaveBeenCalledWith('jira', 'https://new-jira.example.com'));
    expect(setJiraUrlMock).toHaveBeenCalledWith('https://new-jira.example.com');
  });

  it('says so, and keeps the typed value, when the server refuses the save', async () => {
    saveServiceBaseUrlMock.mockRejectedValue(new Error('proxy-config update failed: 500'));
    render(<CredentialManagementSection isAdminUnlocked />);
    const snowInput = screen.getByLabelText(/ServiceNow Instance URL/i);

    await userEvent.click(snowInput);
    await userEvent.paste('https://new-snow.example.com');
    await userEvent.click(screen.getByRole('button', { name: /save servicenow/i }));

    await waitFor(() => expect(screen.getByText(/could not save/i)).toBeInTheDocument());
    expect(snowInput).toHaveValue('https://new-snow.example.com');
    expect(setSnowUrlMock).not.toHaveBeenCalled();
  });
});

describe('CredentialManagementSection — Jira token', () => {
  // After the Jira migration the stored token belonged to the old instance and there was nowhere to put a new
  // one. The field is write-only: the token is sent once, never shown back, and the box empties on success.
  it('saves a pasted Jira token to the server and clears the box', async () => {
    render(<CredentialManagementSection isAdminUnlocked />);
    const tokenInput = screen.getByLabelText(/Jira Personal Access Token/i);
    expect(tokenInput).toHaveAttribute('type', 'password');

    await userEvent.click(tokenInput);
    await userEvent.paste('new-jira-token');
    await userEvent.click(screen.getByRole('button', { name: /save jira token/i }));

    await waitFor(() => expect(saveJiraTokenMock).toHaveBeenCalledWith('new-jira-token'));
    expect(await screen.findByText(/Jira token saved/i)).toBeInTheDocument();
    expect(tokenInput).toHaveValue('');
  });

  it('keeps the token in the box and says so when the server refuses it', async () => {
    saveJiraTokenMock.mockRejectedValue(new Error('proxy-config update failed: 500'));
    render(<CredentialManagementSection isAdminUnlocked />);
    const tokenInput = screen.getByLabelText(/Jira Personal Access Token/i);

    await userEvent.click(tokenInput);
    await userEvent.paste('new-jira-token');
    await userEvent.click(screen.getByRole('button', { name: /save jira token/i }));

    expect(await screen.findByText(/could not save the Jira token/i)).toBeInTheDocument();
    expect(tokenInput).toHaveValue('new-jira-token');
  });

  it('offers no token field while Admin Hub is locked', () => {
    render(<CredentialManagementSection isAdminUnlocked={false} />);
    expect(screen.queryByLabelText(/Jira Personal Access Token/i)).not.toBeInTheDocument();
  });
});

describe('CredentialManagementSection — locked Admin Hub', () => {
  it('shows the URLs read-only and says how to edit them, with no inputs to change', async () => {
    render(<CredentialManagementSection isAdminUnlocked={false} />);
    await waitFor(() => expect(screen.getByText('https://old-jira.example.com')).toBeInTheDocument());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Unlock Admin Hub/i)).toBeInTheDocument();
  });
});

describe('CredentialManagementSection — no third GitHub credential', () => {
  it('does not offer a GitHub token field here, and says where the real ones are', () => {
    // Three places to enter a GitHub token, one of which was read by nothing, cost real time to
    // diagnose. This pins the removal so it cannot drift back.
    render(<CredentialManagementSection isAdminUnlocked />);

    expect(screen.queryByLabelText(/GitHub Personal Access Token/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Connectivity → GitHub/)).toBeInTheDocument();
  });
});
