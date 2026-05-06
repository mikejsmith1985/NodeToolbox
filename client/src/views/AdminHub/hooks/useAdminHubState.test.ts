// useAdminHubState.test.ts — Unit tests for the Admin Hub state hook.

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useAdminHubState } from './useAdminHubState.ts';

describe('useAdminHubState', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
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

  it('tryUnlock sets isAdminUnlocked to true with correct PIN', () => {
    const { result } = renderHook(() => useAdminHubState());
    act(() => {
      result.current.actions.setAdminPinInput('1234');
      result.current.actions.tryUnlock();
    });
    expect(result.current.state.isAdminUnlocked).toBe(true);
  });

  it('tryUnlock does not unlock with wrong PIN', () => {
    const { result } = renderHook(() => useAdminHubState());
    act(() => {
      result.current.actions.setAdminPinInput('9999');
      result.current.actions.tryUnlock();
    });
    expect(result.current.state.isAdminUnlocked).toBe(false);
  });

  it('lock sets isAdminUnlocked to false', () => {
    const { result } = renderHook(() => useAdminHubState());
    act(() => {
      result.current.actions.setAdminPinInput('1234');
      result.current.actions.tryUnlock();
    });
    expect(result.current.state.isAdminUnlocked).toBe(true);
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
