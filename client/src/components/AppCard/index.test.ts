// index.test.ts — Unit tests for the AppCard barrel export.

import { describe, expect, it } from 'vitest';

import { AppCard } from './index.ts';

describe('AppCard index export', () => {
  it('re-exports AppCard as a function', () => {
    expect(typeof AppCard).toBe('function');
  });
});
