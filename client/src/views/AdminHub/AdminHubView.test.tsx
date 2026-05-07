// AdminHubView.test.tsx — Unit tests for the Admin Hub view component.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    proxyUrls: {
      jiraProxyUrl: 'http://jira.example.com',
      snowProxyUrl: '',
      githubProxyUrl: '',
    },
    artSettings: {
      piFieldId: 'customfield_10301',
      sprintPointsFieldId: '',
      featureLinkField: '',
      piName: 'PI 26.2',
      piStartDate: '',
      piEndDate: '',
    },
    featureFlags: {
      isSnowIntegrationEnabled: false,
      isAiEnabled: false,
    },
    isAdminUnlocked: false,
    adminPinInput: '',
    proxySaveStatus: null as string | null,
    artSaveStatus: null as string | null,
    // ── Diagnostics ──
    isDiagnosticsRunning: false,
    diagnosticsResult: null as null | {
      version: string
      nodeVersion: string
      uptime: number
      timestamp: string
    },
    diagnosticsError: null as string | null,
    isDiagnosticsSectionCollapsed: false,
    // ── Backup & Reset ──
    isBackupRestoring: false,
    restoreError: null as string | null,
    isBackupSectionCollapsed: false,
    // ── Hygiene Rules ──
    hygieneRules: {
      staleDays: 5,
      unpointedWarningDays: 7,
      hasMissingAssigneeFlag: true,
    },
    isHygieneSectionCollapsed: false,
    // ── Update Management ──
    updateCheckResult: null as null | {
      currentVersion: string
      latestVersion: string
      hasUpdate: boolean
      releaseNotes: string
    },
    isCheckingUpdate: false,
    isUpdateSectionCollapsed: false,
  },
  mockActions: {
    setProxyUrl: vi.fn(),
    saveProxyUrls: vi.fn(),
    setArtField: vi.fn(),
    saveArtSettings: vi.fn(),
    toggleFeatureFlag: vi.fn(),
    setAdminPinInput: vi.fn(),
    tryUnlock: vi.fn(),
    lock: vi.fn(),
    // ── Diagnostics ──
    runDiagnostics: vi.fn(),
    setDiagnosticsSectionCollapsed: vi.fn(),
    // ── Backup & Reset ──
    downloadBackup: vi.fn(),
    triggerRestoreBackup: vi.fn(),
    resetAllSettings: vi.fn(),
    setBackupSectionCollapsed: vi.fn(),
    // ── Hygiene Rules ──
    updateHygieneRule: vi.fn(),
    setHygieneSectionCollapsed: vi.fn(),
    // ── Update Management ──
    checkForUpdates: vi.fn(),
    setUpdateSectionCollapsed: vi.fn(),
  },
}));

vi.mock('./hooks/useAdminHubState.ts', () => ({
  useAdminHubState: () => ({ state: mockState, actions: mockActions }),
}));

const { mockProxyStatus } = vi.hoisted(() => ({ mockProxyStatus: null as null | object }));

vi.mock('../../store/connectionStore', () => ({
  useConnectionStore: (
    selector: (storeState: { proxyStatus: typeof mockProxyStatus }) => unknown,
  ) => selector({ proxyStatus: mockProxyStatus }),
}));

import AdminHubView from './AdminHubView.tsx';

describe('AdminHubView', () => {
  beforeEach(() => {
    mockState.isAdminUnlocked = false;
    mockState.adminPinInput = '';
    vi.clearAllMocks();
  });

  it('renders the Proxy & Server Setup section', () => {
    render(<AdminHubView />);
    expect(screen.getByText(/proxy & server setup/i)).toBeInTheDocument();
  });

  it('renders the ART Settings section', () => {
    render(<AdminHubView />);
    expect(screen.getByText(/art settings/i)).toBeInTheDocument();
  });

  it('renders the Admin Access section with PIN input when locked', () => {
    render(<AdminHubView />);
    expect(screen.getByText(/admin access/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter pin/i)).toBeInTheDocument();
  });

  it('shows the unlocked admin panel when isAdminUnlocked is true', () => {
    mockState.isAdminUnlocked = true;
    render(<AdminHubView />);
    expect(screen.getByText(/admin access is active/i)).toBeInTheDocument();
  });

  it('shows the Advanced Feature Controls toggles when unlocked', () => {
    mockState.isAdminUnlocked = true;
    render(<AdminHubView />);
    expect(screen.getByText(/advanced feature controls/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/snow integration/i)).toBeInTheDocument();
  });

  it('shows the Developer Utilities when unlocked', () => {
    mockState.isAdminUnlocked = true;
    render(<AdminHubView />);
    expect(screen.getByText(/developer utilities/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset onboarding/i })).toBeInTheDocument();
  });
});

// ── Diagnostics section tests ──

describe('Diagnostics section', () => {
  it('renders the Diagnostics section heading', () => {
    render(<AdminHubView />);
    expect(screen.getByRole('heading', { name: /diagnostics/i })).toBeInTheDocument();
  });

  it('renders the Run Diagnostics button', () => {
    render(<AdminHubView />);
    expect(screen.getByRole('button', { name: /run diagnostics/i })).toBeInTheDocument();
  });

  it('does not render the Copy Report button when diagnosticsResult is null', () => {
    render(<AdminHubView />);
    expect(screen.queryByRole('button', { name: /copy report/i })).not.toBeInTheDocument();
  });

  it('renders the diagnostics result pre-block when result is available', () => {
    mockState.diagnosticsResult = {
      version: '2.3.0',
      nodeVersion: 'v20.0.0',
      uptime: 300,
      timestamp: '2024-01-01T00:00:00.000Z',
    };
    render(<AdminHubView />);
    expect(screen.getByText(/2\.3\.0/)).toBeInTheDocument();
    mockState.diagnosticsResult = null;
  });

  it('renders the Copy Report button when result is available', () => {
    mockState.diagnosticsResult = {
      version: '2.3.0',
      nodeVersion: 'v20.0.0',
      uptime: 300,
      timestamp: '2024-01-01T00:00:00.000Z',
    };
    render(<AdminHubView />);
    expect(screen.getByRole('button', { name: /copy report/i })).toBeInTheDocument();
    mockState.diagnosticsResult = null;
  });

  it('renders the error message when diagnosticsError is set', () => {
    mockState.diagnosticsError = 'Connection refused';
    render(<AdminHubView />);
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
    mockState.diagnosticsError = null;
  });
});

// ── Backup & Reset section tests ──

describe('Backup & Reset section', () => {
  it('renders the Backup & Reset section heading', () => {
    render(<AdminHubView />);
    expect(screen.getByText(/backup.*reset/i)).toBeInTheDocument();
  });

  it('renders the Download Backup button', () => {
    render(<AdminHubView />);
    expect(screen.getByRole('button', { name: /download backup/i })).toBeInTheDocument();
  });

  it('renders the Restore Backup button', () => {
    render(<AdminHubView />);
    expect(screen.getByRole('button', { name: /restore backup/i })).toBeInTheDocument();
  });

  it('renders the Reset All Settings button', () => {
    render(<AdminHubView />);
    expect(screen.getByRole('button', { name: /reset all settings/i })).toBeInTheDocument();
  });

  it('renders the restore error when restoreError is set', () => {
    mockState.restoreError = 'Invalid backup file';
    render(<AdminHubView />);
    expect(screen.getByText(/invalid backup file/i)).toBeInTheDocument();
    mockState.restoreError = null;
  });
});

// ── Hygiene Rules section tests ──

describe('Hygiene Rules section', () => {
  it('renders the Hygiene Rules section heading', () => {
    render(<AdminHubView />);
    expect(screen.getByText(/hygiene rules/i)).toBeInTheDocument();
  });

  it('renders the Stale Days input', () => {
    render(<AdminHubView />);
    expect(screen.getByLabelText(/stale days/i)).toBeInTheDocument();
  });

  it('renders the Unpointed Warning Days input', () => {
    render(<AdminHubView />);
    expect(screen.getByLabelText(/unpointed warning days/i)).toBeInTheDocument();
  });

  it('renders the Flag Missing Assignees checkbox', () => {
    render(<AdminHubView />);
    expect(screen.getByLabelText(/flag missing assignees/i)).toBeInTheDocument();
  });

  it('shows the correct stale days value from state', () => {
    render(<AdminHubView />);
    const staleDaysInput = screen.getByLabelText(/stale days/i) as HTMLInputElement;
    expect(staleDaysInput.value).toBe('5');
  });
});

// ── Update Management section tests ──

describe('Update Management section', () => {
  it('renders the Update Management section heading', () => {
    render(<AdminHubView />);
    expect(screen.getByText(/update management/i)).toBeInTheDocument();
  });

  it('renders the Check for Updates button', () => {
    render(<AdminHubView />);
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeInTheDocument();
  });

  it('renders "Up to date" message when hasUpdate is false', () => {
    mockState.updateCheckResult = {
      currentVersion: '2.3.0',
      latestVersion: '2.3.0',
      hasUpdate: false,
      releaseNotes: 'You are running the latest version.',
    };
    render(<AdminHubView />);
    expect(screen.getByText(/up to date/i)).toBeInTheDocument();
    mockState.updateCheckResult = null;
  });

  it('renders "Update available" message when hasUpdate is true', () => {
    mockState.updateCheckResult = {
      currentVersion: '2.2.0',
      latestVersion: '2.3.0',
      hasUpdate: true,
      releaseNotes: 'New features added.',
    };
    render(<AdminHubView />);
    expect(screen.getByText(/update available/i)).toBeInTheDocument();
    mockState.updateCheckResult = null;
  });

  it('renders the release notes textarea when updateCheckResult is available', () => {
    mockState.updateCheckResult = {
      currentVersion: '2.3.0',
      latestVersion: '2.3.0',
      hasUpdate: false,
      releaseNotes: 'You are running the latest version.',
    };
    render(<AdminHubView />);
    expect(screen.getByRole('textbox', { name: /release notes/i })).toBeInTheDocument();
    mockState.updateCheckResult = null;
  });
});
