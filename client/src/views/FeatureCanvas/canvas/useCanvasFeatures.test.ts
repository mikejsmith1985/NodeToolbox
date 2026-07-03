// useCanvasFeatures.test.ts — Verifies the canvas surfaces nothing until an ART team is configured.

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useCanvasFeatures } from './useCanvasFeatures.ts';

describe('useCanvasFeatures', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reports the no-team state when no ART team matches the active board', () => {
    const { result } = renderHook(() => useCanvasFeatures());
    expect(result.current.status).toBe('no-team');
    expect(result.current.team).toBeNull();
    expect(result.current.items).toHaveLength(0);
  });
});
