// AdminHubView.test.tsx — Unit tests for the Admin Hub view component.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../../components/Toast/ToastProvider.tsx';

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
    adminUsername: '',
    adminUnlockError: null as string | null,
    proxySaveStatus: null as string | null,
    artSaveStatus: null as string | null,
    isAdvancedUnlockDialogOpen: false,
    advancedUnlockPromptMessage: '',
    advancedUnlockError: null as string | null,
    isResetAllSettingsConfirmOpen: false,
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
    updateCheckError: null as string | null,
    isCheckingUpdate: false,
    isInstallingUpdate: false,
    updateInstallError: null as string | null,
    isUpdateSectionCollapsed: false,
    // ── Service Connectivity ──
    connectivityConfig: null as null | {
      snow:       { baseUrl: string; hasCredentials: boolean; usernameMasked: string }
      github:     { baseUrl: string; hasPat: boolean }
      confluence: { baseUrl: string; hasCredentials: boolean; usernameMasked: string }
    },
    isConnectivityConfigLoading: false,
    connectivityConfigError: null as string | null,
    connectivitySaveStatus: null as string | null,
    snowTestResult:       null as null | { isOk: boolean; statusCode: number; message: string },
    isSnowTesting:        false,
    githubTestResult:     null as null | { isOk: boolean; statusCode: number; message: string },
    isGitHubTesting:      false,
    confluenceTestResult: null as null | { isOk: boolean; statusCode: number; message: string },
    isConfluenceTesting:  false,
    rovoTestResult:       null as null | { isOk: boolean; statusCode: number; message: string },
    isRovoTesting:        false,
  },
  mockActions: {
    setProxyUrl: vi.fn(),
    saveProxyUrls: vi.fn(),
    setArtField: vi.fn(),
    saveArtSettings: vi.fn(),
    toggleFeatureFlag: vi.fn(),
    setAdminPinInput: vi.fn(),
    setAdminUsername: vi.fn(),
    tryUnlock: vi.fn(),
    lock: vi.fn(),
    tryAdvancedUnlock: vi.fn(),
    closeAdvancedUnlockDialog: vi.fn(),
    submitAdvancedUnlock: vi.fn(),
    clearAdvancedUnlockError: vi.fn(),
    openResetAllSettingsDialog: vi.fn(),
    closeResetAllSettingsDialog: vi.fn(),
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
    installUpdate: vi.fn(),
    setUpdateSectionCollapsed: vi.fn(),
    // ── Advanced unlock ──
    advancedLock: vi.fn(),
    // ── Service Connectivity ──
    loadConnectivityConfig: vi.fn(),
    saveSnowConfig: vi.fn(),
    saveGitHubConfig: vi.fn(),
    saveConfluenceConfig: vi.fn(),
    testSnowConfig: vi.fn(),
    testGitHubConfig: vi.fn(),
    testConfluenceConfig: vi.fn(),
    testRovoConfig: vi.fn(),
  },
}));

vi.mock('./hooks/useAdminHubState.ts', () => ({
  useAdminHubState: () => ({ state: mockState, actions: mockActions }),
}));

const { mockProxyStatus } = vi.hoisted(() => ({ mockProxyStatus: null as null | object }));

vi.mock('../../store/connectionStore', () => ({
  useConnectionStore: (
    selector: (storeState: { proxyStatus: typeof mockProxyStatus; relayBridgeStatus: null }) => unknown,
  ) => selector({ proxyStatus: mockProxyStatus, relayBridgeStatus: null }),
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

vi.mock('../DevPanel/DevPanelView.tsx', () => ({
  default: () => <div>Mock Dev Panel</div>,
}));

import AdminHubView from './AdminHubView.tsx';

function renderAdminHubView() {
  return render(
    <ToastProvider>
      <AdminHubView />
    </ToastProvider>,
  );
}

describe('AdminHubView', () => {
  beforeEach(() => {
    mockState.isAdminUnlocked = false;
    mockState.isAdvancedUnlocked = false;
    mockState.adminPinInput = '';
    mockState.adminUsername = '';
    mockState.adminUnlockError = null;
    vi.clearAllMocks();

    // Mock global fetch so the server control buttons don't make real network calls.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the Config and Dev Panel tab buttons', () => {
    renderAdminHubView();
    expect(screen.getByRole('tab', { name: /config/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /dev panel/i })).toBeInTheDocument();
  });

  it('renders the Proxy & Server Setup section', () => {
    renderAdminHubView();
    expect(screen.getByText(/proxy & server setup/i)).toBeInTheDocument();
  });

  it('renders the Restart Server button', () => {
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /restart server/i })).toBeInTheDocument();
  });

  it('renders the Kill Port 5555 button', () => {
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /kill port 5555/i })).toBeInTheDocument();
  });

  it('calls /api/restart when Restart Server is clicked', async () => {
    const user = userEvent.setup();
    renderAdminHubView();
    await user.click(screen.getByRole('button', { name: /restart server/i }));
    expect(fetch).toHaveBeenCalledWith('/api/restart', { method: 'POST' });
  });

  it('calls /api/shutdown when Kill Port 5555 is clicked', async () => {
    const user = userEvent.setup();
    renderAdminHubView();
    await user.click(screen.getByRole('button', { name: /kill port 5555/i }));
    expect(fetch).toHaveBeenCalledWith('/api/shutdown', { method: 'POST' });
  });

  it('renders the ART Settings section', () => {
    renderAdminHubView();
    expect(screen.getByText(/art settings/i)).toBeInTheDocument();
  });

  it('renders the Admin Access section with username/password inputs when locked', () => {
    renderAdminHubView();
    expect(screen.getByRole('heading', { name: /admin access/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/username/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
  });

  it('shows the unlocked admin panel when isAdminUnlocked is true', () => {
    mockState.isAdminUnlocked = true;
    renderAdminHubView();
    expect(screen.getByText(/admin access is active/i)).toBeInTheDocument();
  });

  it('shows the Advanced Feature Controls toggles when unlocked', () => {
    mockState.isAdminUnlocked = true;
    renderAdminHubView();
    expect(screen.getByText(/advanced feature controls/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/snow integration/i)).toBeInTheDocument();
  });

  it('shows the Developer Utilities when unlocked', () => {
    mockState.isAdminUnlocked = true;
    renderAdminHubView();
    expect(screen.getByText(/developer utilities/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset onboarding/i })).toBeInTheDocument();
  });

  it('renders the embedded Dev Panel when the tab is selected', async () => {
    const user = userEvent.setup();
    renderAdminHubView();

    await user.click(screen.getByRole('tab', { name: /dev panel/i }));

    expect(screen.getByText('Mock Dev Panel')).toBeInTheDocument();
    expect(screen.queryByText(/proxy & server setup/i)).not.toBeInTheDocument();
  });

  it('renders relay setup without a Copy Code button', () => {
    renderAdminHubView();

    expect(screen.getByRole('heading', { name: /relay activation/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy code/i })).not.toBeInTheDocument();
  });

  it('explains that the relay bookmarklet must be dragged when clicked in Admin Hub', async () => {
    const user = userEvent.setup();
    renderAdminHubView();

    await user.click(screen.getByRole('link', { name: /NodeToolbox SNow Relay/i }));

    expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/Drag "NodeToolbox SNow Relay"/));
  });

  it('keeps the real bookmarklet URL available for browser drag-to-bookmarks install', () => {
    renderAdminHubView();

    const bookmarkletLink = screen.getByRole('link', { name: /NodeToolbox SNow Relay/i });

    expect(bookmarkletLink.getAttribute('href')).toMatch(/^javascript:\(function\(\)\{/);
  });
});

// ── Diagnostics section tests ──

describe('Diagnostics section', () => {
  it('renders the Diagnostics section heading', () => {
    renderAdminHubView();
    expect(screen.getByRole('heading', { name: /diagnostics/i })).toBeInTheDocument();
  });

  it('renders the Run Diagnostics button', () => {
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /run diagnostics/i })).toBeInTheDocument();
  });

  it('does not render the Copy Report button when diagnosticsResult is null', () => {
    renderAdminHubView();
    expect(screen.queryByRole('button', { name: /copy report/i })).not.toBeInTheDocument();
  });

  it('renders the diagnostics result pre-block when result is available', () => {
    mockState.diagnosticsResult = {
      version: '2.3.0',
      nodeVersion: 'v20.0.0',
      uptime: 300,
      timestamp: '2024-01-01T00:00:00.000Z',
    };
    renderAdminHubView();
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
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /copy report/i })).toBeInTheDocument();
    mockState.diagnosticsResult = null;
  });

  it('renders the error message when diagnosticsError is set', () => {
    mockState.diagnosticsError = 'Connection refused';
    renderAdminHubView();
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
    mockState.diagnosticsError = null;
  });
});

// ── Backup & Reset section tests ──

describe('Backup & Reset section', () => {
  it('renders the Backup & Reset section heading', () => {
    renderAdminHubView();
    expect(screen.getByText(/backup.*reset/i)).toBeInTheDocument();
  });

  it('renders the Download Backup button', () => {
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /download backup/i })).toBeInTheDocument();
  });

  it('renders the Restore Backup button', () => {
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /restore backup/i })).toBeInTheDocument();
  });

  it('renders the Reset All Settings button', () => {
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /reset all settings/i })).toBeInTheDocument();
  });

  it('renders the restore error when restoreError is set', () => {
    mockState.restoreError = 'Invalid backup file';
    renderAdminHubView();
    expect(screen.getByText(/invalid backup file/i)).toBeInTheDocument();
    mockState.restoreError = null;
  });
});

// ── Hygiene Rules section tests ──

describe('Hygiene Rules section', () => {
  it('renders the Hygiene Rules section heading', () => {
    renderAdminHubView();
    expect(screen.getByRole('heading', { name: /hygiene rules/i })).toBeInTheDocument();
  });

  it('renders the Stale Days input', () => {
    renderAdminHubView();
    expect(screen.getByLabelText(/stale days/i)).toBeInTheDocument();
  });

  it('renders the Unpointed Warning Days input', () => {
    renderAdminHubView();
    expect(screen.getByLabelText(/unpointed warning days/i)).toBeInTheDocument();
  });

  it('renders the Flag Missing Assignees checkbox', () => {
    renderAdminHubView();
    expect(screen.getByLabelText(/flag missing assignees/i)).toBeInTheDocument();
  });

  it('shows the correct stale days value from state', () => {
    renderAdminHubView();
    const staleDaysInput = screen.getByLabelText(/stale days/i) as HTMLInputElement;
    expect(staleDaysInput.value).toBe('5');
  });
});

// ── Update Management section tests ──

describe('Update Management section', () => {
  it('renders the Update Management section heading', () => {
    renderAdminHubView();
    expect(screen.getByText(/update management/i)).toBeInTheDocument();
  });

  it('renders the Check for Updates button', () => {
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeInTheDocument();
  });

  it('renders "Up to date" message when hasUpdate is false', () => {
    mockState.updateCheckResult = {
      currentVersion: '2.3.0',
      latestVersion: '2.3.0',
      hasUpdate: false,
      releaseNotes: 'You are running the latest version.',
    };
    renderAdminHubView();
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
    renderAdminHubView();
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
    renderAdminHubView();
    expect(screen.getByRole('textbox', { name: /release notes/i })).toBeInTheDocument();
    mockState.updateCheckResult = null;
  });

  it('renders the Install Update button when an update is available', () => {
    mockState.updateCheckResult = {
      currentVersion: '2.2.0',
      latestVersion: '2.3.0',
      hasUpdate: true,
      releaseNotes: 'New features.',
    };
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /install update/i })).toBeInTheDocument();
    mockState.updateCheckResult = null;
  });

  it('does not render the Install Update button when up to date', () => {
    mockState.updateCheckResult = {
      currentVersion: '2.3.0',
      latestVersion: '2.3.0',
      hasUpdate: false,
      releaseNotes: '',
    };
    renderAdminHubView();
    expect(screen.queryByRole('button', { name: /install update/i })).not.toBeInTheDocument();
    mockState.updateCheckResult = null;
  });

  it('shows installing progress message when isInstallingUpdate is true', () => {
    mockState.updateCheckResult = {
      currentVersion: '2.2.0',
      latestVersion: '2.3.0',
      hasUpdate: true,
      releaseNotes: '',
    };
    mockState.isInstallingUpdate = true;
    renderAdminHubView();
    expect(screen.getByText(/installing and restarting/i)).toBeInTheDocument();
    mockState.updateCheckResult = null;
    mockState.isInstallingUpdate = false;
  });

  it('shows install error message when updateInstallError is set', () => {
    mockState.updateInstallError = 'Server did not restart within 60 seconds';
    renderAdminHubView();
    expect(screen.getByText(/server did not restart/i)).toBeInTheDocument();
    mockState.updateInstallError = null;
  });
});

// ── Launcher download buttons ─────────────────────────────────────────────────
// The Proxy & Server Setup section provides download links for the VBS and BAT
// launchers so users can obtain them without re-extracting a release zip.

describe('Launcher download links', () => {
  it('renders an enabled Silent Launcher (.vbs) download link pointing to the correct API path', () => {
    renderAdminHubView();
    const vbsLink = screen.getByRole('link', { name: /silent launcher.*\.vbs/i });
    expect(vbsLink).not.toHaveAttribute('disabled');
    expect(vbsLink).toHaveAttribute('href', '/api/download/launcher-vbs');
  });

  it('renders an enabled Launcher (.bat) download link pointing to the correct API path', () => {
    renderAdminHubView();
    const batLink = screen.getByRole('link', { name: /launcher.*\.bat/i });
    expect(batLink).not.toHaveAttribute('disabled');
    expect(batLink).toHaveAttribute('href', '/api/download/launcher-bat');
  });

  it('does not show the "legacy dashboard" tooltip for download buttons', () => {
    renderAdminHubView();
    expect(screen.queryByText(/legacy dashboard/i)).not.toBeInTheDocument();
  });
});

// ── Advanced lock button tests ──

describe('Advanced lock button', () => {
  it('renders the lock button when isAdvancedUnlocked is false', () => {
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /unlock advanced sections/i })).toBeInTheDocument();
  });

  it('renders the lock button label "🔒 Advanced" when locked', () => {
    renderAdminHubView();
    expect(screen.getByText(/🔒 Advanced/)).toBeInTheDocument();
  });

  it('renders the "Lock Advanced" button when isAdvancedUnlocked is true', () => {
    mockState.isAdvancedUnlocked = true;
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /lock advanced sections/i })).toBeInTheDocument();
    mockState.isAdvancedUnlocked = false;
  });

  it('calls tryAdvancedUnlock when the lock button is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderAdminHubView();
    await user.click(screen.getByRole('button', { name: /unlock advanced sections/i }));
    expect(mockActions.tryAdvancedUnlock).toHaveBeenCalledOnce();
  });

  it('calls advancedLock when the unlock button is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    mockState.isAdvancedUnlocked = true;
    renderAdminHubView();
    await user.click(screen.getByRole('button', { name: /lock advanced sections/i }));
    expect(mockActions.advancedLock).toHaveBeenCalledOnce();
    mockState.isAdvancedUnlocked = false;
  });
});

// ── New always-visible sections ──

describe('Enterprise Standards Panel', () => {
  it('renders the Enterprise Standards section heading', () => {
    renderAdminHubView();
    expect(screen.getByRole('heading', { name: /enterprise standards/i })).toBeInTheDocument();
  });
});

describe('Credential Management Section', () => {
  it('renders the Credential Management section heading', () => {
    renderAdminHubView();
    expect(screen.getByRole('heading', { name: /credential management/i })).toBeInTheDocument();
  });
});

// ── Advanced-gated sections ──

describe('Advanced-gated sections', () => {
  it('shows the locked placeholder when isAdvancedUnlocked is false', () => {
    renderAdminHubView();
    expect(screen.getByText(/unlock advanced/i)).toBeInTheDocument();
  });

  it('renders Tool Visibility section when isAdvancedUnlocked is true', () => {
    mockState.isAdvancedUnlocked = true;
    renderAdminHubView();
    expect(screen.getByRole('heading', { name: /tool visibility/i })).toBeInTheDocument();
    mockState.isAdvancedUnlocked = false;
  });

  it('renders Client Diagnostics panel when isAdvancedUnlocked is true', () => {
    mockState.isAdvancedUnlocked = true;
    renderAdminHubView();
    expect(screen.getByRole('heading', { name: /client diagnostics/i })).toBeInTheDocument();
    mockState.isAdvancedUnlocked = false;
  });

  it('renders TBX Backup/Restore section when isAdvancedUnlocked is true', () => {
    mockState.isAdvancedUnlocked = true;
    renderAdminHubView();
    expect(screen.getByRole('heading', { name: /backup.*restore/i })).toBeInTheDocument();
    mockState.isAdvancedUnlocked = false;
  });

  it('does not render the three advanced sections when locked', () => {
    renderAdminHubView();
    expect(screen.queryByRole('heading', { name: /tool visibility/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /client diagnostics/i })).not.toBeInTheDocument();
  });
});

// ── Service Connectivity section tests ──

describe('Service Connectivity section', () => {
  it('renders the Service Connectivity section heading', () => {
    renderAdminHubView();
    expect(screen.getByRole('heading', { name: /service connectivity/i })).toBeInTheDocument();
  });

  it('shows a lock message when admin is not unlocked', () => {
    mockState.isAdminUnlocked = false;
    renderAdminHubView();
    expect(screen.getByText(/unlock admin access to edit service credentials/i)).toBeInTheDocument();
  });

  it('does not show the Snow fields when admin is not unlocked', () => {
    mockState.isAdminUnlocked = false;
    renderAdminHubView();
    expect(screen.queryByLabelText(/instance url/i)).not.toBeInTheDocument();
  });

  it('renders the ServiceNow and GitHub sub-headings when admin is unlocked', () => {
    mockState.isAdminUnlocked = true;
    renderAdminHubView();
    expect(screen.getByRole('heading', { name: /servicenow/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /github/i })).toBeInTheDocument();
    mockState.isAdminUnlocked = false;
  });

  it('renders Save SNow Config and Save GitHub Config buttons when admin is unlocked', () => {
    mockState.isAdminUnlocked = true;
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /save snow config/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save github config/i })).toBeInTheDocument();
    mockState.isAdminUnlocked = false;
  });

  it('shows the loading indicator while config is being fetched', () => {
    mockState.isAdminUnlocked = true;
    mockState.isConnectivityConfigLoading = true;
    renderAdminHubView();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    mockState.isAdminUnlocked = false;
    mockState.isConnectivityConfigLoading = false;
  });

  it('shows a connectivity config error message when one is set', () => {
    mockState.isAdminUnlocked = true;
    mockState.connectivityConfigError = 'Failed to load connectivity config: HTTP 500';
    renderAdminHubView();
    expect(screen.getByText(/failed to load connectivity config/i)).toBeInTheDocument();
    mockState.isAdminUnlocked = false;
    mockState.connectivityConfigError = null;
  });
});

// ── Feature Request section tests ──

describe('Feature Request section', () => {
  beforeEach(() => {
    // Spy on window.open so we can assert it was called without opening a real tab.
    vi.spyOn(window, 'open').mockImplementation(() => null);
    // Spy on navigator.clipboard.writeText so the copy path doesn't touch real clipboard.
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the Feature Request section heading', () => {
    renderAdminHubView();
    expect(screen.getByRole('heading', { name: /request a feature/i })).toBeInTheDocument();
  });

  it('renders the feature title input', () => {
    renderAdminHubView();
    expect(screen.getByLabelText(/feature title/i)).toBeInTheDocument();
  });

  it('renders the description textarea', () => {
    renderAdminHubView();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  });

  it('renders the Open GitHub Issue button', () => {
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /open github issue/i })).toBeInTheDocument();
  });

  it('renders the Copy Request button', () => {
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /copy request/i })).toBeInTheDocument();
  });

  it('disables both buttons when the title is empty', () => {
    renderAdminHubView();
    expect(screen.getByRole('button', { name: /open github issue/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /copy request/i })).toBeDisabled();
  });

  it('enables both buttons when the title has content', async () => {
    const user = userEvent.setup();
    renderAdminHubView();

    await user.type(screen.getByLabelText(/feature title/i), 'Add dark mode');

    expect(screen.getByRole('button', { name: /open github issue/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /copy request/i })).toBeEnabled();
  });

  it('opens a pre-filled GitHub new-issue URL when submitted', async () => {
    const user = userEvent.setup();
    renderAdminHubView();

    await user.type(screen.getByLabelText(/feature title/i), 'My feature idea');
    await user.click(screen.getByRole('button', { name: /open github issue/i }));

    expect(window.open).toHaveBeenCalledOnce();

    const calledUrl = (window.open as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('github.com/mikejsmith1985/NodeToolbox/issues/new');
    expect(calledUrl).toContain('labels=enhancement');
    expect(calledUrl).toContain(encodeURIComponent('My feature idea'));
  });

  it('opens with noopener security flag', async () => {
    const user = userEvent.setup();
    renderAdminHubView();

    await user.type(screen.getByLabelText(/feature title/i), 'My feature');
    await user.click(screen.getByRole('button', { name: /open github issue/i }));

    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('github.com'),
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('clears the form fields after GitHub submission', async () => {
    const user = userEvent.setup();
    renderAdminHubView();

    const titleInput = screen.getByLabelText(/feature title/i) as HTMLInputElement;
    await user.type(titleInput, 'My feature');
    await user.click(screen.getByRole('button', { name: /open github issue/i }));

    expect(titleInput.value).toBe('');
  });

  it('shows a browser-tab confirmation message after GitHub submission', async () => {
    const user = userEvent.setup();
    renderAdminHubView();

    await user.type(screen.getByLabelText(/feature title/i), 'My feature');
    await user.click(screen.getByRole('button', { name: /open github issue/i }));

    expect(screen.getByText(/browser tab opened/i)).toBeInTheDocument();
  });

  it('calls clipboard.writeText with the request text when Copy Request is clicked', async () => {
    const user = userEvent.setup();
    renderAdminHubView();

    await user.type(screen.getByLabelText(/feature title/i), 'My clipboard feature');
    await user.click(screen.getByRole('button', { name: /copy request/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledOnce();
    const copiedText = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(copiedText).toContain('My clipboard feature');
    expect(copiedText).toContain('Feature Request:');
  });

  it('does not call window.open when Copy Request is clicked', async () => {
    const user = userEvent.setup();
    renderAdminHubView();

    await user.type(screen.getByLabelText(/feature title/i), 'My feature');
    await user.click(screen.getByRole('button', { name: /copy request/i }));

    expect(window.open).not.toHaveBeenCalled();
  });

  it('shows a "Copied!" confirmation message after Copy Request is clicked', async () => {
    const user = userEvent.setup();
    renderAdminHubView();

    await user.type(screen.getByLabelText(/feature title/i), 'My feature');
    await user.click(screen.getByRole('button', { name: /copy request/i }));

    expect(screen.getByText(/copied!/i)).toBeInTheDocument();
  });
});
