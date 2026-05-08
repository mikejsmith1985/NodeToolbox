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
    isAdvancedUnlocked: false,
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
    // ── Advanced unlock ──
    tryAdvancedUnlock: vi.fn(),
    advancedLock: vi.fn(),
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

vi.mock('../../store/settingsStore', () => ({
  useSettingsStore: (selector: (storeState: {
    changeRequestGeneratorJiraUrl: string;
    changeRequestGeneratorSnowUrl: string;
    theme: string;
  }) => unknown) =>
    selector({
      changeRequestGeneratorJiraUrl: '',
      changeRequestGeneratorSnowUrl: '',
      theme: 'dark',
    }),
}));

import AdminHubView from './AdminHubView.tsx';

describe('AdminHubView', () => {
  beforeEach(() => {
    mockState.isAdminUnlocked = false;
    mockState.isAdvancedUnlocked = false;
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
    expect(screen.getByRole('heading', { name: /hygiene rules/i })).toBeInTheDocument();
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

// ── Launcher download buttons ─────────────────────────────────────────────────
// The Proxy & Server Setup section provides download links for the VBS and BAT
// launchers so users can obtain them without re-extracting a release zip.

describe('Launcher download links', () => {
  it('renders an enabled Silent Launcher (.vbs) download link pointing to the correct API path', () => {
    render(<AdminHubView />);
    const vbsLink = screen.getByRole('link', { name: /silent launcher.*\.vbs/i });
    expect(vbsLink).not.toHaveAttribute('disabled');
    expect(vbsLink).toHaveAttribute('href', '/api/download/launcher-vbs');
  });

  it('renders an enabled Launcher (.bat) download link pointing to the correct API path', () => {
    render(<AdminHubView />);
    const batLink = screen.getByRole('link', { name: /launcher.*\.bat/i });
    expect(batLink).not.toHaveAttribute('disabled');
    expect(batLink).toHaveAttribute('href', '/api/download/launcher-bat');
  });

  it('does not show the "legacy dashboard" tooltip for download buttons', () => {
    render(<AdminHubView />);
    expect(screen.queryByText(/legacy dashboard/i)).not.toBeInTheDocument();
  });
});

// ── Advanced lock button tests ──

describe('Advanced lock button', () => {
  it('renders the lock button when isAdvancedUnlocked is false', () => {
    render(<AdminHubView />);
    expect(screen.getByRole('button', { name: /unlock advanced sections/i })).toBeInTheDocument();
  });

  it('renders the lock button label "🔒 Advanced" when locked', () => {
    render(<AdminHubView />);
    expect(screen.getByText(/🔒 Advanced/)).toBeInTheDocument();
  });

  it('renders the "Lock Advanced" button when isAdvancedUnlocked is true', () => {
    mockState.isAdvancedUnlocked = true;
    render(<AdminHubView />);
    expect(screen.getByRole('button', { name: /lock advanced sections/i })).toBeInTheDocument();
    mockState.isAdvancedUnlocked = false;
  });

  it('calls tryAdvancedUnlock when the lock button is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<AdminHubView />);
    await user.click(screen.getByRole('button', { name: /unlock advanced sections/i }));
    expect(mockActions.tryAdvancedUnlock).toHaveBeenCalledOnce();
  });

  it('calls advancedLock when the unlock button is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    mockState.isAdvancedUnlocked = true;
    render(<AdminHubView />);
    await user.click(screen.getByRole('button', { name: /lock advanced sections/i }));
    expect(mockActions.advancedLock).toHaveBeenCalledOnce();
    mockState.isAdvancedUnlocked = false;
  });
});

// ── New always-visible sections ──

describe('Enterprise Standards Panel', () => {
  it('renders the Enterprise Standards section heading', () => {
    render(<AdminHubView />);
    expect(screen.getByRole('heading', { name: /enterprise standards/i })).toBeInTheDocument();
  });
});

describe('Credential Management Section', () => {
  it('renders the Credential Management section heading', () => {
    render(<AdminHubView />);
    expect(screen.getByRole('heading', { name: /credential management/i })).toBeInTheDocument();
  });
});

// ── Advanced-gated sections ──

describe('Advanced-gated sections', () => {
  it('shows the locked placeholder when isAdvancedUnlocked is false', () => {
    render(<AdminHubView />);
    expect(screen.getByText(/unlock advanced/i)).toBeInTheDocument();
  });

  it('renders Tool Visibility section when isAdvancedUnlocked is true', () => {
    mockState.isAdvancedUnlocked = true;
    render(<AdminHubView />);
    expect(screen.getByRole('heading', { name: /tool visibility/i })).toBeInTheDocument();
    mockState.isAdvancedUnlocked = false;
  });

  it('renders Client Diagnostics panel when isAdvancedUnlocked is true', () => {
    mockState.isAdvancedUnlocked = true;
    render(<AdminHubView />);
    expect(screen.getByRole('heading', { name: /client diagnostics/i })).toBeInTheDocument();
    mockState.isAdvancedUnlocked = false;
  });

  it('renders TBX Backup/Restore section when isAdvancedUnlocked is true', () => {
    mockState.isAdvancedUnlocked = true;
    render(<AdminHubView />);
    expect(screen.getByRole('heading', { name: /backup.*restore/i })).toBeInTheDocument();
    mockState.isAdvancedUnlocked = false;
  });

  it('does not render the three advanced sections when locked', () => {
    render(<AdminHubView />);
    expect(screen.queryByRole('heading', { name: /tool visibility/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /client diagnostics/i })).not.toBeInTheDocument();
  });
});

