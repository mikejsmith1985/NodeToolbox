// useAdminHubState.test.ts — Unit tests for the Admin Hub state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAdminHubState } from './useAdminHubState.ts';

describe('useAdminHubState', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    // Default: server accepts the unlock request so most tests succeed without
    // explicitly mocking fetch — they override in the failure cases.
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
  });

  it('initialises with proxy URLs from localStorage', () => {
    localStorage.setItem('tbxJiraProxyUrl', 'http://jira.example.com');
    const { result } = renderHook(() => useAdminHubState());
    expect(result.current.state.proxyUrls.jiraProxyUrl).toBe('http://jira.example.com');
  });

  it('setProxyUrl updates the jira proxy URL in state', () => {
    const { result } = renderHook(() => useAdminHubState());
    act(() => {
      result.current.actions.setProxyUrl('jira', 'http://new-jira.example.com');
    });
    expect(result.current.state.proxyUrls.jiraProxyUrl).toBe('http://new-jira.example.com');
  });

  it('saveProxyUrls persists the jira URL to localStorage', () => {
    const { result } = renderHook(() => useAdminHubState());
    act(() => {
      result.current.actions.setProxyUrl('jira', 'http://saved-jira.example.com');
      result.current.actions.saveProxyUrls();
    });
    expect(localStorage.getItem('tbxJiraProxyUrl')).toBe('http://saved-jira.example.com');
  });

  it('setArtField updates the art settings field in state', () => {
    const { result } = renderHook(() => useAdminHubState());
    act(() => {
      result.current.actions.setArtField('piName', 'PI 26.2');
    });
    expect(result.current.state.artSettings.piName).toBe('PI 26.2');
  });

  it('tryUnlock calls /api/admin-verify and sets isAdminUnlocked on success', async () => {
    const { result } = renderHook(() => useAdminHubState());

    act(() => {
      result.current.actions.setAdminUsername('admin');
      result.current.actions.setAdminPinInput('toolbox');
      result.current.actions.tryUnlock();
    });

    await waitFor(() => {
      expect(result.current.state.isAdminUnlocked).toBe(true);
    });
    expect(result.current.state.adminUnlockError).toBeNull();
  });

  it('tryUnlock sets adminUnlockError when server returns 401', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    } as Response);

    const { result } = renderHook(() => useAdminHubState());

    act(() => {
      result.current.actions.setAdminUsername('wrong');
      result.current.actions.setAdminPinInput('credentials');
      result.current.actions.tryUnlock();
    });

    await waitFor(() => {
      expect(result.current.state.adminUnlockError).not.toBeNull();
    });
    expect(result.current.state.isAdminUnlocked).toBe(false);
  });

  it('tryUnlock sets adminUnlockError on network failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAdminHubState());

    act(() => {
      result.current.actions.tryUnlock();
    });

    await waitFor(() => {
      expect(result.current.state.adminUnlockError).not.toBeNull();
    });
    expect(result.current.state.isAdminUnlocked).toBe(false);
  });

  it('lock sets isAdminUnlocked to false', async () => {
    const { result } = renderHook(() => useAdminHubState());

    act(() => {
      result.current.actions.tryUnlock();
    });
    await waitFor(() => {
      expect(result.current.state.isAdminUnlocked).toBe(true);
    });

    act(() => {
      result.current.actions.lock();
    });
    expect(result.current.state.isAdminUnlocked).toBe(false);
  });

  it('toggleFeatureFlag flips isSnowIntegrationEnabled', () => {
    const { result } = renderHook(() => useAdminHubState());
    const initialValue = result.current.state.featureFlags.isSnowIntegrationEnabled;
    act(() => {
      result.current.actions.toggleFeatureFlag('isSnowIntegrationEnabled');
    });
    expect(result.current.state.featureFlags.isSnowIntegrationEnabled).toBe(!initialValue);
  });
});

// ── Connectivity config tests ──

vi.mock('../../../services/connectivityConfigApi.ts', () => ({
  fetchConnectivityConfig: vi.fn(),
  saveConnectivityConfig: vi.fn(),
  testSnowConnectivity: vi.fn(),
  testGitHubConnectivity: vi.fn(),
}));

import {
  fetchConnectivityConfig,
  saveConnectivityConfig,
  testSnowConnectivity,
  testGitHubConnectivity,
} from '../../../services/connectivityConfigApi.ts';

const MOCK_CONNECTIVITY_CONFIG = {
  snow: { baseUrl: 'https://acme.service-now.com', hasCredentials: true, usernameMasked: 'svc_****x' },
  github: { baseUrl: 'https://api.github.com', hasPat: true },
};

describe('connectivity config', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('loadConnectivityConfig updates connectivityConfig on success', async () => {
    vi.mocked(fetchConnectivityConfig).mockResolvedValueOnce(MOCK_CONNECTIVITY_CONFIG);
    const { result } = renderHook(() => useAdminHubState());

    await act(async () => {
      await result.current.actions.loadConnectivityConfig();
    });

    expect(result.current.state.connectivityConfig).toEqual(MOCK_CONNECTIVITY_CONFIG);
    expect(result.current.state.connectivityConfigError).toBeNull();
    expect(result.current.state.isConnectivityConfigLoading).toBe(false);
  });

  it('loadConnectivityConfig sets connectivityConfigError on fetch failure', async () => {
    vi.mocked(fetchConnectivityConfig).mockRejectedValueOnce(new Error('Network error'));
    const { result } = renderHook(() => useAdminHubState());

    await act(async () => {
      await result.current.actions.loadConnectivityConfig();
    });

    expect(result.current.state.connectivityConfig).toBeNull();
    expect(result.current.state.connectivityConfigError).toBe('Network error');
  });

  it('saveSnowConfig calls saveConnectivityConfig and updates state', async () => {
    vi.mocked(saveConnectivityConfig).mockResolvedValueOnce(MOCK_CONNECTIVITY_CONFIG);
    const { result } = renderHook(() => useAdminHubState());

    await act(async () => {
      await result.current.actions.saveSnowConfig({
        baseUrl: 'https://acme.service-now.com',
        username: 'svc_user',
        password: 'secret',
      });
    });

    expect(result.current.state.connectivityConfig).toEqual(MOCK_CONNECTIVITY_CONFIG);
    expect(result.current.state.connectivitySaveStatus).toBe('✓ Saved');
  });

  it('testSnowConfig sets snowTestResult on success', async () => {
    vi.mocked(testSnowConnectivity).mockResolvedValueOnce({ isOk: true, statusCode: 200, message: 'OK' });
    const { result } = renderHook(() => useAdminHubState());

    await act(async () => {
      await result.current.actions.testSnowConfig();
    });

    expect(result.current.state.snowTestResult?.isOk).toBe(true);
    expect(result.current.state.isSnowTesting).toBe(false);
  });

  it('testSnowConfig sets a failure result on fetch error', async () => {
    vi.mocked(testSnowConnectivity).mockRejectedValueOnce(new Error('Timeout'));
    const { result } = renderHook(() => useAdminHubState());

    await act(async () => {
      await result.current.actions.testSnowConfig();
    });

    expect(result.current.state.snowTestResult?.isOk).toBe(false);
    expect(result.current.state.snowTestResult?.message).toBe('Test request failed.');
  });

  it('testGitHubConfig sets githubTestResult on success', async () => {
    vi.mocked(testGitHubConnectivity).mockResolvedValueOnce({ isOk: true, statusCode: 200, message: 'OK' });
    const { result } = renderHook(() => useAdminHubState());

    await act(async () => {
      await result.current.actions.testGitHubConfig();
    });

    expect(result.current.state.githubTestResult?.isOk).toBe(true);
    expect(result.current.state.isGitHubTesting).toBe(false);
  });
});

// ── Update check tests ──

describe('checkForUpdates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checkForUpdates sets updateCheckResult on success and clears error', async () => {
    const mockResult = {
      currentVersion: '0.7.2',
      latestVersion: '0.7.2',
      hasUpdate: false,
      releaseNotes: '',
    };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResult,
    } as Response);

    const { result } = renderHook(() => useAdminHubState());

    await act(async () => {
      await result.current.actions.checkForUpdates();
    });

    expect(result.current.state.updateCheckResult).toEqual(mockResult);
    expect(result.current.state.updateCheckError).toBeNull();
    expect(result.current.state.isCheckingUpdate).toBe(false);
  });

  it('checkForUpdates sets updateCheckError when the fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAdminHubState());

    await act(async () => {
      await result.current.actions.checkForUpdates();
    });

    expect(result.current.state.updateCheckError).toBe(
      'Could not check for updates: Network error',
    );
    expect(result.current.state.updateCheckResult).toBeNull();
    expect(result.current.state.isCheckingUpdate).toBe(false);
  });

  it('checkForUpdates sets updateCheckError when the server returns non-200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    const { result } = renderHook(() => useAdminHubState());

    await act(async () => {
      await result.current.actions.checkForUpdates();
    });

    expect(result.current.state.updateCheckError).toContain('503');
    expect(result.current.state.isCheckingUpdate).toBe(false);
  });
});
