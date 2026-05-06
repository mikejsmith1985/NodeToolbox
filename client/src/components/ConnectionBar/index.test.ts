// index.test.ts — Unit tests for the ConnectionBar barrel export.

import { describe, expect, it } from 'vitest';

import { ConnectionBar } from './index.ts';

describe('ConnectionBar index export', () => {
  it('re-exports ConnectionBar as a function', () => {
    expect(typeof ConnectionBar).toBe('function');
  });
});
