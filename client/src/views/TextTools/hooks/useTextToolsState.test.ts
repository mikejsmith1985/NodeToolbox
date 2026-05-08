// useTextToolsState.test.ts — Unit tests for the text tools state hook.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { mockSettingsGetState } = vi.hoisted(() => ({
  mockSettingsGetState: vi.fn(() => ({
    textToolsTab: 'case',
    setTextToolsTab: vi.fn(),
  })),
}));

vi.mock('../../../store/settingsStore', () => ({
  useSettingsStore: {
    getState: mockSettingsGetState,
  },
}));

import { useTextToolsState } from './useTextToolsState.ts';

describe('useTextToolsState', () => {
  it('initialises with default tab value', () => {
    const { result } = renderHook(() => useTextToolsState());
    expect(result.current.state.activeTab).toBe('case');
  });

  it('setActiveTab updates activeTab state', () => {
    const { result } = renderHook(() => useTextToolsState());
    act(() => {
      result.current.actions.setActiveTab('json');
    });
    expect(result.current.state.activeTab).toBe('json');
  });

  it('accepts the embedded Mermaid tab value', () => {
    const { result } = renderHook(() => useTextToolsState());
    act(() => {
      result.current.actions.setActiveTab('mermaid');
    });
    expect(result.current.state.activeTab).toBe('mermaid');
  });

  it('setSmartFormatterInput updates smartFormatterInput', () => {
    const { result } = renderHook(() => useTextToolsState());
    act(() => {
      result.current.actions.setSmartFormatterInput('some input text');
    });
    expect(result.current.state.smartFormatterInput).toBe('some input text');
  });

  it('clearSmartFormatter resets smartFormatterInput to empty string', () => {
    const { result } = renderHook(() => useTextToolsState());
    act(() => {
      result.current.actions.setSmartFormatterInput('some text');
      result.current.actions.clearSmartFormatter();
    });
    expect(result.current.state.smartFormatterInput).toBe('');
  });

  it('setJsonInput updates jsonInput', () => {
    const { result } = renderHook(() => useTextToolsState());
    act(() => {
      result.current.actions.setJsonInput('{"test": true}');
    });
    expect(result.current.state.jsonInput).toBe('{"test": true}');
  });

  it('setBase64Operation toggles between encode and decode', () => {
    const { result } = renderHook(() => useTextToolsState());
    expect(result.current.state.base64Operation).toBe('encode');
    act(() => {
      result.current.actions.setBase64Operation('decode');
    });
    expect(result.current.state.base64Operation).toBe('decode');
    act(() => {
      result.current.actions.setBase64Operation('encode');
    });
    expect(result.current.state.base64Operation).toBe('encode');
  });
});
