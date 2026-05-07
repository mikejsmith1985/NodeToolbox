// useMermaidEditorState.test.ts — Verifies Mermaid Editor state persistence and template behaviour.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  MERMAID_EDITOR_STORAGE_KEY,
  useMermaidEditorState,
} from './useMermaidEditorState.ts';

const STORED_SEQUENCE_DIAGRAM = 'sequenceDiagram\n  Alice->>Bob: Hello';
const CUSTOM_FLOWCHART_SOURCE = 'flowchart TD\n  Start --> Finish';

beforeEach(() => {
  window.localStorage.clear();
});

describe('useMermaidEditorState', () => {
  it('starts with a default flowchart when no saved diagram exists', () => {
    const { result } = renderHook(() => useMermaidEditorState());

    expect(result.current.diagramSource).toContain('flowchart');
    expect(result.current.templates.length).toBeGreaterThanOrEqual(3);
    expect(result.current.renderErrorMessage).toBeNull();
  });

  it('restores the saved Mermaid source from localStorage', () => {
    window.localStorage.setItem(MERMAID_EDITOR_STORAGE_KEY, STORED_SEQUENCE_DIAGRAM);

    const { result } = renderHook(() => useMermaidEditorState());

    expect(result.current.diagramSource).toBe(STORED_SEQUENCE_DIAGRAM);
  });

  it('persists source changes immediately so work survives navigation', () => {
    const { result } = renderHook(() => useMermaidEditorState());

    act(() => {
      result.current.setDiagramSource(CUSTOM_FLOWCHART_SOURCE);
    });

    expect(result.current.diagramSource).toBe(CUSTOM_FLOWCHART_SOURCE);
    expect(window.localStorage.getItem(MERMAID_EDITOR_STORAGE_KEY)).toBe(CUSTOM_FLOWCHART_SOURCE);
  });

  it('applies templates and clears previous render errors', () => {
    const { result } = renderHook(() => useMermaidEditorState());
    const sequenceTemplate = result.current.templates.find((template) => template.id === 'sequence');

    act(() => {
      result.current.setRenderErrorMessage('Old Mermaid parse error');
      result.current.applyTemplate('sequence');
    });

    expect(sequenceTemplate).toBeDefined();
    expect(result.current.diagramSource).toBe(sequenceTemplate?.source);
    expect(result.current.renderErrorMessage).toBeNull();
    expect(window.localStorage.getItem(MERMAID_EDITOR_STORAGE_KEY)).toBe(sequenceTemplate?.source);
  });

  it('clears the editor and removes the saved diagram', () => {
    window.localStorage.setItem(MERMAID_EDITOR_STORAGE_KEY, STORED_SEQUENCE_DIAGRAM);
    const { result } = renderHook(() => useMermaidEditorState());

    act(() => {
      result.current.setRenderErrorMessage('Existing Mermaid parse error');
      result.current.clearDiagramSource();
    });

    expect(result.current.diagramSource).toBe('');
    expect(result.current.renderErrorMessage).toBeNull();
    expect(window.localStorage.getItem(MERMAID_EDITOR_STORAGE_KEY)).toBeNull();
  });
});
